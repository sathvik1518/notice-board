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
