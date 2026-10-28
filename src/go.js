// 触发处理页：解析 go.html?u=<原始网址>，判定分屏动作并执行。只做编排。
import { extractOriginalUrl, parseTrigger, expandTemplate, stripMarker, replaceQuery } from "./lib/trigger.js";
import { decideFor } from "./lib/split-decision.js";
import { ruleRight } from "./lib/right-rules.js";
import { validateTemplate } from "./lib/engines.js";
import { loadConfig } from "./chrome/config-store.js";
import { ACTIONS, leaveTab } from "./chrome/split-actions.js";
import { inspectTab } from "./chrome/split-state.js";
import { noteSetupPair } from "./chrome/setup-store.js";
import { openOptionsTab } from "./chrome/options-page.js";
import { errorTab } from "./lib/options-route.js";
import { initI18n, applyI18n, setI18nText } from "./chrome/i18n.js";
import { errorKey } from "./lib/errors.js";
import { safeArgs } from "./lib/safe-error.js";

const log = (...args) => console.error("[split-search]", ...safeArgs(args));
// 这两个错误码设置页也用，措辞面向设置页；出错页另有带“怎么办”的文案
const GO_KEYS = { bad_url: "go_err_bad_url", not_left: "go_err_not_left" };
const $ = (id) => document.getElementById(id);
let optionsKey = null; // 出错页“打开设置”去哪个 tab（lib/options-route.js 的 errorTab），null 时照旧打开设置页

// 文案并行加载，不 await：分屏路径（解析、读配置、分屏、跳转）不等它。
// 加载失败也照样 applyI18n（t() 有退路），i18n-pending 一定会被去掉。
const i18nReady = initI18n().catch(log).then(() => applyI18n(document));

// 下面三个界面函数都先等文案；调用方不 await，它们挂在同一个 promise 上，按调用顺序生效。
async function setStatus(key, ...subs) {
  await i18nReady;
  setI18nText($("status"), key, ...subs);
}

async function showError(key, ...subs) {
  await i18nReady;
  setI18nText($("status"), "go_status_failed");
  setI18nText($("error-message"), key, ...subs);
  $("error").hidden = false;
  $("open-options").hidden = false;
}

// “只打开左侧搜索”按钮：去掉 _ss 后的原始网址就是一次普通的左侧搜索；网址不可用时不显示
async function offerLeftOnly(original) {
  await i18nReady;
  const url = original === null ? null : safeOriginal(original);
  const btn = $("left-only");
  btn.hidden = !url;
  btn.onclick = url ? () => location.replace(url) : null;
}

// 读不到配置时的兜底：原始网址去掉 _ss 本身就是一次左侧搜索。
function safeOriginal(original) {
  try {
    const { protocol } = new URL(original);
    return protocol === "https:" || protocol === "http:" ? stripMarker(original) : null;
  } catch {
    return null;
  }
}

// 收集判定所需的上下文：当前标签、所在窗口、对侧与两侧记录（见 split-state.js 的 inspectTab）。
// 窗口带 populate：标签数用来区分 PiP 与窗口管理器置顶的普通窗口（lib/window-kind.js）。
async function gatherContext(engines) {
  const tab = await chrome.tabs.getCurrent();
  if (!tab) throw new Error("tabs.getCurrent() returned no tab");
  const win = await chrome.windows.get(tab.windowId, { populate: true });
  return { tab, win, ...(await inspectTab(tab, engines)) };
}

// auto：关键词规则选的右侧（{ rule, base }），没有时为 null；执行层只把它写进右侧标签的记录
async function split(engines, narrowEnabled, { left, right, query, auto }, leftUrl, rightUrl) {
  const ctx = await gatherContext(engines);
  // 判定经 decideFor：PiP 归为 "pip"，走 other-window，不在它上面调分屏 API（test/go-wiring.test.js 守着这条接线）
  const action = decideFor(ctx, narrowEnabled);
  const outcome = await ACTIONS[action]({
    ...ctx, leftUrl, rightUrl, leftId: left.id, rightId: right.id, query, narrowEnabled, auto,
  });
  // 写成了一对搜索记录：经 lib/setup-state.js 判定后写 setupDone（“开始使用”卡完成）。
  // 跳转前做（跳转会中断它）；noteSetupPair 从不抛错、最多等 500 ms，不影响分屏流程
  if (outcome.pair) await noteSetupPair([ctx.tab.id, ...outcome.pair]);
  if (!outcome.leave) {
    location.replace(outcome.replaceWith);
  } else if (await leaveTab(ctx.tab) === "kept") {
    setStatus("go_status_kept").catch(log);
  }
}

