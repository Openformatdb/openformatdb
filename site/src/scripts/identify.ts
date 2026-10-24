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
  entries ??= Promise.all([
    fetch("/api/index.json").then((r) => r.json()),
    fetch("/api/magic.json").then((r) => r.json()),
    fetch("/api/signatures.json").then((r) => (r.ok ? r.json() : {}), () => ({})),
  ]).then(([index, magic, sigs]: [IndexEntry[], Record<string, [number, string][]>, Record<string, { signatures: any[]; priority_over?: string[] }>]) =>
      index.map((e) => (magic[e.id] || sigs[e.id] ? { ...e, identifiers: { ...e.identifiers,
        ...(magic[e.id] ? { magic: magic[e.id].map(([offset, hex]): Magic => ({ offset, hex })) } : {}),
        ...(sigs[e.id] ?? {}) } } : e)));
  return entries;
}

async function run(file: File) {
  status.textContent = `Reading ${file.name}…`;
  out.innerHTML = "";
  // The first 8 KB and the last 1 KB: enough for start and end-of-file signatures, read locally.
  const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const whole = file.size <= 8192;
  const hex = toHex(await file.slice(0, 8192).arrayBuffer());
  const tail = whole ? undefined : toHex(await file.slice(Math.max(0, file.size - 1024)).arrayBuffer());
  const all = await load();
  const cands = identify(all, { magic_hex: hex, tail_hex: tail, whole_file: whole, extension: file.name, mime: file.type || undefined }, 10);
  const bySig = cands.some((c) => c.matched.some((m) => m.startsWith("signature") || m === "full signature"));
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
