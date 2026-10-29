# Chrome 设置核对提示实现计划

> **For agentic workers:** Use this plan as a single scoped implementation and verification task in the current session.

**Goal:** 让用户在默认组合旁持续看到核对 Chrome 网站搜索的说明和设置入口。

**Architecture:** pair.js 在未显示 pair-changed 时渲染普通 hint，复用 revealGuideSteps 和原生链接行为；更新四语现有引导和保存文案。没有新权限、状态或存储。

**Tech Stack:** 原生 JS / CSS、Chrome MV3、node --test、现有管道 CDP e2e。

**Spec:** ../specs/2026-10-29-chrome-setup-hint-design.md

## 约束与重点

- 保持现有 manifest、权限、存储、分屏逻辑与语言切换。
- 不把核对说明显示成“已检测到不一致”，与修改提示互斥。
- 四语 key、占位符及 Chrome 术语对齐。
- 检查刷新、改回原组合、首次设置、键盘定位、窄屏与深色。

## 实施与验证

- [x] 在 src/options/pair.js 添加普通说明和真实链接；在 options.css 补 8px 间距。
- [x] 更新 src/_locales/{zh_CN,zh_TW,en,es}/messages.json 的说明、默认网址引导及修改/保存提示；校正 edits.js 的相关注释。
- [x] 运行 npm test 和 npm run e2e -- --auto-only --only B21,B14,I18N。
- [x] 在隔离浏览器里核对新入口与状态切换，查看四语宽窄屏、深浅色的实际截图。
- [x] 运行 Impeccable detector，审查实际 diff，更新项目约定和本计划的验证记录；交付为一个本地 commit。

## 验证记录

2026-10-29，Chrome 156.0.8078.47 / Node 24.14.1：

- `npm test`：1277 项通过，0 失败。首次沙箱内运行有 6 个文件级失败；直接运行服务器用例定位为监听 `127.0.0.1` 被拒绝（EPERM），在允许回环网络的环境中全量重跑通过，未修改测试或产品逻辑来规避。
- `npm run e2e -- --auto-only --only B21,B14,I18N`：3 步全过；B21 的 16 项和 I18N 的 8 项全过，扩展控制台错误 0。报告 `.e2e/report-20261029-225039.md`。
- 最终西语文案调整后重跑 `--only I18N`：8 项全过，控制台错误 0；报告 `.e2e/report-20261029-225810.md`。两次均恢复测试配置的 storage 快照。
- 一次性检查脚本 `.e2e/chrome-setup-hint-check.mjs`：Tab/Enter 定位和可见焦点、Ctrl/中键新开、刷新保留、修改/改回组合、语言重渲染焦点恢复、首次设置档位、导航不写存储，全部通过。使用新建临时配置，仅为覆盖 UI 档位替换该测试页的 `permissions.contains`；真实授权行为由既有 B21 覆盖。浏览器与临时配置已清理。
- 4 语言 × 1100/600/360px × 浅深色共 24 个渲染检查全部通过；无横向溢出、无错误警报角色。说明最小对比度 5.96:1，链接 5.63:1。结果与截图在 `.e2e/chrome-setup-hint/`，已检查实际截图，包括最长的西语窄屏及“添加到 Chrome”说明。
- Impeccable detector 对 pair.js/options.css 返回 `[]`；`git diff --check` 通过。
- 未运行 Windows 原生 Chrome 手测。开发镜像只做 rsync dry-run：其中还有早于本次的源码改动未同步，未执行会一并覆盖这些文件的完整同步。
