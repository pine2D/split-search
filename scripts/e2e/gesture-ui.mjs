// 真实输入手势（二）：右键菜单选项、地址栏输入（gesture.mjs 是公共部分与拖拽）。
import { newFocusedWindow } from "./screen.mjs";
import { deps, readyMouse, idle, moveTo, moveToIn, gestureError, pidOf, REASON_BUSY } from "./gesture.mjs";

// 右键菜单截图：找菜单白色区域里的文字行（每个菜单项一行，分隔线不是深色不算）。返回各项中心 y（菜单窗口内）与文字区左边 x
export function menuRows(rgb, width, height, { dark = 300, minGap = 6 } = {}) {
  const rows = [];
  let left = width;
  for (let y = 0; y < height; y++) {
    let hit = false;
    for (let x = 0; x < Math.floor(width * 0.6); x++) {
      const i = (y * width + x) * 3;
      const s = rgb[i] + rgb[i + 1] + rgb[i + 2];
      // 深色文字：在白底上（左右 6px 外是亮的），排除菜单外的黑色透明阴影
      if (s < dark && x > 6 && rgb[i - 18] + rgb[i - 17] + rgb[i - 16] > 600) { hit = true; left = Math.min(left, x); break; }
    }
    if (hit) rows.push(y);
  }
  const bands = [];
  for (const y of rows) {
    const b = bands.at(-1);
    if (b && y - b[1] <= minGap) b[1] = y; else bands.push([y, y]);
  }
  return { centers: bands.map(([a, b]) => Math.round((a + b) / 2)), left };
}

const inRect = (r, x, y) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

// 关菜单：在页面里（测试窗口）左键点一下，点在所有菜单矩形以外（S11：菜单从右键点向右下展开，8 行高约 450–470 X 像素，
// 旧的 (at.x, at.y + 400) 正好落在菜单里，点完菜单没关掉、下一次右键不出菜单）。菜单的矩形读不到时按向右下展开估计。
// 按顺序试几个候选点，第一个落在测试窗口上的点一下；之后等这些菜单窗口消失（最多 1 秒）。只点左键，不发任何按键。
// 返回菜单是否都已关掉；不抛错（调用方多半已在出错路径上）
export async function dismissMenu(ctx, { at, wid, menus = [] }) {
  const { xi, sleep, nested } = deps(ctx);
  const pid = pidOf(ctx);
  const rects = [];
  for (const m of menus) { try { rects.push(await xi.windowRect(m)); } catch { /* 读不到就按向右下展开估计 */ } }
  const cands = [[at.x - 60, at.y], [at.x, at.y - 60], [at.x - 60, at.y - 60],
    ...rects.flatMap(r => [[r.x - 30, r.y + 10], [r.x + r.width + 30, r.y + 10]])];
  const outside = ([x, y]) => x >= 0 && y >= 0 && !rects.some(r => inRect(r, x, y)) && !(x >= at.x && y >= at.y && !rects.length);
  for (const [x, y] of cands.filter(outside)) {
    try {
      await moveToIn(xi, x, y, wid, "关闭菜单的位置", { pid, nested });
      await xi.click(1, { expectWindow: wid });
      break;
    } catch { /* 换下一个候选点 */ }
  }
  const end = Date.now() + 1000;
  for (;;) {
    let left;
    try { left = new Set(await xi.pidWindows(pid)); } catch { return false; }
    if (!menus.some(m => left.has(m))) return true;
    if (Date.now() >= end) return false;
    await sleep(100);
  }
}

// 在 at（屏幕坐标）右键，等菜单窗口出现，截图按文字行数出各项。返回 { menu, r（菜单矩形）, centers, left }；
// 菜单认不出时先 dismissMenu 再抛错
async function openMenu(ctx, { at, wid, menuWaitMs }) {
  const { xi, sleep, root, nested } = deps(ctx);
  if (!wid) throw new Error("右键菜单手势需要事先取好的测试窗口 id");
  const home = await readyMouse(ctx, wid);
  const pid = pidOf(ctx);
  const before = new Set(await xi.pidWindows(pid));
  await moveToIn(xi, at.x, at.y, wid, "右键位置", { pid, root, home, nested });
  await xi.click(3, { expectWindow: wid });
  let menu = null;
  const end = Date.now() + menuWaitMs;
  while (!menu && Date.now() < end) {
    await sleep(150);
    const fresh = (await xi.pidWindows(pid)).filter(w => !before.has(w));
    if (fresh.length === 1) menu = fresh[0];
    else if (fresh.length > 1) { await dismissMenu(ctx, { at, wid, menus: fresh }); throw gestureError("env", `右键后出现了 ${fresh.length} 个新窗口，认不出菜单`); }
  }
  if (!menu) throw gestureError("fail", "右键后没有出现菜单");
  await sleep(250);
  try {
    const r = await xi.windowRect(menu);
    if (!(Number.isInteger(r.x) && Math.abs(r.x - at.x) < 80 && Math.abs(r.y - at.y) < 80)) throw gestureError("env", `菜单位置 ${r.x},${r.y} 离右键点 ${at.x},${at.y} 太远，不猜测`);
    const shot = await xi.captureRgb(menu, { width: r.width, height: r.height });
    return { menu, r, ...menuRows(shot, r.width, r.height) };
  } catch (e) {
    await dismissMenu(ctx, { at, wid, menus: [menu] });
    throw e;
  }
}

