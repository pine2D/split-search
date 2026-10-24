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

// 在 at（选区中心，屏幕坐标）右键，等菜单窗口出现，按文字行定位第 itemIndex 项，悬停截图确认该行高亮后点击。
// expectItems：菜单至少要有的项数（结构不符判“环境不支持”）
export async function contextMenuPick(ctx, { at, itemIndex, expectItems, wid, menuWaitMs = 3000 }) {
  const { xi, sleep, root, nested } = deps(ctx);
  if (!wid) throw new Error("contextMenuPick 需要事先取好的测试窗口 id");
  const home = await readyMouse(ctx, wid);
  const pid = pidOf(ctx);
  const before = new Set(await xi.pidWindows(pid));
  await moveToIn(xi, at.x, at.y, wid, "右键位置", { pid, root, home, nested });
  await xi.click(3, { expectWindow: wid });
  const dismiss = async () => { // 在页面里（测试窗口）左键点一下关闭菜单
    await moveToIn(xi, at.x, at.y + 400, wid, "关闭菜单的位置", { pid, nested }).then(() => xi.click(1, { expectWindow: wid })).catch(() => {});
  };
  let menu = null;
  const end = Date.now() + menuWaitMs;
  while (!menu && Date.now() < end) {
    await sleep(150);
    const fresh = (await xi.pidWindows(pid)).filter(w => !before.has(w));
    if (fresh.length === 1) menu = fresh[0];
    else if (fresh.length > 1) { await dismiss(); throw gestureError("env", `右键后出现了 ${fresh.length} 个新窗口，认不出菜单`); }
  }
  if (!menu) throw gestureError("fail", "右键后没有出现菜单");
  await sleep(250);
  try {
    const r = await xi.windowRect(menu);
    if (!(Number.isInteger(r.x) && Math.abs(r.x - at.x) < 80 && Math.abs(r.y - at.y) < 80)) throw gestureError("env", `菜单位置 ${r.x},${r.y} 离右键点 ${at.x},${at.y} 太远，不猜测`);
    const shot = await xi.captureRgb(menu, { width: r.width, height: r.height });
    const { centers, left } = menuRows(shot, r.width, r.height);
    if (centers.length < Math.max(expectItems ?? 0, itemIndex + 1)) throw gestureError("env", `菜单只认出 ${centers.length} 项，少于预期的 ${expectItems}`);
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
    await dismiss();
    throw e;
  }
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
