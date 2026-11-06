# School Notice Board: a WordPress Notice Type and a React Page That Reads It

**Day 43 Mini Capstone, Notice Board (CMS Basics, WordPress)**  
**Project folder:** `notice-board`

---

## 1. Goal

Build a school notice board on WordPress. The task (Day 43, Mini Capstone, *task only*) asked for:

1. A **Notice** content type with a **title**, a **body**, a **class** and a **publish date**.
2. An **Editor** can write and publish notices; a **Subscriber** can only read; **neither can install plugins**.
3. A **React page** that lists notices **newest first**, with a **search box**, a **class filter** and **pages of 5**.
4. The page shows **loading, empty and error** states and **never shows a draft**.
5. Hints: `register_post_meta`, `custom-fields`, `X-WP-TotalPages`, decode titles, cancel old requests.
6. Six self-checks: a draft never appears; a title with `&` looks right; fast typing sends few requests; a server error shows a message; a Subscriber cannot create a notice (403 or 401); you can restore your backup into a new database.

**What is real and what is not (read this first).** The sandbox this was built in has no MySQL and no Local/XAMPP. So everything runs on a **real WordPress 7.1.4** (downloaded from GitHub) using the official **SQLite Database Integration** plugin instead of MySQL, started with PHP's built-in server. The plugin, the REST API, the roles and the React page are the real thing and are tested against it. **Not verified:** MySQL itself (the MySQL backup commands in `BACKUP_AND_RESTORE.md` are the standard ones, not run here) and your own Local or XAMPP install. The restore check was done as the SQLite equivalent: back up to one file, restore into a database file that had never been used, start a second site on it.

Think of a school notice board in the corridor. **The Editor** pins notices up (and keeps drafts in the office drawer). **A Subscriber** may only read what is pinned. **The React page** is the screen outside the office: it asks the board "what is pinned, newest first, five at a time", and it must never show what is still in the drawer.

The rules this project is built around:

- **The server decides who may publish**, with capabilities (`publish_notices`), not the React page.
- **A draft is never public.** Not in the list, not by id, not by asking for `status=draft`, not in the class dropdown, not in search.
- **No role gets `install_plugins` from this plugin**, and an Editor never has it.
- **The page asks for `status=publish` every time**, as a second line of defence.
- **Titles arrive as HTML** (`Q&amp;A`), so the page decodes them. **Excerpts are shown as plain text**, never as HTML, because an Editor may write raw HTML.
- **One search request per pause in typing**, and every older request is cancelled.

---

## 2. Tools

| Tool | Role |
|---|---|
| WordPress 7.1.4 (tag from GitHub) | The CMS. The REST API at `/wp-json/wp/v2/notices` is what the page reads |
| SQLite Database Integration plugin (pinned commit) | Lets WordPress run on a SQLite file in the sandbox (no MySQL here) |
| PHP 8.3 built-in server (`php -S`) + `router.php` | Runs the test site, with pretty links like `/wp-json/...` |
| Vite 8 + React 19 + TypeScript 7 | The notice page, with a dev proxy and `--mode cors` |
| Vitest 5 + MSW 3 + React Testing Library | Page tests against a fake WordPress |
| `node:test` (built into Node 22) | `tests/wp.test.mjs`: tests against the REAL WordPress |
| Playwright (Chromium) | `scripts/check-browser.mjs`: real browser + real WordPress + real page |

---

## 3. Project structure

```
notice-board/
├── README.md
├── DOCUMENTATION.md
├── BACKUP_AND_RESTORE.md        (the backup steps and the restore-into-a-new-database test)
├── break43.py                   (breaks 31 rules once each; the tests must notice)
├── package.json, tsconfig.json, vite.config.ts, index.html
├── .env.development, .env.cors, .gitignore
├── plugin/notice-board/         (copy this folder into wp-content/plugins/)
│   ├── notice-board.php         (the Notice type, the class field, the roles, the REST extras, the edit-screen box)
│   └── uninstall.php            (removes the capabilities, keeps the notices)
├── harness/                     (a real test WordPress, nothing here is part of the plugin)
│   ├── wp.mjs                   (downloads WordPress, builds .wp/site, starts and stops it)
│   ├── wp-config.php, router.php
│   ├── install.php              (installs WordPress, makes users and test notices)
│   ├── backup.php               (consistent backup of the database file)
│   └── lifecycle.php            (activate, deactivate, delete, activate again)
├── tests/
│   └── wp.test.mjs              (56 tests against the real WordPress)
├── scripts/
│   └── check-browser.mjs        (33 checks in real Chromium)
└── src/
    ├── api.ts                   (everything that talks to WordPress)
    ├── NoticeBoard.tsx          (the page)
    ├── main.tsx, styles.css, vite-env.d.ts
    ├── api.test.ts              (34)
    ├── NoticeBoard.test.tsx     (33)
    └── test/setup.ts            (fake WordPress server for tests; any unhandled request fails the test)
```

---

## 4. Setup commands

```bash
# Needs Node 22+ and PHP 8.1+ with pdo_sqlite (check: php -m | findstr sqlite)
npm install
npx playwright install chromium       # only for the real-browser check
npm run wp:setup                      # once: downloads WordPress + the SQLite plugin from GitHub, installs the test site
```

**`package.json` scripts**

```json
"wp:setup": "node harness/wp.mjs setup",
"wp:start": "node harness/wp.mjs start",
"dev": "vite",
"dev:cors": "vite --mode cors",
"build": "tsc --noEmit && vite build",
"typecheck": "tsc --noEmit",
"test": "vitest run",
"test:wp": "node --test --test-concurrency=1 tests/wp.test.mjs",
"proof": "node scripts/check-browser.mjs"
```

---

## 5. The idea: a board with its own rules, and a screen that only trusts the server

**The content type.** `register_post_type('notice')` with `show_in_rest` (so `/wp-json/wp/v2/notices` exists) and **its own capabilities** (`capability_type => ['notice','notices']`, `map_meta_cap => true`). That gives WordPress the names `edit_notices`, `publish_notices`, `edit_others_notices`, `read_private_notices`, and so on. If the type used the ordinary post capabilities, anyone who can publish a *post* (an Author, say) could publish a *notice*. A test makes an Author and checks they get a 403.

