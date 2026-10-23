# Split Search v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个 Chrome MV3 扩展：在地址栏搜索或把文字拖到标签栏时，用两个可自定义的搜索引擎打开 Chrome 原生分屏。

**Architecture:** 用户把“左侧引擎真实网址 + `_ss` 标记”的触发网址设为 Chrome 的默认或网站搜索。DNR 动态规则在请求发出前，把触发网址重定向到扩展页 `go.html`。`go.html` 解析出左右引擎和关键词，再用 `tabs.create({splitWithTabId})` 组成分屏。纯逻辑放在 `src/lib/`（不碰 `chrome.*`，用 node 测试）；`src/chrome/` 是对 `chrome.*` 的薄封装；页面脚本只负责编排。

**Tech Stack:** Manifest V3、原生 JS ES modules（无构建、无依赖）、`node --test`（Node 24）、Bash 脚本（rsync、openssl）。

**Spec:** `docs/superpowers/specs/2026-10-23-split-search-design.md`。执行者必须先读完 spec，本计划的取舍都以它为依据。

## Global Constraints

- `manifest_version: 3`；`minimum_chrome_version: "155"`；`incognito: "not_allowed"`。
- `permissions` 只能是 `["declarativeNetRequest", "storage"]`。禁止 `tabs`，禁止必需的 `host_permissions`。
- `optional_host_permissions: ["https://*/*", "http://*/*"]`。运行时只为引擎的精确 origin（`<origin>/*`）申请。
- `web_accessible_resources: [{ "resources": ["go.html"], "matches": ["<all_urls>"], "use_dynamic_url": true }]`。
- manifest 里固定 `key`。私钥放在仓库外：`~/.config/split-search/extension-key.pem`。
- 无构建工具、无运行时依赖。`src/lib/` 不得引用 `chrome`。JS 单文件不超过 300 行。
- 标记参数名为 `_ss`，值为 `<左id>,<右id>`，要兼容 `%2C`。引擎 id 必须匹配 `/^[a-z0-9-]{1,20}$/`，创建后不可修改。
- DNR 规则 id 固定为 `1`。`regexSubstitution` 写死为 `chrome-extension://<chrome.runtime.id>/go.html?u=\0`，不得使用 `runtime.getURL()`。
- 预置引擎（只写在代码里）：`kagi` Kagi `https://kagi.com/search?q=%s`；`google` Google `https://www.google.com/search?q=%s`；`bing` Bing `https://www.bing.com/search?q=%s`；`ddg` DuckDuckGo `https://duckduckgo.com/?q=%s`；`perplexity` Perplexity `https://www.perplexity.ai/search?q=%s`。默认组合为 `["kagi", "google"]`。
- 用户界面文案一律使用简体中文。
- 不使用 iframe，不修改响应头。只有经过用户确认的“本扩展分屏”才允许被覆盖。
- 开发镜像目录：`/mnt/d/APP/Chrome-Extensions/split-search`。之后只用“重新加载”，不要移除后重装。

## Review Focus

1. **Kagi 把 `_ss` 的逗号改写成 `%2C`**：DNR 规则必须仍然命中，`parseTrigger` 必须仍然能解析。用例放在 Task 3 和 Task 4。
2. **用户改了左侧引擎的模板，但 Chrome 里存的还是旧的触发网址**：此时触发网址里没有新模板的参数名。期望显示“触发网址与当前模板不一致，请到设置页重新复制”，不能悄悄打开首页。用例放在 Task 3。
3. **关键词带有 `+`、`&`、`%`、中文、emoji，或空格被 Chrome 编码成 `+`**：两侧都要拿到原样的关键词。用例放在 Task 3。
4. **网站搜索里引用的引擎已被删除或隐藏**：右侧引擎被删或隐藏时，期望显示未知引擎的错误页，不跳转。左侧引擎被删或隐藏时，它的 host 不再出现在 DNR 规则里，期望按 G5 降级为普通搜索，这是预期行为。用例放在 Task 2（隐藏的引擎不进入合并结果）、Task 3 和 Task 4（`leftHosts`）。
5. **分屏另一侧的 url 读不到（没有权限）或已经跨 origin 跳转，或者用户拖到的是本扩展分屏的右侧标签**：前一种情况必须按“其他分屏”处理，不能覆盖；会话里有记录时按“本扩展分屏”处理。拖到右侧标签时，左右位置必须保持不变。用例放在 Task 5。

---

## File Structure

```
split-search/
├── CLAUDE.md                     项目约定（Task 1）
├── README.md                     简介、安装、目标与路线图（Task 1）
├── package.json                  仅含 "test": "node --test" 脚本（Task 1）
├── .gitignore                    （Task 1）
├── scripts/
│   ├── gen-key.sh                生成或复用私钥，把公钥写入 src/manifest.json 的 key（Task 1）
│   └── sync-to-windows.sh        rsync src/ → D 盘镜像目录（Task 1）
├── src/                          扩展根目录（加载这个目录）
│   ├── manifest.json             （Task 1）
│   ├── background.js             SW：重建 DNR 规则、打开设置页（Task 1 占位，Task 6 实现）
│   ├── go.html / go.js           触发处理页（Task 7）
│   ├── options/options.html|js|css  设置页（Task 1 占位，Task 8 实现）
│   ├── lib/engines.js            预置引擎、模板校验、配置合并（Task 2）
│   ├── lib/trigger.js            触发网址生成与解析、模板展开（Task 3）
│   ├── lib/rules.js              DNR 规则构造（Task 4）
│   ├── lib/split-decision.js     分屏动作判定（Task 5）
│   └── chrome/config-store.js    storage.sync 读写封装（Task 6）
└── test/                         node --test（每个 lib 一个文件，另加 manifest.test.js、config-store.test.js）
```

---

### Task 1: 项目脚手架、manifest、CLAUDE.md 与开发脚本

