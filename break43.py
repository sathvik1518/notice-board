"""Break each rule once on purpose and check that the tests notice.
Run from the project folder:   python3 break43.py            (all)     or    python3 break43.py "draft" "debounce"   (only matching names)
Each case edits one file, runs the right test suite, expects it to FAIL, then puts the file back.
  wp  = the WordPress tests (npm run test:wp, about 10 s)      ts = type check + page tests (npm test, about 6 s)"""
import pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).parent
PLUGIN = ROOT / "plugin" / "notice-board" / "notice-board.php"
UNINSTALL = ROOT / "plugin" / "notice-board" / "uninstall.php"
API = ROOT / "src" / "api.ts"
BOARD = ROOT / "src" / "NoticeBoard.tsx"

# (name, file, old text, new text, suite)
CASES = [
  # ---- the plugin (tested inside a real WordPress) ----
  ("Subscriber is given the notice capabilities", PLUGIN, "return array( 'administrator', 'editor' );", "return array( 'administrator', 'editor', 'subscriber' );", "wp"),
  ("Editor is given install_plugins", PLUGIN, "\t\t\t$role->add_cap( $cap );\n\t\t}\n\t}\n}", "\t\t\t$role->add_cap( $cap );\n\t\t}\n\t\t$role->add_cap( 'install_plugins' );\n\t}\n}", "wp"),
  ("notice type uses the capabilities of ordinary posts", PLUGIN, "'capability_type' => array( 'notice', 'notices' ),", "'capability_type' => 'post',", "wp"),
  ("map_meta_cap switched off", PLUGIN, "'map_meta_cap'    => true,", "'map_meta_cap'    => false,", "wp"),
  ("class list includes classes of drafts and private notices", PLUGIN, "AND p.post_status = 'publish'", "", "wp"),
  ("class filter does nothing", PLUGIN, "if ( is_string( $class ) && '' !== $class ) {", "if ( false ) {", "wp"),
  ("class longer than 40 characters is accepted when saving", PLUGIN, "\t\t\t\t\t'maxLength' => NOTICE_BOARD_CLASS_MAX, // a longer value is refused with a 400\n", "", "wp"),
  ("class is saved without cleaning", PLUGIN, "'sanitize_callback' => 'notice_board_sanitize_class', // tags and extra spaces are removed before saving", "'sanitize_callback' => null, // tags and extra spaces are removed before saving", "wp"),
  ("class filter value is not length-checked", PLUGIN, "\t\t'maxLength'         => NOTICE_BOARD_CLASS_MAX,\n\t\t'sanitize_callback' => 'notice_board_sanitize_class',\n\t\t'validate_callback'", "\t\t'sanitize_callback' => 'notice_board_sanitize_class',\n\t\t'validate_callback'", "wp"),
  ("class meta is not shown in the REST answer", PLUGIN, "'show_in_rest'      => array(", "'show_in_rest'      => false, 'x_old' => array(", "wp"),
  ("uninstall leaves the capabilities behind", UNINSTALL, "$role->remove_cap( $cap );", "// $role->remove_cap( $cap );", "wp"),
  # ---- the React page ----
  ("page asks for drafts too (no status=publish)", API, '    status: "publish", // always asked for, so a draft can never be what we get\n', "", "ts"),
  ("page size is 10, not 5", API, "export const PAGE_SIZE = 5;", "export const PAGE_SIZE = 10;", "ts"),
  ("oldest first instead of newest first", API, 'order: "desc",', 'order: "asc",', "ts"),
  ("titles are not decoded (Q&amp;A shows up)", API, 'return new DOMParser().parseFromString(html, "text/html").documentElement.textContent ?? "";', "return html;", "ts"),
  ("excerpt keeps its HTML tags", API, 'return (doc.body.textContent ?? "").replace(/\\s+/g, " ").trim();', "return html;", "ts"),
  ("excerpt is put on the page as live HTML", BOARD, "{n.excerpt && <p>{n.excerpt}</p>}", "{n.excerpt && <p dangerouslySetInnerHTML={{ __html: n.excerpt }} />}", "ts"),
  ("search is not trimmed", API, "params.set(\"search\", q.search.trim());", 'params.set("search", q.search);', "ts"),
  ("no debounce: a request for every key", BOARD, "}, debounceMs);", "}, 0);", "ts"),
  ("old requests are not cancelled", BOARD, "    return () => controller.abort();\n  }, [page, search, noticeClass, retry]);", "    return () => {};\n  }, [page, search, noticeClass, retry]);", "ts"),
  ("changing the class stays on the same page number", BOARD, "setNoticeClass(e.target.value);\n              setPage(1);", "setNoticeClass(e.target.value);", "ts"),
  ("changing the search stays on the same page number", BOARD, "setSearch(typed);\n      setPage(1);", "setSearch(typed);", "ts"),
  ("a page that disappeared shows an error instead of page 1", BOARD, 'err.kind === "page" && page > 1) {', "false) {", "ts"),
  ("a dead server (502) is reported as a server problem", API, "const GATEWAY = new Set([502, 503, 504]);", "const GATEWAY = new Set<number>([]);", "ts"),
  ("page count header ignored", API, 'const totalPages = Number(res.headers.get("X-WP-TotalPages"));', "const totalPages = 1;", "ts"),
  ("'no match' and 'no notices yet' use the same message", BOARD, '{filtered ? "No notices match your search." : "There are no notices yet."}', '{"There are no notices yet."}', "ts"),
  ("Try again does nothing", BOARD, "onClick={() => setRetry((n) => n + 1)}", "onClick={() => {}}", "ts"),
  ("Next is never disabled", BOARD, "disabled={page >= view.data.totalPages}", "disabled={false}", "ts"),
  ("Previous is never disabled", BOARD, "disabled={page <= 1}", "disabled={false}", "ts"),
  ("class filter not sent to the server", API, 'if (q.noticeClass) params.set("notice_class", q.noticeClass);', "", "ts"),
  ("a failed request is never shown (spinner forever)", BOARD, 'setView({ state: "error", noServer: false,', 'setView({ state: "loading" }); void ({ noServer: false,', "ts"),
]

def run(suite):
    if suite == "wp":
        return subprocess.run("node --test --test-concurrency=1 tests/wp.test.mjs", shell=True, cwd=ROOT, capture_output=True, text=True).returncode
    r1 = subprocess.run("npx tsc --noEmit", shell=True, cwd=ROOT, capture_output=True, text=True)
    r2 = subprocess.run("npx vitest run", shell=True, cwd=ROOT, capture_output=True, text=True)
    return r1.returncode or r2.returncode

only = sys.argv[1:]
print("baseline (nothing broken):")
suites = {c[4] for c in CASES if not only or any(o in c[0] for o in only)}
for s in sorted(suites):
    code = run(s)
    print(f"  {s}: {'pass' if code == 0 else 'FAIL'}")
    if code:
        sys.exit("baseline must be green before breaking things")

missed = ran = 0
for name, path, old, new, suite in CASES:
    if only and not any(o in name for o in only):
        continue
    ran += 1
    text = path.read_text()
    if old not in text:
        print(f"SKIP   {name}  (text not found in {path.name})")
        missed += 1
        continue
    path.write_text(text.replace(old, new, 1))
    try:
        code = run(suite)
    finally:
        path.write_text(text)
    caught = code != 0
    missed += not caught
    print(f"{'CAUGHT' if caught else 'MISSED'}  {name}", flush=True)
print(f"\n{ran - missed}/{ran} broken rules were caught by the tests.")
sys.exit(1 if missed else 0)
