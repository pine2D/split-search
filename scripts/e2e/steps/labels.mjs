// 向导里提到的 Chrome 界面文字：中文（英文）并列，测试浏览器的界面可能是英文。
// 已核实（Chrome 155.0.8059.84，--headless=new，分别读 en-US 与 LANGUAGE=zh_CN 下 chrome://settings/searchEngines、
// chrome://extensions 的 loadTimeData 字符串，2026-10-23）的写成固定对照；右键搜索项与标签右键“新拆分视图”两项
// 按 docs/i18n/chrome-terms.md（读 Chrome 155 的 locales/*.pak，2026-10-24）写成 Chrome 原文；授权框仍未核实，写成宽松说法。
export const L = {
  // chrome://settings/searchEngines
  searchEngines: "“搜索引擎（Search engines）”",
  siteSearch: "“网站搜索（Site search）”",
  add: "“添加（Add）”",
  edit: "“修改（Edit，铅笔图标）”",
  del: "“删除（Delete）”",
  makeDefault: "“设为默认选项（Make default）”",
  inactive: "“未使用的快捷字词（Inactive shortcuts）”",
  moreInactive: "“更多无效网站（Additional inactive sites）”",
  activate: "“启用（Activate）”",
  more: "⋮（More actions）",
  // chrome://extensions
  devMode: "“开发者模式（Developer mode）”",
  loadUnpacked: "“加载未打包的扩展程序 / 加载已解压的扩展程序（Load unpacked）”",
  siteAccess: "“有权访问的网站 / 网站访问权限（Site access）”",
  onClick: "“点击时（On click）”",
  onSpecific: "“在特定网站上（On specific sites）”",
  onAll: "“在所有网站上（On all sites）”",
  // 原生界面：授权框未能核实，按常见文字宽松描述
  allow: "“允许（Allow）”",
  // 原生菜单，已按 locale pak 核实（docs/i18n/chrome-terms.md）：zh-CN “使用$1搜索“$2””（占位符紧贴汉字）/ en “Search $1 for “$2””
  ctxSearch: q => `“使用gb搜索“${q}””（英文界面为 “Search gb for “${q}””）`,
  // 标签右键菜单里新建拆分视图的两个菜单项，已按 locale pak 核实（同上）
  newSplit: "“在拆分视图中显示标签页”或“使用当前标签页创建新的拆分视图”（英文界面为 “Add tab to new split view” / “New split view with current tab”）",
};
