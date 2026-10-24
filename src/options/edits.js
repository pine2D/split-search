// 设置页的纯逻辑：校验表单输入，根据原始存储（loadRaw 的结果）算出要写回的整键补丁。
// 不碰 chrome.* 和 DOM，方便在 node 里单独验证。
// 失败时只返回错误码（见 lib/errors.js），由页面翻译成当前语言。
import { PRESETS, ID_PATTERN, validateTemplate, mergeConfig, isIdTaken } from "../lib/engines.js";
import { spec, fail, errorKey } from "../lib/errors.js";

export const NAME_MAX = 40;

const presetOf = (id) => PRESETS.find(p => p.id === id);
export const isPresetId = (id) => presetOf(id) !== undefined;

export function canBeLeft(engine) {
  const v = validateTemplate(engine?.url);
  return v.ok && v.canBeLeft;
}

// 网址输入框的即时说明；msg 是 t() 的参数：[key, ...subs]
export function describeTemplate(url) {
  const v = validateTemplate((url ?? "").trim());
  if (!v.ok) return { level: "error", msg: errorKey(v.error) };
  if (v.canBeLeft) return { level: "ok", msg: ["engine_tpl_ok"] };
  return { level: "warn", msg: ["engine_tpl_right_only"] };
}

function checkFields(input) {
  const errors = {};
  const name = String(input.name ?? "").trim();
  const url = String(input.url ?? "").trim();
  if (!name) errors.name = spec("name_required");
  else if (name.length > NAME_MAX) errors.name = spec("name_too_long", NAME_MAX);
  const v = validateTemplate(url);
  if (!v.ok) errors.url = v.error;
  return { errors, name, url, v };
}

const hasErrors = (errors) => Object.keys(errors).length > 0;

export function addEngine(raw, input) {
  const id = String(input.id ?? "").trim();
  const { errors, name, url } = checkFields(input);
  if (!ID_PATTERN.test(id)) errors.id = spec("id_format");
  else if (isIdTaken(id, raw)) errors.id = spec("id_taken", id);
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
    return { ok: false, errors: { form: spec("engine_gone") } };
  }
  if (!errors.url && !v.canBeLeft && mergeConfig(raw).defaultPair[0] === id) {
    errors.url = spec("default_left_url");
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
  if (!isPresetId(id)) return fail("only_preset_hide");
  if (inDefaultPair(raw, id)) return fail("pair_uses_hide");
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
  if (!customs.some(c => c.id === id)) return fail("only_custom_delete");
  if (inDefaultPair(raw, id)) return fail("pair_uses_delete");
  const patch = { customEngines: customs.filter(c => c.id !== id) };
  if (Array.isArray(raw.order) && raw.order.includes(id)) patch.order = raw.order.filter(x => x !== id);
  return { ok: true, patch };
}

export function setDefaultPair(raw, leftId, rightId) {
  const { engines } = mergeConfig(raw);
  const left = engines.find(e => e.id === leftId);
  const right = engines.find(e => e.id === rightId);
  if (!left || !right) return fail("pair_missing");
  if (!canBeLeft(left)) return fail("not_left", left.name);
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
