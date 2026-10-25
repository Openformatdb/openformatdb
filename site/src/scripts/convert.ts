// "Convert a file": resolve both formats in the static index, run core's conversionPaths.
import { conversionPathsBetween, formatsForExtension, type Conversion, type IndexEntry } from "@openformatdb/core/browser";
import { FIDELITY_LABEL, displayName } from "../lib/config.ts";

const form = document.getElementById("convert") as HTMLFormElement;
const fromEl = form.querySelector<HTMLInputElement>("#from")!;
const toEl = form.querySelector<HTMLInputElement>("#to")!;
const status = document.getElementById("status")!;
const out = document.getElementById("paths")!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

let data: Promise<{ index: IndexEntry[]; byId: Map<string, IndexEntry>; graph: { id: string; family?: string; conversions?: Conversion[] }[] }> | null = null;
function load() {
  data ??= Promise.all([fetch("/api/index.json").then((r) => r.json()), fetch("/api/conversions.json").then((r) => r.json())])
    .then(([index, conv]: [IndexEntry[], Record<string, Conversion[]>]) => ({
      index, byId: new Map(index.map((e) => [e.id, e])),
      graph: index.map((e) => ({ id: e.id, family: e.family, conversions: conv[e.id] })),
    }));
  return data;
}

/** An id, or every format the extension may mean (the most handled first). */
function resolve(index: IndexEntry[], byId: Map<string, IndexEntry>, s: string): IndexEntry[] {
  const v = s.trim().toLowerCase();
  return byId.has(v) ? [byId.get(v)!] : formatsForExtension(index, v);
}

async function run() {
  status.textContent = "Searching…";
  out.innerHTML = "";
  const { index, byId, graph } = await load();
  const froms = resolve(index, byId, fromEl.value), tos = resolve(index, byId, toEl.value);
  if (!froms.length || !tos.length) { status.textContent = `Unknown format: ${!froms.length ? fromEl.value : toEl.value}.`; return; }
  const name = (id: string) => { const e = byId.get(id); return e ? displayName(e.name, e.version) : id; };
  const link = (id: string) => `<a href="/formats/${esc(id)}/">${esc(name(id))}</a>`;
  const paths = conversionPathsBetween(graph, froms.map((e) => e.id), tos.map((e) => e.id), { maxSteps: 3, limit: 4 });
  const from = paths[0]?.steps[0].from ?? froms[0].id, to = paths[0]?.steps.at(-1)!.to ?? tos[0].id;
  status.innerHTML = paths.length
    ? `From ${link(from)} to ${link(to)}: ${paths.length} way${paths.length === 1 ? "" : "s"}, best first.`
    : `No recorded chain from ${link(from)} to ${link(to)}. Their format pages list the software that reads or writes each.`;
  out.innerHTML = paths.map((p, i) => `<div class="card"><h2>${i + 1}. ${esc(FIDELITY_LABEL[p.fidelity])}</h2><ol>` +
    p.steps.map((s) => `<li>${esc(s.tool)}: ${link(s.from)} → ${link(s.to)} <span class="small muted">(${esc(FIDELITY_LABEL[s.fidelity])})</span>` +
      (s.engine ? ` <span class="tag" title="Runs on this page: choose your file above">in browser</span>` : "") +
      (s.command && !s.engine ? `<br /><code>${esc(s.command)}</code>` : "") + (s.losses ? `<div class="small muted">${esc(s.losses)}</div>` : "") + `</li>`).join("") +
    `</ol></div>`).join("");
  history.replaceState(null, "", `?from=${encodeURIComponent(fromEl.value)}&to=${encodeURIComponent(toEl.value)}`);
}

form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
const q = new URLSearchParams(location.search);
if (q.get("from") && q.get("to")) { fromEl.value = q.get("from")!; toEl.value = q.get("to")!; run(); }
