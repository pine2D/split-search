# Split Search v0.5 验收清单

扩展 ID 应为 `alngkkgnobglnfbhcplhpaflcgfiajnj`。v0.5 新功能：按关键词换右侧。设计见 `docs/superpowers/specs/2026-10-27-v0.5-keyword-routing-design.md`。

v0.1、v0.3、v0.4 的表照旧有效，运行方式、显示模式、报告与结果分类都以 v0.1 第 1 节为准。本表只列 v0.5 新增和改写的项目。

## 1. 怎么跑

- 只跑 v0.5 的项目：`npm run e2e -- --auto-only --only T25,B20,I18N,B14,B15`（B15 汇总整次运行的控制台错误）。
- 存储基线不加 `rightRules`。T25、B20 自己写，结束时写回；临时引擎 `ed` 同样写回。I18N、B14 的规则现场（`withRulePopup`、规则区样例）也经 `guarded` 写回 `rightRules`。
- 模拟引擎 D（`ed`）与 C 同 host，按路径区分：`/search` 是 D，`/wiki` 是 C。不加 host、不重新授权，右侧绝不打开真实网站。
- 查询词按原文写，经 `ruleTrigger` 用 `encodeURIComponent` 编码进触发网址；期望的右侧网址由 `expectRight` 按同样的编码算。中文查询经 CDP 导航打开，不走键盘。
- 每个查询带一次性 token，T25(l) 按 token 核对 `storage.sync`、`storage.local` 和控制台日志（error 与 info 级）里都没有查询词。
- 快捷键轮换清掉标记不在 e2e 里测：`cycleRight` 在 SW 里，e2e 不 attach SW。它与弹窗共用 `switchRight → writeEngine`，由 T25(h)(j) 和单测覆盖。

## 2. B/T 表

| # | 检查 | 期望 | 覆盖 |
|---|---|---|---|
| T25(a0) | 没有规则时触发 | 与 v0.4 相同，记录没有 rule/base，左侧 = 原网址去掉 `_ss` | e2e auto |
| T25(a)(b) | 词命中与英文整词 | wiki 换成 C，右侧记录 `rule: "r2"`、`base: "eb"`，左侧记录不带；wikis 不换 | e2e auto |
| T25(c)(c') | 例外 | “默认组合的右侧”规则命中后不往下比；默认组合改成 A ｜ D 后仍是例外，右侧是 D | e2e auto |
| T25(d) | 文字规则与顺序 | 有汉字换成 D；百科排在汉字前面，换成 C | e2e auto |
| T25(e) | 暂不生效 | 等于左侧、引擎已删的规则被跳过，无控制台错误 | e2e auto |
| T25(f) | 复用 | 同一对按新关键词重新比，标记随之出现或消失；分屏不变、没有新标签 | e2e auto |
| T25(g) | 显式组合 | 其他组合不受规则影响 | e2e auto |
| T25(h)(i)(j) | 弹窗 | 说明写明哪个词或哪种文字；换回、手动换后标记消失；换回后说明隐藏、焦点给换右侧列表第一个 | e2e auto |
| T25(k) | 补成分屏 | 建议排序与 go.html 的规则结果一致，不自动建对；点了建出的一对记录无 rule | e2e auto |
| T25(l) | 隐私 | sync/local/日志不含查询词；local 只有 setupDone；session 记录键在白名单内 | e2e auto |
| — | 快捷键轮换清标记 | 记录不带 rule/base | 单测（background、right-switch） |
| — | 窄窗口相邻对、join | 透传 auto | 单测（split-actions） |
| — | 无痕、停用时降级 | 与 v0.4 相同 | e2e auto（T8，不改） |
| B20 | 设置页规则区 | 设计稿 11.2 节 1–11：收起的规则区与空状态（v0.6 起规则区改成“搜索组合”tab 里默认展开的规则卡，不再有带条数的 summary）；新增对话框的焦点、选项与字段；空提交、太长、超过 8000 字节的报错且存储不变；保存后的规范化、行文字、焦点、条数；上移与播报；暂不生效与被挡提示；对话框里的两步删除与焦点；引擎对话框的规则条数与连带删除；keep、已隐藏引擎原样保存、指向左侧必须重选 | e2e auto（见 v0.6：`docs/acceptance-v0.6.md`） |
| I18N、B14 | 新界面四语与深色 | 规则区（v0.6 起是规则卡）、规则对话框（两种单选）、带规则标记的弹窗无 key 文字、无溢出，“换回”一行；深色配色取 tokens.css。截图 `.e2e/i18n/<语言>-options-rules.png`、`<语言>-popup-rule.png`，`.e2e/b14-options-rules-dark.png`、`b14-popup-rule-dark.png` | e2e auto（见 v0.6：`docs/acceptance-v0.6.md`） |
| — | 安装冒烟 | 权限警告与 v0.4 相同 | `npm run pack -- --smoke` |