**The four fields.** Title, body and publish date are what every WordPress post already has (title, editor, **the post's own date**: a notice dated in the future is held back as *scheduled* and is not public). The **class** is a custom field: `register_post_meta('notice','notice_class', ...)` with `show_in_rest`, a `maxLength` of 40, a sanitizer (tags and extra spaces removed) and an `auth_callback` (only someone who may edit that notice may change it). The type supports `custom-fields` so the field also shows in the editor.

**Who may do what.**

| Role | Read published | Write drafts | Publish | Edit others' notices | Install plugins |
|---|---|---|---|---|---|
| Visitor | yes | no (401) | no (401) | no | no |
| **Subscriber** | yes | **no (403)** | **no (403)** | no | **no** |
| **Editor** | yes | yes | **yes** | yes | **no (403)** |
| Administrator | yes | yes | yes | yes | yes (normal WordPress) |

Capabilities live in the database, so the plugin adds them **once, on activation**, to Administrator and Editor, and **never** to Subscriber. It never touches `install_plugins`: an Editor does not have it in stock WordPress, and a test proves it stays that way (`POST /wp/v2/plugins` gives 403). `uninstall.php` removes the capabilities when the plugin is *deleted*, but **keeps the notices** (a plugin must not delete people's content).

**What a visitor can see.** WordPress already refuses `status=draft`, `future` and `private` to people who are not signed in. The tests check it anyway for six statuses, by id, and by search. The class dropdown uses a small extra route, `/notice-board/v1/classes`, which lists only the classes of **published** notices (prepared SQL), so a draft's class cannot leak.

**What the page does.**

```
type in the box ──▶ wait 300 ms of quiet ──▶ search=...&page=1
pick a class    ──▶ notice_class=...&page=1
Next / Previous ──▶ page=N
every request:  per_page=5&orderby=date&order=desc&status=publish&_fields=id,date,title,excerpt,meta
answer:         X-WP-Total (how many)  X-WP-TotalPages (how many pages)  ──▶ "Page 2 of 3 · 12 notices"
a newer request cancels the older one (AbortController), so a slow old answer can never win
```

**Four screens:** *loading* ("Loading notices…", the pager is hidden so there is no stale Next button), *empty* (two different messages: "There are no notices yet." and "No notices match your search."), *error* (two different messages and a **Try again** button: *server off* says "Can't reach the notice board", *server answered with an error* says "The server had a problem") and *ready*.

**Titles.** WordPress sends `"Q&amp;A"` and `"Teacher&#8217;s Day"`. `DOMParser` turns that into text without running scripts or loading images. If the page did not decode, the screen would say `Q&amp;A`. If it put the title in with `innerHTML`, a hostile title could run code. Decoding to **text**, then letting React print it as text, avoids both.

**Excerpts** are decoded the same way and shown as **plain text**. An Editor has the `unfiltered_html` right, so their HTML is not cleaned by WordPress. The page therefore never uses `dangerouslySetInnerHTML`.

**Two ways to reach WordPress.** `npm run dev` uses a Vite **proxy** (`/wp-json` is forwarded to WordPress; the browser sees one address). `npm run dev:cors` talks to `http://localhost:8080` **directly** from another address; WordPress already sends `Access-Control-Allow-Origin` and `Access-Control-Expose-Headers: X-WP-Total, X-WP-TotalPages`, so the page can read the page count. Both modes are checked in a real browser.

**Backup and restore.** See `BACKUP_AND_RESTORE.md`: the real MySQL steps (not run here), and the SQLite version that was run and is tested automatically.

---

## 6. The code

### `plugin/notice-board/notice-board.php`

```php
<?php
/**
 * Plugin Name: Notice Board
 * Description: A "Notice" content type (title, body, class, publish date) with roles: an Editor can write and publish notices, a Subscriber can only read them. Notices are public through the REST API at /wp-json/wp/v2/notices.
 * Version:     1.0.0
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * License:     GPL-2.0-or-later
 * Text Domain: notice-board
 */

defined( 'ABSPATH' ) || exit; // never run this file directly

const NOTICE_BOARD_TYPE       = 'notice';
const NOTICE_BOARD_CLASS_META = 'notice_class';
const NOTICE_BOARD_CLASS_MAX  = 40;

/**
 * The capabilities of the Notice type. WordPress builds these names from capability_type:
 * ['notice', 'notices'] gives edit_notices, publish_notices, edit_others_notices and so on.
 * "read" stays the ordinary core capability, which every logged-in role (even Subscriber) already has.
 */
function notice_board_caps(): array {
	return array(
		'edit_notices',
		'edit_others_notices',
		'edit_published_notices',
		'edit_private_notices',
		'publish_notices',
		'read_private_notices',
		'delete_notices',
		'delete_others_notices',
		'delete_published_notices',
		'delete_private_notices',
	);
}

/** Roles that may manage notices. Subscriber is NOT here on purpose. No role gets install_plugins from this plugin. */
function notice_board_roles(): array {
	return array( 'administrator', 'editor' );
}

/* ---------------------------------------------------------------------------------------------------------
 * 1. The content type and its "class" field
 * ------------------------------------------------------------------------------------------------------ */

add_action( 'init', 'notice_board_register' );

function notice_board_register(): void {
	register_post_type(
		NOTICE_BOARD_TYPE,
		array(
			'labels'          => array(
				'name'          => __( 'Notices', 'notice-board' ),
				'singular_name' => __( 'Notice', 'notice-board' ),
				'add_new_item'  => __( 'Add new notice', 'notice-board' ),
				'edit_item'     => __( 'Edit notice', 'notice-board' ),
			),
			'public'          => true,
			'show_in_rest'    => true,       // needed for the block editor AND for /wp-json/wp/v2/notices
			'rest_base'       => 'notices',
			'menu_icon'       => 'dashicons-megaphone',
			'has_archive'     => false,
			// "custom-fields" lets the REST API read and write the registered meta below.
			'supports'        => array( 'title', 'editor', 'excerpt', 'custom-fields' ),
			'capability_type' => array( 'notice', 'notices' ),
			'map_meta_cap'    => true,       // turns edit_post / delete_post checks into the capabilities above
			'register_meta_box_cb' => 'notice_board_add_meta_box',
		)
	);

	// The "class" of a notice, e.g. "Class 8A". Stored as post meta, shown in REST under "meta".
	register_post_meta(
		NOTICE_BOARD_TYPE,
		NOTICE_BOARD_CLASS_META,
		array(
			'type'              => 'string',
			'single'            => true,
			'default'           => '',
			'show_in_rest'      => array(
				'schema' => array(
					'type'      => 'string',
					'maxLength' => NOTICE_BOARD_CLASS_MAX, // a longer value is refused with a 400
				),
			),
			'sanitize_callback' => 'notice_board_sanitize_class', // tags and extra spaces are removed before saving
			'auth_callback'     => static function ( $allowed, $meta_key, $post_id ) {
				return current_user_can( 'edit_post', $post_id );
			},
		)
	);
}

function notice_board_sanitize_class( $value ): string {
	$value = sanitize_text_field( (string) $value ); // strips tags, collapses spaces, removes line breaks
	return mb_substr( $value, 0, NOTICE_BOARD_CLASS_MAX );
}

/* ---------------------------------------------------------------------------------------------------------
 * 2. Who may do what. Capabilities are stored in the database, so they are added once, on activation.
 * ------------------------------------------------------------------------------------------------------ */

register_activation_hook( __FILE__, 'notice_board_activate' );

function notice_board_activate(): void {
	foreach ( notice_board_roles() as $role_name ) {
		$role = get_role( $role_name );
		if ( ! $role ) {
			continue;
		}
		foreach ( notice_board_caps() as $cap ) {
			$role->add_cap( $cap );
		}
	}
}

/* ---------------------------------------------------------------------------------------------------------
 * 3. REST: a class filter on the list, and a list of the classes in use
 * ------------------------------------------------------------------------------------------------------ */

// GET /wp-json/wp/v2/notices?notice_class=Class 8A
add_filter( 'rest_notice_collection_params', static function ( array $params ): array {
	$params['notice_class'] = array(
		'description'       => __( 'Only notices for this class.', 'notice-board' ),
		'type'              => 'string',
		'maxLength'         => NOTICE_BOARD_CLASS_MAX,
		'sanitize_callback' => 'notice_board_sanitize_class',
		'validate_callback' => 'rest_validate_request_arg',
	);
	return $params;
} );

add_filter( 'rest_notice_query', static function ( array $args, WP_REST_Request $request ): array {
	$class = $request->get_param( 'notice_class' );
	if ( is_string( $class ) && '' !== $class ) {
		// WP_Query builds this with prepared statements, so a quote in the value cannot break out of the query.
		$args['meta_query'][] = array(
			'key'     => NOTICE_BOARD_CLASS_META,
			'value'   => $class,
			'compare' => '=',
		);
	}
	return $args;
}, 10, 2 );

// GET /wp-json/notice-board/v1/classes  ->  ["Class 10C", "Class 8A", ...]  (only classes of PUBLISHED notices)
add_action( 'rest_api_init', static function (): void {
	register_rest_route(
		'notice-board/v1',
		'/classes',
		array(
			'methods'             => 'GET',
			'permission_callback' => '__return_true', // public: it lists only what a visitor could already see
			'callback'            => 'notice_board_list_classes',
		)
	);
} );

function notice_board_list_classes(): WP_REST_Response {
	global $wpdb;
	$values = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT DISTINCT pm.meta_value
			   FROM {$wpdb->postmeta} pm
			   JOIN {$wpdb->posts} p ON p.ID = pm.post_id
			  WHERE pm.meta_key = %s AND pm.meta_value <> '' AND p.post_type = %s AND p.post_status = 'publish'
			  ORDER BY pm.meta_value ASC",
			NOTICE_BOARD_CLASS_META,
			NOTICE_BOARD_TYPE
		)
	);
	return rest_ensure_response( array_values( array_map( 'strval', $values ) ) );
}

/* ---------------------------------------------------------------------------------------------------------
 * 4. The "Class" box on the edit screen
 * ------------------------------------------------------------------------------------------------------ */

function notice_board_add_meta_box(): void {
	add_meta_box( 'notice_board_class', __( 'Class', 'notice-board' ), 'notice_board_render_meta_box', NOTICE_BOARD_TYPE, 'side', 'high' );
}

function notice_board_render_meta_box( WP_Post $post ): void {
	wp_nonce_field( 'notice_board_save_class', 'notice_board_nonce' );
	printf(
		'<label for="notice_board_class_field" class="screen-reader-text">%1$s</label><input type="text" id="notice_board_class_field" name="notice_board_class_field" value="%2$s" maxlength="%3$d" class="widefat" placeholder="%4$s">',
		esc_html__( 'Class', 'notice-board' ),
		esc_attr( (string) get_post_meta( $post->ID, NOTICE_BOARD_CLASS_META, true ) ),
		NOTICE_BOARD_CLASS_MAX,
		esc_attr__( 'e.g. Class 8A', 'notice-board' )
	);
}

add_action( 'save_post_' . NOTICE_BOARD_TYPE, static function ( int $post_id ): void {
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( ! isset( $_POST['notice_board_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['notice_board_nonce'] ) ), 'notice_board_save_class' ) ) {
		return; // not our form (or a forged one)
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}
	$value = isset( $_POST['notice_board_class_field'] ) ? wp_unslash( $_POST['notice_board_class_field'] ) : '';
	update_post_meta( $post_id, NOTICE_BOARD_CLASS_META, notice_board_sanitize_class( $value ) );
} );
```

### `plugin/notice-board/uninstall.php`

```php
<?php
/**
 * Runs when the plugin is DELETED from the Plugins screen (not when it is only deactivated).
 * Removes the capabilities this plugin added. The notices themselves are left in the database on purpose:
 * deleting someone's content because a plugin was removed would be a nasty surprise.
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

foreach ( array( 'administrator', 'editor' ) as $role_name ) {
	$role = get_role( $role_name );
	if ( ! $role ) {
		continue;
	}
	foreach ( array(
		'edit_notices', 'edit_others_notices', 'edit_published_notices', 'edit_private_notices', 'publish_notices',
		'read_private_notices', 'delete_notices', 'delete_others_notices', 'delete_published_notices', 'delete_private_notices',
	) as $cap ) {
		$role->remove_cap( $cap );
	}
}
```

### `src/api.ts`

```ts
// All talking to WordPress lives here. The page itself never calls fetch.

export const PAGE_SIZE = 5;

export interface Notice {
  id: number;
  date: string; // the publish date, as WordPress sends it (site time, no timezone)
  title: string; // already decoded: "Q&A", not "Q&amp;A"
  excerpt: string; // plain text, no tags
  noticeClass: string; // "" when the notice has no class
}

export interface NoticePage {
  notices: Notice[];
  total: number;
  totalPages: number;
}

/** What went wrong, so the screen can say something useful.
 *  network = nobody answered (server off, no internet, or a gateway error from the dev proxy)
 *  http    = the server answered with an error (500 ...)
 *  page    = we asked for a page that does not exist any more (the list got shorter)
 *  aborted = we cancelled the request ourselves (a newer one replaced it): never shown */
export class ApiError extends Error {
  constructor(
    public kind: "network" | "http" | "page" | "aborted",
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = (import.meta.env.VITE_WP_BASE ?? "").replace(/\/$/, "");
const GATEWAY = new Set([502, 503, 504]);

/** WordPress sends titles as HTML ("Q&amp;A", "Teacher&#8217;s"). Turn that into the text a person reads.
 *  DOMParser never runs scripts or loads images, so this is safe even for a hostile title. */
export function decodeHtml(html: string): string {
  return new DOMParser().parseFromString(html, "text/html").documentElement.textContent ?? "";
}

/** An excerpt arrives as "<p>text [&hellip;]</p>". We show it as plain text (never as HTML),
 *  because an Editor is allowed to write raw HTML and we do not trust it. */
export function excerptToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style").forEach((el) => el.remove());
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

interface RawNotice {
  id: number;
  date: string;
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  meta?: { notice_class?: string } | unknown[];
}

function toNotice(raw: RawNotice): Notice {
  // WordPress sends `meta: []` (an empty array, not an object) when there is no meta at all.
  const meta = Array.isArray(raw.meta) ? {} : (raw.meta ?? {});
  return {
    id: raw.id,
    date: raw.date,
    title: decodeHtml(raw.title?.rendered ?? ""),
    excerpt: excerptToText(raw.excerpt?.rendered ?? ""),
    noticeClass: (meta as { notice_class?: string }).notice_class ?? "",
  };
}

async function get(path: string, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) throw new ApiError("aborted", "cancelled");
    throw new ApiError("network", "Could not reach the server");
  }
  if (GATEWAY.has(res.status)) throw new ApiError("network", "Could not reach the server", res.status);
  return res;
}

export interface NoticeQuery {
  page: number;
  search: string;
  noticeClass: string;
}

export async function fetchNotices(q: NoticeQuery, signal?: AbortSignal): Promise<NoticePage> {
  const params = new URLSearchParams({
    per_page: String(PAGE_SIZE),
    page: String(q.page),
    orderby: "date",
    order: "desc",
    status: "publish", // always asked for, so a draft can never be what we get
    _fields: "id,date,title,excerpt,meta",
  });
  if (q.search.trim()) params.set("search", q.search.trim());
  if (q.noticeClass) params.set("notice_class", q.noticeClass);

  const res = await get(`/wp-json/wp/v2/notices?${params}`, signal);
  if (!res.ok) {
    let code = "";
    try {
      code = ((await res.json()) as { code?: string }).code ?? "";
    } catch {}
    if (res.status === 400 && code === "rest_post_invalid_page_number") throw new ApiError("page", "That page does not exist", 400);
    throw new ApiError("http", `The server had a problem (${res.status})`, res.status);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError("http", "The server sent something we could not read", res.status);
  }
  if (!Array.isArray(data)) throw new ApiError("http", "The server sent something we could not read", res.status);
  const total = Number(res.headers.get("X-WP-Total"));
  const totalPages = Number(res.headers.get("X-WP-TotalPages"));
  return {
    notices: (data as RawNotice[]).map(toNotice),
    total: Number.isFinite(total) && res.headers.has("X-WP-Total") ? total : data.length,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
  };
}

/** The classes that have at least one published notice, for the filter dropdown. Never throws: a missing list just means no filter. */
export async function fetchClasses(signal?: AbortSignal): Promise<string[]> {
  try {
    const res = await get("/wp-json/notice-board/v1/classes", signal);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? data.filter((c): c is string => typeof c === "string" && c !== "") : [];
  } catch {
    return [];
  }
}
```

### `src/NoticeBoard.tsx`

```tsx
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, fetchClasses, fetchNotices, PAGE_SIZE, type NoticePage } from "./api";

type View =
  | { state: "loading" }
  | { state: "error"; message: string; noServer: boolean }
  | { state: "ready"; data: NoticePage };

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** `debounceMs`: how long to wait after the last key before searching. A prop only so tests can make it short. */
export function NoticeBoard({ debounceMs = 300 }: { debounceMs?: number }) {
  const [typed, setTyped] = useState(""); // what is in the box right now
  const [search, setSearch] = useState(""); // what we actually search for (after the pause)
  const [noticeClass, setNoticeClass] = useState("");
  const [page, setPage] = useState(1);
  const [classes, setClasses] = useState<string[]>([]);
  const [view, setView] = useState<View>({ state: "loading" });
  const [retry, setRetry] = useState(0);
  const searchId = useId();
  const classId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  // 1. wait until the typing stops, then search (and go back to page 1)
  useEffect(() => {
    if (typed === search) return;
    const timer = setTimeout(() => {
      setSearch(typed);
      setPage(1);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [typed, search, debounceMs]);

  // 2. the class list for the dropdown, once
  useEffect(() => {
    const controller = new AbortController();
    fetchClasses(controller.signal).then((list) => {
      if (!controller.signal.aborted) setClasses(list);
    });
    return () => controller.abort();
  }, []);

  // 3. the notices. Every change cancels the request before it, so a slow old answer can never overwrite a newer one.
  useEffect(() => {
    const controller = new AbortController();
    setView({ state: "loading" });
    fetchNotices({ page, search, noticeClass }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setView({ state: "ready", data });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.kind === "aborted") return;
        if (err instanceof ApiError && err.kind === "page" && page > 1) {
          setPage(1); // the list got shorter while we were looking: go back to the start
          return;
        }
        if (err instanceof ApiError && err.kind === "network") {
          setView({ state: "error", noServer: true, message: "Can't reach the notice board right now. Check that the server is running and try again." });
        } else {
          setView({ state: "error", noServer: false, message: "The server had a problem loading the notices. Please try again." });
        }
      });
    return () => controller.abort();
  }, [page, search, noticeClass, retry]);

  const filtered = search.trim() !== "" || noticeClass !== "";

  function goTo(next: number) {
    setPage(next);
    heading.current?.scrollIntoView?.({ block: "start" });
  }

  return (
    <main className="board">
      <h1 ref={heading}>School Notice Board</h1>

      <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor={searchId}>Search notices</label>
          <input id={searchId} type="search" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. exam" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor={classId}>Class</label>
          <select
            id={classId}
            value={noticeClass}
            onChange={(e) => {
              setNoticeClass(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All classes</option>
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </form>

      <div aria-live="polite" className="status">
        {view.state === "loading" && <p role="status">Loading notices…</p>}

        {view.state === "error" && (
          <div role="alert" className="error" data-kind={view.noServer ? "no-server" : "server-error"}>
            <p>{view.message}</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </button>
          </div>
        )}

        {view.state === "ready" && view.data.notices.length === 0 && (
          <p className="empty">{filtered ? "No notices match your search." : "There are no notices yet."}</p>
        )}
      </div>

      {view.state === "ready" && view.data.notices.length > 0 && (
        <>
          <ul className="notices" aria-label="Notices">
            {view.data.notices.map((n) => (
              <li key={n.id} className="notice">
                <div className="meta">
                  <time dateTime={n.date}>{formatDate(n.date)}</time>
                  {n.noticeClass && <span className="chip">{n.noticeClass}</span>}
                </div>
                <h2>{n.title}</h2>
                {n.excerpt && <p>{n.excerpt}</p>}
              </li>
            ))}
          </ul>

          <nav className="pager" aria-label="Pages">
            <button type="button" onClick={() => goTo(page - 1)} disabled={page <= 1}>
              Previous
            </button>
            <span>
              Page {page} of {view.data.totalPages} · {view.data.total} {view.data.total === 1 ? "notice" : "notices"}
            </span>
            <button type="button" onClick={() => goTo(page + 1)} disabled={page >= view.data.totalPages}>
              Next
            </button>
          </nav>
        </>
      )}
    </main>
  );
}

export { PAGE_SIZE };
```

### `src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NoticeBoard } from "./NoticeBoard";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NoticeBoard />
  </StrictMode>,
);
```

### `src/styles.css`

```css
:root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --text:#1c2230; --muted:#5a6478; --line:#d9deea; --accent:#2b5fd9; --err:#b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg:#12151c; --card:#1b2030; --text:#e8ebf3; --muted:#9aa4ba; --line:#2d3550; --accent:#7ba3ff; --err:#ff8a80; } }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--text); }
.board { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { margin: 0 0 16px; font-size: 1.6rem; }
.filters { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 200px; }
label { font-size: .85rem; color: var(--muted); }
input, select, button { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--text); }
button { cursor: pointer; background: var(--accent); color: #fff; border-color: var(--accent); }
button:disabled { opacity: .45; cursor: not-allowed; }
.notices { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.notice { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
.notice h2 { margin: 4px 0; font-size: 1.1rem; }
.notice p { margin: 0; color: var(--muted); }
.meta { display: flex; gap: 8px; align-items: center; font-size: .8rem; color: var(--muted); }
.chip { background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 0 8px; }
.pager { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
.error { border: 1px solid var(--err); color: var(--err); border-radius: 12px; padding: 12px 16px; }
.error p { margin: 0 0 8px; }
.empty, .status p { color: var(--muted); }
```

### `src/vite-env.d.ts`

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Empty = same address (Vite proxy). Or a full WordPress address, e.g. http://localhost:8080 */
  readonly VITE_WP_BASE?: string;
}
```

### `index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>School Notice Board</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `vite.config.ts`

```ts
/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Two ways to reach WordPress:
//  1. proxy (default):   the page asks /wp-json/... on its own address and Vite forwards it to WordPress. No CORS needed.
//  2. cors (--mode cors): the page asks WordPress directly (VITE_WP_BASE in .env.cors). WordPress itself allows it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.WP_TARGET || "http://localhost:8080";
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true, proxy: { "/wp-json": { target, changeOrigin: false } } },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
```

### `.env.development` (empty = same address, through the proxy)

```bash
VITE_WP_BASE=
```

### `.env.cors` (`npm run dev:cors`)

```bash
VITE_WP_BASE=http://localhost:8080
```

### `package.json`

```json
{
  "name": "notice-board",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "wp:setup": "node harness/wp.mjs setup",
    "wp:start": "node harness/wp.mjs start",
    "dev": "vite",
    "dev:cors": "vite --mode cors",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:wp": "node --test --test-concurrency=1 tests/wp.test.mjs",
    "proof": "node scripts/check-browser.mjs"
  },
  "dependencies": {
    "react": "^19.3.1",
    "react-dom": "^19.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.8",
    "@types/node": "^22.0.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.2.1",
    "jsdom": "^31.0.0",
    "msw": "^3.0.4",
    "playwright": "^1.63.0",
    "typescript": "^7.0.2",
    "vite": "^8.3.6",
    "vitest": "^5.1.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

### `harness/wp.mjs` (test harness)

```js
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
```

### `harness/wp-config.php` (test harness)

```php
<?php
// The test site's settings. Written next to WordPress by harness/wp.mjs.
// The database is a SQLite file (the "SQLite Database Integration" plugin makes WordPress use it instead of MySQL).
$port = getenv( 'WP_PORT' ) ?: '8080';
define( 'DB_NAME', 'wordpress' );
define( 'DB_USER', 'unused' );
define( 'DB_PASSWORD', 'unused' );
define( 'DB_HOST', 'localhost' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );
define( 'DB_DIR', getenv( 'WP_DB_DIR' ) ?: __DIR__ . '/wp-content/database/' );
define( 'DB_FILE', getenv( 'WP_DB_FILE' ) ?: '.ht.sqlite' ); // a different file here is a different database
define( 'WP_ENVIRONMENT_TYPE', 'local' ); // also lets Application Passwords work over plain http
define( 'WP_HOME', 'http://localhost:' . $port );
define( 'WP_SITEURL', 'http://localhost:' . $port );
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_DISPLAY', false );
define( 'WP_DEBUG_LOG', true );
define( 'AUTH_KEY', 'test-only-key-1' );
define( 'SECURE_AUTH_KEY', 'test-only-key-2' );
define( 'LOGGED_IN_KEY', 'test-only-key-3' );
define( 'NONCE_KEY', 'test-only-key-4' );
define( 'AUTH_SALT', 'test-only-salt-1' );
define( 'SECURE_AUTH_SALT', 'test-only-salt-2' );
define( 'LOGGED_IN_SALT', 'test-only-salt-3' );
define( 'NONCE_SALT', 'test-only-salt-4' );
$table_prefix = 'wp_';
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
```

### `harness/router.php` (test harness)

```php
<?php
/**
 * Lets PHP's built-in web server behave like Apache with "pretty permalinks" (mod_rewrite):
 * real files are served as they are, everything else goes to WordPress's index.php.
 * Only for the test site. A real host does this itself.
 */
$path = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
$file = $_SERVER['DOCUMENT_ROOT'] . $path;

if ( '/' !== $path && is_file( $file ) ) {
	return false; // wp-login.php, images, css... served directly
}
if ( is_dir( $file ) && is_file( rtrim( $file, '/' ) . '/index.php' ) ) {
	chdir( $file ); // /wp-admin/
	require rtrim( $file, '/' ) . '/index.php';
	return true;
}
$_SERVER['SCRIPT_NAME']     = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = $_SERVER['DOCUMENT_ROOT'] . '/index.php';
chdir( $_SERVER['DOCUMENT_ROOT'] );
require $_SERVER['DOCUMENT_ROOT'] . '/index.php';
```

### `harness/install.php` (test harness)

```php
<?php
/**
 * Installs WordPress into a fresh database, turns on the Notice Board plugin, makes test users and test notices,
 * and writes the logins to a JSON file for the tests.
 *   php harness/install.php <site folder> <credentials json file>
 */
[ , $root, $creds_file ] = $argv;
define( 'WP_INSTALLING', true );
require $root . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';

wp_install( 'Test School', 'admin', 'admin@example.com', true, '', 'admin-pass-123' );
update_option( 'permalink_structure', '/%postname%/' );

$activated = activate_plugin( 'notice-board/notice-board.php' );
if ( is_wp_error( $activated ) ) {
	fwrite( STDERR, 'Could not activate: ' . $activated->get_error_message() . "\n" );
	exit( 1 );
}
// The post type is registered on "init", which already ran before the plugin was active in this process.
// Registering again and flushing makes /wp-json/wp/v2/notices and the permalinks exist from the first request.
notice_board_register();
flush_rewrite_rules();

$creds = array();
foreach ( array(
	'admin'       => array( 1, 'admin-pass-123' ),
	'editor1'     => array( wp_create_user( 'editor1', 'editor-pass-123', 'editor1@example.com' ), 'editor-pass-123' ),
	'subscriber1' => array( wp_create_user( 'subscriber1', 'subscriber-pass-123', 'subscriber1@example.com' ), 'subscriber-pass-123' ),
) as $login => [ $id, $password ] ) {
	if ( 'editor1' === $login ) {
		( new WP_User( $id ) )->set_role( 'editor' );
	}
	if ( 'subscriber1' === $login ) {
		( new WP_User( $id ) )->set_role( 'subscriber' );
	}
	[ $app_password ] = WP_Application_Passwords::create_new_application_password( $id, array( 'name' => 'harness' ) );
	$creds[ $login ]  = array( 'id' => $id, 'login' => $login, 'password' => $password, 'appPassword' => $app_password );
}
wp_delete_post( 1, true ); // "Hello world"
wp_delete_post( 2, true ); // "Sample Page"

// ---- the notices ----------------------------------------------------------------------------------------------
$day = static fn( int $days_ago ): string => gmdate( 'Y-m-d H:i:s', time() - $days_ago * DAY_IN_SECONDS );
$published = array(
	array( 'Annual Day rehearsal schedule', 'Class 8A', 1 ),
	array( 'Q&A with the Principal', 'Class 10C', 2 ),
	array( "Teacher's Day programme", 'Class 9B', 3 ),
	array( 'Science fair: bring your models', 'Class 8A', 4 ),
	array( 'Library books due Friday', 'Class 9B', 5 ),
	array( 'Sports day: house colours', 'Class 8A', 6 ),
	array( 'Fee payment reminder', 'Class 10C', 7 ),
	array( 'Holiday on Monday', 'Class 9B', 8 ),
	array( 'Parent-teacher meeting on Saturday', 'Class 8A', 9 ),
	array( 'Bus route change', 'Class 9B', 10 ),
	array( 'Exam timetable (Class 10)', 'Class 10C', 11 ),
	array( 'Welcome back to school', '', 12 ),
);
$long = str_repeat( 'This notice has a long body so that the excerpt has to be cut short. ', 12 );
foreach ( $published as [ $title, $class, $ago ] ) {
	wp_insert_post( array(
		'post_type'    => 'notice',
		'post_status'  => 'publish',
		'post_title'   => $title,
		'post_content' => "<!-- wp:paragraph -->\n<p>Details for: {$title}. {$long}</p>\n<!-- /wp:paragraph -->",
		'post_date'    => get_date_from_gmt( $day( $ago ) ),
		'post_date_gmt' => $day( $ago ),
		'meta_input'   => array( 'notice_class' => $class ),
	) );
}
// Three notices that must NEVER show to a visitor: a draft, a scheduled one, a private one.
foreach ( array(
	array( 'draft', 'DRAFT: secret exam paper', 'Class 12D', 0 ),
	array( 'future', 'Scheduled: next term notice', 'Class 7F', -30 ),
	array( 'private', 'Staff only: salary dates', 'Class 6S', 1 ),
) as [ $status, $title, $class, $ago ] ) {
	wp_insert_post( array(
		'post_type'     => 'notice',
		'post_status'   => $status,
		'post_title'    => $title,
		'post_content'  => 'Not for visitors.',
		'post_date'     => get_date_from_gmt( $day( $ago ) ),
		'post_date_gmt' => $day( $ago ),
		'meta_input'    => array( 'notice_class' => $class ),
	) );
}
file_put_contents( $creds_file, json_encode( $creds, JSON_PRETTY_PRINT ) );
echo "installed: " . count( $published ) . " published notices, 3 hidden ones, " . count( $creds ) . " users\n";
```

### `harness/backup.php` (test harness)

```php
<?php
/**
 * Makes a consistent copy of the SQLite database (the test site's equivalent of `mysqldump`).
 *   php harness/backup.php <source .sqlite file> <backup file>
 * VACUUM INTO writes a clean, complete copy even if the site is running.
 */
[ , $source, $target ] = $argv;
if ( file_exists( $target ) ) {
	unlink( $target );
}
$pdo = new PDO( 'sqlite:' . $source );
$pdo->exec( "VACUUM INTO '" . str_replace( "'", "''", $target ) . "'" );
echo "backup written: " . filesize( $target ) . " bytes\n";
```

### `harness/lifecycle.php` (test harness)

```php
<?php
/**
 * Runs the plugin's deactivate and uninstall steps against the test site and prints the Editor's notice capabilities after each.
 *   php harness/lifecycle.php <site folder>
 */
[ , $root ] = $argv;
require $root . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';

$editor_can = static fn() => json_encode( array(
	'publish_notices' => get_role( 'editor' )->has_cap( 'publish_notices' ),
	'install_plugins' => get_role( 'editor' )->has_cap( 'install_plugins' ),
) );
$out = array( 'afterInstall' => json_decode( $editor_can(), true ) );

activate_plugin( 'notice-board/notice-board.php' ); // already active: must change nothing and not fail
$out['afterSecondActivate'] = json_decode( $editor_can(), true );

deactivate_plugins( 'notice-board/notice-board.php' );
$out['afterDeactivate'] = json_decode( $editor_can(), true ); // deactivating keeps the capabilities (they are data)

define( 'WP_UNINSTALL_PLUGIN', 'notice-board/notice-board.php' );
include WP_PLUGIN_DIR . '/notice-board/uninstall.php';
wp_cache_flush();
$out['afterUninstall'] = json_decode( $editor_can(), true );
$out['noticesLeftInDatabase'] = (int) $GLOBALS['wpdb']->get_var( "SELECT COUNT(*) FROM {$GLOBALS['wpdb']->posts} WHERE post_type = 'notice'" );

activate_plugin( 'notice-board/notice-board.php' ); // put it back for the other tests
$out['afterReactivate'] = json_decode( $editor_can(), true );
echo json_encode( $out );
```

### `BACKUP_AND_RESTORE.md`

```markdown
# Backup and restore (Notice Board)

A backup is only a backup once you have **restored it somewhere else and looked at it**. Do the restore test, not just the export.

## What to save

| Part | Where it lives | How to save it |
|---|---|---|
| Notices, users, roles, settings | the **database** | export it to one `.sql` file |
| The plugin | `wp-content/plugins/notice-board/` | it is already in this repo (`plugin/notice-board/`) |
| Uploaded files | `wp-content/uploads/` | copy the folder (this project has none) |
| `wp-config.php` | the WordPress folder | copy it, keep it private (it holds the database password and salts) |

## The real steps (MySQL: Local, XAMPP, any host)

> **Not run here.** The sandbox this project was built in has no MySQL. These are the standard commands; run them once on your own machine and tick the boxes below. What *was* run here is the SQLite version in the next section.

**1. Back up**

- Local: site → **Database** tab → **Adminer** → *Export* → *Save* (SQL). Or in a terminal: `mysqldump -u root -p --single-transaction --default-character-set=utf8mb4 local > notice-board-backup.sql`
- XAMPP: `http://localhost/phpmyadmin` → pick the database → **Export** → *Quick* → *SQL* → Go. Or: `C:\xampp\mysql\bin\mysqldump.exe -u root --single-transaction --default-character-set=utf8mb4 wordpress > notice-board-backup.sql`

**2. Restore into a NEW, empty database** (never over the live one)

```sql
CREATE DATABASE notice_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```
```bash
mysql -u root -p --default-character-set=utf8mb4 notice_restore < notice-board-backup.sql
```
(phpMyAdmin: create the database, open it, **Import** the file.)

**3. Point a copy of the site at the new database**

Copy the WordPress folder, change `DB_NAME` in the copy's `wp-config.php` to `notice_restore`. If the copy has a different address, set `WP_HOME` and `WP_SITEURL` in `wp-config.php` to it. Open the copy.

**4. Look at it**

- [ ] `/wp-json/wp/v2/notices` shows the same published notices, newest first
- [ ] the draft, scheduled and private notices are still **not** listed for a visitor
- [ ] you can sign in as the Editor and publish a new notice
- [ ] a Subscriber still gets 403 when creating one
- [ ] Plugins page: Notice Board is active

## What was actually run here (SQLite, same idea)

The test WordPress in this project stores everything in one SQLite file instead of MySQL. The matching steps:

| MySQL | Here |
|---|---|
| `mysqldump` (consistent export) | `php harness/backup.php <database file> <backup file>` (`VACUUM INTO`: a consistent copy of the whole database in one file) |
| `CREATE DATABASE notice_restore` | a database file name that has never been used (`.ht.restored.sqlite`) |
| `mysql ... < backup.sql` | copy the backup to that file name |
| point `DB_NAME` at it | `WP_DB_FILE=.ht.restored.sqlite` (second site on port 8081) |

`npm run test:wp` does all of this automatically (the last group of tests) and checks that the restored site has the same notices in the same order, still hides the three hidden notices, has the same users and rights, accepts a new notice, and that the original database is not touched.

## Habits

- Back up **before** an update or a plugin change, and keep the last 3.
- Keep one copy **off the computer** (cloud drive, USB stick).
- A backup you have never restored is a hope, not a backup.
```

### Design decisions

| Decision | Reason |
|---|---|
| Notices get their own capabilities | Otherwise anyone who can publish a post could publish a notice. Tested with an Author account |
| Capabilities added on activation, to Administrator and Editor only | Capabilities are stored in the database, not computed. Subscriber is left out on purpose |
| The plugin never grants `install_plugins` | The task says neither role may install plugins. Editors do not have it; a test proves it stays so |
| Uninstall removes capabilities but keeps notices | Deleting a plugin must not delete people's content |
| Publish date = the post's own date | No extra date field to get out of step. A future date makes the notice *scheduled*, which is not public |
| Class is post meta with `maxLength` 40 + sanitizer | A custom field the REST API can read and write, cleaned before saving. A 41-character value is refused with 400 |
| Class filter is a REST argument, not a client-side filter | The server filters, so page counts and `X-WP-TotalPages` stay correct |
| `/notice-board/v1/classes` for the dropdown | Built only from published notices with prepared SQL. A draft's class cannot leak |
| The page always sends `status=publish` | A second wall. WordPress already hides drafts, and the page does not rely on that alone |
| `_fields=id,date,title,excerpt,meta` | Smaller answers, and no author data is sent to a public page |
| Titles decoded with `DOMParser` | Correct text (`Q&A`), and a hostile title cannot run code |
| Excerpt shown as plain text | Editors can write raw HTML (`unfiltered_html`), so it is never put on the page as HTML |
| 300 ms debounce + `AbortController` per request | Fast typing sends one search; a slow old answer cannot replace a newer one |
| `debounceMs` is a prop | Only so tests can make it short; the default is 300 |
| Search/class change resets to page 1 | Page 4 of the old list may not exist in the new one |
| `rest_post_invalid_page_number` goes back to page 1 | If the list gets shorter while you look at it, you land on page 1, not on an error |
| Two different error messages | "Can't reach" (server off, 502/503/504 from the dev proxy) is not the same as "the server had a problem" (a 500). The fix differs |
| Pager hidden while loading | No old Next button under a loading message |
| Class list failing is not an error | The dropdown just shows "All classes"; the notices still load |
| A test harness on SQLite, not MySQL | No MySQL exists in the sandbox. It is clearly stated, and the rules under test (roles, REST, queries) do not depend on the database engine |
| Every test run starts from a freshly installed site | No test depends on what an earlier run left behind |

---

## 7. Tests (123 tests)

Four layers, each finds different mistakes:

1. **`tests/wp.test.mjs` (56)** runs against the **real WordPress** with the real plugin: who may read, write and publish, what a visitor can and cannot see, search, filter, pages, sanitizing, plugin life cycle, backup and restore.
2. **`src/api.test.ts` (34)** tests the page's API layer against a fake server: query string, headers, decoding, every kind of failure.
3. **`src/NoticeBoard.test.tsx` (33)** tests the screen: loading, empty, error, pages, filter, search, debounce, cancelling.
4. **`scripts/check-browser.mjs` (33)** runs the **real page in real Chromium against the real WordPress**, both with the proxy and cross-origin.

On top of that, **`break43.py`** breaks 31 rules one at a time (give Subscriber the rights, let the Editor install plugins, drop `status=publish`, remove the debounce, stop cancelling requests, ...) and checks that a test fails each time.

| # | Test | What it proves |
|---|---|---|
| 1 | Visitor reading | 12 published notices, 5 per page, 3 pages, newest first; page 3 has 2; page 4 gives 400 `rest_post_invalid_page_number` |
| 2 | Visitor and hidden notices | Draft, scheduled and private notices never appear (even `per_page=100`); `status=draft/future/private/pending/any/trash` refused; by id refused; search cannot find them |
| 3 | Search, class, injection | Search works; class filter 8A=4, 9B=4, 10C=3; unknown class is empty not an error; SQL text in the class finds nothing and breaks nothing; 41 characters refused |
| 4 | Class list | Only classes of published notices (12D, 7F, 6S never appear) |
| 5 | CORS and fields | `X-WP-TotalPages` is exposed to another origin; `_fields` limits the answer; no author data |
| 6 | Visitor writing | POST, DELETE and edit give 401 |
| 7 | Subscriber | Can read; POST (publish or draft), edit, change class, delete all give **403**; cannot see drafts; has `read` and none of the notice/plugin capabilities; cannot list or install plugins |
| 8 | Author | Can publish posts but not notices (403): notices have their own capabilities |
| 9 | Editor | Has the notice capabilities and NOT `install_plugins`, `activate_plugins`, `edit_plugins`, `manage_options`...; plugin install gives 403; sees drafts/scheduled/private; saves a draft that visitors cannot see; publishes it and it appears first with its class; future date means scheduled (hidden); `&` stored as typed and escaped in the answer; class cleaned of tags; 41 characters refused; other meta keys ignored; trash then delete |
| 10 | Administrator | Can manage plugins (so the Editor's 403 is about the role, not a broken site) |
| 11 | Plugin life | Activate twice changes nothing; deactivate keeps capabilities; delete removes them but keeps the notices; reactivate restores them; Editor still cannot install plugins |
| 12 | Backup and restore | Backup file restored into a database file never used before, second site on port 8081: same 12 notices, same order and classes, hidden ones still hidden, same users and rights, accepts a new notice, original untouched |
| 13 | `decodeHtml`, `excerptToText` | `Q&amp;A`, `&#8217;`, `&#038;`, `&lt;`; hostile HTML does not run; tags stripped; scripts dropped; spaces collapsed |
| 14 | `fetchNotices` | `per_page=5`, `order=desc`, `status=publish`, `_fields`; blank search not sent; totals read from headers; missing/garbage headers handled; 500 is `http`; 502/503/504 and dropped connection are `network`; invalid page is `page`; HTML instead of JSON and a non-list are `http`; cancelled is `aborted`; missing fields tolerated |
| 15 | `fetchClasses` | List returned; blanks dropped; 500, dropped connection, non-list and 404 give an empty list, never a crash |
| 16 | The list screen | Loading then 5 notices; title, class, date, plain-text excerpt; `Q&A` shown right; hostile and escaped excerpts stay text; asks for `status=publish`, newest first; no empty chip |
| 17 | Empty and error | Two empty messages; 500 and dead server show different messages with Try again; 502 counts as dead; Try again recovers; a failed class list does not break the page |
| 18 | Pages | `Page 1 of 3 · 12 notices`; Next/Previous and disabled states; pager hidden while loading; `1 notice` singular; a vanished page goes back to page 1 |
| 19 | Filter and search | Dropdown from the server; class filter and its count; back to All; class or search change resets to page 1; typing `notice` fast sends exactly 1 search; clear brings the list back; Enter does not reload; search and class together |
| 20 | Cancelling | A slow old answer never replaces a newer one; the signal really is aborted; leaving the page cancels the request |
| 21 | Browser: no drafts | No draft/scheduled/private title on any of the 3 pages, and none ever arrived in the browser; every request had `status=publish` |
| 22 | Browser: `&` | `Q&A` shown with a real `&`; no `&amp;`, `&#8217;` or `&hellip;` anywhere; searching for `Q&A` works |
| 23 | Browser: typing | `library` typed with 40 ms between keys sends exactly one search request |
| 24 | Browser: errors | A 500 shows the message, Try again, no stale notices; recovery works; a switched-off server shows "can't reach" and coming back works |
| 25 | Browser: the rest | Pages of 5/5/2; class filter and dropdown; slow-old-answer race; an Editor's new notice appears first and a draft does not; 375 px wide has no sideways scroll; cross-origin mode loads and reads the page count |

### `tests/wp.test.mjs` (56 tests, real WordPress)

```js
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
```

### `src/test/setup.ts`

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

export const server = setupServer();

// msw 3 names this `onUnhandledFrame` (not `onUnhandledRequest`). An unhandled request FAILS the test instead of reaching a real network.
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());
```

### `src/api.test.ts` (34 tests)

```ts
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ApiError, decodeHtml, excerptToText, fetchClasses, fetchNotices } from "./api";
import { server } from "./test/setup";

const raw = (id: number, title: string, cls?: string) => ({
  id,
  date: "2026-10-01T09:00:00",
  title: { rendered: title },
  excerpt: { rendered: "<p>Body text [&hellip;]</p>" },
  meta: cls === undefined ? [] : { notice_class: cls },
});

function list(items: unknown[], total = items.length, pages = 1) {
  return HttpResponse.json(items, { headers: { "X-WP-Total": String(total), "X-WP-TotalPages": String(pages) } });
}

describe("decodeHtml", () => {
  it.each([
    ["Q&amp;A with the Principal", "Q&A with the Principal"],
    ["Teacher&#8217;s Day", "Teacher’s Day"],
    ["Fish &#038; Chips", "Fish & Chips"],
    ["a &lt; b", "a < b"],
    ["plain", "plain"],
    ["", ""],
  ])("%s -> %s", (input, out) => expect(decodeHtml(input)).toBe(out));

  it("does not run scripts or load images in a hostile title", () => {
    (globalThis as { pwned?: boolean }).pwned = false;
    const out = decodeHtml('<img src=x onerror="globalThis.pwned=true">Hi<script>globalThis.pwned=true</script>');
    expect(out).toContain("Hi");
    expect((globalThis as { pwned?: boolean }).pwned).toBe(false);
  });
});

describe("excerptToText", () => {
  it("strips the tags and decodes the ellipsis", () => expect(excerptToText("<p>Hello <b>there</b> [&hellip;]</p>")).toBe("Hello there […]"));
  it("drops script and style content", () => expect(excerptToText("<p>ok</p><script>alert(1)</script><style>p{}</style>")).toBe("ok"));
  it("collapses white space", () => expect(excerptToText("<p>a\n\n   b</p>")).toBe("a b"));
  it("is empty for empty input", () => expect(excerptToText("")).toBe(""));
});

describe("fetchNotices", () => {
  it("asks for 5 per page, newest first, published only, and only the fields it needs", async () => {
    let url!: URL;
    server.use(http.get("*/wp-json/wp/v2/notices", ({ request }) => ((url = new URL(request.url)), list([]))));
    await fetchNotices({ page: 2, search: "", noticeClass: "" });
    const p = url.searchParams;
    expect(p.get("per_page")).toBe("5");
    expect(p.get("page")).toBe("2");
    expect(p.get("orderby")).toBe("date");
    expect(p.get("order")).toBe("desc");
    expect(p.get("status")).toBe("publish");
    expect(p.get("_fields")).toBe("id,date,title,excerpt,meta");
    expect(p.has("search")).toBe(false);
    expect(p.has("notice_class")).toBe(false);
  });

  it("sends the search text (trimmed) and the class", async () => {
    let url!: URL;
    server.use(http.get("*/wp-json/wp/v2/notices", ({ request }) => ((url = new URL(request.url)), list([]))));
    await fetchNotices({ page: 1, search: "  exam  ", noticeClass: "Class 9B" });
    expect(url.searchParams.get("search")).toBe("exam");
    expect(url.searchParams.get("notice_class")).toBe("Class 9B");
  });

  it("does not send a blank search", async () => {
    let url!: URL;
    server.use(http.get("*/wp-json/wp/v2/notices", ({ request }) => ((url = new URL(request.url)), list([]))));
    await fetchNotices({ page: 1, search: "   ", noticeClass: "" });
    expect(url.searchParams.has("search")).toBe(false);
  });

  it("reads the totals from the headers and decodes titles", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => list([raw(1, "Q&amp;A", "Class 8A"), raw(2, "Teacher&#8217;s Day")], 12, 3)));
    const page = await fetchNotices({ page: 1, search: "", noticeClass: "" });
    expect(page.total).toBe(12);
    expect(page.totalPages).toBe(3);
    expect(page.notices.map((n) => n.title)).toEqual(["Q&A", "Teacher’s Day"]);
    expect(page.notices[0]!.noticeClass).toBe("Class 8A");
    expect(page.notices[1]!.noticeClass).toBe(""); // WordPress sends meta: [] when empty
    expect(page.notices[0]!.excerpt).toBe("Body text […]");
  });

  it("falls back to 1 page when the headers are missing", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => HttpResponse.json([raw(1, "A")])));
    const page = await fetchNotices({ page: 1, search: "", noticeClass: "" });
    expect(page.totalPages).toBe(1);
    expect(page.total).toBe(1);
  });

  it("ignores a nonsense page-count header", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => HttpResponse.json([], { headers: { "X-WP-Total": "x", "X-WP-TotalPages": "abc" } })));
    expect((await fetchNotices({ page: 1, search: "", noticeClass: "" })).totalPages).toBe(1);
  });

  it("a 500 is an 'http' error", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => HttpResponse.json({ code: "internal_server_error" }, { status: 500 })));
    await expect(fetchNotices({ page: 1, search: "", noticeClass: "" })).rejects.toMatchObject({ kind: "http", status: 500 });
  });

  it.each([502, 503, 504])("a %i from the dev proxy means 'nobody home' (network error)", async (status) => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => new HttpResponse(null, { status })));
    await expect(fetchNotices({ page: 1, search: "", noticeClass: "" })).rejects.toMatchObject({ kind: "network" });
  });

  it("a dropped connection is a 'network' error", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => HttpResponse.error()));
    await expect(fetchNotices({ page: 1, search: "", noticeClass: "" })).rejects.toMatchObject({ kind: "network" });
  });

  it("rest_post_invalid_page_number is a 'page' error", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => HttpResponse.json({ code: "rest_post_invalid_page_number" }, { status: 400 })));
    await expect(fetchNotices({ page: 9, search: "", noticeClass: "" })).rejects.toMatchObject({ kind: "page" });
  });

  it("another 400 is a plain 'http' error", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => HttpResponse.json({ code: "rest_invalid_param" }, { status: 400 })));
    await expect(fetchNotices({ page: 1, search: "", noticeClass: "" })).rejects.toMatchObject({ kind: "http", status: 400 });
  });

  it("an HTML page instead of JSON (e.g. a PHP error) is an 'http' error", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => new HttpResponse("<html>Fatal error</html>", { status: 200, headers: { "Content-Type": "text/html" } })));
    await expect(fetchNotices({ page: 1, search: "", noticeClass: "" })).rejects.toBeInstanceOf(ApiError);
  });

  it("an object instead of a list is an 'http' error", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => HttpResponse.json({ nope: true })));
    await expect(fetchNotices({ page: 1, search: "", noticeClass: "" })).rejects.toMatchObject({ kind: "http" });
  });

  it("a cancelled request is an 'aborted' error", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", async () => (await new Promise((r) => setTimeout(r, 200)), list([]))));
    const c = new AbortController();
    const p = fetchNotices({ page: 1, search: "", noticeClass: "" }, c.signal);
    c.abort();
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
  });

  it("copes with missing title / excerpt / meta", async () => {
    server.use(http.get("*/wp-json/wp/v2/notices", () => HttpResponse.json([{ id: 5, date: "2026-10-01T09:00:00" }])));
    const page = await fetchNotices({ page: 1, search: "", noticeClass: "" });
    expect(page.notices[0]).toMatchObject({ id: 5, title: "", excerpt: "", noticeClass: "" });
  });
});

