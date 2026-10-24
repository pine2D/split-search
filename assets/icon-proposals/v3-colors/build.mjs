// 方案 3 配色变体生成器：node assets/icon-proposals/v3-colors/build.mjs
// 形状、白色搜索框横条、16/32 像素对齐版和 96×96 安全区全部沿用方案 3（../build.mjs），只换配色；
// 唯一例外：128 母版里两条次级横线的不透明度由 .6 提到 .72，让 48px 下在浅格上也看得清（16/32px 版没有这两条线）。
// 每套配色写出 icon.svg / icon-16.svg / icon-32.svg / icon-16|32|48|128.png / notes.md，再渲染 compare.html → compare.png。
// 无 npm 依赖；需要 /opt/google/chrome/google-chrome（或 CHROME 环境变量）和 ImageMagick convert。
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { solve, contrast, LIGHT, DARK } from './palette.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/opt/google/chrome/google-chrome';
const PROFILE = process.env.ICON_PROFILE || join(tmpdir(), 'split-search-icon-profile');

// 深格目标亮度 Y=0.155、浅格 Y=0.25：两者对浅/深工具栏都约 3.1:1 以上，白色横条在两格上都 ≥3.4:1。
const Y_DEEP = 0.155, Y_LIGHT = 0.25;
// 128 母版次级横线的白色不透明度（方案 3 原为 .6）
const SUB_ALPHA = 0.72;
const blend = (hex, a) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - a) + 255 * a)
  .toString(16).padStart(2, '0')).join('');
const P = (n, slug, title, caption, deep, light, extra) => ({
  n, slug, title, caption, extra,
  deep: { name: deep[0], hex: solve(deep[1], deep[2], Y_DEEP), C: deep[1], h: deep[2] },
  light: { name: light[0], hex: solve(light[1], light[2], Y_LIGHT), C: light[1], h: light[2] },
});

// deep / light：[中文色名, OKLCH 彩度 C, 色相 h]
const palettes = [
  P(1, 'tonal-blue', '同色系蓝', '一深一浅两档灰蓝，最安静、最像系统图标',
    ['深灰蓝', 0.07, 250], ['浅灰蓝', 0.05, 245],
    '两格同色相（只差约 5°），只靠明度区分，是六套里两格差别最小的一套（两格之间约 1.47:1，主要靠中间 2px 透明缝分开）。c1、c4、c5 都属于灰蓝色系，c1 可以看作“全蓝”的一端，挑选时可以把这三套放在一起比较。'),
  P(2, 'slate-sage', '石板蓝 + 鼠尾草绿', '冷灰蓝配灰绿，冷暖轻微对比，柔和',
    ['石板蓝', 0.035, 255], ['鼠尾草绿', 0.045, 145],
    '蓝绿色相相差约 110°，16px 下除明度外还有色相差，比方案 c1 更容易分清两格。'),
  P(3, 'teal-sand', '灰青 + 沙石色', '灰青配暖沙色，一冷一暖，两格最容易分清',
    ['灰青', 0.05, 200], ['沙石色', 0.04, 92],
    '一冷一暖，色相差最大。灰青彩度压在 0.05，和 Bing 的高饱和青绿拉开距离。沙石色是六套里唯一的暖色：色相放在 92°（偏橄榄/卡其），离原方案 3 的橙色（约 39°）有 50° 以上，彩度只有 0.04，看起来是灰卡其色而不是橙色；如果仍嫌偏暖，可以换 c2 或 c6。'),
  P(4, 'graphite-steel', '石墨灰 + 钢青蓝', '中性灰配偏青的钢蓝，偏工具感、最克制',
    ['石墨灰', 0.008, 260], ['钢青蓝', 0.055, 220],
    '为了对深色工具栏也有 3:1，“石墨灰”只能停在中灰，比真正的石墨浅；左格几乎无彩，右格带一点偏青的蓝。右格色相放在 220°（比 c1 的浅灰蓝偏青约 25°），避免和 c1 右格撞色；c1、c4、c5 同属灰蓝色系。'),
  P(5, 'navy-mist', '暗海军蓝 + 雾灰', '灰调海军蓝配雾灰，稳重、偏商务',
    ['暗海军蓝', 0.07, 262], ['雾灰', 0.012, 250],
    '真正的深海军蓝（亮度 ~0.05）对深色工具栏 #202124 只有约 1.5:1，所以这里提亮成“灰调海军蓝”；雾灰也只能停在中灰（更浅的话白色横条会看不见）。左格和 c1 左格（深灰蓝）比较接近，区别主要在右格：c5 右格几乎无彩。c1、c4、c5 同属灰蓝色系。'),
  P(6, 'pine-fog', '松针绿 + 暖雾灰', '我的推荐：低饱和松绿配暖灰，自然、不撞任何搜索引擎品牌色',
    ['松针绿', 0.05, 165], ['暖雾灰', 0.012, 85],
    '松针绿偏蓝的绿，彩度低，不会让人联想到 Google 绿或 Bing 青绿；暖雾灰几乎无彩，左格有色、右格中性，两格靠色相和明度一起区分。'),
];
for (const p of palettes) {
  for (const k of ['deep', 'light']) {
    const c = p[k];
    c.onLight = contrast(c.hex, LIGHT); c.onDark = contrast(c.hex, DARK); c.white = contrast(c.hex, '#FFFFFF');
    if (c.onLight < 3 || c.onDark < 3 || c.white < 3) throw new Error(`${p.slug} ${k} ${c.hex} 对比度不足`);
  }
  p.between = contrast(p.deep.hex, p.light.hex);
  // 次级横线 = 白色以 SUB_ALPHA 叠在窗格上（与浏览器一样在 sRGB 伽马空间混合）
  for (const k of ['deep', 'light']) p[k].sub = contrast(blend(p[k].hex, SUB_ALPHA), p[k].hex);
}

