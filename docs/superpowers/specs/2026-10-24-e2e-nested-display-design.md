# e2e 嵌套显示（Xephyr / Xvfb）设计文档

日期：2026-10-24　作者：pine2D　状态：用户已选定方案 B（对话中确认，并已安装 xserver-xephyr）
关联：`2026-10-23-e2e-xinput-design.md`（真实输入）；参考：`~/projects/POE2-Rune-Companion/tools/sandbox-test.ps1`（Windows 沙盒里跑桌面测试，宿主不收输入）

## 1. 意图

xauto 步骤现在把真实输入发到 WSLg 的 XWayland。在 WSLg 上，X 指针跟着用户的 Windows 真实光标走，所以跑测试时用户必须把光标停在测试窗口上、手离开鼠标，整段时间不能用电脑。改成让测试 Chrome 跑在一个独立的嵌套 X 服务器上，它的指针和键盘都与用户桌面分开，用户就可以照常用电脑。用户只在需要亲手操作的几步时，才到这个窗口里操作。

## 2. 目标 / 非目标 / 反目标

**目标**
- 新增 `--display <xephyr|xvfb|host>`。
  - 引导式运行（`npm run e2e`）默认用 `xephyr`：一个可见的独立窗口，测试 Chrome 全程在里面；自动步骤和需要用户操作的步骤都在这个窗口里。
  - `--auto-only` 默认用 `xvfb`：不可见，完全无人值守，xauto 照跑。`--auto-only --headed` 默认用 `xephyr`。
  - `--display host` 是现在的行为（WSLg :0），保留作对照。
  - 选定的服务器不可用时（没装、起不来），退回 `host`，并在终端和报告里写明原因。
- 嵌套显示下，xauto 不再需要用户停放光标：脚本自己把指针移进测试窗口，不用等“光标回到测试窗口”。
- 脚本自己起停嵌套服务器：自动挑空闲显示号；结束、中断或崩溃后都关掉；遗留的实例下次启动时按 pid 文件清理，只清理自己起的。
- 报告头写明本次用的显示方式。

**非目标**
- 不做 Windows 沙盒（POE2 的做法）：每次都要装 Windows Chrome、重新登录 Kagi，还要把输入层改写成 Win32；而且 POE2 遇到过沙盒关机时宿主图形冻结。
- 不在嵌套显示里装窗口管理器。

**反目标**
- 合成输入落到用户的 :0 桌面。嵌套模式下，xinput 和截图一律只对嵌套显示号执行。
- 杀掉不是本次运行起的 X 服务器，或占用用户已有的显示号。
- 嵌套模式下，“读回不符”和“被拉回同一点”这两道防护仍保留：用户的光标停在 Xephyr 窗口上时，Xephyr 会把真实移动转发进来。

## 3. 关键事实（2026-10-24 实测，临时配置）

- 本机有 `/usr/bin/Xvfb`、`/usr/bin/Xephyr`，两者都带 XTEST。`Xephyr :N -screen 2400x1500 -title … -no-host-grab -nolisten tcp` 在 WSLg 上是一个普通窗口。
- `/opt/google/chrome/google-chrome` 包装脚本固定 `--ozone-platform=x11 --force-device-scale-factor=1.5`，并按 `DISPLAY` 连接，所以只要把 `DISPLAY` 设成嵌套显示号即可。CSS 1600×1000 × 1.5 = 2400×1500，屏幕就取这个尺寸。
- **Xvfb：** 拖文字到标签栏能打开新标签；地址栏 `ctrl+l` → `type` → `Return` 能用；`import -window root` 能截图。指针读回与命令一致，不受用户真实光标影响。
- **Xephyr：** 地址栏输入同样能用。拖拽也能用，但要慢一点：按下后停 300ms，每步之间约 60–100ms，松开前停留约 800ms；按快的节奏（150ms、30–50ms）有一次没能开始拖拽。用户的光标在 Xephyr 窗口上移动时，读回会偏，与设计预期一致。
- **两者都没有窗口管理器：**
  - `xdotool getactivewindow` 报错，因为没有 `_NET_ACTIVE_WINDOW`；`xdotool getwindowfocus` 能返回 Chrome 窗口。
  - 没有框架窗口，Chrome 顶层窗口直接是根的子窗口。
  - `xwininfo -root -children` 仍然可用。

## 4. 行为设计

- **生命周期（新模块）：** `display.mjs` 负责：
  - 挑空闲显示号：从 :90 起，跳过已有 `/tmp/.X11-unix/X<n>` 或 `/tmp/.X<n>-lock` 的号；
  - 启动服务器，等 `xdpyinfo` 能连上；
  - 写 pid 文件到 `.e2e/display.pid`；
  - `stop()`；
  - 下次启动时，清理遗留实例：确认 pid 文件里的进程仍然是 Xephyr/Xvfb，而且命令行里有那个显示号，才杀它。

  run.mjs 在启动 Chrome 和创建 xinput 之前先起显示服务器，把 `DISPLAY` 指向它（子进程、xinput、截图都走它）。teardown 里最后停掉，SIGINT 和第二次 Ctrl+C 也要停。
- **xinput 在嵌套模式下的变化**，由一个 `nested` 标志控制：
  - 不检查“光标在根窗口上”，也不等“光标回家”；改为把指针直接移进测试窗口。
  - 前台核对：没有 EWMH 时用 `getwindowfocus`。`newFocusedWindow` 通过 `Target.createTarget({newWindow:true})` 拿到新窗口后，焦点没过去就在新窗口的页面空白处点一下，然后再断言焦点。
  - 拖拽时序：嵌套模式下用更慢的参数（见 §3）。
  - 提示文案：“被拉回”的提示改成“请把光标移出测试窗口（Xephyr）”；向导页和 xauto 开始卡片都按模式显示对应文案。
- **用户操作（assist/judge）：** 在 Xephyr 窗口里完成。向导页本身也在这个窗口里，复制、粘贴都在同一个 X 服务器内。Windows 剪贴板和 Xephyr 不通，所以文档要说明：网址从窗口内的向导页复制。用户也可以在自己的浏览器里打开 `http://127.0.0.1:8765/guide` 看进度。
- **报告：** 头部写 `显示：xephyr :N（2400×1500）`，或 `xvfb …`，或 `host :0`；退回 host 时写明原因。

## 5. 约束

- 纯 Node 24，无 npm 依赖；外部命令用 `execFile`/`spawn` 不经 shell。每个 JS 文件 ≤300 行。纯逻辑（挑显示号、pid 文件校验、模式选择）要有 node 单测。
- host 模式的行为和全部防护不变。
- 测试配置、登录态、授权都不变，同一个 `~/.cache/split-search-e2e/profile` 在任何显示下都能用。

## 6. 决策记录

| 决策 | 由谁决定 | 理由 |
|---|---|---|
| 用嵌套 X 服务器隔离，不用 Windows 沙盒 | 用户（选 B，装了 Xephyr） | 轻量；沿用现有 xinput；登录态与授权保留 |
| 引导式默认 xephyr、auto-only 默认 xvfb、保留 host | Claude | 需要人时可见；无人值守时不可见；host 作对照 |
| 嵌套模式脚本自己移动指针 | Claude | 嵌套指针不是用户的光标 |
| 不装窗口管理器，焦点用 getwindowfocus 加点一下 | Claude | 少一个依赖；实测焦点可用 |
