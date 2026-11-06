// Builds and runs a throw-away WordPress for testing the plugin.
//   node harness/wp.mjs setup     download WordPress + the SQLite plugin (once), install a fresh site with test data
//   node harness/wp.mjs start     run the site at http://localhost:8080   (Ctrl+C to stop)
//
// Needs: git, and PHP 8.1+ with the sqlite extension (pdo_sqlite). No MySQL, no Docker.
// WordPress is cloned from GitHub (the wordpress.org download site is not needed).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const root = path.resolve(import.meta.dirname, "..");
export const wpDir = path.join(root, ".wp");
export const siteDir = path.join(wpDir, "site");
export const credsFile = path.join(wpDir, "creds.json");
export const dbDir = path.join(siteDir, "wp-content", "database");
const cacheDir = path.join(wpDir, "cache");
const php = process.env.PHP ?? "php";

// Pinned, so the test site is the same every time.
const WORDPRESS = { url: "https://github.com/WordPress/WordPress.git", tag: "7.1.4" };
const SQLITE_PLUGIN = { url: "https://github.com/WordPress/sqlite-database-integration.git", sha: "6ca5528eec8aa1cb66ac6af038b42e5b8cbd7a4c" };

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: options.quiet ? "pipe" : "inherit", encoding: "utf8", ...options });
  if (r.status !== 0) {
    // PHP prints its errors on stdout, so show both
    throw new Error(`${cmd} ${args.join(" ")} failed (exit code ${r.status ?? "none"})${r.error ? `\n${r.error.message}` : ""}${r.stdout ? `\n${r.stdout}` : ""}${r.stderr ? `\n${r.stderr}` : ""}`);
  }
  return r.stdout;
}

function cloneWordPress(target) {
  console.log(`Cloning WordPress ${WORDPRESS.tag} ...`);
  run("git", ["clone", "--depth", "1", "--branch", WORDPRESS.tag, WORDPRESS.url, target]);
}
function cloneSqlitePlugin(target) {
  console.log("Fetching the SQLite Database Integration plugin ...");
  mkdirSync(target, { recursive: true });
  run("git", ["init", "-q"], { cwd: target });
  run("git", ["fetch", "--depth", "1", "-q", SQLITE_PLUGIN.url, SQLITE_PLUGIN.sha], { cwd: target });
  run("git", ["checkout", "-q", "FETCH_HEAD"], { cwd: target });
}

