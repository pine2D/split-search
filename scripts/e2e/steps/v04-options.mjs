// v0.4 自动步骤 B18（spec 3.11、3.14“其他”第 1 条）：设置页“右键查询”卡片。
// 渲染（没有显示成 key 的文字、没有授权按钮）；查词引擎下拉框写入与删除 lookupEngine；从以图搜图引擎库添加
// Bing Visual Search 后出现在下拉框里；删除选中的以图搜图引擎后回到 Lens；手动新增的模板校验。
// 开始时删掉三个键，从缺省状态测起；guarded 写回步骤前的值。
import { withOptions, guarded, readKeys } from "./optpage.mjs";
import { summarize } from "./util.mjs";
import { sub, verdict } from "./v03-lib.mjs";
import { mockEngines, mockImageEngine } from "../config.mjs";
import { IMAGE_CATALOG, IMAGE_PRESET } from "../../../src/lib/image-engines.js";
import { msg } from "../i18n.mjs";

const J = JSON.stringify;
const KEYS = ["lookupEngine", "imageEngine", "imageEngines"];
const BING = IMAGE_CATALOG.find(e => e.id === "bing-img");

// 卡片的当前状态（页面里读）
const CARD = `
  const card = document.querySelector("#lookup-body .lookup-card");
  if (!card) return null;
  const keyLike = /^[a-z]+_[a-z0-9_]+$/;
  const opts = id => [...document.querySelectorAll("#" + id + " option")].map(o => ({ value: o.value, text: o.textContent, selected: o.selected }));
  const raw = [...card.querySelectorAll("[data-i18n], option")].map(el => el.textContent.trim())
    .filter(x => keyLike.test(x));
  const d = card.querySelector("details.disclosure");
  const notes = d && { open: d.open, items: d.querySelectorAll("li").length, title: d.querySelector("summary").textContent.trim() };
  const il = card.querySelector("ul.engine-list");
  const imageUi = { title: card.querySelector("#image-list-title")?.textContent ?? null, labelledby: il?.getAttribute("aria-labelledby") ?? null,
    catalogBtn: card.querySelector("#image-catalog-open")?.textContent.trim() ?? null, addBtn: card.querySelector("#image-add-open")?.textContent.trim() ?? null };
  return { imageUi, notes, intro: card.querySelector(".hint")?.textContent ?? "", raw,
    lookup: opts("lookup-engine"), lookupValue: document.getElementById("lookup-engine").value,
    image: opts("image-engine"), imageValue: document.getElementById("image-engine").value,
    rows: [...card.querySelectorAll(".engine-row")].map(r => r.dataset.id),
    urls: Object.fromEntries([...card.querySelectorAll(".engine-row")].map(r => [r.dataset.id, r.querySelector(".engine-url")?.textContent ?? null])),
    idTags: card.querySelectorAll(".engine-row .engine-id").length,
    grant: card.querySelectorAll(".perm, [data-i18n^='engine_grant'], [data-i18n^='engine_not_granted']").length };`;
const card = page => page.until(`return (() => { ${CARD} })()`, 8000);

const setSelect = (page, id, value) => page.run(`
  const s = document.getElementById(${J(id)}); s.value = ${J(value)}; s.dispatchEvent(new Event("change")); return true;`);

// 等存储里 keys 满足 pred
async function storageUntil(ctx, pred, what, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const got = await readKeys(ctx.ext, KEYS);
    if (pred(got)) return got;
    if (Date.now() >= end) throw new Error(`没有等到存储：${what}（实际 ${J(got)}）`);
    await new Promise(r => setTimeout(r, 150));
  }
}

