// 验收向导：轮询 /api/state，按钮 POST /api/answer。不依赖任何扩展 API。
const LABELS = { pass: "通过", fail: "不通过", skip: "跳过", retry: "重试" };
const STATUS = { pass: "通过", fail: "失败", skip: "跳过", retry: "重试", error: "出错" };
const $ = id => document.getElementById(id);
let renderedSeq = -1;
let answering = false;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "已复制";
  } catch {
    const r = document.createRange();
    r.selectNodeContents($("copy-text"));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    btn.textContent = "已选中，请按 Ctrl+C";
  }
  setTimeout(() => { btn.textContent = "复制"; }, 2000);
}

async function answer(seq, value) {
  if (answering) return;
  answering = true;
  document.querySelectorAll("#buttons button").forEach(b => { b.disabled = true; });
  try {
    await fetch("/api/answer", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ seq, answer: value }),
    });
  } catch {}
  answering = false;
}

function renderStep(state) {
  const { step, seq, progress } = state;
  $("step").hidden = !step;
  if (!step || renderedSeq === seq) return;
  renderedSeq = seq;
  $("step-no").textContent = `步骤 ${Math.min(progress.done + 1, progress.total || progress.done + 1)} / ${progress.total || "?"}`;
  $("step-title").textContent = step.title || "";
  $("step-instruction").textContent = step.instruction || "";
  const sample = $("sample");
  sample.hidden = !step.sampleText;
  sample.textContent = step.sampleText || "";
  $("copy-row").hidden = !step.copyText;
  $("copy-text").textContent = step.copyText || "";
  const cb = $("copy-btn");
  cb.onclick = () => copy(step.copyText, cb);
  const box = $("buttons");
  box.replaceChildren();
  for (const k of step.buttons || []) {
    const b = el("button", `btn ${k}`, LABELS[k] || k);
    b.type = "button";
    b.onclick = () => answer(seq, k);
    box.append(b);
  }
}

function render(state) {
  $("progress").textContent = state.progress.total
    ? `进度：已完成 ${state.progress.done} / ${state.progress.total}` : "等待开始…";
  renderStep(state);
  const ul = $("results");
  ul.replaceChildren();
  for (const r of state.results.slice().reverse()) {
    const li = el("li");
    li.append(el("span", `st ${r.status}`, STATUS[r.status] || r.status), el("span", "", r.id), el("span", "detail", r.detail || ""));
    ul.append(li);
  }
}

async function poll() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    render(await r.json());
  } catch {}
}
poll();
setInterval(poll, 500);
