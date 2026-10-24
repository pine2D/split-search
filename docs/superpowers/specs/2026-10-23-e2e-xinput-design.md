# e2e 真实输入自动化（xinput）设计文档

日期：2026-10-23　作者：pine2D　状态：用户已同意方向（对话中确认），待审
关联：`2026-10-23-e2e-and-default-pair-design.md`（e2e spec）；技术依据：`.superpowers/sdd/2026-10-23-e2e-and-default-pair/spike-xdotool.md`（2026-10-23 实测）

## 1. 意图

引导式验收（`npm run e2e`）仍需要用户手动做拖拽、地址栏输入、右键、在 chrome://settings 加网站搜索等操作，耗时耗力。实测证明：在 WSLg 上用 xdotool（XTEST）发真实鼠标/键盘事件、再用 CDP 判定，这些都能自动完成；chrome://settings 也能经 CDP 直接改写。本设计把它们并入 e2e，让一次完整验收基本无人值守，人只需回答少数肉眼判断题。

## 2. 目标 / 非目标 / 反目标

**目标**
- 新增步骤类型 `xauto`（真实输入 + 自动判定），覆盖 T1（快捷字词）、T2(a)（默认引擎）、T2(b)（Alt+Enter）、T3(a)（拖到标签之间）、T4（拖到已有标签）、T5-DRAG（拖到分屏右侧）、T6-NTP（手动分屏里的新标签页）、T11（右键搜索）、T14（各引擎作左侧的拖拽，SW 核实保留）。
- 网站搜索条目由脚本经 CDP 在测试配置里自动添加、设为默认；运行前快照、结束（含中断）后恢复，遗留快照下次启动先恢复——和 storage 快照同一套语义。
- xinput 可用时默认启用；不可用（无 xdotool/import/XTEST、`--headless`、`--no-xinput`）时，这些步骤回退为现有 assist 版本。
- 修掉首轮引导遗留：收尾不再要求删除测试配置里的网站搜索或改回默认引擎（用户反馈，见 §6）；.md 报告补 T14 明细；CLAUDE.md 更正“CDP 写不了 chrome://settings”。

**非目标**
- 不驱动 Windows Chrome；T3(b)（从 Windows 应用拖入）仍留给 Windows 冒烟。
- 不自动化授权弹窗（B4、T8 的恢复授权）与 judge 步骤（T12 联想、B14 配色、T8(a) 无痕判断）——保持现有 assist/judge。
- 不做非 ASCII 的真实键盘输入（实测不可靠）；xauto 步骤一律用 ASCII 关键词，中文关键词的覆盖靠 node 单测和 CDP 导航路径。

**反目标**
- 合成输入落到测试窗口以外（尤其用户在后面最大化的 chrome-dbg）——每次按下/松开鼠标、每次按键前都必须核对目标窗口。
- 在用户正在动鼠标时硬做手势。
- 碰用户的真实配置；把 Kagi token 等私密网址写进快照/报告/日志。
- 给扩展加权限或改扩展行为；给 e2e 加 npm 依赖。

## 3. 关键技术事实（spike 实测）