describe("fetchClasses", () => {
  it("returns the list", async () => {
    server.use(http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json(["Class 8A", "Class 9B"])));
    expect(await fetchClasses()).toEqual(["Class 8A", "Class 9B"]);
  });
  it("drops blanks and non-strings", async () => {
    server.use(http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json(["A", "", 5, null, "B"])));
    expect(await fetchClasses()).toEqual(["A", "B"]);
  });
  it.each([
    ["a 500", () => HttpResponse.json({}, { status: 500 })],
    ["a dropped connection", () => HttpResponse.error()],
    ["a non-list", () => HttpResponse.json({ a: 1 })],
    ["a 404 (plugin missing)", () => HttpResponse.json({}, { status: 404 })],
  ])("gives an empty list (not a crash) on %s", async (_name, resolver) => {
    server.use(http.get("*/wp-json/notice-board/v1/classes", resolver));
    expect(await fetchClasses()).toEqual([]);
  });
});
```

### `src/NoticeBoard.test.tsx` (33 tests)

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { NoticeBoard } from "./NoticeBoard";
import { server } from "./test/setup";

interface Seed { id: number; title: string; cls: string }
const SEED: Seed[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  title: i === 1 ? "Q&amp;A with the Principal" : `Notice ${i + 1}`,
  cls: ["Class 8A", "Class 9B", "Class 10C"][i % 3]!,
}));

/** A tiny fake WordPress: filters, searches, pages, and sends the same headers. Records every request it gets. */
function fakeWordPress(all: Seed[] = SEED) {
  const requests: URL[] = [];
  server.use(
    http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json(["Class 10C", "Class 8A", "Class 9B"])),
    http.get("*/wp-json/wp/v2/notices", ({ request }) => {
      const url = new URL(request.url);
      requests.push(url);
      const p = url.searchParams;
      const search = (p.get("search") ?? "").toLowerCase();
      const cls = p.get("notice_class");
      const matches = all.filter((n) => (!cls || n.cls === cls) && (!search || n.title.toLowerCase().includes(search)));
      const per = Number(p.get("per_page"));
      const page = Number(p.get("page"));
      const pages = Math.max(1, Math.ceil(matches.length / per));
      if (page > pages && matches.length > 0) return HttpResponse.json({ code: "rest_post_invalid_page_number" }, { status: 400 });
      const slice = matches.slice((page - 1) * per, page * per).map((n) => ({
        id: n.id, date: "2026-10-01T09:00:00", title: { rendered: n.title }, excerpt: { rendered: `<p>Text of ${n.id}</p>` }, meta: { notice_class: n.cls },
      }));
      return HttpResponse.json(slice, { headers: { "X-WP-Total": String(matches.length), "X-WP-TotalPages": String(matches.length ? pages : 0) } });
    }),
  );
  return requests;
}

const user = () => userEvent.setup();
const items = () => screen.findAllByRole("listitem");

describe("the list", () => {
  it("shows a loading message first, then 5 notices", async () => {
    fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    expect(screen.getByText("Loading notices…")).toBeInTheDocument();
    expect(await items()).toHaveLength(5);
    expect(screen.queryByText("Loading notices…")).not.toBeInTheDocument();
  });

  it("shows the title, the class, the date and a plain-text excerpt", async () => {
    fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    const first = (await items())[0]!;
    expect(within(first).getByRole("heading", { level: 2 })).toHaveTextContent("Notice 1");
    expect(within(first).getByText("Class 8A")).toBeInTheDocument();
    expect(within(first).getByText("Text of 1")).toBeInTheDocument();
    expect(within(first).getByText(/2026/)).toBeInTheDocument();
  });

  it("check 2: a title with & is shown as Q&A, not Q&amp;A", async () => {
    fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    expect(await screen.findByRole("heading", { name: "Q&A with the Principal" })).toBeInTheDocument();
    expect(screen.queryByText(/&amp;/)).not.toBeInTheDocument();
  });

  it("never turns an excerpt into live HTML (a script or image in it stays text)", async () => {
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json([])),
      http.get("*/wp-json/wp/v2/notices", () =>
        HttpResponse.json([{ id: 1, date: "2026-10-01T09:00:00", title: { rendered: "Hostile" }, excerpt: { rendered: '<p>hello</p><img src="x" onerror="alert(1)"><script>alert(2)</script>' }, meta: {} }], {
          headers: { "X-WP-Total": "1", "X-WP-TotalPages": "1" },
        }),
      ),
    );
    const { container } = render(<NoticeBoard debounceMs={20} />);
    await screen.findByText("hello");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("an excerpt that contains escaped tags is shown as literal text, never turned into live HTML", async () => {
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json([])),
      http.get("*/wp-json/wp/v2/notices", () =>
        HttpResponse.json([{ id: 1, date: "2026-10-01T09:00:00", title: { rendered: "Escaped" }, excerpt: { rendered: "<p>&lt;img src=x onerror=alert(1)&gt;</p>" }, meta: {} }], {
          headers: { "X-WP-Total": "1", "X-WP-TotalPages": "1" },
        }),
      ),
    );
    const { container } = render(<NoticeBoard debounceMs={20} />);
    await screen.findByText("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });

  it("asks the server for published notices only, newest first", async () => {
    const requests = fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    expect(requests[0]!.searchParams.get("status")).toBe("publish");
    expect(requests[0]!.searchParams.get("orderby")).toBe("date");
    expect(requests[0]!.searchParams.get("order")).toBe("desc");
  });

  it("shows a notice with no class and no excerpt without a blank chip", async () => {
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json([])),
      http.get("*/wp-json/wp/v2/notices", () => HttpResponse.json([{ id: 1, date: "2026-10-01T09:00:00", title: { rendered: "Bare" }, excerpt: { rendered: "" }, meta: [] }], { headers: { "X-WP-Total": "1", "X-WP-TotalPages": "1" } })),
    );
    const { container } = render(<NoticeBoard debounceMs={20} />);
    await screen.findByText("Bare");
    expect(container.querySelector(".chip")).toBeNull();
  });
});

describe("empty state", () => {
  it("says there are no notices yet", async () => {
    fakeWordPress([]);
    render(<NoticeBoard debounceMs={20} />);
    expect(await screen.findByText("There are no notices yet.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
  });

  it("says nothing matched when a search finds nothing (a different message)", async () => {
    fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    await user().type(screen.getByLabelText("Search notices"), "zzzz");
    expect(await screen.findByText("No notices match your search.")).toBeInTheDocument();
  });
});

describe("error state", () => {
  it("check 4: a server error shows a message and a Try again button", async () => {
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json([])),
      http.get("*/wp-json/wp/v2/notices", () => HttpResponse.json({ code: "internal_server_error" }, { status: 500 })),
    );
    render(<NoticeBoard debounceMs={20} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The server had a problem loading the notices");
    expect(alert).toHaveAttribute("data-kind", "server-error");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("a server that is off says so, in different words", async () => {
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.error()),
      http.get("*/wp-json/wp/v2/notices", () => HttpResponse.error()),
    );
    render(<NoticeBoard debounceMs={20} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Can't reach the notice board");
    expect(alert).toHaveAttribute("data-kind", "no-server");
  });

  it("a 502 from the dev proxy also says 'can't reach'", async () => {
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => new HttpResponse(null, { status: 502 })),
      http.get("*/wp-json/wp/v2/notices", () => new HttpResponse(null, { status: 502 })),
    );
    render(<NoticeBoard debounceMs={20} />);
    expect(await screen.findByRole("alert")).toHaveAttribute("data-kind", "no-server");
  });

  it("Try again loads the list once the server is back", async () => {
    let fail = true;
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json([])),
      http.get("*/wp-json/wp/v2/notices", () =>
        fail ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json([{ id: 1, date: "2026-10-01T09:00:00", title: { rendered: "Back" }, excerpt: { rendered: "" }, meta: {} }], { headers: { "X-WP-Total": "1", "X-WP-TotalPages": "1" } }),
      ),
    );
    render(<NoticeBoard debounceMs={20} />);
    await screen.findByRole("alert");
    fail = false;
    await user().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Back")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed class list does not break the page (the dropdown just has 'All classes')", async () => {
    fakeWordPress();
    server.use(http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json({}, { status: 500 })));
    render(<NoticeBoard debounceMs={20} />);
    await items();
    expect(within(screen.getByLabelText("Class")).getAllByRole("option")).toHaveLength(1);
  });
});

describe("pages of 5", () => {
  it("shows 'Page 1 of 3 · 12 notices' with Previous disabled", async () => {
    fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    expect(screen.getByText("Page 1 of 3 · 12 notices")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("Next goes to page 2, then 3 (2 notices, Next disabled), and Previous goes back", async () => {
    const requests = fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    const u = user();
    await u.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 3 · 12 notices");
    expect(await items()).toHaveLength(5);
    await u.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 3 of 3 · 12 notices");
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await u.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("Page 2 of 3 · 12 notices");
    expect(requests.map((r) => r.searchParams.get("page"))).toEqual(["1", "2", "3", "2"]);
  });

  it("hides the pager while loading (no stale 'Next' under a spinner)", async () => {
    let slow = false;
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json([])),
      http.get("*/wp-json/wp/v2/notices", async ({ request }) => {
        const page = new URL(request.url).searchParams.get("page")!;
        if (slow) await new Promise((r) => setTimeout(r, 150));
        return HttpResponse.json([{ id: 1, date: "2026-10-01T09:00:00", title: { rendered: `P${page}` }, excerpt: { rendered: "" }, meta: {} }], { headers: { "X-WP-Total": "10", "X-WP-TotalPages": "2" } });
      }),
    );
    render(<NoticeBoard debounceMs={20} />);
    await screen.findByText("P1");
    slow = true;
    await user().click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Loading notices…")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
    await screen.findByText("P2");
  });

  it("says '1 notice' (not '1 notices')", async () => {
    fakeWordPress([SEED[0]!]);
    render(<NoticeBoard debounceMs={20} />);
    expect(await screen.findByText("Page 1 of 1 · 1 notice")).toBeInTheDocument();
  });

  it("if the list got shorter and our page is gone, it goes back to page 1 instead of showing an error", async () => {
    let shrunk = false;
    const requests: string[] = [];
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json([])),
      http.get("*/wp-json/wp/v2/notices", ({ request }) => {
        const page = new URL(request.url).searchParams.get("page")!;
        requests.push(page);
        if (page !== "1" && shrunk) return HttpResponse.json({ code: "rest_post_invalid_page_number" }, { status: 400 });
        return HttpResponse.json([{ id: Number(page), date: "2026-10-01T09:00:00", title: { rendered: `Page ${page} item` }, excerpt: { rendered: "" }, meta: {} }], { headers: { "X-WP-Total": shrunk ? "1" : "10", "X-WP-TotalPages": shrunk ? "1" : "2" } });
      }),
    );
    render(<NoticeBoard debounceMs={20} />);
    await screen.findByText("Page 1 item");
    shrunk = true;
    await user().click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 1 item");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(requests).toEqual(["1", "2", "1"]);
  });
});

describe("class filter", () => {
  it("is filled from the server's list, plus 'All classes'", async () => {
    fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    const options = within(screen.getByLabelText("Class")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["All classes", "Class 10C", "Class 8A", "Class 9B"]);
  });

  it("shows only that class, with the right page count", async () => {
    const requests = fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    await screen.findByRole("option", { name: "Class 9B" });
    await user().selectOptions(screen.getByLabelText("Class"), "Class 9B");
    await screen.findByText("Page 1 of 1 · 4 notices");
    const shown = await items();
    expect(shown).toHaveLength(4);
    shown.forEach((li) => expect(within(li).getByText("Class 9B")).toBeInTheDocument());
    expect(requests.at(-1)!.searchParams.get("notice_class")).toBe("Class 9B");
  });

  it("going back to 'All classes' removes the filter", async () => {
    const requests = fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    await screen.findByRole("option", { name: "Class 9B" });
    const u = user();
    await u.selectOptions(screen.getByLabelText("Class"), "Class 9B");
    await screen.findByText(/4 notices/);
    await u.selectOptions(screen.getByLabelText("Class"), "All classes");
    await screen.findByText("Page 1 of 3 · 12 notices");
    expect(requests.at(-1)!.searchParams.has("notice_class")).toBe(false);
  });

  it("changing the class while on page 2 goes back to page 1", async () => {
    const requests = fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    await screen.findByRole("option", { name: "Class 8A" });
    const u = user();
    await u.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 3 · 12 notices");
    await u.selectOptions(screen.getByLabelText("Class"), "Class 8A");
    await screen.findByText("Page 1 of 1 · 4 notices");
    expect(requests.at(-1)!.searchParams.get("page")).toBe("1");
    expect(requests.some((r) => r.searchParams.get("page") === "2" && r.searchParams.get("notice_class") === "Class 8A")).toBe(false); // never asked for page 2 of the new filter
  });
});

describe("search", () => {
  it("finds notices by title and says how many", async () => {
    fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    await user().type(screen.getByLabelText("Search notices"), "q&a");
    expect(await screen.findByText("Page 1 of 1 · 1 notice")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Q&A with the Principal" })).toBeInTheDocument();
  });

  it("check 3: typing 'notice' fast sends ONE search, not six", async () => {
    const requests = fakeWordPress();
    render(<NoticeBoard debounceMs={150} />);
    await items();
    const before = requests.length;
    await userEvent.setup({ delay: 10 }).type(screen.getByLabelText("Search notices"), "notice");
    await screen.findByText(/Page 1 of/);
    await new Promise((r) => setTimeout(r, 400));
    const searches = requests.slice(before).filter((r) => r.searchParams.has("search"));
    expect(searches).toHaveLength(1);
    expect(searches[0]!.searchParams.get("search")).toBe("notice");
  });

  it("changing the search while on page 2 goes back to page 1", async () => {
    const requests = fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    const u = user();
    await u.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 3 · 12 notices");
    await u.type(screen.getByLabelText("Search notices"), "Notice");
    await waitFor(() => expect(requests.at(-1)!.searchParams.get("search")).toBe("Notice"));
    expect(requests.at(-1)!.searchParams.get("page")).toBe("1");
  });

  it("clearing the box brings the full list back", async () => {
    fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    const u = user();
    const box = screen.getByLabelText("Search notices");
    await u.type(box, "zzzz");
    await screen.findByText("No notices match your search.");
    await u.clear(box);
    await screen.findByText("Page 1 of 3 · 12 notices");
  });

  it("pressing Enter in the search box does not reload the page", async () => {
    fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    await user().type(screen.getByLabelText("Search notices"), "x{Enter}");
    expect(screen.getByRole("heading", { name: "School Notice Board" })).toBeInTheDocument();
  });

  it("search and class work together", async () => {
    const requests = fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    await screen.findByRole("option", { name: "Class 8A" });
    const u = user();
    await u.selectOptions(screen.getByLabelText("Class"), "Class 8A");
    await screen.findByText(/4 notices/);
    await u.type(screen.getByLabelText("Search notices"), "Notice 1");
    await waitFor(() => {
      const last = requests.at(-1)!.searchParams;
      expect(last.get("search")).toBe("Notice 1");
      expect(last.get("notice_class")).toBe("Class 8A");
    });
  });
});

describe("old requests are cancelled", () => {
  it("a slow old answer can never replace a newer one", async () => {
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json([])),
      http.get("*/wp-json/wp/v2/notices", async ({ request }) => {
        const search = new URL(request.url).searchParams.get("search");
        if (!search) await new Promise((r) => setTimeout(r, 400)); // the first (empty-search) request is slow
        return HttpResponse.json([{ id: 1, date: "2026-10-01T09:00:00", title: { rendered: search ? "FAST NEW" : "SLOW OLD" }, excerpt: { rendered: "" }, meta: {} }], { headers: { "X-WP-Total": "1", "X-WP-TotalPages": "1" } });
      }),
    );
    render(<NoticeBoard debounceMs={10} />);
    await user().type(screen.getByLabelText("Search notices"), "x");
    expect(await screen.findByText("FAST NEW")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByText("SLOW OLD")).not.toBeInTheDocument();
    expect(screen.getByText("FAST NEW")).toBeInTheDocument();
  });

  it("the browser really cancels the request (the signal is aborted)", async () => {
    const signals: AbortSignal[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/wp/v2/notices") && init?.signal) signals.push(init.signal);
      return real(input, init);
    }) as typeof fetch;
    try {
      fakeWordPress();
      render(<NoticeBoard debounceMs={10} />);
      await items();
      await user().type(screen.getByLabelText("Search notices"), "Q");
      await screen.findByText(/Page 1 of 1/);
      expect(signals.length).toBeGreaterThanOrEqual(2);
      expect(signals[0]!.aborted).toBe(true); // the first request's signal was cancelled when the second began
    } finally {
      globalThis.fetch = real;
    }
  });

  it("leaving the page cancels what is still loading (no 'update after unmount')", async () => {
    server.use(
      http.get("*/wp-json/notice-board/v1/classes", () => HttpResponse.json([])),
      http.get("*/wp-json/wp/v2/notices", async () => (await new Promise((r) => setTimeout(r, 100)), HttpResponse.json([], { headers: { "X-WP-Total": "0", "X-WP-TotalPages": "0" } }))),
    );
    const { unmount } = render(<NoticeBoard debounceMs={10} />);
    unmount();
    await new Promise((r) => setTimeout(r, 200));
  });
});

describe("accessibility", () => {
  it("the search box and the class select have labels", async () => {
    fakeWordPress();
    render(<NoticeBoard debounceMs={20} />);
    await items();
    expect(screen.getByLabelText("Search notices")).toBeInTheDocument();
    expect(screen.getByLabelText("Class")).toBeInTheDocument();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });
});
```

