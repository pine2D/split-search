// e2e 判定扩展页面文字用的文案：测试时界面固定为 zh_CN（基线配置写 uiLocale，见 ext.mjs），
// 期望文字从同一份 messages.json 算出，找元素一律按 data-i18n 的 key，不写死中文。
import { readFileSync } from "node:fs";
import { formatMessage } from "../../src/lib/i18n.js";

export const E2E_LOCALE = "zh_CN";

// 各语言目录按需读一次。I18N 步骤要按 4 种语言核对，其余步骤只用 E2E_LOCALE（msg）
const CATALOGS = new Map();
export function catalog(locale) {
  if (!CATALOGS.has(locale)) {
    CATALOGS.set(locale, JSON.parse(readFileSync(new URL(`../../src/_locales/${locale}/messages.json`, import.meta.url), "utf8")));
  }
  return CATALOGS.get(locale);
}

export function msgIn(locale, key, ...subs) {
  const cat = catalog(locale);
  const entry = Object.hasOwn(cat, key) ? cat[key] : null;
  if (!entry) throw new Error(`${locale} 目录里没有 key：${key}`);
  return formatMessage(entry, subs.map(String));
}

export const msg = (key, ...subs) => msgIn(E2E_LOCALE, key, ...subs);

export const sel = key => `[data-i18n="${key}"]`;
