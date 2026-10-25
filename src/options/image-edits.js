// 以图搜图引擎的纯逻辑：新增、从引擎库添加、删除、选用。不碰 chrome.* 和 DOM。
// 以图搜图引擎单独存在 imageEngines 里，不经过 DNR，不需要授权，也不进快捷键轮换。
import { cleanImageEngines, isIdTaken } from "../lib/engines.js";
import { IMAGE_PRESET } from "../lib/image-engines.js";
import { uniqueId } from "../lib/engine-catalog.js";
import { spec, fail } from "../lib/errors.js";
import { checkFields } from "./edits.js";

const customs = (raw) => cleanImageEngines(raw.imageEngines);

function append(raw, base, name, url) {
  let id;
  try { id = uniqueId(base, x => isIdTaken(x, raw)); }
  catch (err) { if (err.code === "id_exhausted") return { ok: false, error: spec(err.code, ...err.args) }; throw err; }
  const engine = { id, name, url };
  return { ok: true, engine, patch: { imageEngines: [...customs(raw), engine] } };
}

export function addImageEngine(raw, input) {
  const { errors, name, url } = checkFields(input);
  if (Object.keys(errors).length) return { ok: false, errors };
  const r = append(raw, "img", name, url);
  return r.ok ? r : { ok: false, errors: { form: r.error } };
}

export function addImageFromCatalog(raw, entry) {
  if (customs(raw).some(e => e.url === entry.url)) return fail("catalog_already_added", entry.name);
  return append(raw, entry.id, entry.name, entry.url);
}

export function deleteImageEngine(raw, id) {
  const list = customs(raw);
  if (id === IMAGE_PRESET.id || !list.some(e => e.id === id)) return fail("only_custom_delete");
  return {
    ok: true,
    patch: { imageEngines: list.filter(e => e.id !== id) },
    ...(raw.imageEngine === id ? { remove: ["imageEngine"] } : {}),
  };
}

// lens 是默认：删键；其他必须是已有的自定义以图搜图引擎
export function setImageEngine(raw, id) {
  if (id === IMAGE_PRESET.id) return { ok: true, patch: null, remove: ["imageEngine"] };
  if (!customs(raw).some(e => e.id === id)) return fail("engine_gone");
  return { ok: true, patch: { imageEngine: id } };
}
