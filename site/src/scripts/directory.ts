// Directory search island. Loads /api/index.json on first interaction (or at once when the URL
// carries a query), runs core's `search` in the browser and renders one page at a time.
import { search, type IndexEntry } from "@openformatdb/core/browser";
import { STATUS_LABEL, STATUS_HELP, displayName } from "../lib/config.ts";

const PAGE = 50;
const root = document.getElementById("directory")!;
const form = root.querySelector<HTMLFormElement>("form")!;
const qEl = form.querySelector<HTMLInputElement>("#q")!;
const catEl = form.querySelector<HTMLSelectElement>("#category")!;
const stEl = form.querySelector<HTMLSelectElement>("#status")!;
const list = root.querySelector<HTMLElement>("#results")!;
const count = root.querySelector<HTMLElement>("#count")!;
const pager = root.querySelector<HTMLElement>("#pager")!;

let index: IndexEntry[] | null = null;
let loading: Promise<IndexEntry[]> | null = null;
let page = 1;

function load(): Promise<IndexEntry[]> {
  if (index) return Promise.resolve(index);
  if (!loading) {
    count.textContent = "Loading the index…";
    loading = fetch("/api/index.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data: IndexEntry[]) => (index = data))
      .catch((e) => { count.textContent = `Could not load the index (${e.message}).`; loading = null; throw e; });
  }
  return loading;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function row(e: IndexEntry): string {
  const exts = (e.identifiers.extensions ?? []).slice(0, 5).map((x) => `.${x}`).join(" ");
  const meta = [e.category, exts, e.open_tools ? `${e.open_tools} open tool${e.open_tools === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  return `<li><div class="dev-row"><a class="name" href="/formats/${esc(e.id)}/">${esc(displayName(e.name, e.version))}</a>` +
    `<span class="badge s-${e.status}" title="${esc(STATUS_HELP[e.status] ?? "")}">${esc(STATUS_LABEL[e.status] ?? e.status)}</span>` +
    `<span class="meta">${esc(meta)}</span></div></li>`;
}

async function render() {
  const all = await load();
  const q = qEl.value.trim();
  const hits = q || catEl.value || stEl.value
    ? search(all, q, { category: catEl.value || undefined, status: (stEl.value || undefined) as any, limit: 100000 })
    : [...all].sort((a, b) => b.open_tools - a.open_tools || a.id.localeCompare(b.id));
  const pages = Math.max(1, Math.ceil(hits.length / PAGE));
  page = Math.min(page, pages);
  list.innerHTML = hits.slice((page - 1) * PAGE, page * PAGE).map(row).join("");
  count.textContent = `${hits.length.toLocaleString("en")} format${hits.length === 1 ? "" : "s"}${q ? ` for “${q}”` : ""}${pages > 1 ? ` — page ${page} of ${pages}` : ""}.`;
  pager.innerHTML = pages > 1
    ? `${page > 1 ? `<button class="btn" data-p="${page - 1}">Previous</button>` : ""} ${page < pages ? `<button class="btn" data-p="${page + 1}">Next</button>` : ""}`
    : "";
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (catEl.value) params.set("category", catEl.value);
  if (stEl.value) params.set("status", stEl.value);
  if (page > 1) params.set("page", String(page));
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}

const initial = new URLSearchParams(location.search);
qEl.value = initial.get("q") ?? "";
catEl.value = initial.get("category") ?? "";
stEl.value = initial.get("status") ?? "";
page = Number(initial.get("page")) || 1;

let timer: number | undefined;
qEl.addEventListener("input", () => { clearTimeout(timer); page = 1; timer = window.setTimeout(render, 150); });
for (const el of [catEl, stEl]) el.addEventListener("change", () => { page = 1; render(); });
form.addEventListener("submit", (ev) => { ev.preventDefault(); page = 1; render(); });
pager.addEventListener("click", (ev) => {
  const p = (ev.target as HTMLElement).closest<HTMLElement>("[data-p]")?.dataset.p;
  if (p) { page = Number(p); render().then(() => root.scrollIntoView()); }
});
qEl.addEventListener("focus", () => { load().catch(() => {}); }, { once: true });
if (initial.size) render();