### `scripts/check-browser.mjs` (33 checks, real Chromium)

```js
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
```

### `break43.py` (31 broken rules)

```python
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
```

---

## 8. Results

| Check | Command | Result |
|---|---|---|
| WordPress tests (real WordPress 7.1.4 + plugin) | `npm run test:wp` | **56 passed**, 0 failed (about 8 s) |
| Page tests | `npm test` | **67 passed** (34 + 33) |
| Type check | `npm run typecheck` | no errors |
| Production build | `npm run build` | built |
| Real browser proof | `npm run proof` | **33 / 33 passed** (proxy mode and cross-origin mode; screenshots in `.wp/proof/`) |
| Break-it | `python3 break43.py` | **31 / 31** broken rules caught (one was missed at first: an Author test was added) |
| Self-check 1: draft never appears | browser + API tests | pass: not on any page, never even sent to the browser |
| Self-check 2: `&` looks right | unit + browser | pass: `Q&A with the Principal` |
| Self-check 3: fast typing, few requests | unit + browser | pass: 7 keys, 40 ms apart = **1** request |
| Self-check 4: server error shows a message | unit + browser | pass: message and Try again; dead server has its own message |
| Self-check 5: Subscriber cannot create | API tests | pass: **403** signed in, **401** not signed in |
| Self-check 6: restore into a new database | API tests (SQLite) | pass on SQLite. **MySQL restore not run here**: do it once by hand with `BACKUP_AND_RESTORE.md` |