// 在 at（选区中心，屏幕坐标）右键，按文字行定位第 itemIndex 项（0 起算；负数从末尾数，-2 = 倒数第二项），悬停截图确认该行高亮后点击。
// expectItems：菜单至少要有的项数（结构不符判“环境不支持”）。不向菜单发送任何按键（F20）
export async function contextMenuPick(ctx, { at, itemIndex, expectItems, wid, menuWaitMs = 3000 }) {
  const { xi, sleep, nested } = deps(ctx);
  const { menu, r, centers, left } = await openMenu(ctx, { at, wid, menuWaitMs });
  try {
    const need = Math.max(expectItems ?? 0, itemIndex < 0 ? -itemIndex : itemIndex + 1);
    if (centers.length < need) throw gestureError("env", `菜单只认出 ${centers.length} 项，少于预期的 ${need}`);
    if (itemIndex < 0) itemIndex += centers.length;
    const y = r.y + centers[itemIndex], x = r.x + left + 40;
    const p = await moveTo(xi, x, y, { nested });
    if (p.window !== menu) throw gestureError("env", `指针不在菜单上（在窗口 ${p.window}，菜单可能已被关掉）`);
    await sleep(250);
    // 高亮核对：文字左侧留白处（不会有字），悬停项应比另一项暗
    const hx = left - 15;
    const px = async yy => { const b = await xi.captureRgb(menu, { width: 1, height: 1, x: hx, y: yy }); return b[0] + b[1] + b[2]; };
    const [lit, ref] = [await px(centers[itemIndex]), await px(centers[(itemIndex + 1) % centers.length])];
    if (!(lit + 15 < ref)) throw gestureError("env", `悬停后第 ${itemIndex + 1} 项没有高亮（${lit} / ${ref}），菜单结构可能不同`);
    await xi.click(1, { expectWindow: menu });
    return { menu, items: centers.length, x, y };
  } catch (e) {
    await dismissMenu(ctx, { at, wid, menus: [menu] });
    throw e;
  }
}

// 与 contextMenuPick 同样右键、认菜单，只数出项数，然后 dismissMenu 关掉菜单，不点任何项。
// 菜单没关掉判环境问题（留着的菜单会让下一次右键不出菜单）
export async function contextMenuCount(ctx, { at, wid, menuWaitMs = 3000 }) {
  const { menu, centers } = await openMenu(ctx, { at, wid, menuWaitMs });
  if (!(await dismissMenu(ctx, { at, wid, menus: [menu] }))) throw gestureError("env", `数完菜单项（${centers.length} 项）后菜单没关掉`);
  return centers.length;
}

// 地址栏：新开窗口拿前台（断言 getactivewindow；嵌套显示没有窗口管理器，用 getwindowfocus，焦点没过去就在新窗口页面中心点一下），Ctrl+L → 输入 ASCII → Delete（去掉行内自动补全）→ 回车 / Alt+回车。
// 每次按键前断言前台仍是这个窗口。设置页（后台窗口）会抢走前台，所以网站搜索要在调用本手势之前改好
// beforeEnter({ wid })：输完、按 Delete 之后、回车之前调用一次（T12 在这里截地址栏下拉框，只读屏幕、不发输入）
export async function omnibox(ctx, { text, altEnter = false, url, beforeEnter = null }) {
  const { xi, sleep, profileDir, nested } = deps(ctx);
  if ((await idle(xi, { sleep, ...ctx.gx.idleOpts })) === "busy") throw gestureError("skip", REASON_BUSY);
  let nf;
  try { nf = await newFocusedWindow(ctx.browser, url, { xi, profileDir, nested, ...ctx.gx.focusOpts }); }
  catch (e) {
    throw gestureError("env", `${e.message}${nested ? "（嵌套显示里新窗口没拿到焦点，键盘手势做不了，未按任何键）" : "（Windows 没把前台给新窗口，键盘手势做不了）"}`);
  }
  const { wid } = nf;
  try {
    await sleep(300);
    await xi.key("ctrl+l", { expectWindow: wid });
    await sleep(200);
    await xi.typeAscii(text, { expectWindow: wid });
    await sleep(150);
    await xi.key("Delete", { expectWindow: wid });
    if (beforeEnter) await beforeEnter({ wid });
    await xi.key(altEnter ? "alt+Return" : "Return", { expectWindow: wid });
  } catch (e) {
    await xi.releaseModifiers().catch(() => {});
    throw gestureError(/前台窗口/.test(e.message) ? "env" : "fail", e.message);
  }
  return nf;
}

// 在测试窗口的页面空白处左键点一下（不在标签栏、不在选区上）：实测窗口刚被设置页抢走前台后，第一次右键弹出的菜单会立刻关掉，
// 先点一下页面再右键就稳定。点完会清掉页面选区，调用方之后再建选区
export async function primeClick(ctx, at, wid) {
  const { xi, root, nested } = deps(ctx);
  const home = await readyMouse(ctx, wid);
  await moveToIn(xi, at.x, at.y, wid, "页面空白处", { pid: pidOf(ctx), root, home, nested });
  await xi.click(1, { expectWindow: wid });
  await deps(ctx).sleep(300);
}
