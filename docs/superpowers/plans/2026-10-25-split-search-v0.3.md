# Split Search v0.3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 不加任何权限，实现分屏状态加固、右侧引擎库、窄窗口降级、工具栏弹窗（换右侧引擎）和默认不绑定的“右侧换下一个引擎”快捷键。

**Architecture:** 判定“这一对是不是本扩展的”收敛成 `src/lib/split-owner.js` 里的一个纯函数，go.html、弹窗、SW 快捷键三处共用；`storage.session` 的读写与清理集中到 `src/chrome/split-state.js`；换右侧的执行逻辑集中到 `src/chrome/right-switch.js`，弹窗与 SW 共用。引擎库是 `src/lib/engine-catalog.js` 里的纯数据，添加时复制成自定义引擎。

**Tech Stack:** Chrome MV3（最低 155，本机实测 156），原生 ES modules，无构建、无依赖；`node --test`；`scripts/e2e`（管道 CDP、Xvfb/Xephyr、xinput）。

**Spec:** `docs/superpowers/specs/2026-10-25-v0.3-split-tools-design.md`（下文“spec 3.1”等指它的章节）。执行者必须同时读 spec 与本计划。

## Global Constraints

- `permissions` 仍然只能是 `["declarativeNetRequest", "storage"]`；不加 `tabs`、`activeTab`、`contextMenus`；不加必需的 `host_permissions`。
- `src/lib/` 不得引用 `chrome`；JS 单文件不超过 300 行（`test/` 除外，`scripts/` 同样受限）。
- 界面文字只写在 `src/_locales/{en,zh_CN,zh_TW,es}/messages.json`，4 种语言 key 同时补齐；`src` 代码里不得有汉字（注释除外）；动态节点用 `setI18nText`；一句话一个 key，运行时值走具名占位符。
- 唯一允许的 `fetch` 是读包内 `_locales`；引擎库数据不得来自网络。
- 关键词只进 `storage.session`，绝不进 `storage.sync`，绝不外发。
- 引擎 id 匹配 `/^[a-z0-9-]{1,20}$/`；只为精确 origin 申请权限，且只在用户点击时申请。
- 快捷键：`commands` 里只有 `cycle-right`，**不写 `suggested_key`**；`_execute_action` 不绑定。
- 不做“互换左右”“拆开分屏”按钮或命令。
- 窄窗口阈值 `960`（`windows.get` 的 `width`，DIP，含边框），`width < 960` 为窄；`storage.sync.narrowFallback` 缺省视为 `true`。
- 提交用 git-commit skill（Conventional Commits）；本仓库无 git 身份，用 `git -c user.name=pine2D -c user.email=oumu323@gmail.com commit`；提交信息末尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 每个任务结束前 `npm test` 全绿。

## Review Focus

1. **关键词带特殊字符**（`a&b #c+d 中文 😀`）存进记录后经弹窗/快捷键换右侧：右侧网址必须与 go.html 首次打开时 `expandTemplate(right.url, query)` 的结果逐字相同。→ Task 7 `switchRight` 测试。
2. **记录里的右侧引擎已被删除，或全部引擎都被排除出轮换**：弹窗仍能换右侧；快捷键回到第一个参与轮换的引擎，没有候选时什么都不做、不抛错。→ Task 7 `nextRightEngine` 测试。
3. **对侧标签已经关掉但记录还在**（`tabs.get` 抛 `No tab with id`）：go.html 按“不是本扩展”的路径走、弹窗显示说明文字，都不抛到页面。→ Task 2 `inspectTab` 测试。
4. **`windows.get` 拿不到数字宽度，或窗口是 `maximized`/`fullscreen`**：宽度不是数字时不判窄；最大化、全屏时照常按宽度判断。→ Task 3 `isNarrow` 测试。
5. **`storage.session` 读写抛错**（配额、扩展正在重新加载）：go.html 仍然打开左侧搜索（当作没有记录），写记录失败只记日志。→ Task 2 `split-state` 测试。

---

### Task 1: 归属判定纯逻辑（V1）

**Files:**
- Create: `src/lib/split-owner.js`
- Modify: `src/lib/split-decision.js`（`decideSplit` 改签名）
- Test: `test/split-owner.test.js`（新建）、`test/split-decision.test.js`（改写）

**Interfaces:**
- Produces（`src/lib/split-owner.js`）：
  - `export const RECORD_PREFIX = "split:"`；`export function recordKey(tabId: number): string`
  - `export function parseRecord(value): Record | null`。`Record = { peer: number, splitViewId: number, mode: "split" | "adjacent", engine: string, query: string }`；任一字段类型不对（含裸数字）返回 `null`。
  - `export function makeRecords({ a, b, splitViewId, mode, engineA, engineB, query }): { [key: string]: Record }`：两个方向各一条。
  - `export function looksLikeSearchPage(url: string, template: string): boolean`：spec 3.1 第 3 条的两种情形；`url` 或模板解析失败返回 `false`。
  - `export function judgeOwnership({ tab, peer, record, peerRecord, engines }): "own" | "stale" | "fallback-own" | "none"`。`tab`/`peer` 形如 `{ id, index, windowId, splitViewId, url? }`，`peer` 可为 `null`；`record`/`peerRecord` 是 `parseRecord` 的结果。规则：
    - `record` 非空：spec 3.1 第 1 条全部满足 → `"own"`；否则 → `"stale"`。`adjacent` 的“紧挨着”定义为同一窗口且 `Math.abs(peer.index - tab.index) === 1`（当前标签可能是右侧那个）。
    - `record` 为空：`peer` 有字符串 `url` 且对任一引擎 `looksLikeSearchPage(peer.url, e.url)` → `"fallback-own"`；否则 `"none"`。
- Produces（`src/lib/split-decision.js`）：`decideSplit({ windowType, splitViewId, peer, ownership }): "other-window" | "new" | "reuse" | "foreign"`：
  - 非 normal → `"other-window"`
  - `splitViewId === -1`：`ownership === "own"` → `"reuse"`（相邻对复用），否则 `"new"`
  - `peer == null` → `"foreign"`
  - `ownership` 是 `"own"` 或 `"fallback-own"` → `"reuse"`，否则 `"foreign"`
  - `sideOf` 不变。

