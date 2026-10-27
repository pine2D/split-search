// 触发网址：默认组合一条 + 自选组合生成器。分步引导和注意事项是 options.html 里的静态文字；
// “开始使用”卡显示时，默认组合一段和 5 步说明都收进默认收起的 <details>（卡片里已有同样的网址和三个小步）。
import { buildTriggerTemplate } from "../lib/trigger.js";
import { urlBreakParts } from "../lib/url-break.js";
import { h, ht, copyButton, authButton, option, disclosure } from "./ui.js";
import { canBeLeft, generatorPick } from "./edits.js";
import { t } from "../chrome/i18n.js";
import { showTab, focusIn } from "./tabs.js";

export const SETTINGS_URL = "chrome://settings/searchEngines";

// 用户在生成器里亲手选过的 [leftId, rightId]，跨重渲染保留（仍有效时，见 generatorPick）。
// 只在下拉框的 change 里记下；没改过时每次渲染都按当前默认组合重新取初值，默认组合改了初值跟着变
let userGen = null;

const withId = (el, id) => { el.id = id; return el; };

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

// label 是复制按钮的 LabelSpec，ariaKey 是它带上复制对象的无障碍名称（见 ui.js 的 copyButton）。
// 网址在 / ? & = , 之后插 <wbr>（lib/url-break.js），不从单词中间断开；<wbr> 不进 textContent，复制的仍是原字符串
export function urlBox(url, label, ariaKey) {
  const parts = urlBreakParts(url).flatMap((s, i) => (i ? [h("wbr"), s] : [s]));
  return h("div", { class: "url-line" },
    h("code", { class: "url-box mono" }, ...parts),
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
    setupShown ? withId(disclosure("guide-default", "guide_default_url_title", def), "guide-default") : def));

  // 其他组合：普通的左右两个下拉框（不用默认组合卡的窗格，免得看起来像在改默认组合），整段默认收起
  const lefts = cfg.engines.filter(canBeLeft);
  const gen = generatorPick(cfg.engines, cfg.defaultPair, userGen);
  if (userGen && (gen[0] !== userGen[0] || gen[1] !== userGen[1])) userGen = null; // 用户的选择已失效
  const out = h("div", { class: "gen-output" });
  const leftSel = h("select", { id: "gen-left" },
    lefts.map(e => option(e.id, e.leftDiscouraged ? t("engine_left_discouraged_suffix", e.name) : e.name, e.id === gen[0])));
  const rightSel = h("select", { id: "gen-right" }, cfg.engines.map(e => option(e.id, e.name, e.id === gen[1])));
  const update = () => out.replaceChildren(...genOutput(byId.get(leftSel.value), byId.get(rightSel.value), ctx));
  const pick = () => {
    userGen = [leftSel.value, rightSel.value];
    update();
  };
  leftSel.addEventListener("change", pick);
  rightSel.addEventListener("change", pick);

  frag.append(h("div", { class: "trigger-card" },
    withId(disclosure("guide-other", "guide_other_pairs_title",
      ht("p", { class: "hint" }, "guide_pair_shortcut_hint", t("guide_example_shortcut_query")),
      lefts.length
        ? h("div", { class: "lookup-pickers" },
          h("label", null, ht("span", null, "common_left"), leftSel),
          h("label", null, ht("span", null, "common_right"), rightSel))
        : ht("p", { class: "hint hint-error" }, "guide_no_left"),
      out), "guide-other")));
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

// 5 步说明（options.html 的 #guide-steps：小标题 + ol.steps）。ol 是静态节点，只在两种外壳之间移动，
// 里面的复制按钮（settings-url-copy）和 guide-step-fields 的富文本跟着走；小标题每次按 key 新建，切换语言时 applyI18n 照常重写
export function renderGuideSteps(setupShown) {
  const slot = document.getElementById("guide-steps");
  const list = slot?.querySelector("ol.steps");
  if (!list) return;
  // 外壳已经是要的那种就不动：重建会把焦点所在的复制按钮、summary 拿出文档（它们没有 id，还不回来），读屏器也会重读。
  // 文字随语言切换由 applyStatic 按 data-i18n 更新，不靠重建
  if (slot.firstElementChild?.id === (setupShown ? "guide-steps-details" : "guide-steps-title")) return;
  if (setupShown) slot.replaceChildren(withId(disclosure("guide-steps", "guide_steps_title", list), "guide-steps-details"));
  else slot.replaceChildren(ht("h3", { id: "guide-steps-title", tabindex: "-1" }, "guide_steps_title"), list);
}

// “开始使用”卡第 2 步的“详细步骤”：切到“添加到 Chrome”（已在就不动 hash），展开默认组合一段和 5 步说明，
// 滚到 5 步说明，焦点给它的 summary（不收起时给小标题）
export function revealGuideSteps() {
  showTab("add");
  const slot = document.getElementById("guide-steps");
  if (!slot) return;
  for (const id of ["guide-default", "guide-steps-details"]) {
    const d = document.getElementById(id);
    if (d) d.open = true;
  }
  slot.scrollIntoView({ block: "start" });
  (slot.querySelector("details > summary") ?? document.getElementById("guide-steps-title"))?.focus({ preventScroll: true });
}

// “搜索组合”末行指引：切到“添加到 Chrome”，展开“其他组合”，滚过去、焦点给它的 summary
export function revealGenerator() {
  showTab("add");
  const d = document.getElementById("guide-other");
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ block: "start" });
  d.querySelector("summary")?.focus({ preventScroll: true });
}

// 改了引擎网址后提示里的“查看触发网址”：切到“添加到 Chrome”，默认组合一段收着就展开，焦点给默认组合那条的复制按钮
// （不能只找 .url-line button：默认组合拼不出网址、“其他组合”又展开时，第一个是生成器的）
export function revealTriggers() {
  showTab("add");
  const d = document.getElementById("guide-default");
  if (d) d.open = true;
  document.getElementById("triggers")?.scrollIntoView({ block: "start" });
  focusIn(document.querySelector("#triggers .trigger-default .url-line button"));
}
