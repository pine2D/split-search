# e2e 嵌套显示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 e2e 的测试 Chrome 跑在独立的嵌套 X 服务器上：引导式运行用 Xephyr，`--auto-only` 用 Xvfb。xauto 期间用户可以照常用电脑。

**Architecture:** 新增 `scripts/e2e/display.mjs`，负责起停 Xephyr/Xvfb。run.mjs 先起显示服务器，再把 `process.env.DISPLAY` 指向它，Chrome、xinput 和截图都继承这个 DISPLAY。xinput 和手势层加一个 `nested` 标志：不等用户光标，脚本自己移指针，焦点用 `getwindowfocus` 判断，拖拽节奏放慢。

**Tech Stack:** Node 24（无依赖）、Xephyr、Xvfb、xdotool、ImageMagick `import`、xwininfo

**Spec:** `docs/superpowers/specs/2026-10-24-e2e-nested-display-design.md`

## Global Constraints

- 纯 Node 24、无 npm 依赖；外部命令用 `execFile`/`spawn`，不经 shell；scripts/ 与 src/ 下每个 JS 文件 ≤300 行；新测试文件也 ≤300 行。
- host 模式（`--display host`）的行为和全部防护不变；`npm test` 全绿。
- 只杀本次运行起的 X 服务器（pid 文件 + 进程名 + 命令行中的显示号三重核对）；绝不碰 :0 或其他已有显示号。
- 测试配置固定为 `~/.cache/split-search-e2e/profile`；绝不读写用户的真实 Chrome 配置；启动参数不含 `--enable-automation`；`--disable-sync`。
- 报告与日志一律经 redact。用户可见文案用简体中文。
- 提交：`git -c user.name=pine2D -c user.email=oumu323@gmail.com commit`，Conventional Commits，末行 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 只有 Xvfb 下可以由子代理跑真实输入，它对用户不可见；Xephyr 和 host 下的真实运行由控制端安排。

## Review Focus

1. 中断（SIGINT、两次 Ctrl+C、Chrome 崩溃、启动失败）后嵌套服务器残留 → 下次启动按 pid 文件清理，不误杀。
2. 显示号被占用（另一个 Xvfb、用户自己的 :90）→ 跳过，换下一个号。
3. Xephyr 或 Xvfb 不存在、起不来 → 退回 host 并写明原因，不判失败。
4. 嵌套模式下有任何一处 xdotool、import、xwininfo 仍然打到 :0 → 等于把输入发到用户桌面。凡是调用这些工具的地方都要走同一个 env。
5. 没有窗口管理器时 `getactivewindow` 报错，必须走 `getwindowfocus` 分支；新窗口拿不到焦点时，点一下再断言；仍然不行就判 env，不按任何键。

---

### Task 1: 嵌套显示的生命周期与接线

**Files:**
- Create: `scripts/e2e/display.mjs`、`test/e2e-display.test.js`
- Modify: `scripts/e2e/args.mjs`（`--display`）、`scripts/e2e/run.mjs`、`scripts/e2e/teardown.mjs`、`scripts/e2e/report.mjs`（头部写显示方式）

**Interfaces:**
- Produces:
  - `pickDisplay({ exists = fs.existsSync, from = 90, to = 119 }) -> number`：第一个既没有 `/tmp/.X11-unix/X<n>` 也没有 `/tmp/.X<n>-lock` 的号；都占用时抛错。
  - `chooseMode({ display, autoOnly, headed, available }) -> { mode, reason? }`：
    - 显式给了 `display` 就用它；
    - 否则 `autoOnly && !headed` 用 `xvfb`，其余用 `xephyr`；
    - 选中的服务器不可用时，返回 `{ mode: "host", reason }`。
  - `startDisplay(mode, { size = "2400x1500", title, pidFile, spawn, exec }) -> Promise<{ display: ":N", mode, pid, stop(): Promise<void> }>`：
    - 写 pid 文件 `{ pid, display, mode }`；
    - 轮询 `xdpyinfo -display :N`，最多 10s，超时就杀掉并抛错；
    - Xephyr 的参数：`-screen <size> -title <title> -no-host-grab -nolisten tcp`；
    - Xvfb 的参数：`-screen 0 <size>x24 -nolisten tcp`。
  - `cleanupStale(pidFile, { readProc }) -> Promise<string|null>`：进程仍在，并且 `/proc/<pid>/comm` 是 `Xephyr` 或 `Xvfb`，并且 cmdline 里有记录的显示号，才杀它并返回说明；否则只删 pid 文件。
- `args.mjs`：`--display <xephyr|xvfb|host>`；其他值报参数错误。
- `run.mjs`：
  - 在 `launch()` 和 `xinput.available()` 之前，先调用 `cleanupStale`，再 `chooseMode`，再 `startDisplay`；
  - 嵌套模式下，设置 `process.env.DISPLAY = display`；
  - `available` 检测 `Xephyr`/`Xvfb` 可执行。
