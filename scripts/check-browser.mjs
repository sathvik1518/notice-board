// Real browser proof: real WordPress (7.1.4 + SQLite) + real Vite page + real Chromium.
// Run:  npm run proof      (needs `npm run wp:setup` once; starts and stops everything itself)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { installFresh, readCreds, root, startServer, wpDir } from "../harness/wp.mjs";

const WP = "http://localhost:8080";
const PROXY_APP = "http://localhost:5173";
const CORS_APP = "http://localhost:5174";
const shots = path.join(wpDir, "proof");
mkdirSync(shots, { recursive: true });

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failures.push(`${name} ${detail}`);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HIDDEN = ["DRAFT: secret exam paper", "Scheduled: next term notice", "Staff only: salary dates"];

function startVite(args) {
  const child = spawn("npx", ["vite", ...args], { cwd: root, stdio: "ignore" });
  return child;
}
async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("never came up: " + url);
}
const isNoticesApi = (u) => new URL(u).pathname.endsWith("/wp-json/wp/v2/notices");

installFresh();
let wp = await startServer({ port: 8080 });
const proxyVite = startVite(["--port", "5173", "--strictPort"]);
const corsVite = startVite(["--mode", "cors", "--port", "5174", "--strictPort"]);
await Promise.all([waitFor(PROXY_APP), waitFor(CORS_APP)]);

