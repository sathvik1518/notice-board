// Tests the real plugin inside a real WordPress (WordPress 7.1.4 + SQLite, started by harness/wp.mjs).
// Run:  npm run test:wp        (the first run downloads WordPress from GitHub; later runs take a few seconds)
//
// Order matters: the read-only checks come first, then the checks that create or change notices, then the plugin lifecycle,
// then backup and restore (which proves the changes above survive a copy into a new database).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { dbDir, installFresh, readCreds, root, siteDir, startServer, wpDir } from "../harness/wp.mjs";

const PORT = 8080;
const BASE = `http://localhost:${PORT}/wp-json`;
let server;
let creds;

before(async () => {
  installFresh(); // an empty database, every run: the tests never depend on what an earlier run left behind
  creds = readCreds();
  server = await startServer({ port: PORT });
});
after(() => server?.kill());

/** One call to the REST API. `as` is a login name from creds.json (Application Password), or nothing for a visitor. */
async function api(method, route, { as, body, headers = {}, base = BASE } = {}) {
  const h = { ...headers };
  if (as) h.Authorization = "Basic " + Buffer.from(`${creds[as].login}:${creds[as].appPassword}`).toString("base64");
  if (body !== undefined) h["Content-Type"] = "application/json";
  const res = await fetch(base + route, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, headers: res.headers };
}
const titles = (res) => res.json.map((n) => n.title.rendered);
const HIDDEN = ["DRAFT: secret exam paper", "Scheduled: next term notice", "Staff only: salary dates"];