// ---------- 形状：逐字沿用 ../build.mjs 的方案 3 ----------
function rr(x, y, w, h, r) {
  const [a, b, c, d] = Array.isArray(r) ? r : [r, r, r, r];
  return `M${x + a} ${y}H${x + w - b}${b ? `A${b} ${b} 0 0 1 ${x + w} ${y + b}` : ''}V${y + h - c}` +
    `${c ? `A${c} ${c} 0 0 1 ${x + w - c} ${y + h}` : ''}H${x + d}${d ? `A${d} ${d} 0 0 1 ${x} ${y + h - d}` : ''}` +
    `V${y + a}${a ? `A${a} ${a} 0 0 1 ${x + a} ${y}` : ''}Z`;
}
const svg = (size, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>\n`;
const s128 = (A, B) => {
  const ui = (x) => `<rect x="${x}" y="38" width="29" height="9" rx="4.5" fill="#fff"/><rect x="${x}" y="56" width="23" height="5" rx="2.5" fill="#fff" opacity="${SUB_ALPHA}"/><rect x="${x}" y="68" width="17" height="5" rx="2.5" fill="#fff" opacity="${SUB_ALPHA}"/>`;
  return svg(128, `<path fill="${A}" d="${rr(16, 26, 45, 76, [18, 6, 6, 18])}"/><path fill="${B}" d="${rr(67, 26, 45, 76, [6, 18, 18, 6])}"/>${ui(24)}${ui(75)}`);
};
const s32 = (A, B) => svg(32, `<path fill="${A}" d="${rr(2, 5, 13, 22, [5, 1.5, 1.5, 5])}"/><path fill="${B}" d="${rr(17, 5, 13, 22, [1.5, 5, 5, 1.5])}"/>` +
  `<rect x="5" y="9" width="7" height="2" rx="1" fill="#fff"/><rect x="20" y="9" width="7" height="2" rx="1" fill="#fff"/>`);
const s16 = (A, B) => svg(16, `<path fill="${A}" d="${rr(1, 2, 6, 12, [2.5, 0.5, 0.5, 2.5])}"/><path fill="${B}" d="${rr(9, 2, 6, 12, [0.5, 2.5, 2.5, 0.5])}"/>` +
  `<rect x="2" y="4" width="4" height="1" fill="#fff"/><rect x="10" y="4" width="4" height="1" fill="#fff"/>`);

function shot(file, out, w, h) {
  execFileSync(CHROME, ['--headless=new', `--user-data-dir=${PROFILE}`, '--disable-sync', '--no-first-run', '--disable-gpu',
    '--force-device-scale-factor=1', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${w},${h}`, `--screenshot=${out}`, `file://${file}`], { stdio: 'ignore' });
}
const wrap = (src, size) => `<!doctype html><html><body style="margin:0;background:transparent">` +
  `<img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`;