async function main() {
  $("error").hidden = true;
  $("open-options").hidden = true;
  $("left-only").hidden = true;
  optionsKey = null;
  setStatus("go_status_opening").catch(log);

  const original = extractOriginalUrl(location.search);
  if (original === null) {
    showError("go_err_no_trigger").catch(log);
    return;
  }

  let cfg;
  try {
    cfg = await loadConfig();
  } catch (err) {
    log("failed to read the config", err);
    const fallback = safeOriginal(original);
    if (fallback) location.replace(fallback);
    else showError("go_err_config_unreadable").catch(log);
    return;
  }

  const parsed = parseTrigger(original, cfg.engines);
  if (!parsed.ok) {
    const [key, ...subs] = errorKey(parsed.error) ?? ["go_status_failed"];
    optionsKey = errorTab(parsed.error.code);
    showError(GO_KEYS[parsed.error.code] ?? key, ...subs).catch(log);
    offerLeftOnly(original).catch(log);
    return;
  }

  const { left } = parsed;
  let query = parsed.query;
  let leftUrl;
  try {
    leftUrl = query === "" ? expandTemplate(left.url, "") : stripMarker(original);
  } catch (err) {
    log("failed to build the left URL", err);
    optionsKey = errorTab("bad_template");
    showError("go_err_bad_template", left.name).catch(log);
    return;
  }

  // 关键词规则只换默认组合的右侧（lib/right-rules.js 的 ruleRight）；规则出任何错都退回 _ss 原来的右侧，
  // 不落进下面的“只开左侧”。日志不记命中的规则、词或查询
  let right = parsed.right;
  let rightUrl = null;
  let auto = null;
  try {
    const pick = ruleRight(cfg, { leftId: left.id, rightId: right.id, query });
    if (pick) {
      // 用临时变量算，全部成功才提交；去词时左侧只改查询参数（路径型模板没有参数，replaceQuery 会抛错，整条规则不生效）
      let nextLeft = leftUrl;
      if (pick.query !== query) {
        nextLeft = stripMarker(replaceQuery(original, validateTemplate(left.url).leftParam, pick.query));
      }
      // engine 为 null：命中的规则不换右侧（keep 或引擎就是当前右侧）
      const nextRight = pick.engine ?? null;
      const nextRightUrl = nextRight ? expandTemplate(nextRight.url, pick.query) : null;
      leftUrl = nextLeft;
      query = pick.query;
      if (nextRight) {
        rightUrl = nextRightUrl;
        right = nextRight;
        auto = { rule: pick.ruleId, base: parsed.right.id };
      }
    }
  } catch (err) {
    log("keyword rule skipped", err);
  }
  try {
    rightUrl ??= expandTemplate(right.url, query);
    await split(cfg.engines, cfg.narrowFallback, { left, right, query, auto }, leftUrl, rightUrl);
  } catch (err) {
    log("split failed, opening the left side only", err);
    location.replace(leftUrl);
  }
}

async function start() {
  $("open-options").addEventListener("click", () => {
    openOptionsTab(optionsKey).catch(err => log("failed to open the options page", err));
  });

  // 防重入：后退/前进/刷新回到本页时不自动分屏，只给“重新执行”按钮。
  const navType = performance.getEntriesByType("navigation")[0]?.type;
  if (navType === "back_forward" || navType === "reload") {
    setStatus("go_status_no_repeat").catch(log);
    offerLeftOnly(extractOriginalUrl(location.search)).catch(log);
    const rerun = $("rerun");
    rerun.addEventListener("click", () => {
      rerun.hidden = true;
      main().catch(err => log("rerun failed", err));
    }, { once: true });
    await i18nReady;
    rerun.hidden = false;
    return;
  }
  main().catch(err => log("unhandled error in go.js", err));
}

start().catch(err => log("unhandled error in go.js", err));
