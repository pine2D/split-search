# Search pair linked closing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加默认关闭、只针对本扩展原生搜索分屏的联动关闭设置。

**Architecture:** 后台签发 session 联动许可，单次标签快照形成同一 SW 实例的一次性关闭证据。跨上下文 Web Lock 保护配对动作；消费许可后发出关闭，不等待可能被 beforeunload 挂住的 Promise。

**Tech Stack:** Chrome MV3、原生 JavaScript、node:test、现有 CDP/Xvfb 验收设施，无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-01-close-search-pair-design.md`

## Global Constraints

- 默认 false，仅 search/search、mode split、有效 splitViewId、互指记录。
- 只增加 sync 布尔与 session 的 `linked:<splitViewId>` 标签 id 对；local 不变。
- 权限、公钥、minimum Chrome155、版本号不变；不读网址猜归属，不引入 keepalive。
- 生产 JS 每文件不超过300行；四语言用户文案写在 `_locales`；日志经 safe-error。
- 不 await 自动 tabs.remove；不在持锁时导航、等弹窗消息或用户确认。

## Review Focus

- 旧关闭任务与新 adjacent 配对交错：不得关掉新配对或删掉其记录（生命周期序列测试）。
- 用户取消 beforeunload：后续任务不阻塞，旧许可已消费，不自动重试（pending Promise 序列测试与浏览器探针）。
- 开关关闭后保存完成：本地不再发出新的关闭；旧事件不因重新开启而复活（偏好修订号测试）。
- 用户把标签移动到其他窗口/手动重拼：撤销旧许可，不从网址恢复（真实浏览器移动与单测）。
- SW 被终止或 session 失败：缺证据不关闭，残留记录不能升级为关闭权（冷启动/错误注入测试）。

---

### Task 1: 实现并验证完整的联动关闭逻辑单元

**Files:**
- Create: `src/lib/close-pair.js`, `src/chrome/close-pair.js`, `src/chrome/close-store.js`, `src/chrome/pair-lock.js`
- Modify: `src/background.js`, `src/go.js`, `src/popup/popup.js`, `src/chrome/config-store.js`, `src/lib/engines.js`, `src/options/pair.js`, `src/options/edits.js`
- Modify: four `_locales/*/messages.json`, four README files, `CLAUDE.md`, `docs/_config.yml`
- Test: `test/close-pair.test.js`, `test/close-lifecycle.test.js`, `test/pair-lock.test.js`, existing config/options/background tests
- Create: focused e2e step(s), `docs/acceptance-close-pair.md`

**Interfaces:**
- Consumes: `parseRecord`, `recordKey`, `serialQueue`, existing paired actions and `swQueue`.
- Produces: `withPairLock(fn, options?)` (exclusive, optional required lock / waiting abort), pure `searchPair(id, records)` and close evidence/record guards; `installClosePair(queue)` registers lifecycle handlers once; strict `closePairTogether` config and setting.

- [x] **Step 1: Verify native event prerequisites**

Run disposable module SW probe with real Ctrl+W (left/right, warm/cold) and dynamic onUpdated registration across stopAllWorkers.
Expected: two -1 updates before onRemoved in one worker; snapshot contains only survivor; disabled listener does not wake, enabled listener does. Record any different result and adjust conservative guards before implementation.

- [x] **Step 2: Write failing pure/config/lock tests**

Assert literal false default, only exact true enabled; reject adjacent/lookup/manual/mismatched pairs; one side evidence insufficient; both-alive cancels; no-close on unknown snapshot; pending remove does not hold lock.
Run: `node --test test/close-pair.test.js test/pair-lock.test.js test/config-store.test.js test/options-edits.test.js`
Expected: new behaviors fail against baseline (missing implementation).

- [x] **Step 3: Implement pure guards, lock and configuration**

Use immutable pair identities (split id + both tab ids), no URL or query copies in close state. Implement lock without nested acquisition and make absence of required lock fail closed.
Repeat Step 2 command. Expected: PASS.

- [x] **Step 4: Write failing lifecycle sequence tests**

Drive real module handlers with a stateful Chrome API boundary double: direct close removes only peer once; disband/re-pair/lookup/adjacent/window close do not; remove forever pending leaves queue usable; failed session consumption prevents remove; off/on cancels old evidence; fresh pairing while close waits is preserved; moved targets are not closed. Assert effects on tabs and stored relationships, not private source text.
Run: `node --test test/close-lifecycle.test.js`
Expected: FAIL before lifecycle implementation.

- [x] **Step 5: Implement lifecycle and wire action boundaries**

Register top-level listeners, issue snapshots before awaits, queue processing and permission issuance, consume before dispatch. Wrap current read/decide/mutate entrypoints in the same lock. Store local setting writes under that lock and re-read preference before close.
Run: `node --test test/close-lifecycle.test.js test/background.test.js test/split-actions.test.js test/right-switch.test.js test/lookup-actions.test.js test/complete-actions.test.js test/options-actions.test.js`
Expected: PASS including old behavior.

- [x] **Step 6: Add setting, four-language copy and browser acceptance**

Use existing label/description/switch layout, default off, clear warning beside control. Exercise toggle, persistence, locale switching, narrow viewport, native close and exclusions in isolated browser. Update four READMEs and project storage/lifecycle conventions.
Run relevant `npm run e2e -- --auto-only --only ...` plus disposable native/browser tests.
Expected: required steps PASS; external-engine skips and Windows/Chrome155 gaps explicitly recorded.

- [x] **Step 7: Review, verify and commit**

Run `npm test` with host permissions for localhost test services; check `git diff --check`, production JS line limits, manifest unchanged. One fresh whole-feature reviewer checks this spec and Review Focus; address substantive findings with regression tests. Review actual/staged diff and make one focused local Conventional Commit through git-commit skill. Do not push, merge or release.
Expected: full suite PASS, reviewer findings resolved or reported, only task files committed, clean feature branch.
