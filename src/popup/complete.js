// 弹窗的“补成分屏”区（spec 3.2、3.12）：显示识别结果和可放在右侧的引擎，点一个就把执行交给 SW
// （background.js 的 runtime.onMessage，见 chrome/complete-actions.js）。弹窗里的 JS 可能在新标签进分屏时被杀，
// 所以这里不建标签、不写记录；消息只带标签 id 和引擎 id，不带网址和关键词，SW 自己重新读标签、重新识别。
import { t, setI18nText } from "../chrome/i18n.js";
import { safeArgs } from "../lib/safe-error.js";

const $ = (id) => document.getElementById(id);
const log = (...args) => console.error("[split-search]", ...safeArgs(args));

// 回复 mode 对应的提示；split 不提示（弹窗随后换成对视图）
const NOTE = { adjacent: "popup_complete_narrow", plain: "popup_complete_plain" };
// SW 可能回的错误码（lib/errors.js 里各有 err_<code> 文案）；认不出的、发不出去的都按 split_failed 显示
const CODES = ["not_results_page", "window_unsupported", "split_failed", "message_rejected"];

let pending = false; // 已经发出、还没回复：按钮保持禁用（重绘时也是），避免连点建出两对
let spent = false;   // 已经补成过一次（含退化成普通标签的 plain，不写记录，重绘后补成区还在）：本次弹窗里按钮一直禁用

function setDisabled(disabled) {
  for (const b of $("complete-choices").querySelectorAll("button")) b.disabled = disabled;
}

function showNote(mode) {
  const el = $("complete-note");
  const key = NOTE[mode];
  if (key) setI18nText(el, key);
  el.hidden = !key;
}

function showError(code) {
  const el = $("error");
  if (code) setI18nText(el, "err_" + code);
  el.hidden = !code;
}

async function onPick(tab, engineId, onDone) {
  if (pending) return;
  pending = true;
  setDisabled(true);
  showError(null);
  let reply = null;
  try {
    reply = await chrome.runtime.sendMessage({ type: "complete-split", tabId: tab.id, engineId });
  } catch (err) {
    log("popup: sending complete-split failed", err);
  }
  pending = false;
  if (reply?.ok === true) {
    spent = true;
    setDisabled(true);
    showNote(reply.mode);
    onDone();
    return;
  }
  const code = CODES.includes(reply?.code) ? reply.code : "split_failed";
  showError(code);
  // 只有 split_failed 的文案请用户再试一次；其余（页面已变、窗口不支持、被拒）要重新点工具栏按钮
  setDisabled(code !== "split_failed");
}

// view 来自 lib/popup-view.js 的 completeView；tab 是弹窗的目标标签；onDone 在补成之后调用（弹窗据此重绘）。
// 引擎名和关键词是用户数据：经 setI18nText 作参数代入，不当作文案模板。
export function showComplete(view, tab, { onDone }) {
  const detected = $("complete-detected");
  setI18nText(detected, "popup_complete_detected", view.engine.name, view.query);
  detected.title = detected.textContent; // 很长时只显示前几行（popup.css），悬停看完整的一行
  $("complete-choices").replaceChildren(...view.choices.map((engine) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = engine.id === view.suggestedId ? "btn suggested" : "btn";
    button.textContent = engine.name;
    button.dataset.engine = engine.id;
    button.setAttribute("aria-label", t("popup_complete_aria", engine.name));
    button.disabled = pending || spent;
    button.addEventListener("click", () => onPick(tab, engine.id, onDone));
    const li = document.createElement("li");
    li.append(button);
    return li;
  }));
}