describe("a visitor (not signed in) reading the list", () => {
  it("sees only the 12 published notices, 5 per page, in 3 pages", async () => {
    const res = await api("GET", "/wp/v2/notices?per_page=5");
    assert.equal(res.status, 200);
    assert.equal(res.json.length, 5);
    assert.equal(res.headers.get("x-wp-total"), "12");
    assert.equal(res.headers.get("x-wp-totalpages"), "3");
  });

  it("gets the newest notice first", async () => {
    const res = await api("GET", "/wp/v2/notices?per_page=5&orderby=date&order=desc");
    assert.equal(res.json[0].title.rendered, "Annual Day rehearsal schedule");
    const dates = res.json.map((n) => n.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  it("is newest first even with no ordering asked for (WordPress default)", async () => {
    const res = await api("GET", "/wp/v2/notices?per_page=12");
    const dates = res.json.map((n) => n.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  it("gets 2 notices on page 3, and a 400 'rest_post_invalid_page_number' on page 4", async () => {
    const third = await api("GET", "/wp/v2/notices?per_page=5&page=3");
    assert.equal(third.json.length, 2);
    const fourth = await api("GET", "/wp/v2/notices?per_page=5&page=4");
    assert.equal(fourth.status, 400);
    assert.equal(fourth.json.code, "rest_post_invalid_page_number");
  });

  it("NEVER sees the draft, the scheduled notice or the private one (even asking for 100 at once)", async () => {
    const res = await api("GET", "/wp/v2/notices?per_page=100");
    assert.equal(res.json.length, 12);
    for (const hidden of HIDDEN) assert.ok(!titles(res).includes(hidden), `${hidden} leaked`);
  });

  for (const status of ["draft", "future", "private", "pending", "any", "trash"]) it(`asking for status=${status} is refused`, async () => {
    const res = await api("GET", `/wp/v2/notices?status=${status}`);
    assert.ok(res.status === 400 || res.status === 401 || res.status === 403, `status=${status} gave ${res.status}`);
    assert.ok(!JSON.stringify(res.json).includes("secret exam paper"));
  });

  it("is refused a draft fetched by its id", async () => {
    const drafts = await api("GET", "/wp/v2/notices?status=draft", { as: "admin" });
    const id = drafts.json[0].id;
    const res = await api("GET", `/wp/v2/notices/${id}`);
    assert.ok([401, 403, 404].includes(res.status), `gave ${res.status}`);
    assert.ok(!JSON.stringify(res.json).includes("secret exam paper"));
  });

  it("finds notices by search text, and the search cannot find a hidden one", async () => {
    const found = await api("GET", "/wp/v2/notices?search=Library");
    assert.deepEqual(titles(found), ["Library books due Friday"]);
    const body = await api("GET", "/wp/v2/notices?search=rehearsal");
    assert.equal(body.json.length, 1);
    const hidden = await api("GET", "/wp/v2/notices?search=secret");
    assert.equal(hidden.json.length, 0);
  });

  for (const [cls, count] of [["Class 8A", 4], ["Class 9B", 4], ["Class 10C", 3]]) it(`filters by class: ${cls} has ${count} notices`, async () => {
    const res = await api("GET", `/wp/v2/notices?per_page=100&notice_class=${encodeURIComponent(cls)}`);
    assert.equal(res.json.length, count);
    assert.ok(res.json.every((n) => n.meta.notice_class === cls));
  });

  it("an unknown class is an empty list, not an error", async () => {
    const res = await api("GET", "/wp/v2/notices?notice_class=Nope");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, []);
    assert.equal(res.headers.get("x-wp-total"), "0");
  });

  it("the class filter cannot be used for SQL injection", async () => {
    const res = await api("GET", `/wp/v2/notices?notice_class=${encodeURIComponent("' OR '1'='1")}`);
    assert.equal(res.status, 200);
    assert.equal(res.json.length, 0);
    const second = await api("GET", `/wp/v2/notices?notice_class=${encodeURIComponent("x' ); DROP TABLE wp_posts; --")}`);
    assert.equal(second.json.length, 0);
    assert.equal((await api("GET", "/wp/v2/notices")).headers.get("x-wp-total"), "12");
  });

  it("a class longer than 40 characters is refused with a 400", async () => {
    const res = await api("GET", `/wp/v2/notices?notice_class=${"x".repeat(41)}`);
    assert.equal(res.status, 400);
  });

  it("the list of classes holds only the classes of published notices", async () => {
    const res = await api("GET", "/notice-board/v1/classes");
    assert.deepEqual(res.json, ["Class 10C", "Class 8A", "Class 9B"]); // not 12D (draft), 7F (scheduled), 6S (private), or ""
  });

  it("_fields keeps the answer small: only what was asked for comes back", async () => {
    const res = await api("GET", "/wp/v2/notices?per_page=1&_fields=id,title");
    assert.deepEqual(Object.keys(res.json[0]).sort(), ["id", "title"]);
  });

  it("the answer does not give away author accounts when only the shown fields are asked for", async () => {
    const res = await api("GET", "/wp/v2/notices?per_page=1&_fields=id,date,title,excerpt,meta");
    assert.ok(!("author" in res.json[0]));
  });

  it("the page count header can be read from another origin (CORS)", async () => {
    const res = await api("GET", "/wp/v2/notices?per_page=5", { headers: { Origin: "http://localhost:5173" } });
    assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.match(res.headers.get("access-control-expose-headers"), /X-WP-TotalPages/i);
  });

  it("the meta 'notice_class' is shown in the REST answer", async () => {
    const res = await api("GET", "/wp/v2/notices?per_page=1");
    assert.equal(res.json[0].meta.notice_class, "Class 8A");
  });
});

describe("a visitor trying to write", () => {
  it("cannot create a notice: 401", async () => {
    const res = await api("POST", "/wp/v2/notices", { body: { title: "Hacked", status: "publish" } });
    assert.equal(res.status, 401);
    assert.equal(res.json.code, "rest_cannot_create");
  });
  it("cannot delete or change one: 401", async () => {
    const list = await api("GET", "/wp/v2/notices?per_page=1");
    const id = list.json[0].id;
    assert.equal((await api("DELETE", `/wp/v2/notices/${id}`)).status, 401);
    assert.equal((await api("POST", `/wp/v2/notices/${id}`, { body: { title: "x" } })).status, 401);
  });
});

describe("a Subscriber", () => {
  it("can read the notices", async () => {
    const res = await api("GET", "/wp/v2/notices?per_page=5", { as: "subscriber1" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-wp-total"), "12");
  });

  it("cannot create a notice: 403", async () => {
    const res = await api("POST", "/wp/v2/notices", { as: "subscriber1", body: { title: "Not allowed", status: "publish" } });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, "rest_cannot_create");
  });

  it("cannot even save a draft: 403", async () => {
    assert.equal((await api("POST", "/wp/v2/notices", { as: "subscriber1", body: { title: "Draft", status: "draft" } })).status, 403);
  });

  it("cannot edit, change the class of, or delete an existing notice: 403", async () => {
    const id = (await api("GET", "/wp/v2/notices?per_page=1")).json[0].id;
    assert.equal((await api("POST", `/wp/v2/notices/${id}`, { as: "subscriber1", body: { title: "Changed" } })).status, 403);
    assert.equal((await api("POST", `/wp/v2/notices/${id}`, { as: "subscriber1", body: { meta: { notice_class: "Class 1A" } } })).status, 403);
    assert.equal((await api("DELETE", `/wp/v2/notices/${id}`, { as: "subscriber1" })).status, 403);
    assert.equal((await api("GET", `/wp/v2/notices/${id}`)).json.title.rendered, "Annual Day rehearsal schedule");
  });

  it("cannot see drafts or private notices", async () => {
    for (const status of ["draft", "private", "future"]) {
      const res = await api("GET", `/wp/v2/notices?status=${status}`, { as: "subscriber1" });
      assert.ok(res.status >= 400, `status=${status} gave ${res.status}`);
    }
  });

  it("has the 'read' capability and none of the notice or plugin ones", async () => {
    const me = await api("GET", "/wp/v2/users/me?context=edit", { as: "subscriber1" });
    assert.equal(me.json.capabilities.read, true);
    for (const cap of ["edit_notices", "publish_notices", "edit_others_notices", "delete_notices", "install_plugins", "activate_plugins"]) {
      assert.ok(!me.json.capabilities[cap], `a Subscriber has ${cap}`);
    }
  });

  it("cannot see, install or switch on a plugin: 403", async () => {
    assert.equal((await api("GET", "/wp/v2/plugins", { as: "subscriber1" })).status, 403);
    assert.equal((await api("POST", "/wp/v2/plugins", { as: "subscriber1", body: { slug: "hello-dolly", status: "active" } })).status, 403);
  });
});

describe("a user who can write ordinary posts (Author) but was not given notice rights", () => {
  it("cannot create a notice: notices have their own capabilities, not the ones of posts", async () => {
    const made = await api("POST", "/wp/v2/users", { as: "admin", body: { username: "author1", email: "author1@example.test", password: "author-pass-123!x", roles: ["author"] } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const pw = await api("POST", `/wp/v2/users/${made.json.id}/application-passwords`, { as: "admin", body: { name: "test" } });
    assert.equal(pw.status, 201);
    creds.author1 = { login: "author1", appPassword: pw.json.password };
    const me = await api("GET", "/wp/v2/users/me?context=edit", { as: "author1" });
    assert.equal(me.json.capabilities.publish_posts, true); // an Author really can publish posts ...
    assert.ok(!me.json.capabilities.publish_notices); // ... but not notices
    const res = await api("POST", "/wp/v2/notices", { as: "author1", body: { title: "From an author", status: "publish" } });
    assert.equal(res.status, 403);
  });
});

describe("an Editor", () => {
  it("can write and publish notices, and edit other people's", async () => {
    const me = await api("GET", "/wp/v2/users/me?context=edit", { as: "editor1" });
    for (const cap of ["edit_notices", "publish_notices", "edit_others_notices", "edit_published_notices", "delete_notices", "read_private_notices"]) {
      assert.equal(me.json.capabilities[cap], true, `an Editor lacks ${cap}`);
    }
  });

  it("can NOT install, activate, edit or delete plugins, or change themes or settings", async () => {
    const me = await api("GET", "/wp/v2/users/me?context=edit", { as: "editor1" });
    for (const cap of ["install_plugins", "activate_plugins", "edit_plugins", "update_plugins", "delete_plugins", "install_themes", "switch_themes", "manage_options", "create_users"]) {
      assert.ok(!me.json.capabilities[cap], `an Editor has ${cap}`);
    }
  });

  it("is refused when trying to install a plugin through the REST API: 403", async () => {
    const res = await api("POST", "/wp/v2/plugins", { as: "editor1", body: { slug: "hello-dolly", status: "active" } });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, "rest_cannot_install_plugin");
  });

  it("is refused when listing plugins: 403", async () => {
    assert.equal((await api("GET", "/wp/v2/plugins", { as: "editor1" })).status, 403);
  });

  it("can see the draft, the scheduled and the private notices (a visitor cannot)", async () => {
    for (const [status, title] of [["draft", HIDDEN[0]], ["future", HIDDEN[1]], ["private", HIDDEN[2]]]) {
      const res = await api("GET", `/wp/v2/notices?status=${status}`, { as: "editor1" });
      assert.equal(res.status, 200);
      assert.deepEqual(titles(res), [title]);
    }
  });

  it("saves a draft: 201, and a visitor still cannot see it", async () => {
    const created = await api("POST", "/wp/v2/notices", { as: "editor1", body: { title: "Editor draft", content: "Hello", status: "draft", meta: { notice_class: "Class 5A" } } });
    assert.equal(created.status, 201);
    assert.equal(created.json.status, "draft");
    const list = await api("GET", "/wp/v2/notices?per_page=100");
    assert.equal(list.json.length, 12);
    assert.ok(!titles(list).includes("Editor draft"));
    assert.ok([401, 403, 404].includes((await api("GET", `/wp/v2/notices/${created.json.id}`)).status));
    assert.ok(!(await api("GET", "/notice-board/v1/classes")).json.includes("Class 5A"), "a draft's class leaked into the class list");
    globalThis.editorDraftId = created.json.id;
  });

  it("publishes it: it now shows to visitors, newest first, with its class", async () => {
    const id = globalThis.editorDraftId;
    const res = await api("POST", `/wp/v2/notices/${id}`, { as: "editor1", body: { status: "publish" } });
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "publish");
    const list = await api("GET", "/wp/v2/notices?per_page=5");
    assert.equal(list.headers.get("x-wp-total"), "13");
    assert.equal(list.json[0].title.rendered, "Editor draft"); // published just now, so the newest
    assert.ok((await api("GET", "/notice-board/v1/classes")).json.includes("Class 5A"));
    assert.equal((await api("GET", "/wp/v2/notices?notice_class=Class%205A")).json.length, 1);
  });

  it("gives the post date to notices it publishes, and keeps a scheduled one hidden", async () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 19);
    const res = await api("POST", "/wp/v2/notices", { as: "editor1", body: { title: "Next week", status: "publish", date: future } });
    assert.equal(res.json.status, "future");
    assert.equal((await api("GET", "/wp/v2/notices?per_page=100")).headers.get("x-wp-total"), "13");
    await api("DELETE", `/wp/v2/notices/${res.json.id}?force=true`, { as: "editor1" });
  });

  it("stores a title with an & as typed, and the REST answer escapes it", async () => {
    const res = await api("POST", "/wp/v2/notices", { as: "editor1", body: { title: "Fish & Chips <3 \"quoted\"", status: "draft" } });
    assert.equal(res.status, 201);
    const raw = await api("GET", `/wp/v2/notices/${res.json.id}?context=edit`, { as: "editor1" });
    assert.equal(raw.json.title.raw, 'Fish & Chips <3 "quoted"');
    assert.match(res.json.title.rendered, /Fish &(amp|#038);/); // HTML escaped: a page must decode it before showing it as text
    await api("DELETE", `/wp/v2/notices/${res.json.id}?force=true`, { as: "editor1" });
  });

  it("cleans the class: tags removed, spaces tidied", async () => {
    const id = globalThis.editorDraftId;
    const res = await api("POST", `/wp/v2/notices/${id}`, { as: "editor1", body: { meta: { notice_class: " <b>Class</b>  5B <i>x</i> " } } });
    assert.equal(res.status, 200);
    assert.equal(res.json.meta.notice_class, "Class 5B x");
    assert.ok(!res.json.meta.notice_class.includes("<"));
    await api("POST", `/wp/v2/notices/${id}`, { as: "editor1", body: { meta: { notice_class: "Class 5A" } } });
  });

  it("is refused a class longer than 40 characters: 400", async () => {
    const id = globalThis.editorDraftId;
    const res = await api("POST", `/wp/v2/notices/${id}`, { as: "editor1", body: { meta: { notice_class: "x".repeat(41) } } });
    assert.equal(res.status, 400);
  });

  it("cannot write any other meta field through the REST API", async () => {
    const id = globalThis.editorDraftId;
    const res = await api("POST", `/wp/v2/notices/${id}`, { as: "editor1", body: { meta: { _secret: "x", random_key: "y" } } });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.json.meta), ["notice_class"]); // unknown meta keys are ignored
  });

  it("can delete a notice (to the trash, then for good)", async () => {
    const id = globalThis.editorDraftId;
    const trashed = await api("DELETE", `/wp/v2/notices/${id}`, { as: "editor1" });
    assert.equal(trashed.status, 200);
    assert.equal(trashed.json.status, "trash");
    assert.equal((await api("GET", "/wp/v2/notices?per_page=100")).headers.get("x-wp-total"), "12");
    const gone = await api("DELETE", `/wp/v2/notices/${id}?force=true`, { as: "editor1" });
    assert.equal(gone.json.deleted, true);
  });
});

describe("an Admin", () => {
  it("can manage plugins (so the Editor's 403 above is about the role, not a broken site)", async () => {
    const res = await api("GET", "/wp/v2/plugins", { as: "admin" });
    assert.equal(res.status, 200);
    const ours = res.json.find((p) => p.plugin === "notice-board/notice-board");
    assert.equal(ours.status, "active");
    const me = await api("GET", "/wp/v2/users/me?context=edit", { as: "admin" });
    assert.equal(me.json.capabilities.install_plugins, true);
    assert.equal(me.json.capabilities.publish_notices, true);
  });
});

describe("the plugin's life: activate, deactivate, delete", () => {
  it("adds the capabilities once, keeps them when deactivated, removes them (not the notices) when deleted", () => {
    const run = spawnSync("php", [path.join(root, "harness", "lifecycle.php"), siteDir], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.deepEqual(out.afterInstall, { publish_notices: true, install_plugins: false });
    assert.deepEqual(out.afterSecondActivate, out.afterInstall); // activating twice changes nothing
    assert.equal(out.afterDeactivate.publish_notices, true); // a deactivated plugin leaves its data alone
    assert.deepEqual(out.afterUninstall, { publish_notices: false, install_plugins: false }); // deleting the plugin removes the capabilities
    assert.ok(out.noticesLeftInDatabase >= 15, `only ${out.noticesLeftInDatabase} notices were left`); // but never the content
    assert.deepEqual(out.afterReactivate, { publish_notices: true, install_plugins: false });
  });

  it("no role gets install_plugins from this plugin (Editor still cannot after the re-activation)", async () => {
    const me = await api("GET", "/wp/v2/users/me?context=edit", { as: "editor1" });
    assert.ok(!me.json.capabilities.install_plugins);
    assert.equal(me.json.capabilities.publish_notices, true);
  });
});

describe("backup and restore into a NEW database", () => {
  const backupDir = path.join(wpDir, "backup");
  const restoredDir = path.join(wpDir, "restored-db");
  const RESTORED = "http://localhost:8081/wp-json";
  let restored;

  before(async () => {
    rmSync(backupDir, { recursive: true, force: true });
    rmSync(restoredDir, { recursive: true, force: true });
    mkdirSync(backupDir, { recursive: true });
    mkdirSync(restoredDir, { recursive: true });
    const backup = path.join(backupDir, "notice-board-backup.sqlite");
    const run = spawnSync("php", [path.join(root, "harness", "backup.php"), path.join(dbDir, ".ht.sqlite"), backup], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    // "Restore" = put the backup in a database location that has never been used, and point a second site at it.
    const place = spawnSync("php", ["-r", `copy(${JSON.stringify(backup)}, ${JSON.stringify(path.join(restoredDir, ".ht.restored.sqlite"))});`]);
    assert.equal(place.status, 0);
    restored = await startServer({ port: 8081, dbFile: ".ht.restored.sqlite", dbDirOverride: restoredDir + path.sep });
  });
  after(() => restored?.kill());

  it("the restored site is a different database file from the original", () => {
    assert.notEqual(path.join(restoredDir, ".ht.restored.sqlite"), path.join(dbDir, ".ht.sqlite"));
  });

  it("has the same 12 notices, the same order, the same classes", async () => {
    const original = await api("GET", "/wp/v2/notices?per_page=100&_fields=id,date,title,meta");
    const copy = await api("GET", "/wp/v2/notices?per_page=100&_fields=id,date,title,meta", { base: RESTORED });
    assert.equal(copy.status, 200);
    assert.equal(copy.headers.get("x-wp-total"), "12");
    assert.deepEqual(copy.json, original.json);
  });

  it("still hides the draft, the scheduled and the private notice", async () => {
    const res = await api("GET", "/wp/v2/notices?per_page=100", { base: RESTORED });
    for (const hidden of HIDDEN) assert.ok(!titles(res).includes(hidden));
  });

  it("has the same users and roles: the Editor can publish, the Subscriber cannot, neither can install plugins", async () => {
    const editor = await api("GET", "/wp/v2/users/me?context=edit", { as: "editor1", base: RESTORED });
    assert.equal(editor.json.capabilities.publish_notices, true);
    assert.ok(!editor.json.capabilities.install_plugins);
    const sub = await api("POST", "/wp/v2/notices", { as: "subscriber1", base: RESTORED, body: { title: "x", status: "publish" } });
    assert.equal(sub.status, 403);
  });

  it("can take a new notice (it is a working site, not just a copy to look at)", async () => {
    const res = await api("POST", "/wp/v2/notices", { as: "editor1", base: RESTORED, body: { title: "After the restore", status: "publish" } });
    assert.equal(res.status, 201);
    assert.equal((await api("GET", "/wp/v2/notices?per_page=1", { base: RESTORED })).headers.get("x-wp-total"), "13");
    assert.equal((await api("GET", "/wp/v2/notices?per_page=1")).headers.get("x-wp-total"), "12"); // the original is untouched
  });

  it("has the class list too", async () => {
    assert.deepEqual((await api("GET", "/notice-board/v1/classes", { base: RESTORED })).json, ["Class 10C", "Class 8A", "Class 9B"]);
  });
});
