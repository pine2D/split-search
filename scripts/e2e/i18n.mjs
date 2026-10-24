// e2e 判定扩展页面文字用的文案：测试时界面固定为 zh_CN（基线配置写 uiLocale，见 ext.mjs），
// 期望文字从同一份 messages.json 算出，找元素一律按 data-i18n 的 key，不写死中文。
import { readFileSync } from "node:fs";
import { formatMessage } from "../../src/lib/i18n.js";

export const E2E_LOCALE = "zh_CN";

const CATALOG = JSON.parse(readFileSync(new URL(`../../src/_locales/${E2E_LOCALE}/messages.json`, import.meta.url), "utf8"));

export function msg(key, ...subs) {
  const entry = Object.hasOwn(CATALOG, key) ? CATALOG[key] : null;
  if (!entry) throw new Error(`${E2E_LOCALE} 目录里没有 key：${key}`);
  return formatMessage(entry, subs.map(String));
}

export const sel = key => `[data-i18n="${key}"]`;
