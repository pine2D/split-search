// 按原图像素坐标裁切截图：<div class="crop" data-crop="x,y,w,h"><img src data-iw="2400"> …</div>
// 缩放 = 容器宽度 / w；容器高度设为 h × 缩放（data-h="fill" 时保留 CSS 给的高度）。
// 容器内的 .mark / .patch（data-box="x,y,w,h"）按同一缩放定位；.patch 是盖在原图上的修补小图（见 assets/raw/captions.md）；svg.ann 的 viewBox 直接写原图坐标，这里把它对齐到裁切区。
// 某语言换用自己的截图时（render-assets.mjs 设 <html data-raw="en">，截图在 assets/raw/en/），画面位置和网址不同：
// 有 data-crop-en / data-box-en 就用它们，svg.ann 里 path 的 data-d-en 换掉 d，data-text-en 换掉元素文字；没有就用默认值。
// 加载时排一次；render-assets.mjs 换完截图后再调用 window.layoutCrops()（可重复调用）。
function layoutCrops() {
  const raw = document.documentElement.dataset.raw;
  const pick = (el, k) => (raw && el.getAttribute(`data-${k}-${raw}`)) || el.getAttribute(`data-${k}`);
  if (raw) {
    for (const el of document.querySelectorAll(`[data-text-${raw}]`)) el.textContent = el.getAttribute(`data-text-${raw}`);
    for (const p of document.querySelectorAll(`svg.ann path[data-d-${raw}]`)) p.setAttribute("d", p.getAttribute(`data-d-${raw}`));
  }
  for (const el of document.querySelectorAll(".crop[data-crop]")) {
    const [x, y, w, h] = pick(el, "crop").split(",").map(Number);
    const s = el.clientWidth / w;
    if (el.dataset.h !== "fill") el.style.height = `${h * s}px`;
    const img = el.querySelector("img:not(.patch)");
    Object.assign(img.style, { left: `${-x * s}px`, top: `${-y * s}px`, width: `${+img.dataset.iw * s}px` });
    for (const m of el.querySelectorAll(".mark[data-box], .patch[data-box]")) {
      const [bx, by, bw, bh] = pick(m, "box").split(",").map(Number);
      Object.assign(m.style, { left: `${(bx - x) * s}px`, top: `${(by - y) * s}px`, width: `${bw * s}px`, height: `${bh * s}px` });
    }
    for (const svg of el.querySelectorAll("svg.ann")) {
      svg.setAttribute("viewBox", `${x} ${y} ${w} ${el.clientHeight / s}`);
      svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    }
  }
}
layoutCrops();
window.layoutCrops = layoutCrops;
