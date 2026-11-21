// “开始使用”卡的纯逻辑：设置页显示哪几步、每步什么状态；go.html 写入一对搜索记录后算不算“设置完成”。
// 不得引用 chrome。

// 工具栏试用无需站点授权。示例和地址栏触发都只需要左侧授权。
// setupDone 说明真实触发曾打开两个结果，Chrome 中是否设为默认由用户核对。
export function setupView({ leftGranted = false, setupDone = false, justCompleted = false } = {}) {
  if (setupDone && !leftGranted) return { mode: "regrant", steps: [{ id: "grant", state: "todo" }] };
  if (setupDone) return { mode: justCompleted ? "done" : "hidden", steps: [] };
  return {
    mode: "steps",
    steps: [
      { id: "try", state: leftGranted ? "ready" : "needs-grant" },
      { id: "add", state: "todo" },
    ],
  };
}

// go.html 写入一对搜索记录之后（新建分屏、相邻对、在旁边或别的窗口新开一对，以及在本扩展的一对里重新搜索）
// 由它判定要不要写 storage.local 的 setupDone。tabIds：当前标签和写入记录的两侧（至少两个整数）；
// tryTabs：storage.session 的 setupTryTabs，“试一下”打开的标签 id（它绕过了用户的网站搜索设置，不算完成）。
// 已完成过就不再写。读不出 tryTabs（不是数组）当作空。
export function countsAsSetup({ setupDone, tryTabs, tabIds } = {}) {
  if (setupDone === true) return false;
  if (!Array.isArray(tabIds) || tabIds.length < 2 || !tabIds.every(Number.isInteger)) return false;
  const tried = Array.isArray(tryTabs) ? tryTabs : [];
  return !tabIds.some(id => tried.includes(id));
}

// setupTryTabs 最多留这么多个（只有标签 id；浏览器关闭即清空，这里只防无限增长）
export const TRY_TABS_MAX = 50;

// 追加一个“试一下”打开的标签 id：去重后放在最后，只留最近 max 个；list 不是数组当作空，非整数项丢掉
export function addTryTab(list, id, max = TRY_TABS_MAX) {
  const ids = (Array.isArray(list) ? list : []).filter(x => Number.isInteger(x) && x !== id);
  if (Number.isInteger(id)) ids.push(id);
  return ids.slice(-max);
}
