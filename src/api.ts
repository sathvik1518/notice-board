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
