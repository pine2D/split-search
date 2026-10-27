// 弹窗的“按关键词换右侧”说明（v0.5，设计稿 8.3）：右侧是规则换的时，在左右窗格下面说一句为什么换，
// 旁边一个“换回”默认组合的右侧。只显示，不写记录：换回走 popup.js 的 onSwitch（重新判定、switchRight 去掉标记）。
// 命中的词来自用户自己写的规则，查询词本来就显示在弹窗里，不增加外发和存储；这里不记日志。
import { t, setI18nText } from "../chrome/i18n.js";
import { SCRIPT_KEYS } from "../lib/right-rules.js";

const $ = (id) => document.getElementById(id);

// auto 来自 popupView（null：右侧不是规则换的）；right 是当前右侧引擎（已删除为 null）。
// 引擎名是用户数据，作为占位符代入文案（textContent），不当 HTML。
export function showRuleNote(auto, right, onSwitch) {
  const note = $("rule-note");
  const revert = $("rule-revert");
  note.hidden = !auto;
  if (!auto) {
    revert.onclick = null;
    return;
  }
  const engine = right ? right.name : t("popup_engine_deleted");
  const text = $("rule-note-text");
  const hit = auto.hit;
  if (hit?.by === "word") setI18nText(text, "popup_rule_word", hit.word, engine);
  else if (hit?.by === "script") setI18nText(text, "popup_rule_script", t(SCRIPT_KEYS[hit.script]), engine);
  else setI18nText(text, "popup_rule_generic");

  const base = auto.base;
  revert.hidden = !base;
  if (base) {
    setI18nText(revert, "popup_rule_revert", base.name);
    revert.onclick = () => onSwitch(base.id);
  } else {
    revert.onclick = null;
  }
}
