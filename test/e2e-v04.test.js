import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer } from "../scripts/e2e/server.mjs";
import { GRANT_ORIGINS, HOSTS, UNGRANTED_HOSTS, mockEngineU, mockImageEngine } from "../scripts/e2e/config.mjs";
import { popupStateOf } from "../scripts/e2e/steps/v03-popup.mjs";
import { MENU_INDEX, MENU_MIN_ITEMS } from "../scripts/e2e/steps/v04-lib.mjs";

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
