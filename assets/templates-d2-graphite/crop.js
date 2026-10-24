// 按原图像素坐标裁切截图：<div class="crop" data-crop="x,y,w,h"><img src data-iw="2400"> …</div>
// 缩放 = 容器宽度 / w；容器高度设为 h × 缩放（data-h="fill" 时保留 CSS 给的高度）。
// 容器内的 .mark / .patch（data-box="x,y,w,h"）按同一缩放定位；.patch 是盖在原图上的修补小图（见 assets/raw/captions.md）；svg.ann 的 viewBox 直接写原图坐标，这里把它对齐到裁切区。
for (const el of document.querySelectorAll(".crop[data-crop]")) {
  const [x, y, w, h] = el.dataset.crop.split(",").map(Number);
  const s = el.clientWidth / w;
  if (el.dataset.h !== "fill") el.style.height = `${h * s}px`;
  const img = el.querySelector("img:not(.patch)");
  Object.assign(img.style, { left: `${-x * s}px`, top: `${-y * s}px`, width: `${+img.dataset.iw * s}px` });
  for (const m of el.querySelectorAll(".mark[data-box], .patch[data-box]")) {
    const [bx, by, bw, bh] = m.dataset.box.split(",").map(Number);
    Object.assign(m.style, { left: `${(bx - x) * s}px`, top: `${(by - y) * s}px`, width: `${bw * s}px`, height: `${bh * s}px` });
  }
  for (const svg of el.querySelectorAll("svg.ann")) {
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${el.clientHeight / s}`);
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
  }
}