---

## 9. Problems avoided

| Problem | Cause | Fix |
|---|---|---|
| `node --test tests/` crashed with MODULE_NOT_FOUND | Node 22 treats a folder name as a file to run | Name the file: `node --test tests/wp.test.mjs` |
| `it.for is not a function` | `it.for` is Vitest, not `node:test` | A plain `for` loop that calls `it(...)` |
| Saving a class with tags got a 400, not a cleaned value | The 40-character limit is checked **before** the sanitizer, and the test input was 46 characters | A shorter test input. The order is right: limits first |
| Browser check: the error stayed on screen after `unroute` | `page.unroute` needs the same function object, a new function matches nothing | `page.unrouteAll({ behavior: 'ignoreErrors' })` |
| With the server off, the page said "the server had a problem" | The dev proxy answers 502 (a gateway error) when WordPress is down | 502, 503 and 504 count as "can't reach" |
| Notices with no class broke reading `meta` | WordPress sends `meta: []` (an empty list, not an object) when empty | `Array.isArray(meta) ? {} : meta` |
| Page 4 of a 3-page list gives an error | WordPress answers 400 `rest_post_invalid_page_number` | That code goes back to page 1 instead of showing an error |
| The default GitHub branch of WordPress is a 7.2 beta | The branch moves | The harness pins the **7.1.4 tag** and a fixed commit of the SQLite plugin |
| The first notices endpoint probe returned no custom routes | The post type registers on `init`, which had already run | `install.php` registers the type again and flushes the rewrite rules after activation |
| `Q&amp;A` shown on screen | WordPress sends HTML-escaped titles | Decode with `DOMParser`, print as text |
| A missed break-it case (type uses post capabilities) | No test used a user who can write posts but not notices | Added the Author test |
| msw 3 ignored `onUnhandledRequest` | msw 3 renamed it | `server.listen({ onUnhandledFrame: 'error' })` |