- [ ] **Step 1: 写失败的测试** `test/split-owner.test.js`，至少包含：

```js
test("parseRecord 拒绝裸数字和缺字段", () => {
  assert.equal(parseRecord(42), null);
  assert.equal(parseRecord({ peer: 2, splitViewId: 7, mode: "split", engine: "ea" }), null); // 缺 query
  assert.deepEqual(parseRecord({ peer: 2, splitViewId: 7, mode: "split", engine: "ea", query: "" }),
    { peer: 2, splitViewId: 7, mode: "split", engine: "ea", query: "" });
});
test("makeRecords 写两个方向", () => {
  assert.deepEqual(makeRecords({ a: 1, b: 2, splitViewId: 7, mode: "split", engineA: "ea", engineB: "eb", query: "q" }), {
    "split:1": { peer: 2, splitViewId: 7, mode: "split", engine: "ea", query: "q" },
    "split:2": { peer: 1, splitViewId: 7, mode: "split", engine: "eb", query: "q" },
  });
});
test("looksLikeSearchPage：query 型比 origin+pathname", () => {
  const yt = "https://www.youtube.com/results?search_query=%s";
  assert.equal(looksLikeSearchPage("https://www.youtube.com/results?search_query=a", yt), true);
  assert.equal(looksLikeSearchPage("https://www.youtube.com/watch?v=x", yt), false);
  assert.equal(looksLikeSearchPage("https://consent.youtube.com/results", yt), false);
});
test("looksLikeSearchPage：path 型比前缀", () => {
  const maps = "https://www.google.com/maps/search/%s";
  assert.equal(looksLikeSearchPage("https://www.google.com/maps/search/tokyo%20tower", maps), true);
  assert.equal(looksLikeSearchPage("https://www.google.com/maps/place/x", maps), false);
});
test("looksLikeSearchPage：坏网址返回 false", () => assert.equal(looksLikeSearchPage("not a url", "https://a.com/?q=%s"), false));
```

`judgeOwnership` 的用例（用 `tab = { id: 1, index: 4, windowId: 9, splitViewId: 7 }`、`peer = { id: 2, index: 5, windowId: 9, splitViewId: 7 }`）：
  - 两条记录互指且 `splitViewId` 都是 7 → `"own"`
  - 记录 `splitViewId: 6`（拆开再拼回）→ `"stale"`，即使 `peer.url` 是 Google 搜索页
  - `peerRecord` 为 `null` 或 `peerRecord.peer !== 1` → `"stale"`
  - `adjacent`：两边 `splitViewId: -1`、index 4/5 → `"own"`；index 4/7 → `"stale"`；对侧在别的窗口 → `"stale"`；当前标签 index 5、对侧 4 → `"own"`
  - 无记录、`peer.url` 为 `https://www.google.com/search?q=x`、引擎含 Google → `"fallback-own"`
  - 无记录、`peer.url` 缺失 → `"none"`；`peer` 为 `null` → `"none"`

- [ ] **Step 2: 改写 `test/split-decision.test.js`**：删掉基于 `recordedPeerId`/`engineOrigins` 的用例（包括“记录对不上，但另一侧 url 属于已配置引擎时仍复用（Task 5 裁定）”——spec 3.1 第 2 条推翻了这条裁定），换成按新签名覆盖 4 个返回值的用例，包括 `splitViewId: -1` + `ownership: "own"` → `"reuse"`、`ownership: "stale"` → `"foreign"`。

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/split-owner.test.js test/split-decision.test.js`
Expected: FAIL（`split-owner.js` 不存在 / 断言失败）

- [ ] **Step 4: 实现 `src/lib/split-owner.js` 与新的 `decideSplit`**

`looksLikeSearchPage`：用 `validateTemplate` 同款占位（把第一个 `%s` 换成哨兵后 `new URL`）判断 `%s` 落在 `pathname` 还是查询参数里；path 型取哨兵之前的 pathname 前缀。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test test/split-owner.test.js test/split-decision.test.js`
Expected: PASS（此时 `go.js` 仍按旧签名调用，Task 2 修；`npm test` 里与 go.js 无关的测试应全绿）

- [ ] **Step 6: Commit**

```bash
git add src/lib/split-owner.js src/lib/split-decision.js test/split-owner.test.js test/split-decision.test.js
git commit -m "feat(split): judge split ownership by record and splitViewId"
```

---

### Task 2: 分屏状态读写、动作改造与清理（V1）

**Files:**
- Create: `src/chrome/split-state.js`
- Modify: `src/chrome/split-actions.js`、`src/go.js`、`src/background.js`
- Test: `test/split-state.test.js`（新建）、`test/split-actions.test.js`（改写）

**Interfaces:**
- Consumes: Task 1 的 `recordKey`、`parseRecord`、`makeRecords`、`judgeOwnership`、`decideSplit`。
- Produces（`src/chrome/split-state.js`，`chrome.tabs` / `chrome.storage.session` 薄封装）：
  - `export async function readRecord(tabId: number): Promise<Record | null>`：读失败记日志返回 `null`。
  - `export async function writePair({ a, b, splitViewId, mode, engineA, engineB, query }): Promise<void>`：一次 `set` 写两条；失败只记日志。
  - `export async function writeEngine(tabId: number, record: Record, engine: string): Promise<void>`：只改这一条的 `engine`。
  - `export async function clearPair(tabId: number): Promise<void>`：删 `split:<tabId>`；对侧记录 `peer === tabId` 时一并删。
  - `export async function inspectTab(tab, engines): Promise<{ splitViewId, splitTabs, peer, record, peerRecord, ownership }>`：
    - 在分屏中：`tabs.query({ splitViewId })` 找对侧（同现状）。
    - 不在分屏中但 `record?.mode === "adjacent"`：`tabs.get(record.peer)` 取对侧，抛错当作 `null`。
    - 读 `peerRecord`；调用 `judgeOwnership`；`ownership === "stale"` 时 `await clearPair(tab.id)`。