const render = (ctx, page) => sub("(a) 渲染：说明、跟随默认组合右侧、Lens；没有原样 key，没有授权按钮", async () => {
  const c = await card(page);
  const rightName = mockEngines(ctx.port).find(e => e.id === "eb").name;
  const p = [];
  const u = c.imageUi;
  if (u.title !== msg("options_image_list_title")) p.push(`以图搜图列表小标题应为“${msg("options_image_list_title")}”，实际“${u.title}”`);
  if (u.labelledby !== "image-list-title") p.push(`以图搜图列表 aria-labelledby 应为 image-list-title，实际 ${J(u.labelledby)}`);
  if (u.catalogBtn !== msg("options_image_add_catalog")) p.push(`引擎库按钮应为“${msg("options_image_add_catalog")}”，实际“${u.catalogBtn}”`);
  if (u.addBtn !== msg("options_image_add_custom")) p.push(`新增按钮应为“${msg("options_image_add_custom")}”，实际“${u.addBtn}”`);
  if (c.intro !== msg("options_lookup_intro")) p.push(`说明应为“${msg("options_lookup_intro")}”，实际“${c.intro}”`);
  if (!c.notes) p.push("卡片里没有收起的说明（details）");
  else {
    if (c.notes.open) p.push("说明应默认收起，实际是展开的");
    if (c.notes.items !== 3) p.push(`说明应有 3 条（两条图片限制加隐私说明），实际 ${c.notes.items} 条`);
    if (c.notes.title !== msg("options_lookup_notes_title")) p.push(`说明标题应为“${msg("options_lookup_notes_title")}”，实际“${c.notes.title}”`);
  }
  if (c.raw.length) p.push(`显示成 key 的文字：${c.raw.join("、")}`);
  const follow = c.lookup[0];
  if (follow?.value !== "" || follow.text !== msg("options_lookup_follow", rightName) || c.lookupValue !== "") {
    p.push(`查词引擎第一项应是选中的“${msg("options_lookup_follow", rightName)}”，实际 ${J(follow)}、当前值 ${J(c.lookupValue)}`);
  }
  if (c.imageValue !== IMAGE_PRESET.id) p.push(`以图搜图引擎应是 ${IMAGE_PRESET.id}，实际 ${c.imageValue}`);
  if (c.grant) p.push(`卡片里有 ${c.grant} 个授权相关元素`);
  return verdict(p, `卡片已渲染：查词引擎 ${c.lookup.length} 项（第一项“${follow.text}”），以图搜图引擎 ${c.image.map(o => o.value).join(",")}`);
});

const lookup = (ctx, page) => sub("(b) 查词引擎下拉框：选模拟引擎 C 写入 lookupEngine，选回“跟随”删掉它", async () => {
  await setSelect(page, "lookup-engine", "ec");
  await storageUntil(ctx, s => s.lookupEngine === "ec", "lookupEngine 为 ec");
  const c1 = await page.until(`return (() => { ${CARD} })()?.lookupValue === "ec"`, 5000).then(() => card(page));
  await setSelect(page, "lookup-engine", "");
  await storageUntil(ctx, s => !("lookupEngine" in s), "删掉 lookupEngine");
  const c2 = await page.until(`return (() => { ${CARD} })()?.lookupValue === ""`, 5000).then(() => card(page));
  return verdict([], `选 ec 后存储 lookupEngine = ec、下拉框为 ${c1.lookupValue}；选回跟随后键已删除、下拉框为“${c2.lookup[0].text}”`);
});

