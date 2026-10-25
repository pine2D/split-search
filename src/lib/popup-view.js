// 工具栏弹窗的纯逻辑：目标标签参数与显示内容。不得引用 chrome。

// ?tabId=<非负整数> 是给 e2e 留的测试接缝（popup.html 不在 web_accessible_resources 里，网页打不开它）。
// 其余情况返回 null，弹窗改用所在窗口的活动标签。
export function targetTabId(search) {
  const raw = new URLSearchParams(search).get("tabId");
  if (raw === null || !/^\d{1,15}$/.test(raw)) return null;
  return Number(raw);
}

// pair 来自 ownedPair（左右已按当前标签顺序排好）。
// 引擎按 id 在已配置和已隐藏的引擎里查；查不到（已删除）为 null，页面显示“已删除的引擎”。
// 按钮是显示顺序里除当前右侧外的全部引擎：不看 cycleExclude，每一次都是用户亲手点选。
export function popupView(pair, { engines, hidden = [] }) {
  const find = id => engines.find(e => e.id === id) ?? hidden.find(e => e.id === id) ?? null;
  return {
    query: pair.query,
    left: find(pair.left.engineId),
    right: find(pair.right.engineId),
    choices: engines.filter(e => e.id !== pair.right.engineId),
  };
}