- Produces（`src/chrome/split-actions.js`）：
  - `createPaired(url, withTab, { split = true } = {}): Promise<{ tab, splitViewId }>`：`split` 为 `false` 时不传 `splitWithTabId`；为 `true` 时创建后用 `chrome.tabs.get(withTab.id)` 复核，两者 `splitViewId` 相同且不为 -1 才返回该值，否则返回 `-1`（退化日志保留）。
  - 每个动作的入参增加 `{ leftId, rightId, query, narrowEnabled }`（`narrowEnabled` 在 Task 3 才用，本任务传进来但不读）。
  - `openNew`/`openForeign`/`openInOtherWindow`：只有 `splitViewId !== -1` 时 `writePair({ mode: "split", ... })`。
  - `reuse`：按 `sideOf` 决定哪个标签拿左侧；`writePair` 的 `mode` 与 `splitViewId` 取现状（分屏中是当前 `splitViewId` + `"split"`，相邻对是 `-1` + `"adjacent"`），两个标签的 `engine` 按它们拿到的那一侧写。
  - 删除旧的 `recordPair`。

- [ ] **Step 1: 写失败的测试** `test/split-state.test.js`（沿用 `test/split-actions.test.js` 的 chrome 桩写法，`storage.session` 用内存 Map 实现 get/set/remove）：
  - `readRecord` 对裸数字返回 `null`；`storage.session.get` 抛错时返回 `null` 且不抛。
  - `clearPair(1)`：对侧记录指回 1 → 两条都删；对侧记录已指向 3 → 只删 `split:1`。
  - `inspectTab`：相邻对时调用 `tabs.get(record.peer)`；`tabs.get` 抛 `No tab with id` → `peer` 为 `null`、`ownership` 为 `"stale"`，并且 `split:<tab>` 已被删除。
  - `writePair` 在 `set` 抛错时不抛。

- [ ] **Step 2: 改写 `test/split-actions.test.js`**：桩增加 `tabs.get`（返回可配置的 `splitViewId`）；断言：
  - `openNew`：`splitWithTabId` 成功且复核一致 → 写两条 `mode: "split"` 记录，`engine` 分别是 `leftId`/`rightId`；`splitWithTabId` 抛错 → **不写记录**（spec 2.1 第 3 条的缺口）。
  - `createPaired` 复核时 `tabs.get` 返回 `splitViewId: -1` → 返回 `{ splitViewId: -1 }`，`openNew` 不写记录。
  - `reuse`：当前标签在右（index 大）时，对侧拿 `leftUrl`，记录里对侧 `engine` 是 `leftId`、当前是 `rightId`。

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test test/split-state.test.js test/split-actions.test.js`
Expected: FAIL

- [ ] **Step 4: 实现 `split-state.js`，改造 `split-actions.js`**

- [ ] **Step 5: 改 `src/go.js`**：`gatherContext` 改为 `chrome.tabs.getCurrent()` + `windows.get` + `inspectTab(tab, engines)`；`decideSplit({ windowType, splitViewId, peer, ownership })`；`ACTIONS[action]({ ...ctx, leftUrl, rightUrl, leftId: left.id, rightId: right.id, query, narrowEnabled })`（`narrowEnabled` 取 `loadConfig()` 结果里的 `narrowFallback`，Task 3 加进 `mergeConfig`；本任务先传 `false`）。删除不再使用的 `originsOf`。

- [ ] **Step 6: 改 `src/background.js`**：顶层 `chrome.tabs.onRemoved.addListener((tabId) => clearPair(tabId))`。

- [ ] **Step 7: 跑全部测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/chrome/split-state.js src/chrome/split-actions.js src/go.js src/background.js test/split-state.test.js test/split-actions.test.js
git commit -m "fix(split): bind split records to splitViewId and clear them on close"
```

---

### Task 3: 窄窗口降级（V3）

**Files:**
- Modify: `src/lib/engines.js`（`mergeConfig`）、`src/lib/split-owner.js` 或新建 `src/lib/narrow.js`（二选一，放常量和 `isNarrow`）、`src/chrome/split-actions.js`、`src/go.js`、`src/options/edits.js`、`src/options/options.js`、`src/options/options.html`、`src/_locales/*/messages.json`
- Test: `test/engines.test.js`、`test/split-actions.test.js`、`test/options-edits.test.js`、新的 `isNarrow` 测试（放在对应 lib 的测试文件）

**Interfaces:**
- Produces：
  - `export const NARROW_WIDTH = 960`；`export function isNarrow(width, enabled: boolean): boolean`：`enabled && typeof width === "number" && Number.isFinite(width) && width < 960`。
  - `mergeConfig` 返回值新增 `narrowFallback: boolean`（`stored.narrowFallback !== false`）。
  - `src/options/edits.js`：`export function setNarrowFallback(raw, enabled: boolean): { ok: true, patch: { narrowFallback: boolean } }`。
  - 动作行为（spec 3.3）：`openNew`/`openForeign` 用 `isNarrow(win.width, narrowEnabled)`，`openInOtherWindow` 用目标窗口（`getLastFocused` 的结果；新建窗口时取 `windows.create` 返回值）的 `width`。窄时 `createPaired(..., { split: false })`，并 `writePair({ mode: "adjacent", splitViewId: -1, ... })`。`reuse` 不看宽度。