const browser = await chromium.launch();
const pageErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  const apiRequests = [];
  page.on("request", (r) => {
    if (isNoticesApi(r.url())) apiRequests.push(new URL(r.url()));
  });
  const bodies = [];
  page.on("response", async (r) => {
    if (r.url().includes("/wp-json/")) bodies.push(await r.text().catch(() => ""));
  });
  const titles = async () => (await page.locator(".notice h2").allTextContents());
  const pagerText = () => page.locator(".pager span").textContent();

  // ---------- proxy mode ----------
  await page.goto(PROXY_APP);
  await page.locator(".notice").first().waitFor();
  check("loads 5 notices on the first page", (await page.locator(".notice").count()) === 5);
  check("pager says Page 1 of 3 · 12 notices", (await pagerText()) === "Page 1 of 3 · 12 notices", await pagerText());
  check("newest notice is first", (await titles())[0] === "Annual Day rehearsal schedule", String(await titles()));
  await page.screenshot({ path: path.join(shots, "01-list.png") });

  // check 2: & is shown properly
  check('check 2: "Q&A with the Principal" is shown with a real &', (await titles()).includes("Q&A with the Principal"), String(await titles()));
  const bodyText = await page.locator("body").innerText();
  check("check 2: no '&amp;' or '&#8217;' text anywhere on the page", !/&amp;|&#\d+;|&hellip;/.test(bodyText));

  // walk every page; check 1: no draft / scheduled / private anywhere
  const seen = [...(await titles())];
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Page 2 of 3").waitFor();
  await page.locator(".notice").first().waitFor();
  seen.push(...(await titles()));
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Page 3 of 3").waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".notice").length === 2);
  seen.push(...(await titles()));
  check("pages hold 5, 5 and 2 notices (12 in total, all different)", seen.length === 12 && new Set(seen).size === 12, String(seen.length));
  check("Next is disabled on the last page", await page.getByRole("button", { name: "Next" }).isDisabled());
  check("check 1: no draft, scheduled or private notice on any page", HIDDEN.every((h) => !seen.includes(h)), String(seen));
  check("check 1: their titles never even arrived in the browser", HIDDEN.every((h) => bodies.every((b) => !b.includes(h))));
  check("every request asked for status=publish", apiRequests.length > 0 && apiRequests.every((u) => u.searchParams.get("status") === "publish"));

  // class filter
  await page.getByRole("button", { name: "Previous" }).click();
  await page.getByText("Page 2 of 3").waitFor();
  await page.getByLabel("Class").selectOption("Class 9B");
  await page.getByText("Page 1 of 1 · 4 notices").waitFor();
  check("class filter shows only Class 9B (4 notices, went back to page 1)", (await page.locator(".notice").count()) === 4 && (await page.locator(".notice .chip").allTextContents()).every((c) => c === "Class 9B"));
  check("the class dropdown lists only classes of published notices", JSON.stringify(await page.getByLabel("Class").locator("option").allTextContents()) === JSON.stringify(["All classes", "Class 10C", "Class 8A", "Class 9B"]));
  check("the hidden notices' classes (12D, 7F, 6S) are not offered", !(await page.getByLabel("Class").innerText()).match(/12D|7F|6S/));
  await page.getByLabel("Class").selectOption("");
  await page.getByText("Page 1 of 3 · 12 notices").waitFor();

  // search with & in it
  await page.getByLabel("Search notices").fill("Q&A");
  await page.getByText("Page 1 of 1 · 1 notice").waitFor();
  check("searching for 'Q&A' (with the &) finds the notice", (await titles()).join() === "Q&A with the Principal", String(await titles()));
  await page.getByLabel("Search notices").fill("secret");
  await page.getByText("No notices match your search.").waitFor();
  check("searching for a word that is only in the draft finds nothing", true);
  await page.screenshot({ path: path.join(shots, "02-empty-search.png") });
  await page.getByLabel("Search notices").fill("");
  await page.getByText("Page 1 of 3 · 12 notices").waitFor();

  // check 3: fast typing
  await page.waitForTimeout(500);
  const before = apiRequests.length;
  await page.getByLabel("Search notices").pressSequentially("library", { delay: 40 });
  await page.getByText("Page 1 of 1 · 1 notice").waitFor();
  await page.waitForTimeout(600);
  const newSearches = apiRequests.slice(before).filter((u) => u.searchParams.has("search"));
  check("check 3: typing 'library' (7 keys, 40 ms apart) sent exactly 1 search request", newSearches.length === 1 && newSearches[0].searchParams.get("search") === "library", `sent ${newSearches.length}: ${newSearches.map((u) => u.searchParams.get("search"))}`);
  check("...and nothing was sent while the keys were still going (no 'l', 'li', 'lib'...)", newSearches.every((u) => u.searchParams.get("search") === "library"));
  await page.getByLabel("Search notices").fill("");
  await page.getByText("Page 1 of 3 · 12 notices").waitFor();

  // check 4: server error
  await page.route((u) => isNoticesApi(u.toString()), (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "internal_server_error", message: "boom" }) }));
  await page.getByLabel("Search notices").fill("fail");
  await page.getByRole("alert").waitFor();
  const alertText = await page.getByRole("alert").innerText();
  check("check 4: a 500 shows a message", /server had a problem/i.test(alertText), alertText);
  check("check 4: the error screen has Try again and no stale notices", (await page.getByRole("button", { name: "Try again" }).count()) === 1 && (await page.locator(".notice").count()) === 0);
  await page.screenshot({ path: path.join(shots, "03-error.png") });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.getByLabel("Search notices").fill("");
  await page.getByText("Page 1 of 3 · 12 notices").waitFor();
  check("after the server recovers, clearing the search shows the list again", (await page.locator(".notice").count()) === 5);

  // Try again button after a real failure
  let failNext = true;
  await page.route((u) => isNoticesApi(u.toString()), (route) => (failNext ? route.fulfill({ status: 500, body: "{}", contentType: "application/json" }) : route.continue()));
  await page.getByLabel("Search notices").fill("holiday");
  await page.getByRole("alert").waitFor();
  failNext = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByText("Page 1 of 1 · 1 notice").waitFor();
  check("Try again works once the server is fine", (await titles()).join() === "Holiday on Monday", String(await titles()));
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.getByLabel("Search notices").fill("");
  await page.getByText("Page 1 of 3 · 12 notices").waitFor();

  // a slow, then fast answer: the old one must not win
  let slowOnce = true;
  await page.route((u) => isNoticesApi(u.toString()), async (route) => {
    if (slowOnce && !new URL(route.request().url()).searchParams.has("search")) {
      slowOnce = false;
      await sleep(1200);
    }
    await route.continue().catch(() => {});
  });
  await page.getByLabel("Class").selectOption("Class 10C"); // first request (class only) is slow ...
  await page.getByLabel("Class").selectOption("Class 8A"); // ... and is replaced right away
  await page.getByText("Page 1 of 1 · 4 notices").waitFor();
  await page.waitForTimeout(1500);
  const chips = await page.locator(".notice .chip").allTextContents();
  check("an old slow answer (Class 10C) never replaces the newer one (Class 8A)", chips.length === 4 && chips.every((c) => c === "Class 8A"), String(chips));
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.getByLabel("Class").selectOption("");

  // an Editor publishes and saves a draft -> the page reflects only the published one
  const creds = readCreds();
  const auth = "Basic " + Buffer.from(`${creds.editor1.login}:${creds.editor1.appPassword}`).toString("base64");
  const post = (body) => fetch(`${WP}/wp-json/wp/v2/notices`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  await post({ title: "Editor secret draft", status: "draft", meta: { notice_class: "Class 5Z" } });
  await post({ title: "Fish & Chips day", status: "publish", meta: { notice_class: "Class 5A" } });
  await page.reload();
  await page.locator(".notice").first().waitFor();
  check("a notice the Editor just published is first, with a proper &", (await titles())[0] === "Fish & Chips day", String(await titles()));
  check("the pager now says 13 notices", (await pagerText()) === "Page 1 of 3 · 13 notices", await pagerText());
  check("the Editor's new draft is not on the page, and its class is not in the filter", !(await page.locator("body").innerText()).includes("Editor secret draft") && !(await page.getByLabel("Class").innerText()).includes("5Z"));
  check("the new class (Class 5A) is offered in the filter", (await page.getByLabel("Class").innerText()).includes("Class 5A"));

  // phone width
  await page.setViewportSize({ width: 375, height: 800 });
  await page.waitForTimeout(200);
  check("375 px wide: no sideways scrolling", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: path.join(shots, "04-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 1000, height: 900 });

  // server completely off (the proxy answers 502/500 for a dead target)
  wp.kill();
  await sleep(800);
  await page.reload();
  await page.getByRole("alert").waitFor();
  const offText = await page.getByRole("alert").innerText();
  check("server switched off: says it can't reach the notice board (not 'server had a problem')", /can't reach/i.test(offText), offText);
  await page.screenshot({ path: path.join(shots, "05-server-off.png") });
  wp = await startServer({ port: 8080, keepDb: true });
  await page.getByRole("button", { name: "Try again" }).click();
  await page.locator(".notice").first().waitFor();
  check("server switched back on: Try again brings the list back", (await page.locator(".notice").count()) === 5);

  // ---------- cross-origin mode (page on :5174, WordPress on :8080, no proxy) ----------
  const page2 = await ctx.newPage();
  page2.on("pageerror", (e) => pageErrors.push(String(e)));
  const cross = [];
  page2.on("request", (r) => {
    if (isNoticesApi(r.url())) cross.push(r.url());
  });
  await page2.goto(CORS_APP);
  await page2.locator(".notice").first().waitFor();
  check("cross-origin mode: list loads straight from WordPress on :8080", cross.length > 0 && cross.every((u) => u.startsWith(WP)), cross[0]);
  const crossPager = await page2.locator(".pager span").textContent();
  check("cross-origin mode: the page count header is readable (Page 1 of 3 · 13 notices)", crossPager === "Page 1 of 3 · 13 notices", crossPager);
  await page2.getByRole("button", { name: "Next" }).click();
  await page2.getByText("Page 2 of 3").waitFor();
  check("cross-origin mode: Next works", (await page2.locator(".notice").count()) === 5);
  await page2.screenshot({ path: path.join(shots, "06-cors.png") });

  check("no uncaught errors in the page", pageErrors.length === 0, pageErrors.join(" | "));
} catch (err) {
  failures.push("CRASH " + (err?.stack ?? err));
  console.log("CRASH", err);
} finally {
  await browser.close();
  wp.kill();
  proxyVite.kill();
  corsVite.kill();
}
console.log(`\n${passed} passed, ${failures.length} failed  (screenshots: ${shots})`);
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
process.exit(0);