- `teardown.mjs`：浏览器关掉之后调用 `stop()`。第二次 Ctrl+C 的同步路径也要停掉服务器，用 `process.kill` 加删 pid 文件。
- `report.mjs`：头部写 `显示：<mode> <display>（<size>）`；退回 host 时附原因。

- [ ] 写测试：
  - `pickDisplay` 跳过两种占用；
  - `chooseMode` 的全部组合，以及不可用时退回；
  - `cleanupStale` 的三种情况：进程已不在、comm 不符、显示号不符都不杀，全部符合才杀；
  - `startDisplay` 的参数与超时（注入假的 spawn/exec）；
  - args 解析 `--display`。
- [ ] 实现，`npm test` 全绿。
- [ ] 真实核对，只在 Xvfb 下做：
  - `npm run e2e -- --auto-only --no-xinput` 用 xvfb 跑完，报告头写着 xvfb；
  - 运行中，`DISPLAY=:0 xdotool search --name split-search` 找不到 Chrome；
  - 结束后没有残留的 Xvfb 进程，pid 文件已删。
  - 跑一次，在中途发 SIGINT，确认服务器已停；
  - 再造一个遗留的 pid 文件，确认下次启动时会清理。
- [ ] 提交 `feat(e2e): run the test browser on a nested X display`。

### Task 2: xinput 与手势的嵌套模式

**Files:**
- Modify: `scripts/e2e/xinput.mjs`、`scripts/e2e/screen.mjs`（`newFocusedWindow`）、`scripts/e2e/gesture.mjs`、`scripts/e2e/gesture-ui.mjs`、`scripts/e2e/steps/xauto*.mjs`（开始卡片文案）、`scripts/e2e/guide/*`（提示文案）、run.mjs（`gx.nested`）
- Test: 新的 `test/e2e-nested.test.js`。`e2e-gesture.test.js` 已有 429 行，不再往里加。

**Interfaces:**
- Consumes：Task 1 的 `{ mode }`；run.mjs 把 `gx.nested = mode !== "host"` 传给手势层。
- Produces：
  - `activeWindow()`：先用 `getactivewindow`；输出里含 `_NET_ACTIVE_WINDOW` 不支持的提示或报错时，改用 `getwindowfocus`。结果缓存在 xi 实例上。
  - `cursorHome`/`readyMouse`：`nested` 时不等用户光标，直接 `mousemove` 到测试窗口中心，再断言指针在测试窗口上。不在就判 env，不按下。
  - 拖拽参数：`nested` 时按下后等 300ms，每步 60–100ms，松开前停留 800ms。数值写成常量并加注释，说明是实测结果。
  - `newFocusedWindow`：拿到新窗口后，焦点不在它上面，就在新窗口页面中心点一下（先断言指针在新窗口上），再等焦点。仍然不行就判 env，不按任何键。
  - 文案：`nested` 时，被拉回的原因写“指针被用户光标带走（请把光标移出测试窗口 Xephyr）”；开始卡片写“自动操作中，请不要把光标停在 Xephyr 窗口上”。host 模式的文案不变。
- 防误投的规则全部保留：down/up/key 前的断言、拖拽图像、外来窗口与叠放核对、stuck 处理。

- [ ] 写测试：
  - `getactivewindow` 失败时退到 `getwindowfocus`；
  - nested 时不等用户光标、直接移指针；
  - nested 的拖拽参数；
  - `newFocusedWindow` 点一下之后的成功与失败；
  - 两种模式的文案。
- [ ] 实现，`npm test` 全绿。
- [ ] 真实核对，只在 Xvfb 下：`npm run e2e -- --auto-only` 连跑 3 次（默认 xvfb，xauto 会跑）。记录每次的通过、跳过、失败和 attempt 分布。预期除 Perplexity 预期降级外全部通过。
- [ ] 提交 `feat(e2e): real-input gestures on a nested display`。

### Task 3: 文档

**Files:** Modify `CLAUDE.md`、`docs/acceptance-v0.1.md`、`.superpowers/sdd/2026-10-23-e2e-xinput/global-constraints.md`（不在 git 里，就地更新）

- [ ] CLAUDE.md：
  - 写清 `--display` 的三种模式、各自的默认值和退回规则；
  - 光标规则按模式分开：嵌套模式只要别把光标停在 Xephyr 窗口上；host 模式保留原文；
  - 剪贴板说明：Windows 和 Xephyr 不通，网址从窗口内的向导页复制；
  - 外部命令加上 Xephyr、Xvfb；
  - pid 文件位置。
- [ ] acceptance 第 1 节：引导式运行开一个 Xephyr 窗口，用户只在提示时到窗口里操作，其余时间照常用电脑。
- [ ] 提交 `docs: e2e nested display`。