- [ ] **Step 1: 写失败的测试**
  - `isNarrow(959, true) === true`、`isNarrow(960, true) === false`、`isNarrow(500, false) === false`、`isNarrow(undefined, true) === false`、`isNarrow(NaN, true) === false`。
  - `mergeConfig({}).narrowFallback === true`；`mergeConfig({ narrowFallback: false }).narrowFallback === false`；`mergeConfig({ narrowFallback: "no" }).narrowFallback === true`。
  - `setNarrowFallback({}, false)` 的补丁是 `{ narrowFallback: false }`。
  - `openNew({ ..., win: { width: 800 }, narrowEnabled: true })`：`tabs.create` 没有 `splitWithTabId`、`active: false`、`index: tab.index + 1`；写了 `mode: "adjacent"` 记录。`width: 1200` 时照常带 `splitWithTabId`。
  - `openForeign` 窄时：新左侧在 `maxIndex + 1`，右侧在新左侧 `index + 1` 且不带 `splitWithTabId`；返回 `{ leave: true }`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL（新用例）

- [ ] **Step 3: 实现**：常量与 `isNarrow`、`mergeConfig`、动作、`go.js` 传 `narrowEnabled: config.narrowFallback`（go.js 现在只解构 `engines`，改为同时取 `narrowFallback`）。

- [ ] **Step 4: 设置页开关**：`options.html` 的默认组合卡片加复选框；`options.js` 的 `pairSection` 渲染它（`checked = cfg.narrowFallback`，变化时 `act(raw => setNarrowFallback(raw, el.checked), ["notice_narrow_saved"])`，新增成功提示 key `notice_narrow_saved`）；文案 key 用 `options_` 前缀（例如 `options_narrow_label`、`options_narrow_hint`），4 种语言同时补齐（先写初稿，Task 11 统一润色）。

- [ ] **Step 5: 跑全部测试**

Run: `npm test`
Expected: PASS（含 `test/i18n-catalog.test.js`）

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(split): open the right side in a background tab when the window is narrow"
```

---

### Task 4: 引擎库候选真机验证（V2 数据）

**Files:**
- Create: 一次性验证脚本放在会话临时目录（不进仓库），可复用 `scripts/e2e/browser.mjs` 的 `launch()` 与 `scripts/e2e/fonts.mjs`
- Modify: `docs/superpowers/specs/2026-10-25-v0.3-split-tools-design.md`（附录 A）

**Interfaces:**
- Produces：附录 A 的表格：每个候选（spec 3.2 候选清单全部 19 条，翻译/Wikipedia 按 4 种界面语言各展开一次）记 `验证日期 | Chrome 版本 | 网址 | 预填（是/否/需登录无法判断）| 登录墙 | SW 接管 | 收录与否 | 备注`。Task 5 只收录“收录 = 是”的条目，`leftDiscouraged` 按“SW 接管 = 是”设置。

- [ ] **Step 1: 起一次性 Chrome 配置**（同 `scripts/pack-smoke.mjs` 的做法：临时 `--user-data-dir`、`--disable-sync`、管道 CDP、`FONTCONFIG_FILE`），不碰 `~/.cache/split-search-e2e/profile` 和任何真实配置；结束删掉临时目录、只关自己起的进程。

- [ ] **Step 2: 逐个打开展开后的网址**（关键词用 ASCII `split view`），等待加载完成后判定：
  - 预填：页面里有 `input`/`textarea`/`[contenteditable]` 的值或文本包含关键词，或 `document.title` / 结果区文本包含关键词。
  - 登录墙：最终网址的 host/path 是登录页（含 `login`、`signin`、`auth`、`accounts.`）。
  - SW：`navigator.serviceWorker.controller !== null`（刷新一次后再读）。
  - 保存截图到临时目录备查。

- [ ] **Step 3: 需要登录才能判断的条目**（预计 ChatGPT、Claude、Gemini、Zhihu）记为“需用户在自己的浏览器里确认”，**本版不收录**，并在完成报告里把这几条和对应网址列给用户；用户确认后另开一个提交加入。

- [ ] **Step 4: 填附录 A 并提交**

```bash
git add docs/superpowers/specs/2026-10-25-v0.3-split-tools-design.md
git commit -m "docs(spec): record engine catalog verification results"
```

---

### Task 5: 引擎库数据与 `leftDiscouraged` 持久化（V2）

**Files:**
- Create: `src/lib/engine-catalog.js`
- Modify: `src/lib/engines.js`（`mergeConfig` 清洗）、`src/options/edits.js`（`editEngine`、新增 `addFromCatalog`）、`src/lib/errors.js`（新错误码）、`test/i18n-catalog.test.js`（`KEY_RE` 前缀表加 `catalog|popup`）、`src/_locales/*/messages.json`
- Test: `test/engine-catalog.test.js`（新建）、`test/engines.test.js`、`test/options-edits.test.js`

**Interfaces:**
- Consumes: Task 4 附录 A（收录哪些、`leftDiscouraged`）。
- Produces（`src/lib/engine-catalog.js`）：
  - `export const CATEGORIES`：有序数组 `[{ id: "translate", key: "catalog_cat_translate" }, ...]`，key 写成字面量。
  - `export const CATALOG`：`[{ id, name, url, category, leftDiscouraged?, ai?, targets? }]`；`targets` 是 `{ en, zh_CN, zh_TW, es }`，给含 `<target>` 的条目用。
  - `export function catalogUrl(entry, locale: "en"|"zh_CN"|"zh_TW"|"es"): string`：展开 `<target>`（取 `entry.targets[locale]`）与 `<lang>`（en→`en`、zh_CN/zh_TW→`zh`、es→`es`）。
  - `export function uniqueId(base: string, taken: (id) => boolean): string`：`base`、`base-2`、`base-3`……，截断保证总长 ≤ 20 且仍匹配 `ID_PATTERN`。
  - `export function isAdded(entry, locale, engines): boolean`：任一引擎 `url === catalogUrl(entry, locale)`。
- Produces（`src/options/edits.js`）：`export function addFromCatalog(raw, entry, locale): { ok: true, engine, patch } | { ok: false, error }`：
  - 已添加 → `fail("catalog_already_added", entry.name)`。
  - `engine = { id: uniqueId(entry.id, id => isIdTaken(id, raw)), name: entry.name, url: catalogUrl(entry, locale), ...(entry.leftDiscouraged ? { leftDiscouraged: true } : {}) }`。
  - `patch.customEngines` 追加；`entry.ai` 为真时 `patch.cycleExclude = [...(raw.cycleExclude || []), engine.id]`（`cycleExclude` 的读取在 Task 7 加进 `mergeConfig`，这里只写）。
- `mergeConfig`：自定义引擎只保留 `id`、`name`、`url`，以及 `leftDiscouraged === true` 时的 `leftDiscouraged: true`。
- `editEngine`：自定义引擎模板的 origin 变了就去掉 `leftDiscouraged`（用 `engineOrigin` 比较，解析失败视为变了）。

- [ ] **Step 1: 写失败的测试** `test/engine-catalog.test.js`：

```js
for (const locale of ["en", "zh_CN", "zh_TW", "es"]) {
  for (const e of CATALOG) {
    test(`${e.id} @${locale} 模板合法`, () => {
      const url = catalogUrl(e, locale);
      assert.ok(!url.includes("<"), url);
      assert.equal(validateTemplate(url).ok, true);
      assert.ok(ID_PATTERN.test(e.id));
      assert.ok(!PRESETS.some(p => p.id === e.id));
      assert.ok(CATEGORIES.some(c => c.id === e.category));
    });
  }
}
test("目录 id 互不重复", () => assert.equal(new Set(CATALOG.map(e => e.id)).size, CATALOG.length));
test("uniqueId 加后缀且不超过 20 字符", () => {
  assert.equal(uniqueId("youtube", id => id === "youtube"), "youtube-2");
  const long = "a".repeat(20);
  const got = uniqueId(long, id => id === long);
  assert.ok(got.length <= 20 && ID_PATTERN.test(got) && got !== long);
});
```

  另加：`addFromCatalog` 重复添加返回 `catalog_already_added`；AI 条目写进 `cycleExclude`；`mergeConfig` 丢掉 `leftDiscouraged: "yes"`、保留 `true`；`editEngine` 把模板从 youtube 改到别的 origin 后补丁里没有 `leftDiscouraged`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: 实现**；`catalog_already_added` 加进 `ERROR_CODES`，4 种语言补 `err_catalog_already_added`；分类名 key 4 种语言补齐；`KEY_RE` 前缀表加 `catalog|popup`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(engines): add a verified right-side engine catalog"
```

---

### Task 6: 引擎库对话框与授权提示调整（V2）

**Files:**
- Create: `src/options/catalog.js`
- Modify: `src/options/options.js`（必要时把 `actions` 拆到新文件 `src/options/actions.js` 以守住 300 行）、`src/options/options.html`、`src/options/options.css`、`src/_locales/*/messages.json`
- Test: `test/options-edits.test.js`（`saveEngine` 提示规则若抽成纯函数则在此测）

**Interfaces:**
- Consumes: Task 5 的 `CATALOG`、`CATEGORIES`、`catalogUrl`、`isAdded`、`addFromCatalog`。
- Produces：
  - `src/options/catalog.js`：`export function setupCatalogDialog(actions)`、`export function openCatalogDialog(cfg)`；对话框按 `CATEGORIES` 顺序分组，每条“名称 + 添加/已添加”，“已添加”按钮 `disabled`；语言切换后文字原地更新（用 `setI18nText`/`ht`）。
  - `actions.addFromCatalog(entry)`：`write(raw => addFromCatalog(raw, entry, currentLocale()))`，成功提示用新 key（例如 `notice_catalog_added`，占位符为引擎名），**不**把 id 加进 `attention`，**不**显示“需授权”。
  - 提示规则（可抽成 `edits.js` 的 `export function needsGrantWarning(engine, granted: boolean): boolean`，返回 `!granted && canBeLeft(engine)`）：`saveEngine` 只在它为真时加 `attention` 并显示持久警告。

- [ ] **Step 1: 写失败的测试**：`needsGrantWarning({ url: "https://www.google.com/maps/search/%s" }, false) === false`；`needsGrantWarning({ url: "https://a.com/?q=%s" }, false) === true`；`needsGrantWarning({ url: "https://a.com/?q=%s" }, true) === false`。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/options-edits.test.js`
Expected: FAIL

