// “搜索组合”tab 的默认组合卡（#pair-body）：左右两个窗格、改了组合后的提示（#pair-changed）、窄窗口开关、
// 左侧未授权的提示框、末行指向“添加到 Chrome”的指引。关键词规则在紧跟其后的规则卡里（options.js 渲染 #rules-body）。
// render 由 options.js 传入（不 import options.js，免得循环）。
import { buildTriggerTemplate } from "../lib/trigger.js";
import { h, ht, authButton, option } from "./ui.js";
import { setDefaultPair, canBeLeft, setNarrowFallback, notePairChange, pairChangedView, pairSavedKey } from "./edits.js";
import { act } from "./actions.js";
import { urlBox, revealGuideSteps } from "./guide.js";
import { requestReveal } from "./setup.js";
import { pane, panes } from "../ui/panes.js";
import { t, tNodes } from "../chrome/i18n.js";

// 本页第一次改默认组合时记下的 { from, mode }（lib 见 edits.js 的 notePairChange）：只在内存里，刷新即清掉
let pairChanged = null;

// 默认组合的左右两个下拉框做成镜像图标的两个窗格（只有默认组合卡用：窗格就代表默认组合）；整个窗格是 <label>，点哪里都聚焦下拉框
function pickerPanes(leftSel, rightSel) {
  return panes(
    pane("left", "label", ht("span", null, "common_left"), leftSel),
    pane("right", "label", ht("span", null, "common_right"), rightSel),
    "pair-pickers");
}

function triggerOf(left, right) {
  try {
    return left && right ? buildTriggerTemplate(left, right.id) : null;
  } catch {
    return null;
  }
}

// 左键交给页内的 reveal（切到“添加到 Chrome”并定位）；中键、Ctrl+点照常按 href 新开
const revealLink = (href, key, run) => ht("a", { href, onclick: (ev) => { ev.preventDefault(); run(); } }, key);

// 改了默认组合之后：steps 档说“开始使用”里的网址已换成新的；其余档说 Chrome 里还是旧网址，给新网址和设置步骤。
// 不设 role：它随每次渲染整个重建，播报交给保存时的提示（#notices）
function changedNote(show, left, right) {
  if (show === "setup") {
    return h("div", { class: "callout", id: "pair-changed" },
      ht("p", null, "options_pair_changed_setup"),
      revealLink("#setup", "options_pair_changed_continue", () => requestReveal("setup")));
  }
  const url = triggerOf(left, right);
  const label = t("guide_pair_label", left?.name ?? "", right?.name ?? "");
  return h("div", { class: "callout", id: "pair-changed" },
    ht("p", null, "options_pair_changed", label),
    url ? urlBox(url, undefined, "guide_copy_default_aria") : ht("p", { class: "hint hint-error" }, "guide_no_trigger"),
    revealLink("#guide-steps", "options_pair_changed_steps", revealGuideSteps));
}

// 窄窗口降级：Chrome 式开关行，名称来自 <label for>，说明经 aria-describedby
function narrowRow(cfg) {
  const input = h("input", { type: "checkbox", role: "switch", id: "narrow-fallback", class: "switch", "aria-describedby": "narrow-hint" });
  input.checked = cfg.narrowFallback;
  input.addEventListener("change", () => act(raw => setNarrowFallback(raw, input.checked), ["notice_narrow_saved"]));
  return h("div", { class: "switch-row" },
    h("div", { class: "switch-text" },
      ht("label", { for: "narrow-fallback", id: "narrow-label" }, "options_narrow_label"),
      ht("p", { class: "hint", id: "narrow-hint" }, "options_narrow_hint")),
    input);
}

// mode 是 setupView 的 mode（steps / regrant / done / hidden）；返回 #pair-body 的子节点
export function pairSection({ cfg, byId, granted, mode, render }) {
  let show;
  ({ rec: pairChanged, show } = pairChangedView(pairChanged, { pair: cfg.defaultPair, mode }));
  const lefts = cfg.engines.filter(canBeLeft);
  const [l, r] = cfg.defaultPair;
  const leftSel = h("select", { id: "pair-left" }, lefts.map(e => option(e.id, e.name, e.id === l)));
  const rightSel = h("select", { id: "pair-right" }, cfg.engines.map(e => option(e.id, e.name, e.id === r)));
  const save = () => act(raw => setDefaultPair(raw, leftSel.value, rightSel.value), result => {
    const key = pairSavedKey(pairChanged, result.patch.defaultPair, mode);
    pairChanged = notePairChange(pairChanged, { from: cfg.defaultPair, mode });
    return [key];
  });
  leftSel.addEventListener("change", save);
  rightSel.addEventListener("change", save);

  const left = byId.get(l);
  const nodes = [pickerPanes(leftSel, rightSel)];
  if (show) nodes.push(changedNote(show, left, byId.get(r)));
  nodes.push(narrowRow(cfg));
  // 卡片在“添加到 Chrome”里，用户在这里换成未授权的左侧时这里也要说
  if (left && !granted.get(left.id)) {
    const btn = authButton([left], ["engine_grant_named", left.name], { cls: "btn btn-small btn-attention", onDone: render });
    btn.id = "pair-grant";
    nodes.push(h("div", { class: "callout callout-warn" }, ht("span", null, "options_left_not_granted", left.name), btn));
  }
  nodes.push(h("p", { class: "hint" },
    ...tNodes("options_pair_other", [h("a", { href: "#tab-add", "data-reveal": "generator" }, t("options_tab_add"))])));
  return nodes;
}
