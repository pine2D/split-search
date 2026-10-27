// 设置页的纯逻辑：校验表单输入，根据原始存储（loadRaw 的结果）算出要写回的整键补丁。
// 不碰 chrome.* 和 DOM，方便在 node 里单独验证。
// 失败时只返回错误码（见 lib/errors.js），由页面翻译成当前语言。
import { PRESETS, ID_PATTERN, validateTemplate, mergeConfig, isIdTaken, engineOrigin, cleanIdList } from "../lib/engines.js";
import { catalogUrl, uniqueId, isAdded } from "../lib/engine-catalog.js";
import { spec, fail, errorKey } from "../lib/errors.js";
import { dropRulesFor } from "./rule-edits.js";

export const NAME_MAX = 40;

const presetOf = (id) => PRESETS.find(p => p.id === id);
export const isPresetId = (id) => presetOf(id) !== undefined;

export function canBeLeft(engine) {
  const v = validateTemplate(engine?.url);
  return v.ok && v.canBeLeft;
}

// “其他组合”生成器的选择 [leftId, rightId]。prev（用户改过的选择）两侧都还有效就保留；
// 否则取初值：左取默认左侧（不能作左侧时退回第一个可作左侧的），右取第一个既不是默认右侧、也不是左侧的引擎，
// 没有就退回默认右侧（也不在列表里时取第一个引擎）。初值故意不等于默认组合，免得看起来像在改默认组合
export function generatorPick(engines, defaultPair, prev = null) {
  const lefts = engines.filter(canBeLeft);
  const has = (list, id) => list.some(e => e.id === id);
  if (prev && has(lefts, prev[0]) && has(engines, prev[1])) return [prev[0], prev[1]];
  const [dl, dr] = defaultPair;
  const left = has(lefts, dl) ? dl : lefts[0]?.id;
  const right = engines.find(e => e.id !== dr && e.id !== left)?.id ?? (has(engines, dr) ? dr : engines[0]?.id);
  return [left, right];
}

// 只有能作左侧、又还没授权的引擎才需要持久的“需授权”警告；右侧专用引擎的授权只是兜底
export function needsGrantWarning(engine, granted) {
  return !granted && canBeLeft(engine);
}

// 网址输入框的即时说明；msg 是 t() 的参数：[key, ...subs]
export function describeTemplate(url) {
  const v = validateTemplate((url ?? "").trim());
  if (!v.ok) return { level: "error", msg: errorKey(v.error) };
  if (v.canBeLeft) return { level: "ok", msg: ["engine_tpl_ok"] };
  return { level: "warn", msg: ["engine_tpl_right_only"] };
}

export function checkFields(input) {
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
  // id 在收起的“高级”里，多半是按名称自动生成的：名称或网址有错时先只报这两项，不报 id、不展开“高级”
  if (hasErrors(errors)) return { ok: false, errors };
  if (!ID_PATTERN.test(id)) errors.id = spec("id_format");
  else if (isIdTaken(id, raw)) errors.id = spec("id_taken", id);
  if (hasErrors(errors)) return { ok: false, errors };
  const engine = { id, name, url };
  return { ok: true, engine, patch: { customEngines: [...(raw.customEngines || []), engine] } };
}

// 解析失败视为不同
function sameOrigin(a, b) {
  try {
    return engineOrigin({ url: a }) === engineOrigin({ url: b });
  } catch {
    return false;
  }
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
    const next = { ...customs[idx], name, url };
    if (next.leftDiscouraged && !sameOrigin(before, url)) delete next.leftDiscouraged;
    list[idx] = next;
    patch = { customEngines: list };
  }
  return { ok: true, patch, engine: { id, name, url }, templateChanged: before !== url };
}

// 引擎库条目复制成一条自定义引擎，加到显示顺序末尾；ai 条目同时排除出快捷键轮换
export function addFromCatalog(raw, entry, locale) {
  const { engines } = mergeConfig(raw);
  if (isAdded(entry, locale, engines)) return fail("catalog_already_added", entry.name);
  let id;
  try { id = uniqueId(entry.id, x => isIdTaken(x, raw)); }
  catch (err) { if (err.code === "id_exhausted") return { ok: false, error: { code: err.code, args: err.args } }; throw err; }
  const engine = {
    id,
    name: entry.name,
    url: catalogUrl(entry, locale),
    ...(entry.leftDiscouraged ? { leftDiscouraged: true } : {}),
  };
  const patch = { customEngines: [...(raw.customEngines || []), engine] };
  if (entry.ai) patch.cycleExclude = [...cleanIdList(raw.cycleExclude), engine.id];
  return { ok: true, engine, patch };
}

function inDefaultPair(raw, id) {
  return mergeConfig(raw).defaultPair.includes(id);
}

