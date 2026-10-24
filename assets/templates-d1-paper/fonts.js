// 截图前检查定稿字体。模板按更纱黑体排版，换成别的字体字宽会变，标题和原理图的折行可能跟着变。
// render-assets.mjs 截图前会调用 window.beforeCapture；这里抛错会让该图渲染失败、命令以非零码退出。
window.beforeCapture = async () => {
  const ctx = document.createElement("canvas").getContext("2d");
  const probe = "Split Search 分屏搜索 0123 ijkW";
  const width = (font) => { ctx.font = font; return ctx.measureText(probe).width; };
  const missing = ["Sarasa UI SC", "Sarasa Fixed SC"].filter(fam =>
    ["monospace", "serif"].every(g => width(`32px ${g}`) === width(`32px "${fam}", ${g}`)));
  if (missing.length) throw new Error(`缺少字体：${missing.join("、")}（更纱黑体，github.com/be5invis/Sarasa-Gothic）。装好后用 fc-match "Sarasa UI SC" 确认再渲染。`);
};