const catalog = (ctx, page) => sub("(c) 从以图搜图引擎库添加 Bing Visual Search：出现在下拉框和列表里，没有授权按钮", async () => {
  await page.run(`document.getElementById("image-catalog-open").click(); return true;`);
  await page.until(`return document.getElementById("image-catalog-dialog").open
    && [...document.querySelectorAll("#image-catalog-body .catalog-row")].some(r => r.querySelector(".catalog-name").textContent === ${J(BING.name)})`);
  const clicked = await page.run(`
    const entry = [...document.querySelectorAll("#image-catalog-body .catalog-row")].find(r => r.querySelector(".catalog-name").textContent === ${J(BING.name)});
    const b = entry?.querySelector("button"); if (!b || b.disabled) return false; b.click(); return true;`);
  if (!clicked) return { status: "fail", detail: `引擎库里 ${BING.name} 的“添加”按钮找不到或已禁用` };
  const got = await storageUntil(ctx, s => s.imageEngines?.some(e => e.url === BING.url), `imageEngines 含 ${BING.url}`);
  const id = got.imageEngines.find(e => e.url === BING.url).id;
  const added = await page.until(`
    const b = [...document.querySelectorAll("#image-catalog-body .catalog-row")].find(r => r.querySelector(".catalog-name").textContent === ${J(BING.name)})?.querySelector("button");
    return b?.disabled && b.textContent === ${J(msg("catalog_added"))};`).catch(() => false);
  await page.run(`document.getElementById("image-catalog-close").click(); return true;`);
  const c = await page.until(`const c = (() => { ${CARD} })(); return c?.image.some(o => o.value === ${J(id)}) && c;`);
  const p = [];
  if (!added) p.push(`引擎库里 ${BING.name} 没有变成“${msg("catalog_added")}”`);
  if (!c.rows.includes(id)) p.push(`以图搜图引擎列表里没有 ${id}`);
  if (c.grant) p.push(`卡片里有 ${c.grant} 个授权相关元素`);
  // 行与引擎列表一致：不显示 id；内置 Lens 不显示网址，自定义的显示 origin
  if (c.idTags) p.push(`以图搜图引擎行不该显示 id，实际有 ${c.idTags} 个`);
  if (c.urls[IMAGE_PRESET.id] !== null) p.push(`内置 ${IMAGE_PRESET.id} 不该显示网址，实际“${c.urls[IMAGE_PRESET.id]}”`);
  const origin = new URL(BING.url.replace("%s", "x")).origin;
  if (c.urls[id] !== origin) p.push(`${id} 应显示 origin ${origin}，实际“${c.urls[id]}”`);
  return verdict(p, `添加后存储有 ${id}，下拉框 ${c.image.map(o => o.value).join(",")}，列表 ${c.rows.join(",")}（没有 id 标签，Lens 不显示网址，${id} 显示 ${origin}），没有授权按钮`);
});

const remove = (ctx, page) => sub("(d) 选用 Bing Visual Search 后删除它：imageEngine 键随之删除，回到 Lens", async () => {
  const id = (await readKeys(ctx.ext, KEYS)).imageEngines?.find(e => e.url === BING.url)?.id;
  if (!id) return { status: "skip", detail: "(c) 没有加上 Bing Visual Search" };
  const btnId = J(`remove-image-${id}`);
  // 选用会写 storage.sync，设置页随 onChanged 重渲染、按钮换成新建的（确认状态随之复原）。
  // 先给旧按钮打记号，等重渲染出新按钮、再稳住 500 ms，才开始两步删除，免得第一下点在要被换掉的按钮上
  await page.run(`const b = document.getElementById(${btnId}); if (b) b.__b18old = true; return true;`);
  await setSelect(page, "image-engine", id);
  await storageUntil(ctx, s => s.imageEngine === id, `imageEngine 为 ${id}`);
  await page.until(`const b = document.getElementById(${btnId}); return (() => { ${CARD} })()?.imageValue === ${J(id)} && b && !b.__b18old;`)
    .catch(() => { throw new Error(`选用 ${id} 后设置页没有重渲染出新的“删除”按钮`); });
  const settled = await page.run(`
    for (let b = document.getElementById(${btnId}), i = 0; i < 20; i++) {
      if (!b) return "gone";
      await sleep(500);
      const now = document.getElementById(${btnId}); if (now === b) return "stable"; b = now;
    }
    return "busy";`);
  if (settled === "gone") return { status: "fail", detail: `选用 ${id} 后列表里 ${id} 的“删除”按钮不见了` };
  if (settled !== "stable") return { status: "fail", detail: `选用 ${id} 后设置页 10 秒内一直在重渲染，“删除”按钮没有稳定下来` };
  // 两步删除：点一次只变成“确认删除？”，再点才删（两下点同一个按钮；中途重渲染时如实报出）
  const once = await page.run(`
    const b = document.getElementById(${btnId}); if (!b) return null; b.click(); await sleep(300);
    const now = document.getElementById(${btnId});
    return { text: b.textContent, still: !!now, same: now === b };`);
  if (!once) return { status: "fail", detail: `列表里 ${id} 的“删除”按钮找不到` };
  const early = [];
  if (once.text !== msg("engine_delete_confirm")) early.push(`点一次后按钮应为“${msg("engine_delete_confirm")}”，实际“${once.text}”`);
  if (!once.still) early.push("只点一次就删掉了");
  else if (!once.same) early.push("点一次后设置页重渲染了，“删除”按钮被换成新的（确认状态丢失）");
  await page.run(`document.getElementById(${btnId})?.click(); return true;`);
  const got = await storageUntil(ctx, s => !s.imageEngines?.some(e => e.id === id) && !("imageEngine" in s), `删掉 ${id} 和 imageEngine`);
  const c = await page.until(`const c = (() => { ${CARD} })(); return c && !c.rows.includes(${J(id)}) && c;`);
  const p = [...early];
  if (c.imageValue !== IMAGE_PRESET.id) p.push(`下拉框应回到 ${IMAGE_PRESET.id}，实际 ${c.imageValue}`);
  if (page.dialogs.length) p.push(`不该弹 JS 对话框，实际弹了 ${page.dialogs.length} 个`);
  return verdict(p, `选用 ${id} 后删除：存储 imageEngines ${J(got.imageEngines ?? [])}、没有 imageEngine 键，下拉框回到 ${c.imageValue}`);
});