- [ ] **Step 3: 实现** `needsGrantWarning`、`catalog.js`、`options.html` 里“从引擎库添加”按钮与 `<dialog>` 骨架（静态文字用 `data-i18n`）、`saveEngine` 改用 `needsGrantWarning`。

- [ ] **Step 4: 跑全部测试并检查行数**

Run: `npm test && wc -l src/options/*.js`
Expected: PASS；每个文件 ≤ 300 行

- [ ] **Step 5: 手动冒烟**：`bash scripts/sync-to-windows.sh` 不需要；用 `npm run e2e -- --auto-only --only B5` 确认设置页仍能渲染（B5 是现有的设置页步骤；若编号不同，选任一现有设置页 auto 步骤）。

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(options): add engines from the catalog without a grant warning"
```

---

### Task 7: 快捷键轮换与换右侧的共享逻辑（V5 + V4 共用部分）

**Files:**
- Create: `src/lib/cycle.js`、`src/chrome/right-switch.js`、`src/options/shortcut.js`
- Modify: `src/lib/engines.js`（`mergeConfig` 返回 `cycleExclude`）、`src/options/edits.js`（`setCycle`、`deleteEngine` 清理）、`src/options/engine-list.js`（每行开关）、`src/options/options.html`、`src/options/options.js`、`src/background.js`（`commands.onCommand`）、`src/manifest.json`（`commands`）、`src/_locales/*/messages.json`、`test/pack.test.js`（`msgRefs` 断言加 `cmd_cycle_right`）
- Test: `test/cycle.test.js`（新建）、`test/right-switch.test.js`（新建）、`test/engines.test.js`、`test/options-edits.test.js`、`test/manifest.test.js`

**Interfaces:**
- Consumes: Task 2 的 `inspectTab`、`writeEngine`；`expandTemplate`（`src/lib/trigger.js`）。
- Produces：
  - `src/lib/cycle.js`：`export function nextRightEngine(engines, currentRightId: string, cycleExclude: string[]): Engine | null`：候选 = `engines` 中未被排除且 `id !== currentRightId`；取显示顺序里位于 `currentRightId` 之后的第一个候选，没有就取第一个候选；`currentRightId` 不在 `engines` 里时取第一个候选；没有候选返回 `null`。
  - `mergeConfig` 返回 `cycleExclude: string[]`（只保留字符串，缺省 `[]`）。
  - `edits.js`：`export function setCycle(raw, id: string, included: boolean)` → 补丁 `{ cycleExclude }`（去重，`included` 为真时移除）；`deleteEngine` 同时从 `cycleExclude` 去掉该 id（仅当原数组含它时才写这个键）。
  - `src/chrome/right-switch.js`：
    - `export async function ownedPair(tab, engines): Promise<{ left: { tabId, engineId, record }, right: { tabId, engineId, record }, query } | null>`：`inspectTab` 结果 `ownership === "own"` 才返回（`"fallback-own"` 没有关键词，返回 `null`）；左右按 `index` 判断。
    - `export async function switchRight(pair, engine): Promise<void>`：`tabs.update(pair.right.tabId, { url: expandTemplate(engine.url, pair.query) })`，然后 `writeEngine(pair.right.tabId, pair.right.record, engine.id)`。
  - `manifest.json`：`"commands": { "cycle-right": { "description": "__MSG_cmd_cycle_right__" } }`（无 `suggested_key`）。
  - `background.js`：顶层 `chrome.commands.onCommand.addListener(cmd => { if (cmd === "cycle-right") cycleRight().catch(log) })`；`cycleRight`：`windows.getLastFocused({ windowTypes: ["normal"] })` → `tabs.query({ active: true, windowId })` → `loadConfig()` → `ownedPair` → `nextRightEngine` → `switchRight`；任一步为空就返回。
  - `src/options/shortcut.js`：`export async function renderShortcut(): Promise<Node>`：`chrome.commands.getAll()` 找 `cycle-right`，`shortcut` 为空显示“未设置”文案，否则显示组合键；按钮 `chrome.tabs.create({ url: "chrome://extensions/shortcuts" })`。`options.js` 在 `window` `focus` 时重绘这一块。
  - 引擎行开关：`<label><input type="checkbox"> 参与快捷键轮换</label>`，`checked = !cfg.cycleExclude.includes(e.id)`，变化时 `actions.setCycle(e.id, checked)`。

- [ ] **Step 1: 写失败的测试** `test/cycle.test.js`：

```js
const E = ["a", "b", "c", "d"].map(id => ({ id, url: `https://${id}.com/?q=%s` }));
test("取当前之后的下一个", () => assert.equal(nextRightEngine(E, "b", []).id, "c"));
test("到末尾回到开头，跳过当前", () => assert.equal(nextRightEngine(E, "d", []).id, "a"));
test("跳过被排除的", () => assert.equal(nextRightEngine(E, "b", ["c"]).id, "d"));
test("当前引擎已删除 → 第一个候选", () => assert.equal(nextRightEngine(E, "gone", ["a"]).id, "b"));
test("全部被排除 → null", () => assert.equal(nextRightEngine(E, "a", ["b", "c", "d"]), null));
test("只有当前一个 → null", () => assert.equal(nextRightEngine([E[0]], "a", []), null));
```

  `test/right-switch.test.js`（chrome 桩）：
  - 关键词 `a&b #c+d 中文 😀`：`switchRight` 调用 `tabs.update` 的 url 等于 `expandTemplate(engine.url, query)`，并且 `storage.session` 里右侧记录的 `engine` 变成新 id、其他字段不变。
  - 当前活动标签在右侧（index 大）时，`ownedPair` 的 `right.tabId` 仍是 index 大的那个。
  - `ownership` 为 `"fallback-own"`/`"none"`/`"stale"` → `ownedPair` 返回 `null`。

  `test/manifest.test.js`：`commands["cycle-right"]` 存在、没有 `suggested_key`、没有 `_execute_action`。`test/options-edits.test.js`：`setCycle` 加入/移除、`deleteEngine` 清理 `cycleExclude`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: 实现上述全部**；文案 key 用 `options_`/`engine_` 前缀，`cmd_cycle_right` 只在 manifest 引用（`pack-lib` 的 `checkLocales` 要求 4 种语言都有）。

- [ ] **Step 4: 跑全部测试**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(shortcut): cycle the right side through opted-in engines"
```

---

### Task 8: 工具栏弹窗（V4）

**Files:**
- Create: `src/popup/popup.html`、`src/popup/popup.js`、`src/popup/popup.css`
- Modify: `src/manifest.json`（`action.default_popup`）、`src/background.js`（删 `action.onClicked`）、`scripts/pack-lib.mjs`（`referencedFiles` 收 `action.default_popup`）、`scripts/pack-smoke.mjs`（弹窗英文渲染核对）、`src/_locales/*/messages.json`
- Test: `test/manifest.test.js`、`test/pack.test.js`

**Interfaces:**
- Consumes: Task 7 的 `ownedPair`、`switchRight`；`loadConfig`；`initI18n`/`applyI18n`/`setI18nText`（`src/chrome/i18n.js`）。
- Produces：
  - `popup.js`：目标标签 = `?tabId=<整数>` 时 `chrome.tabs.get(该值)`，否则 `tabs.query({ active: true, currentWindow: true })[0]`。`ownedPair` 为空 → 显示说明文字 key（例如 `popup_not_ours`）与“打开设置页”。非空 → 关键词（空串时显示 `popup_empty_query`）、左右引擎名（引擎已删除显示 `popup_engine_deleted`）、按钮列表（`cfg.engines` 去掉当前右侧引擎，不看 `cycleExclude`），点击后 `switchRight` 再重绘。“打开设置页”用 `chrome.runtime.openOptionsPage()`。
  - 样式复用设置页的颜色变量（复制 `options.css` 里 `:root` 与深色模式段落需要的变量，或抽公共 css——实现者定，不得违反“无构建”），宽 320–400 CSS px。
  - `pack-lib.mjs` 的 `referencedFiles` 包含 `manifest.action?.default_popup`。

- [ ] **Step 1: 写失败的测试**：`test/manifest.test.js` 断言 `m.action.default_popup === "popup/popup.html"` 且该文件存在；`test/pack.test.js` 断言 `referencedFiles(manifest)` 含 `popup/popup.html`，并在删掉该文件的临时副本上 `checkReferenced` 报错（沿用该测试文件现有的临时目录写法）。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/manifest.test.js test/pack.test.js`
Expected: FAIL