const f2 = (x) => x.toFixed(2);
const notes = (p) => `# c${p.n}：${p.title}

${p.caption}。形状沿用方案 3（两块实心圆角窗格 + 白色搜索框横条），只换配色。

| 窗格 | 色名 | HEX | OKLCH 彩度 / 色相 | 对浅色工具栏 #f1f3f4 | 对深色工具栏 #202124 | 白色横条对窗格 |
|---|---|---|---|---|---|---|
| 左 | ${p.deep.name} | \`${p.deep.hex}\` | ${p.deep.C} / ${p.deep.h}° | ${f2(p.deep.onLight)}:1 | ${f2(p.deep.onDark)}:1 | ${f2(p.deep.white)}:1 |
| 右 | ${p.light.name} | \`${p.light.hex}\` | ${p.light.C} / ${p.light.h}° | ${f2(p.light.onLight)}:1 | ${f2(p.light.onDark)}:1 | ${f2(p.light.white)}:1 |

- 两格之间的亮度对比：${f2(p.between)}:1（另有 2px 透明缝隔开；16px 下两格各 6×12 像素）。
- 两格对浅、深两种工具栏都 ≥3:1（非文本图形门槛），所以 16/32px 不需要额外描边。
- 128 母版里两条次级横线是 ${Math.round(SUB_ALPHA * 100)}% 白（方案 3 原为 60%），对窗格：左 ${f2(p.deep.sub)}:1、右 ${f2(p.light.sub)}:1。它们是装饰线，只出现在 48/128px；16/32px 版没有。
- 饱和度：OKLCH 彩度 ≤0.07（原方案 3 的紫 #6A5CFF 约 0.23、橙 #E0561F 约 0.18）。
- ${p.extra}

为什么两格都是中等明度：要同时对 #f1f3f4 和 #202124 达到 3:1，窗格的相对亮度只能落在 0.146–0.265 之间；再浅，白色横条和浅色工具栏都会看不清，再深，在深色工具栏上会糊成一块。所以“深/浅”两档只能拉开约 1.5 倍亮度，区分更多靠色相差（c1 两格同色相，除外）和中间的透明缝。

文件：\`icon.svg\` 是 128×128 母版（图形在中央 96×96，四周 16px 透明留白），48 和 128 由它渲染；\`icon-32.svg\`、\`icon-16.svg\` 是按像素网格单独调整的小尺寸版本。由 \`../build.mjs\`（即 v3-colors/build.mjs）生成，改色请改脚本后重跑。
`;

