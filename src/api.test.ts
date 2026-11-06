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