- [ ] **Step 3: 实现弹窗、manifest、background、pack-lib**

- [ ] **Step 4: 实测 `Extensions.triggerAction` 在有 `default_popup` 时是否出现弹窗的 CDP 目标**（一次性脚本，同 Task 4 的一次性配置做法）。把结论写进 Task 9 的 B2 改写说明里（提交信息里也写一句）。

- [ ] **Step 5: `scripts/pack-smoke.mjs`** 增加：`Target.createTarget` 打开 `chrome-extension://<装出的 id>/popup/popup.html`，断言 `lang="en"`、没有显示成 key 的文字（复用它核对设置页的同一个函数）。

- [ ] **Step 6: 跑测试与冒烟**

Run: `npm test && npm run pack -- --smoke --allow-dirty`
Expected: PASS；冒烟输出里弹窗核对通过（`--allow-dirty` 只因为尚未提交）

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(popup): switch the right engine from the toolbar popup"
```

---

### Task 9: e2e 第一部分：基线、V1、V3、V4、B2

**Files:**
- Modify: `scripts/e2e/ext.mjs`（`mockBaseline` 加 `narrowFallback: false`）、`scripts/e2e/steps/options-b.mjs`（B2）、`scripts/e2e/steps/index.mjs`（注册）、`scripts/e2e/server.mjs`（如需普通页面路由）
- Create: `scripts/e2e/steps/v03-split.mjs`（T16、T17）、`scripts/e2e/steps/v03-popup.mjs`（T18）
- Test: `test/e2e-*.test.js` 中对新导出的纯逻辑补单测（如断言辅助函数）

**Interfaces:**
- Consumes: `resetTabs`、`openTab`、`navigate`、`waitState`、`trigger`、`findPair`、`summarize`（`scripts/e2e/steps/util.mjs`）；`T5_RESTART` 的重启模式（`flow-restart.mjs`）；`fixWindow` 的 `Browser.setWindowBounds` 写法（`xauto-lib.mjs`）；`ctx.ext.eval`。
- Produces：步骤 `T16`（V1，auto，`timeoutMs: 180000`）、`T17`（V3，auto，`timeoutMs: 180000`）、`T18`（V4，auto）；改写后的 `B2`。断言内容按 spec 3.8 的 V1、V3、V4 条目逐条实现（子项名用 (a)(b)…，经 `summarize` 汇总）。T17 的 `finally` 恢复窗口尺寸并用 `guarded` 写回 `narrowFallback`。

- [ ] **Step 1: 基线**：`mockBaseline` 增加 `narrowFallback: false`；跑 `npm run e2e -- --auto-only` 确认现有步骤不受影响（预期全部同改动前）。

- [ ] **Step 2: 实现 T16**，单独跑：

Run: `npm run e2e -- --auto-only --only T16`
Expected: T16 pass，报告里 (a)–(e) 都是 pass

- [ ] **Step 3: 实现 T17**（先在步骤里实测 Xvfb 下 `Browser.setWindowBounds` 能设到的最小宽度，用 `900` 或能达到的最小值，低于 960 即可；高于 960 用 `1600`），单独跑：

Run: `npm run e2e -- --auto-only --only T17`
Expected: pass

- [ ] **Step 4: 实现 T18 并改写 B2**（按 Task 8 Step 4 的结论二选一），单独跑：

Run: `npm run e2e -- --auto-only --only B2,T18`
Expected: pass

- [ ] **Step 5: 全量自动步骤**

Run: `npm test && npm run e2e -- --auto-only`
Expected: 全部 pass 或已知的预期降级（T14），没有新增失败

- [ ] **Step 6: Commit**

```bash
git commit -m "test(e2e): cover split records, narrow fallback and the popup"
```

---

### Task 10: e2e 第二部分：V2、V5、I18N/B14、验收表

**Files:**
- Create: `scripts/e2e/steps/v03-options.mjs`（B16 引擎库、B17 快捷键 auto 子项）、`scripts/e2e/ext-shortcuts.mjs`（`chrome://extensions/shortcuts` WebUI 操作）、`scripts/e2e/steps/xauto-t19.mjs`（T19 xauto + judge 回退）、`docs/acceptance-v0.3.md`
- Modify: `scripts/e2e/steps/index.mjs`、`scripts/e2e/steps/i18n.mjs`（加弹窗页）、`scripts/e2e/steps/b14.mjs`（加弹窗页深色截图 `.e2e/b14-popup-dark.png`）
- Test: `test/e2e-*.test.js` 补 `ext-shortcuts.mjs` 里可单测的纯逻辑（如按键串格式化）

