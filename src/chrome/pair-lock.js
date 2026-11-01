// 同源扩展页面和 SW 共用一把独占 Web Lock。仅在动作入口获取，内部 helper 不再获取。
// 顺序：SW 队列 → 此锁 → split-state 的串行写入。导航、消息回复和关闭确认不占锁。
const NAME = "split-search:pairs";
const WAIT_MS = 5000; // 只限制排队等待；不是判断拆开/关闭的时间阈值

export async function withPairLock(run, { required = false, signal } = {}) {
  const locks = globalThis.navigator?.locks;
  if (!locks) {
    if (required) throw new Error("pair lock unavailable");
    return run(); // 保留旧功能；自动关闭必须 required，不能无锁执行
  }
  return locks.request(NAME, { mode: "exclusive", signal: signal ?? AbortSignal.timeout(WAIT_MS) }, run);
}