mkdirSync(PROFILE, { recursive: true });
for (const p of palettes) {
  const dir = join(HERE, `c${p.n}-${p.slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'icon.svg'), s128(p.deep.hex, p.light.hex));
  writeFileSync(join(dir, 'icon-32.svg'), s32(p.deep.hex, p.light.hex));
  writeFileSync(join(dir, 'icon-16.svg'), s16(p.deep.hex, p.light.hex));
  writeFileSync(join(dir, 'notes.md'), notes(p));
  const tmp = join(dir, '.render.html');
  for (const [size, src] of [[128, 'icon.svg'], [48, 'icon.svg'], [32, 'icon-32.svg'], [16, 'icon-16.svg']]) {
    writeFileSync(tmp, wrap(src, size));
    shot(tmp, join(dir, `icon-${size}.png`), size, size);
  }
  rmSync(tmp);
}

// ---------- 对比图 ----------
const ref = {
  n: 0, dir: '../v3-two-tint', title: '原方案 3（饱和度过高，仅对照）', caption: '紫 + 橙，用户已否决配色，只保留形状',
  deep: { name: '紫', hex: '#6A5CFF' }, light: { name: '橙', hex: '#E0561F' },
};
for (const k of ['deep', 'light']) {
  ref[k].onLight = contrast(ref[k].hex, LIGHT); ref[k].onDark = contrast(ref[k].hex, DARK);
}
const rows = [ref, ...palettes.map((p) => ({ ...p, dir: `c${p.n}-${p.slug}` }))];

const splitMock = (c) => `<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M8 3.5V12.5" stroke="${c}" stroke-width="1.5"/></svg>`;
const puzzleMock = (c) => `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="${c}" d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/></svg>`;
const sizesCell = (r, bg, fg) => `<div class="sizes" style="background:${bg};color:${fg}">` +
  [128, 48, 32, 16].map((s) => `<figure><img src="${r.dir}/icon-${s}.png" width="${s}" height="${s}"><figcaption>${s}</figcaption></figure>`).join('') + '</div>';
const toolbar = (r, bg, fg, omni) => `<div class="tb" style="background:${bg}"><div class="omni" style="background:${omni}"></div>` +
  `<span class="btn">${splitMock(fg)}</span><span class="btn"><img src="${r.dir}/icon-16.png" width="16" height="16"></span><span class="btn">${puzzleMock(fg)}</span></div>`;
const swatch = (c) => `<div class="sw"><i style="background:${c.hex}"></i><div><b>${c.hex}</b> ${c.name}<br><span>浅 ${f2(c.onLight)} · 深 ${f2(c.onDark)}</span></div></div>`;
const label = (r) => r.n
  ? `<div class="label"><div><b>c${r.n}</b><span class="t">${r.title}</span></div><div class="c">${r.caption}</div></div>`
  : `<div class="label ref"><div><b>3</b><span class="t">${r.title}</span></div><div class="c">${r.caption}</div></div>`;

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>方案 3 配色变体</title><style>
*{box-sizing:border-box}body{margin:0;padding:28px 32px;background:#fff;font-family:"Sarasa UI SC","Source Han Sans SC",sans-serif;color:#202124;width:1460px}
h1{font-size:22px;margin:0 0 4px}p.sub{margin:0 0 18px;color:#5f6368;font-size:13px;line-height:1.6}
.head,.row{display:grid;grid-template-columns:190px 300px 300px 220px 70px 250px;gap:14px;align-items:center}
.head{font-size:12px;color:#5f6368;padding:0 0 6px;border-bottom:1px solid #dadce0}
.row{padding:12px 0;border-bottom:1px solid #e8eaed}.row.refrow{border-bottom:2px solid #dadce0}.label.ref .t{color:#80868b}
.label b{display:inline-block;min-width:30px;height:26px;padding:0 6px;border-radius:13px;background:#202124;color:#fff;text-align:center;line-height:26px;font-size:13px;margin-right:8px}
.label.ref b{background:#9aa0a6}
.label .t{font-size:15px;font-weight:600}.label .c{font-size:12px;color:#5f6368;margin-top:6px;line-height:1.5}
.sizes{display:flex;align-items:flex-end;gap:14px;padding:12px 14px;border-radius:10px;height:172px}
.sizes figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}
.sizes figcaption{font-size:10px;opacity:.6}.sizes img{display:block}
.tbs{display:flex;flex-direction:column;gap:10px}
.tb{display:flex;align-items:center;gap:4px;height:40px;padding:0 8px;border-radius:8px}
.omni{flex:1;height:28px;border-radius:14px;margin-right:6px}
.btn{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:14px}
.btn svg,.btn img{display:block}
.zoom{image-rendering:pixelated;border:1px solid #dadce0;background:repeating-conic-gradient(#f1f3f4 0 25%,#fff 0 50%) 0 0/8px 8px}
.sws{display:flex;flex-direction:column;gap:10px}
.sw{display:flex;gap:10px;align-items:center;font-size:12px;line-height:1.45}
.sw i{width:40px;height:40px;border-radius:8px;flex:none}.sw b{font-family:ui-monospace,"Sarasa Mono SC",monospace;font-size:13px}
.sw span{color:#5f6368;font-size:11px}.btw{font-size:11px;color:#5f6368}
</style></head><body>
<h1>方案 3 配色变体（低到中饱和，无紫无橙）</h1>
<p class="sub">形状、白色搜索框横条、16/32 像素对齐和 96×96 安全区不变，只换配色。每行依次为：浅色工具栏 #f1f3f4 / 深色工具栏 #202124 下的 128、48、32、16 px；1x 工具栏示意（左：Chrome 原生分屏按钮，中：本扩展 16px，右：扩展菜单）；16px 放大 4 倍；色值与对比度（“浅/深”= 对两种工具栏的对比度，均 ≥3:1）。<br>两格要同时对浅、深工具栏达到 3:1，亮度只能落在中间一段，所以每套都是“中深 + 中浅”，两格间约 ${f2(Math.min(...palettes.map((p) => p.between)))}–${f2(Math.max(...palettes.map((p) => p.between)))}:1，靠色相差（c1 除外）和 2px 透明缝区分。c1、c4、c5 同属灰蓝色系，c3 的沙石色是唯一的暖色（偏卡其，非橙）。</p>
<div class="head"><span>配色</span><span>浅色背景 #f1f3f4</span><span>深色背景 #202124</span><span>工具栏 16px 实际比例</span><span>16px ×4</span><span>色值（左格 / 右格）</span></div>
${rows.map((r) => `<div class="row${r.n ? '' : ' refrow'}">${label(r)}` +
  sizesCell(r, LIGHT, '#202124') + sizesCell(r, DARK, '#e8eaed') +
  `<div class="tbs">${toolbar(r, LIGHT, '#474747', '#ffffff')}${toolbar(r, DARK, '#c7c7c7', '#3c3c3c')}</div>` +
  `<img class="zoom" src="${r.dir}/icon-16.png" width="64" height="64">` +
  `<div class="sws">${swatch(r.deep)}${swatch(r.light)}${r.n ? `<div class="btw">两格之间 ${f2(r.between)}:1</div>` : ''}</div></div>`).join('\n')}
</body></html>
`;
writeFileSync(join(HERE, 'compare.html'), html);
shot(join(HERE, 'compare.html'), join(HERE, 'compare.png'), 1460, 1700);
execFileSync('convert', [join(HERE, 'compare.png'), '-trim', '+repage', '-bordercolor', '#ffffff', '-border', '28', join(HERE, 'compare.png')]);
for (const p of palettes) console.log(`c${p.n}-${p.slug}`, p.deep.hex, p.light.hex, f2(p.between));