**Files:**
- Create: `package.json`、`.gitignore`、`README.md`、`CLAUDE.md`、`scripts/gen-key.sh`、`scripts/sync-to-windows.sh`、`src/manifest.json`、`src/background.js`、`src/options/options.html`、`src/options/options.js`、`src/options/options.css`
- Test: `test/manifest.test.js`

**Interfaces:**
- Produces：扩展根目录是 `src/`；options 页路径为 `options/options.html`；`npm test` 等价于 `node --test`（自动发现 `**/*.test.js`。注意：在 Node 24 上不能写成 `node --test test/`，会报 MODULE_NOT_FOUND）。

- [ ] **Step 1: 写失败的测试 `test/manifest.test.js`**，读取 `src/manifest.json` 并断言：
```js
assert.equal(m.manifest_version, 3);
assert.equal(m.minimum_chrome_version, "155");
assert.equal(m.incognito, "not_allowed");
assert.deepEqual(m.permissions, ["declarativeNetRequest", "storage"]);
assert.equal(m.host_permissions, undefined);
assert.deepEqual(m.optional_host_permissions, ["https://*/*", "http://*/*"]);
assert.deepEqual(m.web_accessible_resources, [{ resources: ["go.html"], matches: ["<all_urls>"], use_dynamic_url: true }]);
assert.equal(m.background.service_worker, "background.js");
assert.equal(m.background.type, "module");
assert.equal(m.options_ui.page, "options/options.html");
assert.equal(m.options_ui.open_in_tab, true);
assert.match(m.key, /^[A-Za-z0-9+/=]{300,}$/);
assert.equal(m.omnibox, undefined);
assert.equal(m.chrome_settings_overrides, undefined);
```

- [ ] **Step 2: 运行 `npm test`**。预期失败：找不到 `src/manifest.json`，或缺少 `package.json`。

- [ ] **Step 3: 创建 `package.json`**：`{"name":"split-search","version":"0.1.0","private":true,"type":"module","scripts":{"test":"node --test"}}`。

- [ ] **Step 4: 创建 `src/manifest.json`**，满足 Step 1 的全部断言，另外加上 `name: "Split Search"`、`version: "0.1.0"`、`description: "地址栏或拖拽搜索，一键用两个搜索引擎打开原生分屏对比"`、`action: { default_title: "Split Search 设置" }`。`key` 暂时留空，由 Step 5 写入。

- [ ] **Step 5: 创建 `scripts/gen-key.sh`，然后运行它。** 脚本先 `set -euo pipefail`，逻辑如下：私钥文件 `~/.config/split-search/extension-key.pem` 不存在时，用 `openssl genrsa 2048` 生成并 `chmod 600`；然后执行 `openssl rsa -pubout -outform DER | base64 -w0` 得到公钥，用 `node -e` 写进 `src/manifest.json` 的 `key` 字段（保持两空格缩进）；最后打印扩展 ID。扩展 ID 的算法：对 DER 公钥做 sha256，取前 32 个 hex 字符，再把 `0-9a-f` 逐个映射成 `a-p`。脚本可重复执行，结果幂等。

- [ ] **Step 6: 创建 `scripts/sync-to-windows.sh`**：`set -euo pipefail`，然后 `rsync -a --delete src/ /mnt/d/APP/Chrome-Extensions/split-search/`。目标父目录不存在时报错退出。结束时提示“到 chrome://extensions 点重新加载（不要移除重装）”。

- [ ] **Step 7: 创建占位文件。**
  - `src/background.js`：只注册两个监听。`chrome.runtime.onInstalled` 在 `reason === "install"` 时调用 `chrome.runtime.openOptionsPage()`；`chrome.action.onClicked` 调用 `chrome.runtime.openOptionsPage()`。
  - `src/options/options.html`：标题“Split Search 设置”，正文写“设置页施工中（Task 8）”，以 module 方式引入 `options.js` 和 `options.css`。
  - `options.js` 和 `options.css` 先留空。

- [ ] **Step 8: 创建 `.gitignore`**，内容：`node_modules/`、`*.pem`、`*.crx`、`*.zip`、`.codegraph/`。

- [ ] **Step 9: 创建 `README.md`（中文）。** 面向真实用户，力求精简，正文不超过约 40 行。只写四部分：
  1. 一句话说明它能做什么；
  2. 环境要求：Chrome 155+；
  3. 安装：在 Chrome 中加载已解压的扩展程序；
  4. 三步上手：授权 → 复制触发网址 → 在 Chrome 设置中添加网站搜索并设为默认。另附一行说明：在其他设备或无痕窗口中，会退化为普通搜索。

  **不要**写目标方向、路线图、开发命令或实现机制。这些内容放到 CLAUDE.md 和 spec 里。

- [ ] **Step 10: 创建 `CLAUDE.md`（中文）**，必须包含以下几节：
  - **项目一句话** + 指向 spec 和本计划的路径；
  - **目标与方向**：摘录 spec §3 的目标、非目标、反目标，以及 §8 的路线图；
  - **开发与安装**：运行 `scripts/sync-to-windows.sh` 同步到 D 盘，再在 Chrome 中加载 `D:\APP\Chrome-Extensions\split-search`；
  - **机制速览**：照搬 spec §4.2 的流程框图；
  - **目录与职责**：同上文 File Structure；
  - **硬约束**：抄录本计划 Global Constraints 的全部条目，并写明“违反任一条视为缺陷”；
  - **命令**：`npm test`、`bash scripts/sync-to-windows.sh`、`bash scripts/gen-key.sh`（私钥位置，以及“私钥丢了扩展 ID 就会变，所有授权和 sync 数据都会作废”）；
  - **测试纪律**：`src/lib/` 新增逻辑先写 node 测试；涉及分屏、DNR、权限的行为，只能在 Windows Chrome 155+ 里按 spec §7（T1–T15）手测，WSL 里的 Chrome 版本不够，不能用；
  - **提交**：使用 git-commit skill（Conventional Commits），仓库没有 git 身份配置时用内联身份 `-c user.name=pine2D -c user.email=oumu323@gmail.com`；
  - **已知事实**：摘录 spec §2.2 的核查结论，比如 `%s` 在 query 中时空格编为 `+`、Kagi 会把逗号改成 `%2C`、popup 窗口不能分屏、不要用 `navigation.canGoBack`，避免以后重复踩坑。