- 窗口：`xdotool search --all --pid <chrome pid> --onlyvisible --class google-chrome`（必须 `--all`，否则会命中用户的 chrome-dbg），并核对 WM_CLASS instance 含测试配置路径。
- 坐标：`X = round((screenX + (outerWidth−innerWidth) + clientX)·dpr)`，Y 同理（dpr 实测 1.5）；不要用 `xdotool getwindowgeometry` 的 Position。
- 标签边界：激活目标标签 → `import -window <wid> -crop <W>x80+0+0 rgb:-` 取原始 RGB → 在第 4–40 行扫比背景亮的连续区段，去掉 <90px 的（tab search 按钮），得当前标签 `[L,R]`。落点：之间 `L−2`，之上 `(L+R)/2`，分屏右侧取单元 75% 处。找不到唯一区段 → 判“环境不支持”。
- 焦点：`windowactivate` 在 WSLg 无效；键盘手势前用 `Target.createTarget({url, newWindow:true})` 新开窗口并断言 `getactivewindow` 等于它；鼠标手势不需要焦点。
- 时序：拖拽 mousedown → 150ms → 抖动越过阈值 → 分步移动 → 停留 → mouseup（约 3s）；地址栏 `ctrl+l` → `type --delay 8`（ASCII）→ `Delete` → `Return`；右键菜单 click 3 后 250–600ms 出现 override-redirect 窗口，按项高约 48px 定位并核对菜单高度。
- chrome://settings：attach 到 WebUI 页，穿透 shadow DOM 操作 `#addSearchEngine`、编辑对话框的 `cr-input#searchEngine/#keyword/#queryUrl`、`#actionButton`，行菜单 `button#makeDefault/#delete`（按 id 不按文字，界面语言无关）；读回用 `SearchEnginesBrowserProxyImpl.getSearchEnginesList()`。快照里网址需脱敏（Kagi 条目带私有 token）。
- 实测成功率：拖到之间 8/8、拖到标签上 6/6、分屏右侧 3/3、地址栏 24/24（新窗口焦点）、右键 3/3、settings 增删设默认各 1/1。

## 4. 行为设计

- 启动后 `Browser.setWindowBounds` 固定为 normal 1600×1000，让布局可预测。
- 每个手势前做防干扰：静止采样指针两次（300ms 间隔），位置变了就等 3s 再采，连续 3 次在变 → 该步骤“跳过：检测到用户在操作鼠标”；手势中每次 move 后读回指针位置，与命令不符即中止。向导页在 xauto 步骤显示“自动操作中，请不要动鼠标键盘”。
- 每个手势失败后完整重建现场（resetTabs、重建选区、重测标签边界）最多重试 2 次；报告写明第几次成功（不稳定信号）。坐标从不缓存。
- 网站搜索：脚本只使用专用快捷字词（如 `sse2e`、`sse2e-r` 等，网址指向模拟引擎），不碰用户的 gb/bg 等条目；快照记录默认引擎和这些专用条目，结束恢复默认引擎并删除专用条目（这些是脚本自己建的，删除不需要用户动手）。
- 收尾：不再要求用户删除测试配置里的任何条目或改回默认引擎；只在 assist 回退路径下用户手动改过东西时，提示“这些只在测试配置里，可保留”。

## 5. 约束

- 纯 Node 24，无 npm 依赖；外部命令仅 `xdotool`、`import`（ImageMagick）、`xdpyinfo`，用 `execFile` 不经 shell；缺任一即判 xinput 不可用。
- 新模块：`scripts/e2e/xinput.mjs`（xdotool 封装）、`scripts/e2e/screen.mjs`（坐标、选区、标签测量、新焦点窗口）、`scripts/e2e/gesture.mjs`（dragText / contextMenuPick / omnibox，含防干扰/防误投/防错焦）、`scripts/e2e/settings-se.mjs`（网站搜索快照/增/设默认/删/恢复）、`scripts/e2e/steps/xauto.mjs`（可拆分）。每个 JS 文件 ≤ 300 行。
- 纯逻辑（坐标换算、RGB 区段扫描、菜单项定位、ASCII 校验、快照脱敏、步骤选择）必须有 node 单测。
- 报告与日志一律经 redact。

## 6. 决策记录

| 决策 | 由谁决定 | 理由 |
|---|---|---|
| 用 xdotool + CDP 自动化浏览器界面操作 | 用户同意 | 验收太耗时 |
| xinput 可用时默认启用，不可用回退 assist | Claude | 用户要省事；回退保证在缺工具的机器上仍能验收 |
| 网站搜索由脚本用专用快捷字词自动管理并在结束时自删 | Claude | 不打扰用户、不碰用户条目、不留垃圾 |
| 收尾不要求用户删除测试配置里的条目 | 用户反馈 | 删了下一轮又要重加（“有毛病？”） |
| 授权弹窗、judge 步骤保持人工 | Claude | 原生对话框内容读不到、判断题需要人；出现频率低 |
| xauto 只用 ASCII 关键词 | Claude | 非 ASCII 真实输入实测不可靠 |
