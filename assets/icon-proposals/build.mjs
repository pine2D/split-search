// 图标提案生成器：node assets/icon-proposals/build.mjs
// 为每个方案写出 icon.svg（128 母版，图形落在中央 96×96）以及 16/32 像素对齐版 SVG，
// 再用无头 Chrome 渲染 icon-16/32/48/128.png，最后渲染对比图 compare.png。
// 无 npm 依赖；需要 /opt/google/chrome/google-chrome（或 CHROME 环境变量）。
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/opt/google/chrome/google-chrome';
const PROFILE = process.env.ICON_PROFILE || join(tmpdir(), 'split-search-icon-profile');

const IRIS = '#6A5CFF';   // 主色：浅/深工具栏对比度约 4.1 / 3.5
const IRIS_D = '#4B3FE0'; // 主色深一档
const CORAL = '#F26B3A';  // 辅色

// 圆角矩形路径，四角半径可分别指定 [tl, tr, br, bl]
function rr(x, y, w, h, r) {
  const [a, b, c, d] = Array.isArray(r) ? r : [r, r, r, r];
  return `M${x + a} ${y}H${x + w - b}${b ? `A${b} ${b} 0 0 1 ${x + w} ${y + b}` : ''}V${y + h - c}` +
    `${c ? `A${c} ${c} 0 0 1 ${x + w - c} ${y + h}` : ''}H${x + d}${d ? `A${d} ${d} 0 0 1 ${x} ${y + h - d}` : ''}` +
    `V${y + a}${a ? `A${a} ${a} 0 0 1 ${x + a} ${y}` : ''}Z`;
}
// 实心描边框：外圆角矩形减内圆角矩形（evenodd），边缘落在整数像素上
function frame(x, y, w, h, r, t) {
  return rr(x, y, w, h, r) + rr(x + t, y + t, w - 2 * t, h - 2 * t, Math.max(r - t, 0));
}
const svg = (size, body, defs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
  (defs ? `<defs>${defs}</defs>` : '') + body + '</svg>\n';

// 几何“S”（以 128 母版坐标描述，中心 64,64）
const GRAD6 = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6A5CFF"/><stop offset=".55" stop-color="#B34FE0"/><stop offset="1" stop-color="#FF7A45"/></linearGradient>`;
const S_PATH = 'M85 41C80 35 73 32 64 32C53 32 44 38 44 47.5C44 57.5 53 60.5 64 64C75 67.5 84 70.5 84 80.5C84 90 75 96 64 96C55 96 47.5 93 42.5 87';

const variants = [
  {
    n: 1, slug: 'pane', title: '原生分屏线框',
    caption: '贴近原生分屏按钮的圆角线框，换成品牌紫',
    notes: '思路：几乎照搬 Chrome 分屏按钮的“[|]”造型，只把线条加粗、圆角放大并换成单一品牌紫（#6A5CFF）。理由：用户一眼就能联想到“分屏”，学习成本最低，16px 下用 2px 实心线框和 2px 分隔线，像素对齐，清晰度最好。风险：和原生分屏按钮太像，两者并排出现在工具栏时容易混淆、显得像仿冒；也没有任何“搜索”含义，在应用店里辨识度最弱。',
    s128: () => svg(128, `<path fill="${IRIS}" fill-rule="evenodd" d="${frame(16, 24, 96, 80, 18, 10)}"/><rect x="59" y="28" width="10" height="72" fill="${IRIS}"/>`),
    s32: () => svg(32, `<path fill="${IRIS}" fill-rule="evenodd" d="${frame(2, 5, 28, 22, 5, 3)}"/><rect x="14" y="6" width="3" height="20" fill="${IRIS}"/>`),
    s16: () => svg(16, `<path fill="${IRIS}" fill-rule="evenodd" d="${frame(1, 2, 14, 12, 3, 2)}"/><rect x="7" y="3" width="2" height="10" fill="${IRIS}"/>`),
  },
  {
    n: 2, slug: 'pane-magnifier', title: '分屏 + 放大镜',
    caption: '分屏线框右下角压一个放大镜，点明“搜索”',
    notes: '思路：保留分屏线框，在右下角叠一个放大镜，线框在放大镜周围留出透明间隙。理由：同时表达“分屏”和“搜索”两层含义，仍然沿用用户熟悉的分屏符号，比方案 1 多了产品语义。风险：16px 下放大镜只有约 6px、镜片内孔 2px，线框也只能改成 1px 细线才放得下，在 1x 屏幕上接近辨识下限；元素多、显得略挤；“窗口 + 放大镜”在搜索类扩展里很常见，独特性一般。',
    s128: () => {
      const defs = `<mask id="m"><rect width="128" height="128" fill="#fff"/><circle cx="88" cy="86" r="31" fill="#000"/><path d="M100 98L114 112" stroke="#000" stroke-width="28" stroke-linecap="round"/></mask>`;
      return svg(128, `<g mask="url(#m)"><path fill="${IRIS}" fill-rule="evenodd" d="${frame(16, 22, 90, 72, 16, 10)}"/><rect x="56" y="26" width="10" height="64" fill="${IRIS}"/></g>` +
        `<circle cx="88" cy="86" r="17" fill="none" stroke="${IRIS}" stroke-width="10"/><path d="M100 98L106 104" stroke="${IRIS}" stroke-width="12" stroke-linecap="round"/>`, defs);
    },
    s32: () => {
      const defs = `<mask id="m"><rect width="32" height="32" fill="#fff"/><circle cx="22" cy="22" r="8.5" fill="#000"/><path d="M25 25L29 29" stroke="#000" stroke-width="8" stroke-linecap="round"/></mask>`;
      return svg(32, `<g mask="url(#m)"><path fill="${IRIS}" fill-rule="evenodd" d="${frame(2, 4, 24, 20, 4, 3)}"/><rect x="12" y="5" width="3" height="18" fill="${IRIS}"/></g>` +
        `<circle cx="22" cy="22" r="4.5" fill="none" stroke="${IRIS}" stroke-width="3"/><path d="M25.5 25.5L28.5 28.5" stroke="${IRIS}" stroke-width="3.2" stroke-linecap="round"/>`, defs);
    },
    s16: () => {
      // 16px：线框改 1px 细线留出空间；放大镜画成贴像素网格的八边形，线框在其周围留 1px 空隙
      const lens = 'M9 7H13L14 8V12L13 13H9L8 12V8Z M10 9V11H12V9Z';
      const defs = `<mask id="m"><rect width="16" height="16" fill="#fff"/><path d="M8 6H14L15 7V16H7V7Z" fill="#000"/></mask>`;
      return svg(16, `<g mask="url(#m)"><path fill="${IRIS}" fill-rule="evenodd" d="${frame(1, 2, 11, 9, 2, 1)}"/><rect x="6" y="3" width="1" height="7" fill="${IRIS}"/></g>` +
        `<path fill="${IRIS}" fill-rule="evenodd" d="${lens}"/><path d="M13.3 12.3L14.8 13.8" stroke="${IRIS}" stroke-width="2" stroke-linecap="round"/>`, defs);
    },
  },
  {
    n: 3, slug: 'two-tint', title: '双色分屏',
    caption: '左紫右橙两块实心窗格，一眼看出“两边对比”',
    notes: '思路：把分屏拆成两块实心窗格，左紫（#6A5CFF）右橙（#F26B3A），大图里每格加一条白色搜索框和两行结果线。理由：实心色块在 16px 下最醒目，在浅色和深色工具栏上都有足够面积；双色直接表达“两个引擎左右对比”，同时和原生分屏按钮明显区分。风险：配色要避开 Google 四色和 Bing 青绿，橙色仍可能让人联想到某些品牌；两块方色块偏通用，需要靠配色建立辨识度；橙色在浅色工具栏上对比度偏低（约 2.7），主要靠紫色那半边撑住。',
    s128: () => {
      const L = rr(16, 26, 45, 76, [18, 6, 6, 18]), R = rr(67, 26, 45, 76, [6, 18, 18, 6]);
      const ui = (x) => `<rect x="${x}" y="38" width="29" height="9" rx="4.5" fill="#fff"/><rect x="${x}" y="56" width="23" height="5" rx="2.5" fill="#fff" opacity=".6"/><rect x="${x}" y="68" width="17" height="5" rx="2.5" fill="#fff" opacity=".6"/>`;
      return svg(128, `<path fill="${IRIS}" d="${L}"/><path fill="${CORAL}" d="${R}"/>${ui(24)}${ui(75)}`);
    },
    s32: () => svg(32, `<path fill="${IRIS}" d="${rr(2, 5, 13, 22, [5, 1.5, 1.5, 5])}"/><path fill="${CORAL}" d="${rr(17, 5, 13, 22, [1.5, 5, 5, 1.5])}"/>` +
      `<rect x="5" y="9" width="7" height="2" rx="1" fill="#fff"/><rect x="20" y="9" width="7" height="2" rx="1" fill="#fff"/>`),
    s16: () => svg(16, `<path fill="${IRIS}" d="${rr(1, 2, 6, 12, [2.5, 0.5, 0.5, 2.5])}"/><path fill="${CORAL}" d="${rr(9, 2, 6, 12, [0.5, 2.5, 2.5, 0.5])}"/>`),
  },
  {
    n: 4, slug: 'split-lens', title: '分屏镜片',
    caption: '放大镜的镜片被竖缝一分为二，左紫右橙',
    notes: '思路：主体换成放大镜，镜片被一条透明竖缝分成两半，左半紫、右半橙，镜圈和手柄用品牌紫。理由：先读出“搜索”，再读出“一分为二”，概念最贴合“分屏搜索”，轮廓（圆 + 斜柄）和原生分屏按钮完全不同，不会混淆；色块面积大，16px 下也稳。风险：放大镜是搜索类图标的通用符号，若别家也用分色镜片会撞车；16px 下镜片太小放不下两个半圆加竖缝，所以 16px 版只把右半填橙、左半留空，和大尺寸略有差异；缩放到 24px（1.5 倍屏）时竖缝可能略糊。',
    s128: () => {
      const defs = `<clipPath id="lens"><circle cx="54" cy="54" r="22"/></clipPath>`;
      return svg(128, `<g clip-path="url(#lens)"><rect x="20" y="20" width="31" height="70" fill="${IRIS}"/><rect x="57" y="20" width="40" height="70" fill="${CORAL}"/></g>` +
        `<circle cx="54" cy="54" r="33" fill="none" stroke="${IRIS}" stroke-width="10"/><path d="M80 80L104 104" stroke="${IRIS}" stroke-width="15" stroke-linecap="round"/>`, defs);
    },
    s32: () => {
      const defs = `<clipPath id="lens"><circle cx="13" cy="13" r="5.5"/></clipPath>`;
      return svg(32, `<g clip-path="url(#lens)"><rect x="5" y="5" width="7" height="16" fill="${IRIS}"/><rect x="14" y="5" width="9" height="16" fill="${CORAL}"/></g>` +
        `<circle cx="13" cy="13" r="8.5" fill="none" stroke="${IRIS}" stroke-width="3"/><path d="M20 20L28 28" stroke="${IRIS}" stroke-width="4" stroke-linecap="round"/>`, defs);
    },
    s16: () => {
      const defs = `<clipPath id="lens"><circle cx="6.5" cy="6.5" r="4"/></clipPath>`;
      return svg(16, `<g clip-path="url(#lens)"><rect x="7" y="2" width="5" height="9" fill="${CORAL}"/></g>` +
        `<circle cx="6.5" cy="6.5" r="4.6" fill="none" stroke="${IRIS}" stroke-width="1.8"/><path d="M10.2 10.2L14 14" stroke="${IRIS}" stroke-width="2.4" stroke-linecap="round"/>`, defs);
    },
  },
  {
    n: 5, slug: 'offset-s', title: '错位窗格',
    caption: '两块窗格上下错位、对角大圆角，组成抽象的 S',
    notes: '思路：两块窗格上下错开，左格左上角、右格右下角用大圆角，其余为小圆角，整体呈中心对称，像一个抽象的“S”（Split / Search），左格紫色渐变、右格橙色渐变。理由：保留“左右两格”的分屏语义，又有品牌字母的暗示，形状独特、适合做成长期品牌标识，在 16px 下仍是两块大色块。风险：抽象度较高，第一次见到的用户未必读出“S”或“搜索”；错位让它更像“对话气泡”或“拼图”，需要配合名称和宣传图建立认知。',
    s128: () => {
      const defs = `<linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7E6BFF"/><stop offset="1" stop-color="${IRIS_D}"/></linearGradient>` +
        `<linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A4C"/><stop offset="1" stop-color="#E5532A"/></linearGradient>`;
      return svg(128, `<path fill="url(#a)" d="${rr(16, 16, 45, 74, [34, 8, 8, 8])}"/><path fill="url(#b)" d="${rr(67, 38, 45, 74, [8, 8, 34, 8])}"/>`, defs);
    },
    s32: () => svg(32, `<path fill="${IRIS}" d="${rr(2, 2, 13, 21, [9, 2, 2, 2])}"/><path fill="${CORAL}" d="${rr(17, 9, 13, 21, [2, 2, 9, 2])}"/>`),
    s16: () => svg(16, `<path fill="${IRIS}" d="${rr(1, 1, 6, 11, [4.5, 1, 1, 1])}"/><path fill="${CORAL}" d="${rr(9, 4, 6, 11, [1, 1, 4.5, 1])}"/>`),
  },
  {
    n: 6, slug: 'gradient-s', title: '渐变字标',
    caption: '紫到橙渐变底板左右分两色调，中间白色字母 S',
    notes: '思路：做成应用图标式的圆角方底板，填紫—品红—橙对角渐变，底板右半叠一层暗色，形成一条竖直的“分屏”色缝；中间是完整的白色几何字母“S”（Split / Search）。理由：最大胆、最像正式产品的品牌标识，在应用店列表和扩展管理页最抢眼；白字落在实心底板上，浅色、深色工具栏都清楚。曾试过用竖缝直接切开 S，结果像美元符号“$”，所以改为让底板分色、字母保持完整。风险：满版底板在工具栏里比其他图标“重”，和 Chrome 简洁的线性图标风格反差大；字母 S 本身不说明功能，需要靠名称；16px 下渐变和分色缝被压得很弱，基本只剩“彩色方块 + S”。',
    s128: () => {
      const defs = GRAD6 + `<clipPath id="t"><rect x="16" y="16" width="96" height="96" rx="26"/></clipPath>`;
      return svg(128, `<g clip-path="url(#t)"><rect x="16" y="16" width="96" height="96" fill="url(#g)"/><rect x="64" y="16" width="48" height="96" fill="#1a0f4d" opacity=".2"/></g>` +
        `<path d="${S_PATH}" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round"/>`, defs);
    },
    s32: () => {
      const defs = GRAD6 + `<clipPath id="t"><rect x="2" y="2" width="28" height="28" rx="7.5"/></clipPath>`;
      // 128 母版的 S 映射到 32：中心 16,16，缩放 0.3
      return svg(32, `<g clip-path="url(#t)"><rect x="2" y="2" width="28" height="28" fill="url(#g)"/><rect x="16" y="2" width="14" height="28" fill="#1a0f4d" opacity=".2"/></g>` +
        `<path d="${S_PATH}" transform="translate(16 16) scale(.3) translate(-64 -64)" fill="none" stroke="#fff" stroke-width="13.5" stroke-linecap="round"/>`, defs);
    },
    s16: () => {
      const defs = GRAD6 + `<clipPath id="t"><rect x="1" y="1" width="14" height="14" rx="3.5"/></clipPath>`;
      // 16px 专用 S：更高更窄，2px 笔画
      const S16 = 'M11 4.6C10.3 3.7 9.3 3.2 8 3.2C6.3 3.2 5 4.1 5 5.6C5 7.2 6.4 7.6 8 8C9.6 8.4 11 8.9 11 10.4C11 11.9 9.7 12.8 8 12.8C6.7 12.8 5.6 12.3 4.9 11.4';
      return svg(16, `<g clip-path="url(#t)"><rect x="1" y="1" width="14" height="14" fill="url(#g)"/><rect x="8" y="1" width="7" height="14" fill="#1a0f4d" opacity=".2"/></g>` +
        `<path d="${S16}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`, defs);
    },
  },
];

function shot(file, out, w, h) {
  execFileSync(CHROME, ['--headless=new', `--user-data-dir=${PROFILE}`, '--disable-sync', '--no-first-run', '--disable-gpu',
    '--force-device-scale-factor=1', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${w},${h}`, `--screenshot=${out}`, `file://${file}`], { stdio: 'ignore' });
}

const wrap = (src, size) => `<!doctype html><html><body style="margin:0;background:transparent">` +
  `<img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`;

mkdirSync(PROFILE, { recursive: true });
for (const v of variants) {
  const dir = join(HERE, `v${v.n}-${v.slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'icon.svg'), v.s128());
  writeFileSync(join(dir, 'icon-32.svg'), v.s32());
  writeFileSync(join(dir, 'icon-16.svg'), v.s16());
  writeFileSync(join(dir, 'notes.md'), `# 方案 ${v.n}：${v.title}\n\n${v.notes}\n\n文件：\`icon.svg\` 是 128×128 母版（图形在中央 96×96，四周 16px 透明留白），48 和 128 由它渲染；\`icon-32.svg\`、\`icon-16.svg\` 是按像素网格单独调整的小尺寸版本。\n`);
  const tmp = join(dir, '.render.html');
  for (const [size, src] of [[128, 'icon.svg'], [48, 'icon.svg'], [32, 'icon-32.svg'], [16, 'icon-16.svg']]) {
    writeFileSync(tmp, wrap(src, size));
    shot(tmp, join(dir, `icon-${size}.png`), size, size);
  }
  rmSync(tmp);
}

// ---------- 对比图 ----------
const LIGHT = '#f1f3f4', DARK = '#202124';
// 原生分屏按钮示意（细线 [|]），16px
const splitMock = (c) => `<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M8 3.5V12.5" stroke="${c}" stroke-width="1.5"/></svg>`;
const puzzleMock = (c) => `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="${c}" d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z"/></svg>`;
const sizesCell = (v, bg, fg) => `<div class="sizes" style="background:${bg};color:${fg}">` +
  [128, 48, 32, 16].map((s) => `<figure><img src="v${v.n}-${v.slug}/icon-${s}.png" width="${s}" height="${s}"><figcaption>${s}</figcaption></figure>`).join('') + '</div>';
const toolbar = (v, bg, fg, omni) => `<div class="tb" style="background:${bg}"><div class="omni" style="background:${omni}"></div>` +
  `<span class="btn">${splitMock(fg)}</span><span class="btn"><img src="v${v.n}-${v.slug}/icon-16.png" width="16" height="16"></span><span class="btn">${puzzleMock(fg)}</span></div>`;
const zoom = (v) => `<img class="zoom" src="v${v.n}-${v.slug}/icon-16.png" width="64" height="64">`;

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Split Search 图标提案</title><style>
*{box-sizing:border-box}body{margin:0;padding:28px 32px;background:#fff;font-family:"Sarasa UI SC","Source Han Sans SC",sans-serif;color:#202124;width:1240px}
h1{font-size:22px;margin:0 0 4px}p.sub{margin:0 0 18px;color:#5f6368;font-size:13px}
.head,.row{display:grid;grid-template-columns:200px 300px 300px 220px 88px;gap:12px;align-items:center}
.head{font-size:12px;color:#5f6368;padding:0 0 6px;border-bottom:1px solid #dadce0}
.row{padding:12px 0;border-bottom:1px solid #e8eaed}
.label b{display:inline-block;width:26px;height:26px;border-radius:13px;background:#202124;color:#fff;text-align:center;line-height:26px;font-size:14px;margin-right:8px}
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
</style></head><body>
<h1>Split Search 扩展图标提案（1 保守 → 6 大胆）</h1>
<p class="sub">每行依次为：浅色工具栏背景 / 深色工具栏背景下的 128、48、32、16 px；1x 工具栏示意（左：Chrome 原生分屏按钮，中：本扩展 16px，右：扩展菜单）；16px 放大 4 倍看像素。</p>
<div class="head"><span>方案</span><span>浅色背景 #f1f3f4</span><span>深色背景 #202124</span><span>工具栏 16px 实际比例</span><span>16px ×4</span></div>
${variants.map((v) => `<div class="row"><div class="label"><div><b>${v.n}</b><span class="t">${v.title}</span></div><div class="c">${v.caption}</div></div>` +
  sizesCell(v, LIGHT, '#202124') + sizesCell(v, DARK, '#e8eaed') +
  `<div class="tbs">${toolbar(v, LIGHT, '#474747', '#ffffff')}${toolbar(v, DARK, '#c7c7c7', '#3c3c3c')}</div>${zoom(v)}</div>`).join('\n')}
</body></html>
`;
writeFileSync(join(HERE, 'compare.html'), html);
shot(join(HERE, 'compare.html'), join(HERE, 'compare.png'), 1240, 1400);
execFileSync('convert', [join(HERE, 'compare.png'), '-trim', '+repage', '-bordercolor', '#ffffff', '-border', '28', join(HERE, 'compare.png')]);
console.log('done');