- [ ] **Step 11: 运行 `npm test`。** 预期 manifest 测试 PASS。

- [ ] **Step 12: 运行 `bash scripts/sync-to-windows.sh`。** 用户在 Windows Chrome 中加载 `D:\APP\Chrome-Extensions\split-search`。预期：安装后自动打开设置占位页；点击工具栏图标也能打开该页；`chrome://extensions` 上显示的 ID 与 gen-key 打印的一致；扩展详情页里没有“在无痕模式下启用”的开关。

- [ ] **Step 13: 提交**：`chore: scaffold split-search extension`（包含 spec 和本计划）。

---

### Task 2: `lib/engines.js`：预置引擎、模板校验、配置合并

**Files:**
- Create: `src/lib/engines.js`
- Test: `test/engines.test.js`

**Interfaces:**
- Produces:
  - `PRESETS: Engine[]`，其中 `Engine = { id: string, name: string, url: string, leftDiscouraged?: boolean }`，值见 Global Constraints。`leftDiscouraged` 初始全部不设；如果 Task 9 的 T14 发现某引擎的 Service Worker 让 DNR 失效，就给它设上这个字段。
  - `DEFAULT_PAIR: [string, string]`，值为 `["kagi", "google"]`。
  - `ID_PATTERN: RegExp`，值为 `/^[a-z0-9-]{1,20}$/`。
  - `validateTemplate(url: string): { ok: true, canBeLeft: boolean, leftParam: string | null } | { ok: false, error: string }`
  - `mergeConfig(stored: { customEngines?: Engine[], presetOverrides?: Record<string, { name?: string, url?: string, hidden?: boolean }>, order?: string[], defaultPair?: [string, string] }): { engines: Engine[], hidden: Engine[], defaultPair: [string, string] }`：`hidden` 是被隐藏的预置引擎，供设置页“取消隐藏”使用。
  - `isIdTaken(id: string, stored): boolean`：在全部 `PRESETS`（包括已隐藏的）和 `customEngines` 里查重。
  - `engineOrigin(engine: Engine): string`，返回 `new URL(engine.url.replace("%s", "x")).origin`。

- [ ] **Step 1: 写失败的测试。**
```js
test("validateTemplate: 合格的左侧模板", () => {
  assert.deepEqual(validateTemplate("https://kagi.com/search?q=%s"), { ok: true, canBeLeft: true, leftParam: "q" });
  assert.deepEqual(validateTemplate("https://duckduckgo.com/?q=%s&ia=web"), { ok: true, canBeLeft: true, leftParam: "q" });
});
test("validateTemplate: 只能作右侧", () => {
  assert.deepEqual(validateTemplate("https://en.wikipedia.org/wiki/%s"), { ok: true, canBeLeft: false, leftParam: null });
  assert.equal(validateTemplate("https://a.com/?q=%s#x").canBeLeft, false);
  assert.equal(validateTemplate("https://a.com/?q=%s&r=%s").canBeLeft, false);
  assert.equal(validateTemplate("https://a.com/?q=pre%s").canBeLeft, false);
  assert.equal(validateTemplate("https://a.com/?q=%s&_ss=a,b").canBeLeft, false);
});
test("validateTemplate: 不合格", () => {
  assert.equal(validateTemplate("ftp://a.com/?q=%s").ok, false);
  assert.equal(validateTemplate("https://a.com/?q=").ok, false);
  assert.equal(validateTemplate("https://a.com/?q=%S").ok, false);
  assert.equal(validateTemplate("not a url %s").ok, false);
});
test("mergeConfig: 空存储返回预置引擎和默认组合", () => {
  const c = mergeConfig({});
  assert.deepEqual(c.engines.map(e => e.id), ["kagi", "google", "bing", "ddg", "perplexity"]);
  assert.deepEqual(c.defaultPair, ["kagi", "google"]);
});
test("mergeConfig: 覆盖、隐藏、自定义、排序", () => {
  const c = mergeConfig({
    presetOverrides: { bing: { hidden: true }, google: { name: "G" } },
    customEngines: [{ id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" }],
    order: ["baidu", "google"],
  });
  assert.deepEqual(c.engines.map(e => e.id), ["baidu", "google", "kagi", "ddg", "perplexity"]);
  assert.equal(c.engines.find(e => e.id === "google").name, "G");
});
test("mergeConfig: defaultPair 引用了不存在、隐藏的引擎，或左侧不能作左侧时，回退到 DEFAULT_PAIR", () => {
  assert.deepEqual(mergeConfig({ defaultPair: ["kagi", "nope"] }).defaultPair, ["kagi", "google"]);
  assert.deepEqual(mergeConfig({ presetOverrides: { bing: { hidden: true } }, defaultPair: ["bing", "kagi"] }).defaultPair, ["kagi", "google"]);
  assert.deepEqual(mergeConfig({ customEngines: [{ id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" }], defaultPair: ["wiki", "kagi"] }).defaultPair, ["kagi", "google"]);
});
test("mergeConfig: 隐藏的预置引擎出现在 hidden 中", () => {
  assert.deepEqual(mergeConfig({ presetOverrides: { bing: { hidden: true } } }).hidden.map(e => e.id), ["bing"]);
});
test("isIdTaken: 已隐藏的预置引擎 id 也算已占用", () => {
  assert.equal(isIdTaken("bing", { presetOverrides: { bing: { hidden: true } } }), true);
  assert.equal(isIdTaken("baidu", { customEngines: [{ id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" }] }), true);
  assert.equal(isIdTaken("sogou", {}), false);
});
test("engineOrigin", () => {
  assert.equal(engineOrigin(PRESETS[0]), "https://kagi.com");
});
```