---

## 10. What was practiced

- Registering a custom post type with its own capabilities, and adding capabilities to roles once on activation
- `register_post_meta` with `show_in_rest`, a length limit, a sanitizer and an auth callback
- Extending the REST API: a query argument and a small public route (with prepared SQL)
- Reading `X-WP-Total` and `X-WP-TotalPages`, and CORS exposed headers
- 401 versus 403, and proving a role cannot do something instead of hiding a button
- Decoding HTML titles safely and never printing editor HTML as HTML
- Debounce, `AbortController`, and a page that resets when the filter changes
- Loading, empty and error states that say different things for different causes
- Backup and restore into a new database, and the habit of testing the restore
- Testing against the real thing, and writing down what could not be tested

---

## 11. Known limit

- **MySQL was not used.** The tests ran on WordPress with SQLite. The code does not depend on the engine, but a MySQL run is not verified here. Run the five-line checklist in `BACKUP_AND_RESTORE.md` once on your own Local or XAMPP.
- **Local/XAMPP was not used.** Install steps for your machine: copy `plugin/notice-board/` into `wp-content/plugins/`, activate **Notice Board**, set Settings > Permalinks to *Post name*, create an Editor and a Subscriber, then run `npm run dev` with `WP_TARGET=http://your-site-address` (or `npm run dev:cors` after changing `VITE_WP_BASE` in `.env.cors`).
- **No notice detail page.** The task asked for a list. Each card shows the title, class, date and an excerpt.
- **Search is WordPress's own** (words in the title and body). It is not fuzzy.
- **The Editor rights come from the plugin on activation.** If the plugin was active before a role was edited by hand, deactivate and activate it once.
- **The test passwords and salts in `harness/` are for the test site only.** Never use them on a real site.

