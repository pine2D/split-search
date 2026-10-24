// 配色求解与对比度计算（无依赖）。
// 每块窗格用 OKLCH 的色相 h、彩度 C 描述，再按目标相对亮度 Y 二分求出明度 L，
// 保证窗格对浅色工具栏 #f1f3f4 和深色工具栏 #202124 都 ≥ 3:1（非文本图形门槛）。
// 两者同时达标时 Y 只能落在 0.146–0.265 之间；这里深格取 Y≈0.155，浅格取 Y≈0.25，各留约 0.15 的余量。

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// OKLCH → 线性 sRGB（Björn Ottosson 的 OKLab 矩阵）
function oklchToLin(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const hex2 = (v) => Math.round(Math.min(1, Math.max(0, toGam(v))) * 255).toString(16).padStart(2, '0');
export const oklchHex = (L, C, h) => '#' + oklchToLin(L, C, h).map(hex2).join('').toUpperCase();

// 给定色相/彩度，二分明度，使相对亮度最接近目标 Y
export function solve(C, h, Y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(oklchHex(mid, C, h)) < Y) lo = mid; else hi = mid;
  }
  return oklchHex((lo + hi) / 2, C, h);
}

export const LIGHT = '#F1F3F4', DARK = '#202124';