- [ ] **Step 2: 运行 `node --test test/engines.test.js`**。预期失败：模块不存在。

- [ ] **Step 3: 实现 `src/lib/engines.js`。** 合并顺序：`order` 中列出的 id 排最前，其余按“预置在前、自定义在后”的原始顺序排。`error` 文案用中文，例如“网址必须以 http:// 或 https:// 开头”“网址中必须包含小写 %s”。`leftParam` 用 `new URL(url.replace("%s", "__SS__"))` 解析后，找出值恰好等于 `__SS__` 的那个参数名。

- [ ] **Step 4: 运行测试**，预期 PASS。

- [ ] **Step 5: 提交**：`feat(lib): engines presets, template validation and config merge`。

---

### Task 3: `lib/trigger.js`：触发网址的生成与解析

**Files:**
- Create: `src/lib/trigger.js`
- Test: `test/trigger.test.js`

**Interfaces:**
- Consumes：Task 2 的 `validateTemplate`、`Engine`。
- Produces:
  - `MARKER = "_ss"`
  - `buildTriggerTemplate(left: Engine, rightId: string): string`：左侧引擎不能作左侧时 throw。
  - `extractOriginalUrl(search: string): string | null`：返回 `search` 里第一个 `u=` 之后的全部文本。
  - `stripMarker(originalUrl: string): string`：用字符串操作删除 `_ss=…` 这一个参数，以及它前面或后面紧邻的 `&`（或 `?`），其余部分原样保留，不经过 URLSearchParams 重新编码。左侧标签导航到这个网址，这样原始网址里的其他参数都能保留下来。
  - `parseTrigger(originalUrl: string, engines: Engine[]): { ok: true, left: Engine, right: Engine, query: string } | { ok: false, error: string }`
  - `expandTemplate(template: string, query: string): string`：`query` 为空串时返回 `new URL(...).origin + "/"`；否则用 `replaceAll("%s", encodeURIComponent(query))` 替换**所有** `%s`。