// 删除或隐藏的正是查词引擎时，一并删掉 lookupEngine，回到“跟随默认组合的右侧”
const dropLookup = (raw, id) => (raw.lookupEngine === id ? { remove: ["lookupEngine"] } : {});

export function hideEngine(raw, id) {
  if (!isPresetId(id)) return fail("only_preset_hide");
  if (inDefaultPair(raw, id)) return fail("pair_uses_hide");
  const overrides = { ...(raw.presetOverrides || {}) };
  overrides[id] = { ...(overrides[id] || {}), hidden: true };
  return { ok: true, patch: { presetOverrides: overrides }, ...dropLookup(raw, id) };
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
  if (Array.isArray(raw.cycleExclude) && raw.cycleExclude.includes(id)) {
    patch.cycleExclude = cleanIdList(raw.cycleExclude).filter(x => x !== id);
  }
  // 连带删掉指向它的关键词规则：同名重建会拿回同一个 id，留着的规则会悄悄指向新引擎
  const { rules, dropped } = dropRulesFor(raw, id);
  if (dropped && rules.length) patch.rightRules = rules;
  const remove = [...(dropLookup(raw, id).remove ?? []), ...(dropped && !rules.length ? ["rightRules"] : [])];
  return { ok: true, patch, ...(remove.length ? { remove } : {}), rulesDropped: dropped };
}

// null：回到跟随默认组合的右侧（删键）；否则必须是未隐藏的文字引擎
export function setLookupEngine(raw, id) {
  if (id === null) return { ok: true, patch: null, remove: ["lookupEngine"] };
  if (!mergeConfig(raw).engines.some(e => e.id === id)) return fail("engine_gone");
  return { ok: true, patch: { lookupEngine: id } };
}

// included 为真：参与快捷键轮换（从 cycleExclude 移除）；否则加入 cycleExclude（不重复）
export function setCycle(raw, id, included) {
  const list = cleanIdList(raw.cycleExclude).filter(x => x !== id);
  return { ok: true, patch: { cycleExclude: included ? list : [...list, id] } };
}

export function setDefaultPair(raw, leftId, rightId) {
  const { engines } = mergeConfig(raw);
  const left = engines.find(e => e.id === leftId);
  const right = engines.find(e => e.id === rightId);
  if (!left || !right) return fail("pair_missing");
  if (!canBeLeft(left)) return fail("not_left", left.name);
  return { ok: true, patch: { defaultPair: [leftId, rightId] } };
}

// 改了默认组合后“Chrome 里还是旧网址”的提示（设计稿 3.9 第 1 条）。rec 是本页内存的 { from, mode }：
// from 是第一次改之前的组合，mode 是那时 setupView 的 mode；只记一次，之后再改不覆盖
const samePair = (a, b) => a[0] === b[0] && a[1] === b[1];
export function notePairChange(rec, { from, mode }) {
  return rec ?? { from: [...from], mode };
}
// 每次渲染先判要不要清掉：没记录、改回原组合、steps 档记下的而现在已离开 steps（按新网址完成了设置）
export function pairChangedView(rec, { pair, mode }) {
  if (!rec || samePair(pair, rec.from) || (rec.mode === "steps" && mode !== "steps")) return { rec: null, show: null };
  return { rec, show: mode === "steps" ? "setup" : "replace" };
}
// 保存成功的提示：改回原组合（提示框随之消失）、还在首次设置、其余
export function pairSavedKey(rec, pair, mode) {
  if (rec && samePair(pair, rec.from)) return "notice_pair_saved_back";
  return mode === "steps" ? "notice_pair_saved_setup" : "notice_pair_saved";
}

export function setNarrowFallback(_raw, enabled) {
  return { ok: true, patch: { narrowFallback: enabled === true } };
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

// 防抖期内的排序（pendingOrder）与当前可见引擎（ids）对齐：按 pending 的先后保留仍可见的，
// ids 里缺的（刚恢复的引擎）按原顺序补到末尾；另一页隐藏或删除、却还留在 pending 里的 id 去掉
export function reconcileOrder(pending, ids) {
  if (!pending) return ids.slice();
  const kept = pending.filter(id => ids.includes(id));
  return [...kept, ...ids.filter(id => !kept.includes(id))];
}

// 移动后的播报用：位置从 1 起，找不到返回 null
export function movePosition(order, id) {
  const i = order.indexOf(id);
  return i < 0 ? null : { pos: i + 1, total: order.length };
}

// 上移 / 下移按钮移到边缘后被禁用，焦点交给同一行另一个方向的按钮：move-up-x ↔ move-down-x
export function siblingMoveId(id) {
  const m = /^move-(up|down)-(.+)$/.exec(id ?? "");
  return m ? `move-${m[1] === "up" ? "down" : "up"}-${m[2]}` : null;
}