---

## 12. How to run it

```bash
# one-time
npm install
npx playwright install chromium
npm run wp:setup                 # downloads WordPress 7.1.4 + SQLite plugin from GitHub (needs internet, needs php on PATH)

# see it working
npm run wp:start                 # terminal 1: WordPress at http://localhost:8080
npm run dev                      # terminal 2: the notice page at http://localhost:5173
#   WordPress admin: http://localhost:8080/wp-login.php
#   admin / admin-pass-123 · editor1 / editor-pass-123 · subscriber1 / subscriber-pass-123

# tests (they install and start their own fresh WordPress; stop npm run wp:start first)
npm run test:wp                  # 56 tests against real WordPress
npm test                         # 67 page tests
npm run typecheck
npm run proof                    # 33 real-browser checks
python3 break43.py               # optional: breaks 31 rules, tests must notice
```

**Windows notes.** PHP must be on `PATH` (`php -v`) and have `pdo_sqlite` (`php -m`). In XAMPP the PHP folder is `C:\xampp\php`; uncomment `extension=pdo_sqlite` and `extension=sqlite3` in `C:\xampp\php\php.ini` if it is missing. On Windows use `python` instead of `python3` for `break43.py`. The tests use ports **8080, 8081, 5173 and 5174**: close anything using them.
