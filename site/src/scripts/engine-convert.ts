// "Convert a file" in the browser: plan with the engines registry, run in a worker so the page
// stays responsive while WebAssembly works. Nothing leaves the machine.
import { extKey, labelOf, readable, targets, downloadSize, ENGINES, type Plan } from "@openformatdb/engines";
import { cachedEngines } from "@openformatdb/engines/browser";
import { FIDELITY_LABEL } from "../lib/config.ts";

const box = document.getElementById("engine-convert")!;
const input = box.querySelector<HTMLInputElement>("#file")!;
const choose = box.querySelector<HTMLElement>("#choose")!;
const detected = box.querySelector<HTMLElement>("#detected")!;
const select = box.querySelector<HTMLSelectElement>("#target")!;
const go = box.querySelector<HTMLButtonElement>("#go")!;
const planEl = box.querySelector<HTMLElement>("#plan")!;
const status = box.querySelector<HTMLElement>("#run-status")!;
const progress = box.querySelector<HTMLProgressElement>("#progress")!;
const results = box.querySelector<HTMLElement>("#results")!;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const mb = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} kB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`);

let file: File | null = null;
let options: { ext: string; label: string; plan: Plan }[] = [];
let worker: Worker | null = null;
const urls: string[] = [];

async function describe() {
  const o = options[select.selectedIndex];
  if (!o) { planEl.textContent = ""; return; }
  const engines = [...new Set(o.plan.steps.map((s) => s.engine))];
  const cached = await cachedEngines(ENGINES.filter((e) => engines.includes(e.id)));
  const toFetch = engines.filter((id) => !cached.has(id));
  planEl.innerHTML = o.plan.steps.map((s) => `${esc(s.tool)}: .${esc(s.from)} → .${esc(s.to)}`).join(", then ") +
    ` — ${esc(FIDELITY_LABEL[o.plan.fidelity])}. ${esc(o.plan.steps.map((s) => s.losses).filter(Boolean).join(" "))}` +
    (toFetch.length ? ` <strong>First use downloads ${mb(downloadSize(toFetch))}.</strong>` : " Engine already downloaded.");
}

function pick(f: File) {
  file = f;
  results.innerHTML = "";
  status.textContent = "";
  const ext = extKey(f.name);
  options = targets(ext);
  if (!options.length) {
    choose.hidden = true;
    status.innerHTML = readable().includes(ext)
      ? `No engine here converts .${esc(ext)} further.`
      : `No engine here reads .${esc(ext)} files${ext ? "" : " (the file has no extension)"}. <a href="/identify/">Identify the file</a>, or look below for other tools.`;
    return;
  }
  choose.hidden = false;
  detected.innerHTML = `<strong>${esc(f.name)}</strong> (${mb(f.size)}), read as ${esc(labelOf(ext))}.`;
  select.innerHTML = options.map((o) => `<option value="${esc(o.ext)}">${esc(o.label)} (.${esc(o.ext)})${o.plan.steps.length > 1 ? " — 2 steps" : ""}${o.plan.fidelity === "lossless" ? " — lossless" : ""}</option>`).join("");
  describe();
}

function run() {
  const o = options[select.selectedIndex];
  if (!file || !o) return;
  go.disabled = true;
  results.innerHTML = "";
  progress.hidden = false;
  progress.removeAttribute("value");
  status.textContent = "Starting…";
  worker ??= new Worker(new URL("./engine-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent) => {
    const m = ev.data;
    if (m.type === "progress") {
      progress.max = m.total; progress.value = m.loaded;
      status.textContent = `Downloading ${m.engine}: ${mb(m.loaded)} of ${mb(m.total)} (once; it is cached afterwards)…`;
    } else if (m.type === "step") {
      progress.removeAttribute("value");
      status.textContent = `Step ${m.index + 1} of ${m.total}: ${m.step.tool}, .${m.step.from} → .${m.step.to}…`;
    } else if (m.type === "done") {
      progress.hidden = true;
      go.disabled = false;
      for (const u of urls.splice(0)) URL.revokeObjectURL(u);
      status.textContent = `Done in ${(m.ms / 1000).toFixed(1)} s, on your machine.`;
      results.innerHTML = m.files.map((f: { name: string; data: Uint8Array }) => {
        const url = URL.createObjectURL(new Blob([f.data as BlobPart]));
        urls.push(url);
        return `<li><a class="btn" href="${url}" download="${esc(f.name)}">Download ${esc(f.name)}</a> <span class="small muted">${mb(f.data.length)}</span></li>`;
      }).join("");
      describe();
    } else if (m.type === "error") {
      progress.hidden = true;
      go.disabled = false;
      status.textContent = `Conversion failed: ${m.message}`;
    }
  };
  file.arrayBuffer().then((buf) => worker!.postMessage({ name: file!.name, data: buf, to: o.ext, plan: o.plan }, [buf]));
}

input.addEventListener("change", () => { if (input.files?.[0]) pick(input.files[0]); });
select.addEventListener("change", describe);
go.addEventListener("click", run);
box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("drag"); });
box.addEventListener("dragleave", () => box.classList.remove("drag"));
box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("drag"); const f = e.dataTransfer?.files?.[0]; if (f) pick(f); });
