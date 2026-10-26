// “开始使用”卡的纯逻辑：设置页显示哪几步、每步什么状态；go.html 写入一对搜索记录后算不算“设置完成”。
// 不得引用 chrome。

// 输入：左右两侧是否已授权、右侧是否是另一个引擎、storage.local 的 setupDone、本页是否刚看到它变成 true。
// mode：steps（首次，三步）、regrant（完成过但左侧没授权：只显示第 1 步）、done（本页刚完成：一句确认）、hidden。
// 步骤状态：grant todo|done，add todo（Chrome 里的设置读不到，只能靠完成判定收尾），try ready|blocked（左侧没授权不能试）。
// rightPending：右侧是另一个引擎且没授权，第 1 步要留一个“建议”的授权入口。
export function setupView({ leftGranted = false, rightGranted = false, rightDistinct = false, setupDone = false, justCompleted = false } = {}) {
  const rightPending = rightDistinct && !rightGranted;
  if (setupDone && !leftGranted) return { mode: "regrant", steps: [{ id: "grant", state: "todo" }], rightPending };
  if (setupDone) return { mode: justCompleted ? "done" : "hidden", steps: [], rightPending };
  return {
    mode: "steps",
    steps: [
      { id: "grant", state: leftGranted ? "done" : "todo" },
      { id: "add", state: "todo" },
      { id: "try", state: leftGranted ? "ready" : "blocked" },
    ],
    rightPending,
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