- [ ] **Step 1: 写失败的测试。** 文件开头先定义以下 fixture：
```js
import { PRESETS, mergeConfig } from "../src/lib/engines.js";
const kagi = PRESETS.find(e => e.id === "kagi");
const wiki = { id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" };
const E = [...mergeConfig({}).engines, { id: "baidu", name: "百度", url: "https://www.baidu.com/s?wd=%s" }];
const withWiki = [...E, wiki];
```
```js
test("buildTriggerTemplate", () => {
  assert.equal(buildTriggerTemplate(kagi, "google"), "https://kagi.com/search?q=%s&_ss=kagi,google");
  assert.equal(buildTriggerTemplate({ id: "x", name: "X", url: "https://x.com/s?q=%s" }, "bing"), "https://x.com/s?q=%s&_ss=x,bing");
  assert.throws(() => buildTriggerTemplate({ id: "w", name: "W", url: "https://w.org/wiki/%s" }, "google"));
});
test("extractOriginalUrl 保留原始网址里的 & 和 +", () => {
  assert.equal(extractOriginalUrl("?u=https://kagi.com/search?q=a+b&_ss=kagi,google"), "https://kagi.com/search?q=a+b&_ss=kagi,google");
  assert.equal(extractOriginalUrl("?x=1"), null);
});
test("parseTrigger: 空格编码为 + 时还原成空格", () => {
  const r = parseTrigger("https://kagi.com/search?q=hello+world&_ss=kagi,google", E);
  assert.equal(r.ok, true); assert.equal(r.query, "hello world");
  assert.equal(r.left.id, "kagi"); assert.equal(r.right.id, "google");
});
test("parseTrigger: 特殊字符往返", () => {
  for (const q of ["c++", "a&_ss=x", "100%", "中文 搜索", "😀", "a#b"]) {
    const u = "https://kagi.com/search?q=" + encodeURIComponent(q).replace(/%20/g, "+") + "&_ss=kagi,google";
    assert.equal(parseTrigger(u, E).query, q);
  }
});
test("parseTrigger: 兼容 Kagi 把逗号改写成 %2C", () => {
  assert.equal(parseTrigger("https://kagi.com/search?q=x&_ss=kagi%2Cgoogle", E).right.id, "google");
});
test("parseTrigger: 左右可以是同一个引擎", () => {
  assert.equal(parseTrigger("https://kagi.com/search?q=x&_ss=kagi,kagi", E).ok, true);
});
test("parseTrigger: 出错时返回中文说明", () => {
  assert.equal(parseTrigger("https://kagi.com/search?q=x&_ss=kagi,nope", E).ok, false);
  assert.equal(parseTrigger("https://kagi.com/search?q=x&_ss=kagi", E).ok, false);
  assert.equal(parseTrigger("https://kagi.com/search?q=x&_ss=wiki,google", withWiki).ok, false); // 左侧不能作左
  const m = parseTrigger("https://kagi.com/search?query=x&_ss=kagi,google", E);  // 模板已改、参数名对不上
  assert.equal(m.ok, false); assert.match(m.error, /重新复制/);
});
test("parseTrigger: 参数存在但值为空时 query 为空串", () => {
  assert.equal(parseTrigger("https://kagi.com/search?q=&_ss=kagi,google", E).query, "");
});
test("parseTrigger: _ss 格式不对（能被宽松的 DNR 正则命中）时返回错误", () => {
  for (const ss of ["kagi", "Kagi,google", "kagi,google,bing", ""]) assert.equal(parseTrigger(`https://kagi.com/search?q=x&_ss=${ss}`, E).ok, false, ss);
});
test("expandTemplate", () => {
  assert.equal(expandTemplate("https://www.google.com/search?q=%s", "a b&c"), "https://www.google.com/search?q=a%20b%26c");
  assert.equal(expandTemplate("https://www.google.com/search?q=%s", ""), "https://www.google.com/");
  assert.equal(expandTemplate("https://x.com/%s?q=%s", "a"), "https://x.com/a?q=a");
});
test("stripMarker 只删 _ss，其余原样保留", () => {
  assert.equal(stripMarker("https://kagi.com/search?q=a+b&_ss=kagi,google"), "https://kagi.com/search?q=a+b");
  assert.equal(stripMarker("https://kagi.com/search?_ss=kagi%2Cgoogle&q=a%20b&page=2"), "https://kagi.com/search?q=a%20b&page=2");
  assert.equal(stripMarker("https://x.com/s?q=a&_ss=x,y&r=1"), "https://x.com/s?q=a&r=1");
});
```

- [ ] **Step 2: 运行 `node --test test/trigger.test.js`**，预期失败。

- [ ] **Step 3: 实现 `src/lib/trigger.js`。** 解析时一律通过 `new URL(originalUrl).searchParams` 取值，不要手写拆分，`+` 和 `%2C` 会自动处理。错误文案：未知引擎写“未知引擎：<id>”；格式不对写“标记参数格式不对”；左侧不能作左写“<名称> 不能作为左侧引擎”；参数名对不上写“触发网址与当前模板不一致，请到设置页重新复制”。

- [ ] **Step 4: 运行测试**，预期 PASS。

- [ ] **Step 5: 提交**：`feat(lib): trigger url build and parse`。

---

### Task 4: `lib/rules.js`：DNR 规则构造

**Files:**
- Create: `src/lib/rules.js`
- Test: `test/rules.test.js`

**Interfaces:**
- Consumes：Task 2 的 `validateTemplate`、`Engine`。
- Produces:
  - `RULE_ID = 1`
  - `TRIGGER_REGEX: string`
  - `leftHosts(engines: Engine[]): string[]`：只取能作左侧的引擎，返回去重后的 hostname。
  - `buildRedirectRule(extensionId: string, hosts: string[]): object | null`：`hosts` 为空时返回 `null`。

- [ ] **Step 1: 写失败的测试。** 文件开头先写好 fixture 和导入：
```js
import { PRESETS } from "../src/lib/engines.js";
import { extractOriginalUrl } from "../src/lib/trigger.js";
const kagi = PRESETS.find(e => e.id === "kagi"), google = PRESETS.find(e => e.id === "google");
const wiki = { id: "wiki", name: "Wiki", url: "https://en.wikipedia.org/wiki/%s" };
```
```js
test("规则结构", () => {
  const r = buildRedirectRule("abcdefghijklmnopabcdefghijklmnop", ["kagi.com"]);
  assert.deepEqual(r.action, { type: "redirect", redirect: { regexSubstitution: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/go.html?u=\\0" } });
  assert.deepEqual(r.condition.resourceTypes, ["main_frame"]);
  assert.deepEqual(r.condition.requestDomains, ["kagi.com"]);
  assert.equal(r.condition.isUrlFilterCaseSensitive, true);
  assert.equal(r.id, 1);
  assert.equal(buildRedirectRule("x", []), null);
});
test("TRIGGER_REGEX 应命中与不应命中（用 JS RegExp 模拟，正则只用 RE2 兼容语法）", () => {
  const re = new RegExp(TRIGGER_REGEX);
  // 正则故意放宽：只要求出现 _ss 参数。格式校验交给 parseTrigger，这样格式错误时会进入 go.html 显示错误页（spec 5.2 / T7）
  for (const u of ["https://kagi.com/search?q=a&_ss=kagi,google", "https://kagi.com/search?_ss=kagi%2Cgoogle&q=a", "https://www.google.com/search?q=a+b&_ss=google,kagi&hl=en", "https://kagi.com/search?q=a&_ss=kagi"]) assert.ok(re.test(u), u);
  for (const u of ["https://kagi.com/search?q=a", "https://kagi.com/search?q=a&_SS=kagi,google", "https://kagi.com/search?q=a&x_ss=kagi,google", "https://kagi.com/search?q=a#&_ss=kagi,google"]) assert.ok(!re.test(u), u);
});
test("用 \\0 替换后能被 extractOriginalUrl 还原", () => {
  const u = "https://kagi.com/search?q=a+b&_ss=kagi,google";
  const out = u.replace(new RegExp(TRIGGER_REGEX), "chrome-extension://id/go.html?u=$&");
  assert.equal(extractOriginalUrl(new URL(out).search), u);
});
test("leftHosts 排除只能作右侧的引擎并去重", () => {
  assert.deepEqual(leftHosts([kagi, google, wiki, { ...kagi, id: "k2" }]), ["kagi.com", "www.google.com"]);
});
```

- [ ] **Step 2: 运行测试**，预期失败。

- [ ] **Step 3: 实现 `src/lib/rules.js`。** `TRIGGER_REGEX` 取 `^https?://[^#]*[?&]_ss=[^&#]*(&[^#]*)?$`，规则 `priority` 设为 1。

- [ ] **Step 4: 运行测试**，预期 PASS。

- [ ] **Step 5: 提交**：`feat(lib): dnr redirect rule builder`。

---

### Task 5: `lib/split-decision.js`：分屏动作判定

**Files:**
- Create: `src/lib/split-decision.js`
- Test: `test/split-decision.test.js`

**Interfaces:**
- Produces:
  - `decideSplit(input: { windowType: string, splitViewId: number, peer: { id: number, index: number, url?: string } | null, recordedPeerId: number | undefined, engineOrigins: string[] }): "new" | "reuse" | "foreign" | "other-window"`（`splitViewId` 为 `-1` 表示不在分屏中）
  - `sideOf(tabIndex: number, peerIndex: number): "left" | "right"`：分支为 reuse 时用它决定当前标签在哪一侧，保证左右位置不变。

- [ ] **Step 1: 写失败的测试。**
```js
const base = { windowType: "normal", splitViewId: 7, peer: { id: 2, index: 5, url: "https://www.google.com/search?q=x" }, recordedPeerId: undefined, engineOrigins: ["https://kagi.com", "https://www.google.com"] };
test("sideOf", () => { assert.equal(sideOf(4, 5), "left"); assert.equal(sideOf(6, 5), "right"); });
test("非 normal 窗口", () => assert.equal(decideSplit({ ...base, windowType: "popup" }), "other-window"));
test("不在分屏中", () => assert.equal(decideSplit({ ...base, splitViewId: -1, peer: null }), "new"));
test("会话里有记录：即使已跨 origin 跳转也算本扩展分屏", () =>
  assert.equal(decideSplit({ ...base, recordedPeerId: 2, peer: { id: 2, url: "https://consent.google.com/" } }), "reuse"));
test("无记录但 origin 属于已配置引擎", () => assert.equal(decideSplit(base), "reuse"));
test("url 读不到时宁可当作其他分屏", () => assert.equal(decideSplit({ ...base, peer: { id: 2 } }), "foreign"));
test("origin 不是已配置引擎", () => assert.equal(decideSplit({ ...base, peer: { id: 2, url: "https://docs.foo.com/" } }), "foreign"));
test("在分屏中却找不到另一侧", () => assert.equal(decideSplit({ ...base, peer: null }), "foreign"));
test("记录的 peer 已不是当前的另一侧", () => assert.equal(decideSplit({ ...base, recordedPeerId: 99, peer: { id: 2 } }), "foreign"));
```

- [ ] **Step 2: 运行测试**，预期失败。
- [ ] **Step 3: 实现**，判定顺序与测试顺序一致。
- [ ] **Step 4: 运行测试**，预期 PASS。
- [ ] **Step 5: 提交**：`feat(lib): split action decision`。

---

### Task 6: `chrome/config-store.js` 与 background 规则重建

**Files:**
- Create: `src/chrome/config-store.js`
- Modify: `src/background.js`
- Test: `test/config-store.test.js`

**Interfaces:**
- Consumes：`mergeConfig`（Task 2）、`buildRedirectRule`、`leftHosts`、`RULE_ID`（Task 4）。
- Produces:
  - `loadRaw(area = chrome.storage.sync): Promise<object>`：返回 `area.get(null)` 的原始存储。设置页基于它修改，再整键写回。
  - `loadConfig(area = chrome.storage.sync): Promise<{ engines: Engine[], hidden: Engine[], defaultPair: [string, string] }>`：返回 `mergeConfig(await loadRaw(area))`。
  - `saveKeys(patch: object, area = chrome.storage.sync): Promise<void>`：只写 `patch` 中出现的顶层键，不做“读-改-写”。写入前对每个键检查 `new TextEncoder().encode(key + JSON.stringify(value)).length <= 8192`，超出时抛出 `Error("配置过大，无法保存：<key>")`，不调用 `set`。
  - `rebuildRules(): Promise<void>`：只在 background.js 内部使用，不导出。

- [ ] **Step 1: 写失败的测试。** 用一个假的 area 对象（`get`/`set` 读写内存对象）验证以下几点：
  - 存储为空时，`loadConfig` 返回 5 个预置引擎；
  - `saveKeys({ order: ["ddg"] })` 之后，`loadConfig` 返回的第一个引擎是 `ddg`，且 `set` 只收到 `{ order: [...] }` 这一个键；
  - 对一个约 9000 字节的 `customEngines` 调用 `saveKeys`，会以 `/配置过大/` 为错误信息 reject，并且 `set` 没有被调用；
  - `loadRaw` 原样返回存储中的 `presetOverrides`。

- [ ] **Step 2: 运行测试**，预期失败。

- [ ] **Step 3: 实现 `src/chrome/config-store.js`。** 默认参数要写成 `area = globalThis.chrome?.storage.sync`，否则 node 环境里没有 `chrome` 时一引用就报错。

- [ ] **Step 4: 运行测试**，预期 PASS。

- [ ] **Step 5: 修改 `src/background.js`。**
  - `rebuildRules()` 执行 `chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID], addRules: rule ? [rule] : [] })`，其中 `rule = buildRedirectRule(chrome.runtime.id, leftHosts((await loadConfig()).engines))`。
  - 调用要串行：用模块级的 `let chain = Promise.resolve()`，每次执行 `chain = chain.then(doRebuild, doRebuild)`，确保最后一次执行读到的是最新配置，避免旧配置后写入覆盖新配置。
  - 在顶层注册以下监听，触发时都调用 `rebuildRules()`：`runtime.onInstalled`（`reason === "install"` 时额外调用 `openOptionsPage()`）、`runtime.onStartup`、`storage.onChanged`（只处理 `area === "sync"`）、`permissions.onAdded`、`permissions.onRemoved`。
  - 保留 `action.onClicked`。
  - 每次 `rebuildRules()` 都包一层 try/catch，出错时只 `console.error`。

- [ ] **Step 6: 手动验证。** 运行 `bash scripts/sync-to-windows.sh`，在 Chrome 里点“重新加载”，打开扩展 SW 的 DevTools，执行 `await chrome.declarativeNetRequest.getDynamicRules()`。预期：只有 1 条规则，`requestDomains` 包含 `kagi.com`、`www.google.com`、`www.bing.com`、`duckduckgo.com`、`www.perplexity.ai`，`regexSubstitution` 里是静态扩展 ID。

- [ ] **Step 7: 提交**：`feat: config store and dynamic rule rebuild`。

---

### Task 7: `go.html` / `go.js`：触发处理与分屏编排

**Files:**
- Create: `src/go.html`、`src/go.js`

**Interfaces:**
- Consumes：`extractOriginalUrl`、`parseTrigger`、`expandTemplate`、`stripMarker`（Task 3）、`decideSplit`、`sideOf`（Task 5）、`loadConfig`（Task 6）、`engineOrigin`（Task 2）。
- 内部 helper（定义在 go.js，或在 Step 3 中拆到 `src/chrome/split-actions.js`）：`createPaired(url: string, withTab: { id: number, index: number, windowId: number }): Promise<Tab>`。它先尝试 `tabs.create({ url, splitWithTabId: withTab.id, index: withTab.index + 1, windowId: withTab.windowId, active: false })`；如果抛错，就去掉 `splitWithTabId` 在相同位置重新创建，并 `console.error`。所有分支都用它来创建右侧标签。
- Produces：会话记录写入 `chrome.storage.session`，键为 `split:<tabId>`，值为对侧 tabId（数字）。一次写两个键，两个方向各一条，不做“读-改-写”。

- [ ] **Step 1: 编写 `src/go.html`。** 页面正文显示“正在打开分屏…”。预留一个默认隐藏的错误区和一个默认隐藏的“重新执行”按钮，通过 `<script type="module" src="go.js">` 引入脚本。样式内联，并适配深色模式。

- [ ] **Step 2: 实现 `src/go.js`，按 spec §4.2 的步骤顺序执行。**
  1. 先检查 `performance.getEntriesByType("navigation")[0]?.type`。如果是 `back_forward` 或 `reload`，就显示“重新执行”按钮，点击后跑一遍主流程，并就此停止。
  2. 主流程：
     - `extractOriginalUrl(location.search)` 取得原始网址，再用 `parseTrigger` 解析。失败时在错误区显示错误文案和一个“打开设置”按钮（调用 `chrome.runtime.openOptionsPage()`），然后停止。
     - 计算网址：
       - `leftUrl`：关键词非空时为 `stripMarker(original)`，即保留原始网址的其他参数；关键词为空时为 `expandTemplate(left.url, "")`。
       - `rightUrl`：`expandTemplate(right.url, query)`。
     - 获取当前标签：`tab = await chrome.tabs.getCurrent()`；获取窗口：`win = await chrome.windows.get(tab.windowId)`。
     - 如果 `tab.splitViewId !== -1`，用 `chrome.tabs.query({ splitViewId })` 找出另一侧标签 `peer`。
     - 从 `chrome.storage.session.get("split:" + tab.id)` 读出之前记录的对侧 id。
     - 调用 `decideSplit(...)`。
  3. 按判定结果分支（所有 `chrome.*` 调用都要包在 try/catch 里，任何失败都至少保证执行 `location.replace(leftUrl)`）：
     - `new`：用 `createPaired(rightUrl, tab)` 创建右侧，记录对应关系，然后 `location.replace(leftUrl)`。
     - `reuse`：用 `sideOf(tab.index, peer.index)` 判断当前标签在哪一侧。在左侧时，执行 `tabs.update(peer.id, { url: rightUrl })`，再 `location.replace(leftUrl)`；在右侧时，执行 `tabs.update(peer.id, { url: leftUrl })`，再 `location.replace(rightUrl)`。两种情况都要记录对应关系。
     - `foreign`：
       1. 用 `tabs.query({ splitViewId })` 求出分屏两个标签中最大的 index；
       2. 在它后面执行 `tabs.create({ url: leftUrl, index: maxIndex + 1, windowId, active: true })`，作为新的左侧；
       3. 执行 `createPaired(rightUrl, 新左侧)` 创建右侧，并记录这一对；
       4. 如果 `history.length > 1`，执行 `history.back()`；否则执行 `tabs.remove(tab.id)`，抛错时保留本页。
     - `other-window`：
       1. 在 try 里用 `chrome.windows.getLastFocused({ windowTypes: ["normal"] })` 找普通窗口。找不到时它会 reject，所以 catch 分支里改用 `chrome.windows.create({ type: "normal", url: leftUrl })` 新建窗口，把 `win.tabs[0]` 作为新的左侧；
       2. 如果找到了已有窗口，就在其中 `tabs.create({ url: leftUrl, windowId, active: true })` 作为新的左侧；
       3. 两种情况都执行 `createPaired(rightUrl, 新左侧)`，并记录这一对；
       4. 最后当前标签执行 `location.replace(leftUrl)`。
  4. 失败只用 `console.error("[split-search]", ...)` 记录，不写日志存储。

- [ ] **Step 3: 确认文件不超过 300 行**：`wc -l src/go.js` 输出 ≤ 300。超出时，把四个分支抽到 `src/chrome/split-actions.js`，导出 `openNew`、`reuse`、`openForeign`、`openInOtherWindow`。

- [ ] **Step 4: `npm test` 全部 PASS**，确认 lib 层没有被改坏。

- [ ] **Step 5: 手动验证。** 先运行 `bash scripts/sync-to-windows.sh`，再重新加载扩展。
  - 未授权时：在地址栏访问 `https://kagi.com/search?q=test&_ss=kagi,google`，预期是普通的 Kagi 搜索（T8 降级）。
  - 授权：打开设置占位页，在该页的 DevTools 控制台执行 `await chrome.permissions.request({ origins: ["https://kagi.com/*", "https://www.google.com/*"] })`。控制台求值算作用户手势；SW 的 DevTools 不行。
  - 授权后重复访问上面的网址：预期左 Kagi、右 Google 分屏；点后退不会再次触发分屏（T10 的一部分）。
  - 拖拽文字到右侧标签上：左右位置保持不变（T5）。
  - 把 `_ss` 改成 `kagi` 再访问：显示错误页（T7）。

- [ ] **Step 6: 提交**：`feat: go page split orchestration`。

---

### Task 8: 设置页

**Files:**
- Modify: `src/options/options.html`、`src/options/options.js`、`src/options/options.css`
- 必要时新建 `src/options/guide.js`（引导和生成器），保证每个 JS 文件不超过 300 行。

**Interfaces:**
- Consumes：`loadRaw`、`loadConfig`、`saveKeys`（Task 6）；`validateTemplate`、`engineOrigin`、`PRESETS`、`ID_PATTERN`、`isIdTaken`（Task 2）；`buildTriggerTemplate`（Task 3）。
- 写入规则：先 `loadRaw()` 读出原始存储，修改对应的整键（`presetOverrides`、`customEngines`、`order`、`defaultPair`）后再 `saveKeys`。`saveKeys` 抛出的错误要用中文显示在页面上。

- [ ] **Step 1: 引擎列表。**
  - 每行显示：名称、id、模板、“可作左侧”或“仅右侧”标记、授权状态（每次渲染时调用 `chrome.permissions.contains({ origins: [engineOrigin(e) + "/*"] })`）、“授权”按钮（调用 `chrome.permissions.request`）、上移/下移按钮、编辑、隐藏（预置引擎）或删除（自定义引擎）。
  - 默认组合正在引用的引擎，隐藏和删除按钮禁用。被隐藏的预置引擎（`hidden`）单独列出，提供“恢复”按钮。
  - 删除或隐藏引擎时提示：如果 Chrome 里有以它为左侧的网站搜索，请一并删除，否则那条网站搜索会退化为普通搜索。
  - 编辑引擎时，id 只读。修改模板后提示：“以该引擎为左侧的网站搜索网址需要重新复制”。如果这个引擎是默认组合的左侧，而新模板 `canBeLeft === false`，拒绝保存，并说明原因。
  - 保存引擎后，如果它的 origin 尚未授权，就在这一行突出显示“授权”按钮。
  - `leftDiscouraged` 为真的引擎，显示“建议仅作右侧”的提示。
  - 新增引擎时，id 必须符合 `ID_PATTERN`，并且 `isIdTaken` 为 false；模板用 `validateTemplate` 校验，失败时把 `error` 显示在表单旁边。
  - 排序操作防抖 500ms 后，调用 `saveKeys({ order })`。
  - 写回存储时：预置引擎的改动写入 `presetOverrides`，自定义引擎写入 `customEngines`。

- [ ] **Step 2: 默认组合。** 左侧下拉框只列出可作左侧的引擎，右侧下拉框列出全部引擎。保存时调用 `saveKeys({ defaultPair })`。如果左侧引擎还没授权，显示醒目提示并附“授权”按钮。

- [ ] **Step 3: 首次安装授权横幅。** 只要默认组合的左侧未授权，页面顶部就显示“点此授权 <左侧名称>（必需）和 <右侧名称>（建议）”。点击后在同一个手势里调用一次 `permissions.request`，同时申请两个 origin。

- [ ] **Step 4: 组合生成器与引导。**
  - 选好左右引擎后，显示 `buildTriggerTemplate(...)` 生成的触发网址，旁边放“复制”按钮（`navigator.clipboard.writeText`）。
  - 默认组合单独列出一条，并提示“设为默认”。
  - 写出分步引导：打开 `chrome://settings/searchEngines`（这个地址不能用链接打开，只能提示用户复制），在“网站搜索”里点“添加”，名称随意，快捷字词自定，网址粘贴上面的触发网址，保存后在该条目的 ⋮ 菜单里选“设为默认”。
  - 写出注意事项：
    - 以下情况会降级成普通的左侧搜索：其他设备、无痕窗口、扩展被停用、撤销授权、引擎站点自己的 Service Worker 接管了导航；
    - 地址栏不再有搜索联想；
    - 右键菜单“在 X 中搜索”同样会分屏；
    - 授权不会跨设备同步，每台设备都要单独授权。

- [ ] **Step 5: 页面监听** `storage.onChanged`、`permissions.onAdded` 和 `permissions.onRemoved`，任一触发时重新渲染。

- [ ] **Step 6: `npm test` 全部 PASS**；`wc -l src/options/*.js` 每个文件都不超过 300 行。

- [ ] **Step 7: 手动验证。**
  1. 在 `chrome://extensions` 移除扩展后重新加载（只有这一次允许移除，用来模拟首次安装）。预期自动打开设置页，并显示授权横幅。
  2. 点击授权，两个 origin 都应变为已授权。
  3. 新增百度 `https://www.baidu.com/s?wd=%s` 并授权，生成 `baidu,kagi` 的触发网址并复制。
  4. 在 Chrome 设置里添加网站搜索 `bk`，用 `bk 测试` 触发，预期打开百度 ｜ Kagi 分屏。

- [ ] **Step 8: 提交**：`feat: options page with engines, permissions and setup guide`。

---

### Task 9: v0.1 验收

**Files:**
- Create: `docs/acceptance-v0.1.md`

- [ ] **Step 1: 逐项执行 spec §7 的 T1–T15**，每项记录“期望 / 实际 / 通过与否 / 备注”，写入 `docs/acceptance-v0.1.md`。
  - T5 要加测“拖到右侧标签上”。
  - T8 的“站点访问改为点击时”：如果扩展详情页没有这个选项，就记为“不适用”并说明原因。
  - T12 记录地址栏联想是否保留。如果保留，把“编辑自动发现的条目”的做法加进设置页引导，单独提交一次。
  - T14 如果发现某个预置引擎的 Service Worker 让 DNR 失效，就给它设上 `leftDiscouraged: true`，单独提交一次。

- [ ] **Step 2: 处理验收中发现的缺陷。** 能写成 node 测试的，先补失败的测试再修；只能手测的，修完后重测对应的 T 项。

- [ ] **Step 3: 最终检查。**
  - `npm test` 全部 PASS。
  - 检查 manifest 权限与 Global Constraints 一致（`test/manifest.test.js` 已覆盖）。
  - `grep -rn "chrome\." src/lib` 无输出。
  - `find src -name '*.js' -exec wc -l {} +` 中每个文件都不超过 300 行。

- [ ] **Step 4: 提交**：`docs: v0.1 acceptance results`，并打标签 `git tag v0.1.0`。
