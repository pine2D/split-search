import { validateTemplate } from "./engines.js";

export const RULE_ID = 1;
// RE2 兼容：只要求出现 _ss 参数，格式校验交给 parseTrigger
export const TRIGGER_REGEX = "^https?://[^#]*[?&]_ss=[^&#]*(&[^#]*)?$";

export function leftHosts(engines) {
  const hosts = [];
  for (const e of engines) {
    const v = validateTemplate(e.url);
    if (!v.ok || !v.canBeLeft) continue;
    const host = new URL(e.url.replace("%s", "x")).hostname;
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

export function buildRedirectRule(extensionId, hosts) {
  if (!hosts.length) return null;
  return {
    id: RULE_ID,
    priority: 1,
    condition: {
      regexFilter: TRIGGER_REGEX,
      isUrlFilterCaseSensitive: true,
      requestDomains: [...hosts],
      resourceTypes: ["main_frame"],
    },
    action: {
      type: "redirect",
      redirect: { regexSubstitution: "chrome-extension://" + extensionId + "/go.html?u=\\0" },
    },
  };
}
