// "Identify a file": read the first bytes locally, run core's `identify` on the static index.
import { identify, type IndexEntry, type Magic } from "@openformatdb/core/browser";
import { STATUS_LABEL, displayName } from "../lib/config.ts";

const box = document.getElementById("identify")!;
const input = box.querySelector<HTMLInputElement>("#file")!;
const status = box.querySelector<HTMLElement>("#status")!;
const out = box.querySelector<HTMLElement>("#candidates")!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

let entries: Promise<IndexEntry[]> | null = null;
function load(): Promise<IndexEntry[]> {
  entries ??= Promise.all([fetch("/api/index.json").then((r) => r.json()), fetch("/api/magic.json").then((r) => r.json())])
    .then(([index, magic]: [IndexEntry[], Record<string, [number, string][]>]) =>
      index.map((e) => (magic[e.id] ? { ...e, identifiers: { ...e.identifiers, magic: magic[e.id].map(([offset, hex]): Magic => ({ offset, hex })) } } : e)));
  return entries;
}

async function run(file: File) {
  status.textContent = `Reading ${file.name}…`;
  out.innerHTML = "";
  const bytes = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const all = await load();
  const cands = identify(all, { magic_hex: hex, extension: file.name, mime: file.type || undefined }, 10);
  const bySig = cands.some((c) => c.matched.some((m) => m.startsWith("signature")));
  status.textContent = !cands.length
    ? `No known format matches ${file.name}. First bytes: ${hex.slice(0, 32)}…`
    : bySig ? `${cands.length} candidate${cands.length === 1 ? "" : "s"} for ${file.name}, best first.` : `No signature matched ${file.name}: these candidates come from its name or type only.`;
  out.innerHTML = cands.map((c) =>
    `<li><div class="dev-row"><a class="name" href="/formats/${esc(c.id)}/">${esc(displayName(c.name, c.version))}</a>` +
    `<span class="badge s-${c.status}">${esc(STATUS_LABEL[c.status] ?? c.status)}</span>` +
    `<span class="meta">${esc(c.matched.join(", "))}</span></div></li>`).join("");
}

input.addEventListener("change", () => { if (input.files?.[0]) run(input.files[0]); });
box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("drag"); });
box.addEventListener("dragleave", () => box.classList.remove("drag"));
box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("drag"); const f = e.dataTransfer?.files?.[0]; if (f) run(f); });
input.addEventListener("click", () => { load().catch(() => {}); }, { once: true });
