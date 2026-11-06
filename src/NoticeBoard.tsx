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
