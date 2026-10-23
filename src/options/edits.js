// 设置页的纯逻辑：校验表单输入，根据原始存储（loadRaw 的结果）算出要写回的整键补丁。
// 不碰 chrome.* 和 DOM，方便在 node 里单独验证。
import { PRESETS, ID_PATTERN, validateTemplate, mergeConfig, isIdTaken } from "../lib/engines.js";

export const NAME_MAX = 40;
export const LEFT_RULE =
  "可作左侧的网址要求：小写 %s 恰好出现一次，并且是某个查询参数的完整值（如 ?q=%s），不含 # 和 _ss 参数";

const presetOf = (id) => PRESETS.find(p => p.id === id);
export const isPresetId = (id) => presetOf(id) !== undefined;

export function canBeLeft(engine) {
  const v = validateTemplate(engine?.url);
  return v.ok && v.canBeLeft;
}

// 网址输入框的即时说明
export function describeTemplate(url) {
  const v = validateTemplate((url ?? "").trim());
  if (!v.ok) return { level: "error", text: v.error };
  if (v.canBeLeft) return { level: "ok", text: "可作左侧或右侧" };
  return { level: "warn", text: `只能作右侧。${LEFT_RULE}` };
}

function checkFields(input) {
  const errors = {};
  const name = String(input.name ?? "").trim();
  const url = String(input.url ?? "").trim();
  if (!name) errors.name = "请填写名称";
  else if (name.length > NAME_MAX) errors.name = `名称不能超过 ${NAME_MAX} 个字符`;
  const v = validateTemplate(url);
  if (!v.ok) errors.url = v.error;
  return { errors, name, url, v };
}

const hasErrors = (errors) => Object.keys(errors).length > 0;

export function addEngine(raw, input) {
  const id = String(input.id ?? "").trim();
  const { errors, name, url } = checkFields(input);
  if (!ID_PATTERN.test(id)) errors.id = "id 只能由小写字母、数字和 - 组成，长度 1–20";
  else if (isIdTaken(id, raw)) errors.id = `id “${id}” 已被占用，请换一个`;
  if (hasErrors(errors)) return { ok: false, errors };
  const engine = { id, name, url };
  return { ok: true, engine, patch: { customEngines: [...(raw.customEngines || []), engine] } };
}

export function editEngine(raw, id, input) {
  const { errors, name, url, v } = checkFields(input);
  const preset = presetOf(id);
  const customs = raw.customEngines || [];
  const idx = customs.findIndex(c => c.id === id);
  if (!preset && idx === -1) {
    return { ok: false, errors: { form: "找不到这个引擎，它可能已在其他设备上被删除" } };
  }
  if (!errors.url && !v.canBeLeft && mergeConfig(raw).defaultPair[0] === id) {
    errors.url = `不能保存：这个引擎是默认组合的左侧，而新网址不能作为左侧。${LEFT_RULE}。`
      + "如果确实要用这个网址，请先把默认组合的左侧换成其他引擎。";
  }
  if (hasErrors(errors)) return { ok: false, errors };

  let before;
  let patch;
  if (preset) {
    const overrides = { ...(raw.presetOverrides || {}) };
    const o = { ...(overrides[id] || {}) };
    before = o.url || preset.url;
    if (name === preset.name) delete o.name; else o.name = name;
    if (url === preset.url) delete o.url; else o.url = url;
    if (Object.keys(o).length) overrides[id] = o; else delete overrides[id];
    patch = { presetOverrides: overrides };
  } else {
    before = customs[idx].url;
    const list = customs.slice();
    list[idx] = { ...customs[idx], name, url };
    patch = { customEngines: list };
  }
  return { ok: true, patch, engine: { id, name, url }, templateChanged: before !== url };
}

function inDefaultPair(raw, id) {
  return mergeConfig(raw).defaultPair.includes(id);
}

export function hideEngine(raw, id) {
  if (!isPresetId(id)) return { ok: false, error: "只有预置引擎可以隐藏" };
  if (inDefaultPair(raw, id)) return { ok: false, error: "默认组合正在使用这个引擎，不能隐藏" };
  const overrides = { ...(raw.presetOverrides || {}) };
  overrides[id] = { ...(overrides[id] || {}), hidden: true };
  return { ok: true, patch: { presetOverrides: overrides } };
}

export function restoreEngine(raw, id) {
  const overrides = { ...(raw.presetOverrides || {}) };
  if (!overrides[id]?.hidden) return { ok: true, patch: null };
  const o = { ...overrides[id] };
  delete o.hidden;
  if (Object.keys(o).length) overrides[id] = o; else delete overrides[id];
  return { ok: true, patch: { presetOverrides: overrides } };
}

export function deleteEngine(raw, id) {
  const customs = raw.customEngines || [];
  if (!customs.some(c => c.id === id)) return { ok: false, error: "只有自定义引擎可以删除" };
  if (inDefaultPair(raw, id)) return { ok: false, error: "默认组合正在使用这个引擎，不能删除" };
  const patch = { customEngines: customs.filter(c => c.id !== id) };
  if (Array.isArray(raw.order) && raw.order.includes(id)) patch.order = raw.order.filter(x => x !== id);
  return { ok: true, patch };
}

export function setDefaultPair(raw, leftId, rightId) {
  const { engines } = mergeConfig(raw);
  const left = engines.find(e => e.id === leftId);
  const right = engines.find(e => e.id === rightId);
  if (!left || !right) return { ok: false, error: "所选引擎不存在，可能已被删除或隐藏" };
  if (!canBeLeft(left)) return { ok: false, error: `${left.name} 不能作为左侧引擎` };
  return { ok: true, patch: { defaultPair: [leftId, rightId] } };
}

// 返回移动后的新数组；越界时原样返回同一个数组
export function moveId(ids, id, delta) {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= ids.length) return ids;
  const next = ids.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
