// 会撤销授权或停用扩展的步骤（restores: true，即 B4、T8）结束后，由 run.mjs 经运行器的 afterStep 调用：
// 不受单步超时限制，无论步骤通过、失败、跳过还是超时都执行。确认扩展可用、一次性授权齐全；
// 缺授权就由脚本发起申请（用户点“允许”），被拒绝再申请一次；仍不行返回原因，run.mjs 据此设 stopReason，
// 剩余步骤以该原因跳过，而不是一个个超时、给出误导性的失败原因。
import { GRANT_ORIGINS } from "../config.mjs";
import { userWait, extAlive, contains, requestGrant, focusGuide } from "./guided.mjs";

const ENABLE_TEXT = "Split Search 目前不可用（可能还处于停用状态）。请打开 chrome://extensions，把 Split Search 的开关打开（启用）。\n"
  + "后面的步骤都依赖它；启用后脚本自动继续。";

// deps 可注入，便于单测
export async function ensureRecovered(ctx, deps = {}) {
  const { alive = () => extAlive(ctx.browser), has = o => contains(ctx.browser, o), request = requestGrant, wait = userWait,
    focus = () => focusGuide(ctx).catch(() => {}) } = deps;
  const origins = GRANT_ORIGINS(ctx.port);
  if (!(await alive())) {
    await focus();
    const r = await wait(ctx, {
      title: "恢复：启用扩展", what: "扩展已启用", hint: null, buttons: ["skip"], copyText: "chrome://extensions",
      instruction: ENABLE_TEXT, probe: alive, timeoutMs: (ctx.timeoutMs ?? 120000) * 5,
    });
    if (r.kind !== "met") return { ok: false, reason: "扩展未恢复", detail: "扩展没有重新启用" };
  }
  if ((await has(origins).catch(() => false)) === true) return { ok: true, detail: "扩展可用，授权齐全" };
  const attempts = [
    "上一步结束后一次性授权不完整，后面的步骤需要这些网站的授权。",
    "上一次没有允许（被拒绝或超时）。后面的步骤都需要这些授权，这是最后一次申请；再不允许，剩余步骤会全部跳过。",
  ];
  for (const [i, why] of attempts.entries()) {
    const ok = await request(ctx, origins, { title: `恢复授权（第 ${i + 1} 次）`, why }).catch(() => false);
    if (ok) return { ok: true, detail: `授权已恢复（第 ${i + 1} 次申请）` };
  }
  return { ok: false, reason: "授权未恢复", detail: "两次申请都没有得到授权" };
}

// run.mjs 的 afterStep：只处理 restores 步骤
export function makeAfterStep(rt, { log = () => {}, warn = () => {} } = {}, deps) {
  return async step => {
    if (!step.restores) return;
    const c = rt.ctx;
    const r = await ensureRecovered(c, deps);
    if (r.ok) { log(`  ${step.id} 之后：${r.detail}`); return; }
    const msg = `${step.id} 之后：${r.detail}，剩余步骤跳过（${r.reason}）`;
    rt.notes.push(msg);
    warn(msg);
    rt.stopReason ??= r.reason;
  };
}
