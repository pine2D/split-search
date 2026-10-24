// 触发网址：默认组合一条 + 自选组合生成器。分步引导和注意事项是 options.html 里的静态文字。
import { buildTriggerTemplate } from "../lib/trigger.js";
import { h, copyButton, authButton, option } from "./ui.js";
import { canBeLeft } from "./edits.js";

const SETTINGS_URL = "chrome://settings/searchEngines";

let gen = null; // 生成器当前选择 [leftId, rightId]，跨重渲染保留

export function setupGuide() {
  const slot = document.getElementById("settings-url-copy");
  slot.replaceChildren(copyButton(() => SETTINGS_URL, "复制地址"));
}

function triggerOf(left, right) {
  try {
    return buildTriggerTemplate(left, right.id);
  } catch {
    return null;
  }
}

function urlBox(url) {
  return h("div", { class: "url-line" },
    h("code", { class: "url-box mono" }, url),
    copyButton(() => url));
}

// ctx: { cfg, granted, refresh }
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
      h("span", { class: "tag tag-accent" }, "默认组合"),
      h("strong", null, dl && dr ? `${dl.name} ｜ ${dr.name}` : "（默认组合无效）")),
    defUrl ? urlBox(defUrl) : h("p", { class: "hint hint-error" }, "无法生成触发网址，请检查默认组合的左侧引擎。"),
    defUrl && dl.leftDiscouraged && leftWarn(dl),
    h("p", { class: "hint" },
      "按下方步骤添加为网站搜索后，在该条目的 ⋮ 菜单里选“设为默认”。之后地址栏直接搜索、拖拽文字到标签栏都会分屏。")));

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
    lefts.map(e => option(e.id, e.leftDiscouraged ? `${e.name}（建议作右侧）` : e.name, e.id === gen[0])));
  const rightSel = h("select", { id: "gen-right" }, rights.map(e => option(e.id, e.name, e.id === gen[1])));
  const update = () => {
    gen = [leftSel.value, rightSel.value];
    out.replaceChildren(...genOutput(byId.get(gen[0]), byId.get(gen[1]), granted, ctx.refresh));
  };
  leftSel.addEventListener("change", update);
  rightSel.addEventListener("change", update);

  frag.append(h("div", { class: "trigger-card" },
    h("div", { class: "trigger-head" }, h("strong", null, "其他组合")),
    h("p", { class: "hint" }, "每个组合添加成一条网站搜索，用你自己定的快捷字词触发，例如在地址栏输入“kg 关键词”。"),
    lefts.length
      ? h("div", { class: "pair-pickers" },
          h("label", null, h("span", null, "左侧"), leftSel),
          h("span", { class: "pair-sep", "aria-hidden": "true" }, "｜"),
          h("label", null, h("span", null, "右侧"), rightSel))
      : h("p", { class: "hint hint-error" }, "没有可作左侧的引擎。"),
    out));
  if (lefts.length) update();
  return frag;
}

function genOutput(left, right, granted, refresh) {
  if (!left || !right) return [];
  const url = triggerOf(left, right);
  if (!url) return [h("p", { class: "hint hint-error" }, `${left.name} 不能作为左侧引擎。`)];
  const nodes = [urlBox(url)];
  if (left.leftDiscouraged) nodes.push(leftWarn(left));
  if (granted.get(left.id) !== true) {
    nodes.push(h("div", { class: "callout callout-warn" },
      h("span", null, `左侧 ${left.name} 还没授权，这个组合不会分屏，只会打开普通的 ${left.name} 搜索。`),
      authButton([left, right], `授权 ${left.name}`, { cls: "btn btn-small btn-attention", onDone: refresh })));
  }
  return nodes;
}

// 预置里标了 leftDiscouraged 的引擎（如 Perplexity）作左侧：站点 Service Worker 接管跳转，扩展收不到触发
function leftWarn(e) {
  return h("div", { class: "callout callout-warn" },
    h("span", null, `${e.name} 建议只作右侧：它的网站用 Service Worker 接管页面跳转，作左侧时通常只会打开普通的 ${e.name} 搜索、不分屏。作右侧不受影响。`));
}
