import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "../scripts/e2e/server.mjs";
import { GRANT_ORIGINS, HOSTS, UNGRANTED_HOSTS, mockEngineU, mockImageEngine } from "../scripts/e2e/config.mjs";
import { popupStateOf } from "../scripts/e2e/steps/v03-popup.mjs";
import { MENU_INDEX, MENU_MIN_ITEMS } from "../scripts/e2e/steps/v04-lib.mjs";
import { settleMenu, MENU_SETTLE_MS } from "../scripts/e2e/steps/v04-lookup-lib.mjs";
import { guardProblems, guardTabs } from "../scripts/e2e/steps/v04-guard.mjs";

test("UNGRANTED_HOSTS 不进 HOSTS，也不进 GRANT_ORIGINS（一次性授权不覆盖它们）", () => {
  assert.deepEqual(UNGRANTED_HOSTS, { u: "engine-u.localhost", page: "page-u.localhost", img: "engine-i.localhost" });
  const granted = GRANT_ORIGINS(8765);
  for (const h of Object.values(UNGRANTED_HOSTS)) {
    assert.ok(!Object.values(HOSTS).includes(h), `${h} 不应在 HOSTS 里`);
    assert.ok(!granted.some(o => o.includes(h)), `${h} 不应在 GRANT_ORIGINS 里`);
  }
});

test("mockEngineU / mockImageEngine 的形状", () => {
  assert.deepEqual(mockEngineU(8765), { id: "eu", name: "模拟引擎 U", url: "http://engine-u.localhost:8765/search?q=%s" });
  assert.deepEqual(mockImageEngine(8765), { id: "ei", name: "模拟以图搜图", url: "http://engine-i.localhost:8765/imgsearch?url=%s" });
});

// 端口 0：系统分配；fetch 不允许覆盖 Host，改用 http.request
async function withServer(fn) {
  const srv = await startServer({ port: 0 });
  const get = (path, host) => new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: srv.port, path, headers: { Host: `${host}:${srv.port}` } }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
  try { return await fn({ srv, get }); } finally { await srv.close(); }
}