// 填新增对话框并提交，返回 { open, name, url, form }（各字段的错误文字）
const submitImage = (page, name, url) => page.run(`
  const f = document.getElementById("image-form");
  f.elements.name.value = ${J(name)}; f.elements.url.value = ${J(url)};
  document.getElementById("image-save").click();
  await sleep(300);
  const err = n => { const el = f.querySelector('.field-error[data-for="' + n + '"]'); return el && !el.hidden ? el.textContent : ""; };
  return { open: document.getElementById("image-dialog").open, name: err("name"), url: err("url"), form: err("form") };`);

const custom = (ctx, page) => sub("(e) 手动新增：空名称与没有 %s 的模板被拦下、对话框不关；合法的模板加入列表", async () => {
  const before = J((await readKeys(ctx.ext, KEYS)).imageEngines ?? []);
  await page.run(`document.getElementById("image-add-open").click(); return true;`);
  await page.until(`return document.getElementById("image-dialog").open`);
  const bad = await submitImage(page, "", "https://img.example/noplaceholder");
  const p = [];
  if (!bad.open) p.push("非法输入提交后对话框关掉了");
  if (!bad.name) p.push("空名称没有提示");
  if (!bad.url) p.push("没有 %s 的模板没有提示");
  const mid = J((await readKeys(ctx.ext, KEYS)).imageEngines ?? []);
  if (mid !== before) p.push(`非法输入改动了存储：${mid}`);
  const eng = mockImageEngine(ctx.port);
  const ok = await submitImage(page, eng.name, eng.url);
  if (ok.open) p.push(`合法输入提交后对话框没关（${J(ok)}）`);
  const got = await storageUntil(ctx, s => s.imageEngines?.some(e => e.url === eng.url && e.name === eng.name), `imageEngines 含 ${eng.url}`).catch(e => { p.push(e.message); return null; });
  const id = got?.imageEngines.find(e => e.url === eng.url)?.id;
  if (id) await page.until(`return (() => { ${CARD} })()?.image.some(o => o.value === ${J(id)})`).catch(() => p.push(`下拉框里没有新增的 ${id}`));
  if (ok.open) await page.run(`document.getElementById("image-dialog").close(); return true;`).catch(() => {});
  return verdict(p, `非法输入：名称“${bad.name}”、模板“${bad.url}”，存储不变；合法输入加入 ${id}（${eng.url}）`);
});

const B18 = {
  id: "B18", title: "设置页“右键查询”卡片：渲染、查词引擎写入与删除、以图搜图引擎库添加与删除、手动新增的模板校验（自动判定）", kind: "auto", needs: [],
  run: ctx => guarded(ctx, KEYS, async () => {
    await ctx.ext.eval(`chrome.storage.sync.remove(${J(KEYS)}).then(() => true)`);
    return withOptions(ctx.browser, async page => summarize([
      await render(ctx, page), await lookup(ctx, page), await catalog(ctx, page), await remove(ctx, page), await custom(ctx, page),
    ]));
  }),
};

export const V04_OPTIONS_STEPS = [B18];
