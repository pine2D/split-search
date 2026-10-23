// 占位：Task 6 实现规则重建。
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
