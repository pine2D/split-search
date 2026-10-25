// 识别搜索结果页（spec 3.2“识别结果页”）：给“补成分屏”用。纯逻辑，不得引用 chrome。
import { parseTrigger } from "./trigger.js";
import { validateTemplate, PLACEHOLDER } from "./engines.js";

// 网址是否是 engine 的结果页：origin、pathname 与模板相同，模板里除 %s 以外的固定参数都在且值相同
// （网址多出的参数不影响），%s 所在参数的第一个值去掉首尾空白后非空。
// 只认 %s 整个占一个查询参数值的模板（leftParam 不为空），%s 在路径里或只是参数值一部分的不支持。
function matchEngine(u, engine) {
  const v = validateTemplate(engine.url);
  if (!v.ok || !v.canBeLeft) return null;
  const t = new URL(engine.url.replace("%s", PLACEHOLDER));
  if (u.origin !== t.origin || u.pathname !== t.pathname) return null;
  const fixed = [...t.searchParams].filter(([k]) => k !== v.leftParam);
  if (!fixed.every(([k, val]) => u.searchParams.get(k) === val)) return null;
  const query = (u.searchParams.get(v.leftParam) ?? "").trim();
  if (!query) return null;
  return { engine, query, fixed: fixed.length, pathLen: t.pathname.length };
}

// 没有 _ss 时建议默认组合的右侧；它恰好就是识别出的引擎时改建议默认组合的左侧
function suggestFor(engineId, defaultPair) {
  return defaultPair[1] === engineId ? defaultPair[0] : defaultPair[1];
}

// engines 是未隐藏的文字引擎（显示顺序），defaultPair 来自 mergeConfig。
// 返回 { engine, query, suggestedId }，识别不出返回 null。
export function matchResultPage(url, { engines, defaultPair }) {
  let u;
  try { u = new URL(url); } catch { return null; }
  // 带合法 _ss 的网址只按 _ss 声明的左侧引擎识别，不通过就是识别不出，不再逐个比对
  const trig = parseTrigger(url, engines);
  if (trig.ok) {
    const hit = matchEngine(u, trig.left);
    if (!hit) return null;
    const suggestedId = trig.right.id === hit.engine.id ? suggestFor(hit.engine.id, defaultPair) : trig.right.id;
    return { engine: hit.engine, query: hit.query, suggestedId };
  }
  // 多个匹配时：固定参数多的 → 模板 pathname 长的 → 显示顺序靠前的
  let best = null;
  for (const e of engines) {
    const hit = matchEngine(u, e);
    if (hit && (!best || hit.fixed > best.fixed || (hit.fixed === best.fixed && hit.pathLen > best.pathLen))) best = hit;
  }
  if (!best) return null;
  return { engine: best.engine, query: best.query, suggestedId: suggestFor(best.engine.id, defaultPair) };
}