/** WordPress + the SQLite plugin + our plugin, put together in .wp/site. Downloads only the first time. */
export function ensureSite() {
  if (!existsSync(path.join(siteDir, "wp-load.php"))) {
    mkdirSync(cacheDir, { recursive: true });
    const wpClone = path.join(cacheDir, "WordPress");
    const sqliteClone = path.join(cacheDir, "sqlite");
    if (!existsSync(wpClone)) cloneWordPress(wpClone);
    if (!existsSync(sqliteClone)) cloneSqlitePlugin(sqliteClone);
    console.log("Putting the site together ...");
    rmSync(siteDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); // Windows can hold files for a moment (antivirus, a leftover php.exe)
    cpSync(wpClone, siteDir, { recursive: true, filter: (src) => !src.includes(`${path.sep}.git${path.sep}`) && !src.endsWith(`${path.sep}.git`) });
    const pluginTarget = path.join(siteDir, "wp-content", "plugins", "sqlite-database-integration");
    // dereference: the plugin folder in the repo uses a symbolic link for its database code
    cpSync(path.join(sqliteClone, "packages", "plugin-sqlite-database-integration"), pluginTarget, { recursive: true, dereference: true });
    // On Windows, git does not create symbolic links: the "database" folder arrives as a small text file. So copy the real folder in explicitly (works everywhere).
    const dbCode = path.join(pluginTarget, "wp-includes", "database");
    rmSync(dbCode, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    cpSync(path.join(sqliteClone, "packages", "mysql-on-sqlite", "src"), dbCode, { recursive: true });
    // On Windows, git often turns a symbolic link into a small text file. Then `wp-includes/database` is a file, not a folder,
    // and WordPress crashes. If so, copy the real folder the link points to.
    const linked = path.join(pluginTarget, "wp-includes", "database");
    if (!statSync(linked).isDirectory()) {
      rmSync(linked, { force: true });
      cpSync(path.join(sqliteClone, "packages", "mysql-on-sqlite", "src"), linked, { recursive: true });
    }
    let dbPhp = readFileSync(path.join(pluginTarget, "db.copy"), "utf8");
    dbPhp = dbPhp.replaceAll("'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'", "__DIR__.'/plugins/sqlite-database-integration'").replaceAll("{SQLITE_PLUGIN}", "sqlite-database-integration/load.php");
    writeFileSync(path.join(siteDir, "wp-content", "db.php"), dbPhp); // the "drop-in" that swaps MySQL for SQLite
  }
  // our plugin and settings are copied fresh every time, so edits in plugin/ are picked up
  const ours = path.join(siteDir, "wp-content", "plugins", "notice-board");
  rmSync(ours, { recursive: true, force: true });
  cpSync(path.join(root, "plugin", "notice-board"), ours, { recursive: true });
  cpSync(path.join(root, "harness", "wp-config.php"), path.join(siteDir, "wp-config.php"));
}

/** An empty database, WordPress installed, plugin active, test users and notices added. */
export function installFresh() {
  const mods = spawnSync(php, ["-m"], { encoding: "utf8" });
  if (mods.error) throw new Error("PHP was not found. Install PHP 8.1+ and put it on PATH (php -v), or set the PHP environment variable to php.exe.");
  const have = (mods.stdout || "").toLowerCase();
  for (const need of ["pdo_sqlite", "sqlite3", "mbstring"]) {
    if (!have.includes(need)) throw new Error(`Your PHP is missing the "${need}" extension. Open php.ini (php --ini shows where), remove the ; before extension=${need}, save, and run again.`);
  }
  ensureSite();
  mkdirSync(dbDir, { recursive: true });
  for (const f of readdirSync(dbDir)) if (f.startsWith(".ht.sqlite")) rmSync(path.join(dbDir, f), { force: true });
  console.log("Installing WordPress ...");
  const out = run(php, [path.join(root, "harness", "install.php"), siteDir, credsFile], { quiet: true });
  console.log(out.trim());
}

/** Starts PHP's built-in web server. Resolves when WordPress answers. */
export async function startServer({ port = 8080, dbFile, dbDirOverride } = {}) {
  const env = { ...process.env, WP_PORT: String(port) };
  if (dbFile) env.WP_DB_FILE = dbFile;
  if (dbDirOverride) env.WP_DB_DIR = dbDirOverride;
  const child = spawn(php, ["-S", `localhost:${port}`, "-t", siteDir, path.join(root, "harness", "router.php")], { env, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/wp-json/`);
      if (res.ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`WordPress did not start on port ${port}`);
}

export const readCreds = () => JSON.parse(readFileSync(credsFile, "utf8"));

if (process.argv[1] === import.meta.filename) {
  const [command] = process.argv.slice(2);
  if (command === "setup") {
    installFresh();
    console.log("\nDone. Start it with:  npm run wp:start");
    console.log("Log in at http://localhost:8080/wp-login.php   (admin / admin-pass-123, editor1 / editor-pass-123, subscriber1 / subscriber-pass-123)");
  } else if (command === "start") {
    ensureSite();
    if (!existsSync(credsFile)) installFresh();
    const child = await startServer();
    console.log("WordPress is running at http://localhost:8080   (Ctrl+C to stop)");
    child.on("exit", () => process.exit(0));
    process.on("SIGINT", () => child.kill());
  } else {
    console.log("Usage: node harness/wp.mjs setup | start");
    process.exit(1);
  }
}
