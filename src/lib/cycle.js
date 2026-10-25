// 快捷键轮换：右侧换成显示顺序里的下一个参与轮换的引擎。纯逻辑，不得引用 chrome。

// 按这一对的 kind 取轮换候选：图片查询对用以图搜图引擎、不看 cycleExclude（它们没有“参与快捷键轮换”开关）；
// 搜索对和文字查询对用文字引擎并跳过 cycleExclude
export function cycleCandidates(cfg, kind) {
  return kind === "image"
    ? { engines: cfg.imageEngines, exclude: [] }
    : { engines: cfg.engines, exclude: cfg.cycleExclude };
}

// 候选 = 没被排除、也不是当前右侧的引擎。取显示顺序里位于当前右侧之后的第一个候选，
// 到末尾回到开头；当前右侧已不在列表里（被删除或隐藏）时取第一个候选；没有候选返回 null。
// 候选可以与左侧相同。
export function nextRightEngine(engines, currentRightId, cycleExclude = []) {
  const excluded = new Set(cycleExclude);
  const candidates = engines.filter(e => !excluded.has(e.id) && e.id !== currentRightId);
  if (!candidates.length) return null;
  const at = engines.findIndex(e => e.id === currentRightId);
  if (at === -1) return candidates[0];
  const after = engines.slice(at + 1).find(e => candidates.includes(e));
  return after ?? candidates[0];
}
