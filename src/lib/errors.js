// 错误码：lib 和设置页逻辑只返回码和参数，页面用 t("err_<code>", ...args) 显示。纯逻辑，不得引用 chrome。

export const ERROR_CODES = Object.freeze([
  "bad_url", "tpl_no_placeholder", "tpl_bad_scheme", "tpl_no_host", "tpl_wildcard_host", "tpl_ipv6",
  "tpl_reserved_param", "marker_format", "unknown_engine", "not_left", "template_mismatch",
  "config_too_large", "name_required", "name_too_long", "id_format", "id_taken", "engine_gone",
  "default_left_url", "only_preset_hide", "pair_uses_hide", "only_custom_delete", "pair_uses_delete",
  "pair_missing", "quota_rate", "quota_bytes", "catalog_already_added", "id_exhausted",
  "not_results_page", "window_unsupported", "split_failed", "message_rejected",
  "rule_too_many", "rule_too_many_words", "rule_words_total", "rule_word_long", "rule_no_words", "rule_script",
  "rule_engine", "rule_too_large", "rule_gone",
]);

export function spec(code, ...args) {
  return { code, args: args.map(String) };
}

export function fail(code, ...args) {
  return { ok: false, error: spec(code, ...args) };
}

// 需要抛出时用它：message 就是错误码，日志里也看得出来
export function codedError(code, ...args) {
  return Object.assign(new Error(code), spec(code, ...args));
}

// chrome.storage.sync 的配额错误只有英文常量名，按 message 认
const QUOTA = [
  [/MAX_WRITE_OPERATIONS_PER_(MINUTE|HOUR)/, "quota_rate"],
  [/QUOTA_BYTES/, "quota_bytes"],
];

export function errorKey(x) {
  if (ERROR_CODES.includes(x?.code)) return ["err_" + x.code, ...(x.args ?? []).map(String)];
  const text = x?.message ?? String(x);
  for (const [re, code] of QUOTA) if (re.test(text)) return ["err_" + code];
  return null;
}