**Interfaces:**
- Produces：
  - `ext-shortcuts.mjs`：`export async function bindShortcut(browser, command: string, keys: string): Promise<void>`、`export async function clearShortcut(browser, command: string): Promise<void>`；结构认不出抛 `infra(...)`（`ext-webui.mjs` 的同名工具）。测试用组合键 `Alt+Shift+Period`（先确认 Chrome 自带快捷键不占用；占用就换一个并写进步骤注释）。
  - `B16`、`B17`（auto）按 spec 3.8 V2、V5 的 auto 子项实现；B17 先 `clearShortcut` 再断言“未设置”。
  - `T19`（xauto）：`bindShortcut` → 建本扩展分屏 → 真实按键 → 断言右侧换成下一个参与轮换的引擎、被排除的被跳过 → `finally` 里 `clearShortcut`。fallback 是 judge 版本（向导请用户按快捷键并确认右侧变了）。
  - `docs/acceptance-v0.3.md`：B16、B17、T16–T19、改写后的 B2、I18N/B14 新增覆盖，每行写覆盖方式（auto/xauto/judge）。

- [ ] **Step 1: 实现 B16、B17 并单独跑**

Run: `npm run e2e -- --auto-only --only B16,B17`
Expected: pass

- [ ] **Step 2: 实现 `ext-shortcuts.mjs` 与 T19 并单独跑**（默认 Xvfb，xauto 照跑）

