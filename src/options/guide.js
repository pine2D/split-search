// 触发网址：默认组合一条 + 自选组合生成器。分步引导和注意事项是 options.html 里的静态文字。
import { buildTriggerTemplate } from "../lib/trigger.js";
import { h, ht, copyButton, authButton, option, disclosure } from "./ui.js";
import { canBeLeft, generatorPick } from "./edits.js";
import { t } from "../chrome/i18n.js";

export const SETTINGS_URL = "chrome://settings/searchEngines";

let gen = null; // 生成器当前选择 [leftId, rightId]，跨重渲染保留（仍有效时，见 generatorPick）

export function setupGuide() {
  const slot = document.getElementById("settings-url-copy");
  slot.replaceChildren(copyButton(() => SETTINGS_URL, ["guide_copy_settings_url"], "guide_copy_settings_aria"));
}

function triggerOf(left, right) {
  try {
    return buildTriggerTemplate(left, right.id);
  } catch {
    return null;
  }
}

// label 是复制按钮的 LabelSpec，ariaKey 是它带上复制对象的无障碍名称（见 ui.js 的 copyButton）
export function urlBox(url, label, ariaKey) {
  return h("div", { class: "url-line" },
    h("code", { class: "url-box mono" }, url),
    copyButton(() => url, label, ariaKey));
}

// ctx: { cfg, granted, refresh, setupShown }。setupShown：“开始使用”卡显示着，默认组合左侧的授权入口只留在卡里，
// 默认组合的触发网址卡里也有，这里收进默认收起的 <details>；卡片不显示时照常展开
export function renderTriggers(ctx) {
  const { cfg, setupShown } = ctx;
  const all = [...cfg.engines, ...cfg.hidden];
  const byId = new Map(all.map(e => [e.id, e]));
  const [dl, dr] = cfg.defaultPair.map(id => byId.get(id));
  const frag = document.createDocumentFragment();

  // 默认组合
  const defUrl = dl && dr ? triggerOf(dl, dr) : null;
  const def = h("div", { class: "trigger-default" },
    h("div", { class: "trigger-head" },
      ht("span", { class: "tag tag-accent" }, "guide_default_tag"),
      dl && dr ? ht("strong", null, "guide_pair_label", dl.name, dr.name) : ht("strong", null, "guide_pair_invalid")),
    defUrl ? urlBox(defUrl, undefined, "guide_copy_default_aria") : ht("p", { class: "hint hint-error" }, "guide_no_trigger"),
    defUrl && dl.leftDiscouraged && leftWarn(dl),
    ht("p", { class: "hint" }, "guide_default_hint"));
  frag.append(h("div", { class: "trigger-card" },
    setupShown ? disclosure("guide-default", "guide_default_url_title", def) : def));

  // 其他组合：普通的左右两个下拉框（不用默认组合卡的窗格，免得看起来像在改默认组合），整段默认收起
  const lefts = cfg.engines.filter(canBeLeft);
  gen = generatorPick(cfg.engines, cfg.defaultPair, gen);
  const out = h("div", { class: "gen-output" });
  const leftSel = h("select", { id: "gen-left" },
    lefts.map(e => option(e.id, e.leftDiscouraged ? t("engine_left_discouraged_suffix", e.name) : e.name, e.id === gen[0])));
  const rightSel = h("select", { id: "gen-right" }, cfg.engines.map(e => option(e.id, e.name, e.id === gen[1])));
  const update = () => {
    gen = [leftSel.value, rightSel.value];
    out.replaceChildren(...genOutput(byId.get(gen[0]), byId.get(gen[1]), ctx));
  };
  leftSel.addEventListener("change", update);
  rightSel.addEventListener("change", update);

  frag.append(h("div", { class: "trigger-card" },
    disclosure("guide-other", "guide_other_pairs_title",
      ht("p", { class: "hint" }, "guide_pair_shortcut_hint", t("guide_example_shortcut_query")),
      lefts.length
        ? h("div", { class: "lookup-pickers gen-pickers" },
          h("label", null, ht("span", null, "common_left"), leftSel),
          h("label", null, ht("span", null, "common_right"), rightSel))
        : ht("p", { class: "hint hint-error" }, "guide_no_left"),
      out)));
  if (lefts.length) update();
  return frag;
}

// “开始使用”卡显示着时，只有默认组合的左侧把授权入口留在卡里；生成器选了别的未授权左侧照常提示
function genOutput(left, right, { cfg, granted, refresh, setupShown }) {
  if (!left || !right) return [];
  const url = triggerOf(left, right);
  if (!url) return [ht("p", { class: "hint hint-error" }, "guide_not_left", left.name)];
  const nodes = [urlBox(url, undefined, "guide_copy_gen_aria")];
  if (left.leftDiscouraged) nodes.push(leftWarn(left));
  const inSetupCard = setupShown && left.id === cfg.defaultPair[0];
  if (!inSetupCard && granted.get(left.id) !== true) {
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