test("page-u：/article 带两段文字、http 图片与 data: 图片；/img.png 是 PNG", () => withServer(async ({ srv, get }) => {
  const r = await get("/article", UNGRANTED_HOSTS.page);
  assert.equal(r.status, 200);
  const html = r.body.toString("utf8");
  assert.match(html, /id="p1"/);
  assert.match(html, /id="p2"/);
  assert.match(html, /id="http-img"/);
  assert.ok(html.includes(`src="http://page-u.localhost:${srv.port}/img.png"`), "http 图片指向 page-u 自己的 /img.png");
  assert.match(html, /id="data-img"[^>]*src="data:image\/png;base64,/);
  const img = await get("/img.png", UNGRANTED_HOSTS.page);
  assert.equal(img.status, 200);
  assert.equal(img.type, "image/png");
  assert.deepEqual([...img.body.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}));

test("engine-i：/imgsearch 回显收到的 url 参数", () => withServer(async ({ get }) => {
  const r = await get("/imgsearch?url=http%3A%2F%2Fa%2Fb.png", UNGRANTED_HOSTS.img);
  assert.equal(r.status, 200);
  const html = r.body.toString("utf8");
  assert.match(html, /<p id="got">http:\/\/a\/b\.png<\/p>/);
}));

test("engine-u：/search?q=hi 是模拟引擎 U 的结果页", () => withServer(async ({ get }) => {
  const r = await get("/search?q=hi", UNGRANTED_HOSTS.u);
  assert.equal(r.status, 200);
  assert.equal(r.body.toString("utf8").match(/<title>(.*?)<\/title>/s)[1], "U · hi");
}));

// 页面里读出的快照（POPUP_SNAPSHOT 的形状）
const snap = (over = {}) => ({
  loading: false,
  pair: { hidden: true }, notOurs: { hidden: true, text: "" }, complete: { hidden: true },
  query: "", left: "", right: "", choices: [],
  detected: "", completeChoices: [],
  note: { hidden: true, text: "" }, error: { hidden: true, text: "" },
  ...over,
});

test("popupStateOf：loading 或三块都隐藏时返回 null", () => {
  assert.equal(popupStateOf(snap({ loading: true, notOurs: { hidden: false, text: "x" } })), null);
  assert.equal(popupStateOf(snap()), null);
  assert.equal(popupStateOf(null), null);
});

test("popupStateOf：#complete 可见时返回 complete、detected、completeChoices 与建议项", () => {
  const s = popupStateOf(snap({
    complete: { hidden: false },
    detected: "识别到 模拟引擎 U 搜索：hello",
    completeChoices: [{ engine: "eb", disabled: false, suggested: true }, { engine: "ea", disabled: false, suggested: false }],
  }));
  assert.equal(s.complete, true);
  assert.equal(s.ours, false);
  assert.equal(s.notOurs, false);
  assert.equal(s.detected, "识别到 模拟引擎 U 搜索：hello");
  assert.deepEqual(s.completeChoices, ["eb", "ea"]);
  assert.equal(s.suggested, "eb");
  assert.equal(s.busy, false);
  const busy = popupStateOf(snap({ complete: { hidden: false }, completeChoices: [{ engine: "ea", disabled: true, suggested: false }] }));
  assert.equal(busy.busy, true, "补成分屏的按钮禁用中也算 busy");
  assert.equal(busy.suggested, null);
  // 补成之后弹窗换成对视图：#complete 隐藏了，里面留着的禁用按钮不算 busy
  const after = popupStateOf(snap({ pair: { hidden: false }, choices: [{ engine: "eb", disabled: false }],
    completeChoices: [{ engine: "ea", disabled: true, suggested: false }] }));
  assert.equal(after.busy, false);
});

test("popupStateOf：对视图与说明文字保持 v0.3 的字段；提示与错误照读", () => {
  const pair = popupStateOf(snap({
    pair: { hidden: false }, query: "q", left: "模拟引擎 A", right: "模拟引擎 B",
    choices: [{ engine: "ec", disabled: false }], note: { hidden: false, text: "窄" }, error: { hidden: false, text: "错" },
  }));
  assert.deepEqual({ ours: pair.ours, notOurs: pair.notOurs, complete: pair.complete, query: pair.query, left: pair.left, right: pair.right },
    { ours: true, notOurs: false, complete: false, query: "q", left: "模拟引擎 A", right: "模拟引擎 B" });
  assert.deepEqual(pair.choices, ["ec"]);
  assert.equal(pair.note, "窄");
  assert.equal(pair.error, "错");
  const not = popupStateOf(snap({ notOurs: { hidden: false, text: "不是" } }));
  assert.deepEqual({ ours: not.ours, notOurs: not.notOurs, notOursText: not.notOursText, note: not.note, error: not.error },
    { ours: false, notOurs: true, notOursText: "不是", note: "", error: "" });
});

test("MENU_INDEX / MENU_MIN_ITEMS：整数；行号从末尾数（负数），落在最少项数以内（只防写错，行号对不对由 T21/T22 以效果判定）", () => {
  for (const k of ["text", "image"]) {
    assert.ok(Number.isInteger(MENU_INDEX[k]) && MENU_INDEX[k] < 0, `MENU_INDEX.${k} 从末尾数`);
    assert.ok(Number.isInteger(MENU_MIN_ITEMS[k]), `MENU_MIN_ITEMS.${k}`);
    assert.ok(MENU_INDEX[k] < MENU_MIN_ITEMS[k] && -MENU_INDEX[k] <= MENU_MIN_ITEMS[k], `MENU_INDEX.${k} 落在 MENU_MIN_ITEMS.${k} 行以内`);
  }
  assert.deepEqual(Object.keys(MENU_INDEX).sort(), ["image", "text"]);
  assert.deepEqual(Object.keys(MENU_MIN_ITEMS).sort(), ["image", "text"]);
});

// 假的数行函数：依次返回 seq，log 记下等待与数行的先后
function fakeCounts(seq) {
  const log = [];
  let i = 0;
  return {
    log,
    count: async () => { const n = seq[Math.min(i++, seq.length - 1)]; log.push(`count ${n}`); return n; },
    wait: async ms => { log.push(`wait ${ms}`); },
  };
}

test("settleMenu：先等 MENU_SETTLE_MS 再数；撞上重建空档（少一行）时再等再数，直到行数等于 expected", async () => {
  const f = fakeCounts([6, 7]);
  assert.ok(MENU_SETTLE_MS > 0);
  assert.equal(await settleMenu(f.count, 7, { wait: f.wait }), 7);
  assert.deepEqual(f.log, [`wait ${MENU_SETTLE_MS}`, "count 6", `wait ${MENU_SETTLE_MS}`, "count 7"]);
});

test("settleMenu：一直数不到 expected 时数满 tries 次，返回最后一次的行数（由调用方判定）", async () => {
  const f = fakeCounts([6]);
  assert.equal(await settleMenu(f.count, 7, { tries: 3, wait: f.wait }), 6);
  assert.equal(f.log.filter(x => x.startsWith("count")).length, 3);
});

test("settleMenu：expected 为 null 时等到连续两次行数相同", async () => {
  const f = fakeCounts([6, 7, 7]);
  assert.equal(await settleMenu(f.count, null, { wait: f.wait }), 7);
  assert.deepEqual(f.log.filter(x => x.startsWith("count")), ["count 6", "count 7", "count 7"]);
});

// guardProblems：两份 { tabId: { url, mark } } 快照（mark 是页面里读回的标记，读不到为 null）
test("guardProblems：网址与标记都没变 → 空数组", () => {
  const snap = { 5: { url: "http://page-u.localhost:8765/article?n=1", mark: "ss-a" }, 6: { url: "http://engine-b.localhost:8765/search?q=x", mark: "ss-b" } };
  assert.deepEqual(guardProblems(snap, structuredClone(snap)), []);
});

test("guardProblems：网址相同、标记丢了 → 报“被重载”", () => {
  const before = { 5: { url: "http://page-u.localhost:8765/article?n=1", mark: "ss-a" } };
  const p = guardProblems(before, { 5: { url: before[5].url, mark: null } });
  assert.equal(p.length, 1);
  assert.match(p[0], /标签 5/);
  assert.match(p[0], /被重载/);
  assert.doesNotMatch(p[0], /被导航/);
});

test("guardProblems：网址变了 → 报“被导航”，写出前后网址", () => {
  const before = { 5: { url: "http://page-u.localhost:8765/article?n=1", mark: "ss-a" }, 6: { url: "http://site-x.localhost:8765/a", mark: "ss-b" } };
  const p = guardProblems(before, { 5: { url: "http://engine-b.localhost:8765/search?q=x", mark: null }, 6: before[6] });
  assert.equal(p.length, 1);
  assert.match(p[0], /标签 5 被导航/);
  assert.ok(p[0].includes(before[5].url) && p[0].includes("http://engine-b.localhost:8765/search?q=x"));
});

test("guardProblems：标签不见了也报出来；每个被改的标签各一条", () => {
  const before = { 5: { url: "http://a/", mark: "m5" }, 6: { url: "http://b/", mark: "m6" }, 7: { url: "http://c/", mark: "m7" } };
  const p = guardProblems(before, { 5: { url: "http://a/", mark: "other" }, 6: { url: "http://b2/", mark: "m6" } });
  assert.equal(p.length, 3);
  assert.match(p.find(x => x.includes("标签 5")), /被重载/);
  assert.match(p.find(x => x.includes("标签 6")), /被导航/);
  assert.match(p.find(x => x.includes("标签 7")), /不见了/);
});

// guardTabs 的替身：页面里的 __ssMark 存在 marks；readFails 里的目标读回时抛错
function guardCtx({ readFails = [] } = {}) {
  const marks = {};
  const sids = {};
  let n = 0;
  return {
    marks,
    browser: {
      attach: async (targetId) => { const sid = `s${n++}`; sids[sid] = targetId; return sid; },
      evaluate: async (sid, expr) => {
        const target = sids[sid];
        const set = /^\(globalThis\.__ssMark = "([^"]+)"\)$/.exec(expr);
        if (set) { marks[target] = set[1]; return set[1]; }
        if (readFails.includes(target)) throw new Error("Runtime.evaluate 超时");
        return marks[target] ?? null;
      },
      client: { send: async (m) => (m === "Target.getTargets"
        ? { targetInfos: [{ targetId: "TA", url: "http://a/" }, { targetId: "TB", url: "http://b/" }] } : {}) },
    },
  };
}

test("guardTabs：快照里的标记就是 markPage 写进去的值", async () => {
  const ctx = guardCtx();
  const snap = await guardTabs(ctx, [{ id: 5, targetId: "TA" }, { id: 6, targetId: "TB" }]);
  assert.deepEqual(Object.keys(snap), ["5", "6"]);
  assert.equal(snap[5].url, "http://a/");
  assert.equal(snap[5].mark, ctx.marks.TA);
  assert.match(snap[6].mark, /^ss-/);
});

test("guardTabs：标记读回失败（或对不上）判 env，不留下 mark 为 null 的快照", async () => {
  const ctx = guardCtx({ readFails: ["TB"] });
  await assert.rejects(guardTabs(ctx, [{ id: 5, targetId: "TA" }, { id: 6, targetId: "TB" }]),
    e => e.kind === "env" && /标签 6/.test(e.message));
});


test("popupStateOf：分屏外的 #idle 与默认组合、底部快捷键；旧快照没有这些字段时给空值", () => {
  const s = popupStateOf(snap({ notOurs: { hidden: false, text: "不是" }, idle: { hidden: false, text: "试试" },
    idlePair: ["模拟引擎 A", "模拟引擎 B"], shortcut: { key: "Alt+Shift+Period", setButton: false } }));
  assert.equal(s.idle, true);
  assert.equal(s.idleText, "试试");
  assert.deepEqual(s.idlePair, ["模拟引擎 A", "模拟引擎 B"]);
  assert.deepEqual(s.shortcut, { key: "Alt+Shift+Period", setButton: false });
  const old = popupStateOf(snap({ notOurs: { hidden: false, text: "不是" } }));
  assert.equal(old.idle, false);
  assert.deepEqual(old.idlePair, []);
  assert.deepEqual(old.shortcut, { key: "", setButton: false });
});

test("popupStateOf：分屏外 setup 档（说明文字隐藏、只显示 #idle）也算渲染完成，带出档位、显示的块与页脚", () => {
  const s = popupStateOf(snap({ idle: { hidden: false, text: "" }, idleTier: "setup", idleShown: ["idle-setup"], footer: false }));
  assert.equal(s.notOurs, false);
  assert.equal(s.idle, true);
  assert.equal(s.idleTier, "setup");
  assert.deepEqual(s.idleShown, ["idle-setup"]);
  assert.equal(s.footer, false);
  // 没有这些字段的旧快照：档位 null，页脚按显示处理
  const old = popupStateOf(snap({ notOurs: { hidden: false, text: "x" } }));
  assert.equal(old.idleTier, null);
  assert.deepEqual(old.idleShown, []);
  assert.equal(old.footer, true);
});

test("B19 substepProblems：第 2 步依次是设置地址、触发网址（各一个复制按钮）、设为默认（没有复制框）", async () => {
  const { substepProblems } = await import("../scripts/e2e/steps/b19.mjs");
  const ok = [{ buttons: 1, box: "chrome://settings/searchEngines" }, { buttons: 1, box: "http://engine-a.localhost:8765/search?q=%s&_ss=ea,eb" }, { buttons: 0, box: "" }];
  assert.deepEqual(substepProblems(ok), []);
  assert.equal(substepProblems(ok.slice(0, 2)).length, 1);
  assert.equal(substepProblems(null).length, 1);
  assert.equal(substepProblems([ok[1], ok[0], ok[2]]).length, 2, "顺序反了（先触发网址）两步都报");
  assert.equal(substepProblems([ok[0], { ...ok[1], buttons: 2 }, ok[2]]).length, 1);
  assert.equal(substepProblems([ok[0], ok[1], { buttons: 1, box: "x" }]).length, 1);
});
