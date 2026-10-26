// 触发网址：默认组合一条 + 自选组合生成器。分步引导和注意事项是 options.html 里的静态文字。
import { buildTriggerTemplate } from "../lib/trigger.js";
import { h, ht, copyButton, authButton, option } from "./ui.js";
import { canBeLeft } from "./edits.js";
import { t } from "../chrome/i18n.js";
import { pane, panes } from "../ui/panes.js";

export const SETTINGS_URL = "chrome://settings/searchEngines";

let gen = null; // 生成器当前选择 [leftId, rightId]，跨重渲染保留

export function setupGuide() {
  const slot = document.getElementById("settings-url-copy");
  slot.replaceChildren(copyButton(() => SETTINGS_URL, ["guide_copy_settings_url"]));
}

function triggerOf(left, right) {
  try {
    return buildTriggerTemplate(left, right.id);
  } catch {
    return null;
  }
}

// label 是复制按钮的 LabelSpec
export function urlBox(url, label) {
  return h("div", { class: "url-line" },
    h("code", { class: "url-box mono" }, url),
    copyButton(() => url, label));
}

// 左右两个下拉框做成镜像图标的两个窗格（默认组合卡与组合生成器共用）：整个窗格是 <label>，点哪里都聚焦下拉框
export function pickerPanes(leftSel, rightSel) {
  return panes(
    pane("left", "label", ht("span", null, "common_left"), leftSel),
    pane("right", "label", ht("span", null, "common_right"), rightSel),
    "pair-pickers");
}

// ctx: { cfg, granted, refresh, setupShown }。setupShown：“开始使用”卡显示着，左侧授权的入口只留在卡里
export function renderTriggers(ctx) {
  const { cfg, granted } = ctx;
  const all = [...cfg.engines, ...cfg.hidden];
  const byId = new Map(all.map(e => [e.id, e]));
  const [dl, dr] = cfg.defaultPair.map(id => byId.get(id));
  const frag = document.createDocumentFragment();

  // 默认组合
  const defUrl = dl && dr ? triggerOf(dl, dr) : null;
  frag.append(h("div", { class: "trigger-card trigger-default" },
    h("div", { class: "trigger-head" },
      ht("span", { class: "tag tag-accent" }, "guide_default_tag"),
      dl && dr ? ht("strong", null, "guide_pair_label", dl.name, dr.name) : ht("strong", null, "guide_pair_invalid")),
    defUrl ? urlBox(defUrl) : ht("p", { class: "hint hint-error" }, "guide_no_trigger"),
    defUrl && dl.leftDiscouraged && leftWarn(dl),
    ht("p", { class: "hint" }, "guide_default_hint")));

  // 自选组合
  const lefts = cfg.engines.filter(canBeLeft);
  const rights = cfg.engines;
  if (!gen || !lefts.some(e => e.id === gen[0]) || !rights.some(e => e.id === gen[1])) {
    gen = [...cfg.defaultPair];
    if (!lefts.some(e => e.id === gen[0])) gen[0] = lefts[0]?.id;
    if (!rights.some(e => e.id === gen[1])) gen[1] = rights[0]?.id;
  }
  const out = h("div", { class: "gen-output" });
  const leftSel = h("select", { id: "gen-left" },
    lefts.map(e => option(e.id, e.leftDiscouraged ? t("engine_left_discouraged_suffix", e.name) : e.name, e.id === gen[0])));
  const rightSel = h("select", { id: "gen-right" }, rights.map(e => option(e.id, e.name, e.id === gen[1])));
  const update = () => {
    gen = [leftSel.value, rightSel.value];
    out.replaceChildren(...genOutput(byId.get(gen[0]), byId.get(gen[1]), ctx));
  };
  leftSel.addEventListener("change", update);
  rightSel.addEventListener("change", update);

  frag.append(h("div", { class: "trigger-card" },
    h("div", { class: "trigger-head" }, ht("strong", null, "guide_other_pairs_title")),
    ht("p", { class: "hint" }, "guide_pair_shortcut_hint", t("guide_example_shortcut_query")),
    lefts.length
      ? pickerPanes(leftSel, rightSel)
      : ht("p", { class: "hint hint-error" }, "guide_no_left"),
    out));
  if (lefts.length) update();
  return frag;
}

function genOutput(left, right, { granted, refresh, setupShown }) {
  if (!left || !right) return [];
  const url = triggerOf(left, right);
  if (!url) return [ht("p", { class: "hint hint-error" }, "guide_not_left", left.name)];
  const nodes = [urlBox(url)];
  if (left.leftDiscouraged) nodes.push(leftWarn(left));
  if (!setupShown && granted.get(left.id) !== true) {
    nodes.push(h("div", { class: "callout callout-warn" },
      ht("span", null, "guide_left_not_granted", left.name),
      authButton([left, right], ["engine_grant_named", left.name], { cls: "btn btn-small btn-attention", onDone: refresh })));
  }
  return nodes;
}

// 预置里标了 leftDiscouraged 的引擎（如 Perplexity）作左侧：站点 Service Worker 接管跳转，扩展收不到触发
export function leftWarn(e) {
  return h("div", { class: "callout callout-warn" },
    ht("span", null, "guide_left_discouraged", e.name));
}