Run: `npm run e2e -- --auto-only --only T19`
Expected: pass（WebUI 结构认不出时 skip 且写明原因——这种情况算未完成，要修到 pass）

- [ ] **Step 3: I18N 与 B14 覆盖弹窗**

Run: `npm run e2e -- --auto-only --only I18N,B14`
Expected: pass；`.e2e/i18n/<locale>-popup.png` 与 `.e2e/b14-popup-dark.png` 生成

- [ ] **Step 4: 写 `docs/acceptance-v0.3.md`**

- [ ] **Step 5: 全量**

Run: `npm test && npm run e2e -- --auto-only`
Expected: 无新增失败

- [ ] **Step 6: Commit**

```bash
git commit -m "test(e2e): cover the engine catalog, shortcut and popup locales"
```

---

### Task 11: 文案定稿与隐私、商店、README、CHANGELOG

**Files:**
- Modify: `src/_locales/{zh_CN,en,zh_TW,es}/messages.json`（本版新增的全部 key）、`docs/store/privacy.md`、`docs/privacy.md`、`docs/privacy.zh-CN.md`、`docs/store/listing.{en,zh-CN,zh-TW,es}.md`、`README.md`、`README.zh-CN.md`、`README.zh-TW.md`、`README.es.md`、`CHANGELOG.md`

**Interfaces:**
- Consumes: spec 3.6 的“要改写的旧说法”清单（4 条）与“要改的地方”清单。

- [ ] **Step 1: 界面文案**：按 CLAUDE.md“文案”节的流程，先把本版新增 key 的 zh_CN 源文案用 lieflat-less-ai-tone + humanizer-zh 定稿；再转写 en（humanizer）、zh_TW（humanizer-zh + 台湾用语审校）、es（content-l10n，中性国际西语，用 tú）。术语（拆分视图、快捷键、网站搜索等）对照 `docs/i18n/chrome-terms.md`，缺的从 `/opt/google/chrome/locales/<语言>.pak` 核实。
- [ ] **Step 2: 隐私文档**：按 spec 3.6 改 `docs/store/privacy.md`（含开头版本说明、速查表、`storage` 理由、审核员说明、政策正文、`storage.sync` 字段清单），同步 `docs/privacy.md`、`docs/privacy.zh-CN.md` 并更新生效日期。
- [ ] **Step 3: CWS“数据使用”披露复核**：对照 CWS 用户数据 FAQ 写下依据与结论到 `docs/store/privacy.md`；结论是需要勾选时，按其中的回退表改隐私政策标题和 4 种语言详情首句（用户已同意“该勾就勾”）。在完成报告里明确告诉用户结论，因为上传时要在 CWS 后台照此勾选。
- [ ] **Step 4: 商店详情与 README**：4 种语言的 FEATURES/功能列表加弹窗、快捷键（说明默认未绑定、去哪绑）、引擎库、窄窗口；PRIVACY 段按新说法改；4 份 README 结构保持一致，语言切换行不变。各语言按各自流程润色。
- [ ] **Step 5: `CHANGELOG.md`**：新增 v0.3.0 条目（按仓库现有格式），写明“关键词在本机浏览器内存中暂存，用于换右侧引擎，关闭浏览器即清除”。
- [ ] **Step 6: 检查**

Run: `npm test`
Expected: PASS（含 `test/i18n-catalog.test.js` 的 `[needs-translation]` 清零检查、`test/store-i18n.test.js`）

- [ ] **Step 7: Commit**（可按“界面文案”“隐私与商店文档”“README 与 CHANGELOG”拆成 2–3 个提交）

```bash
git commit -m "docs: describe v0.3 features and local query storage"
```

---

### Task 12: 版本号、CLAUDE.md 同步与全量验证

**Files:**
- Modify: `src/manifest.json`、`package.json`（`0.3.0`）、`test/manifest.test.js`（版本断言）、`CLAUDE.md`

- [ ] **Step 1: 版本号** 改成 `0.3.0`（manifest、`package.json`、`test/manifest.test.js`）。
- [ ] **Step 2: CLAUDE.md**（spec 第 5 节）：目录与职责（`popup/`、`lib/split-owner.js`、`lib/engine-catalog.js`、`lib/cycle.js`、`chrome/split-state.js`、`chrome/right-switch.js`、`options/catalog.js`、`options/shortcut.js`、新 e2e 文件与测试文件）、`storage.sync` 新顶层键（`narrowFallback`、`cycleExclude`）、机制速览（go.html 分支增加窄窗口；弹窗与快捷键）、已知事实（Chrome 156.0.8078.47 实测；spec 第 2 节新核实的分屏 API 行为）、e2e 新步骤与 `narrowFallback` 基线、路线图 v0.3 一行标“已实现”。
- [ ] **Step 3: 全量验证**

Run: `npm test && npm run e2e -- --auto-only && npm run pack -- --smoke`
Expected: 全部通过；`--smoke` 打印 0.3.0 ZIP 的大小、sha256，key 已去掉（不带 `--store-key` 时）

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: release v0.3.0"
```

- [ ] **Step 5: 向用户报告**：引擎库收录结果与“需用户确认”的条目（Task 4 Step 3）、CWS 披露结论（Task 11 Step 3）、上传命令 `npm run pack -- --store-key ~/.config/split-search/cws-public-key.pem --smoke`（上传时机由用户决定，不自动执行）。
