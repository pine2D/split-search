// 截图前检查定稿字体。模板按更纱黑体排版，换成别的字体字宽会变，标题和原理图的折行可能跟着变。
// 要检查的字族取自 base.css 的 --font / --mono 的第一项，所以跟着 <html lang> 走（zh-TW 是 Sarasa UI TC，其余 Sarasa UI SC）。
// render-assets.mjs 截图前会调用 window.beforeCapture；这里抛错会让该图渲染失败、命令以非零码退出。
window.beforeCapture = async () => {
  const css = getComputedStyle(document.documentElement);
  const families = ["--font", "--mono"].map(v => css.getPropertyValue(v).split(",")[0].trim().replace(/^["']|["']$/g, ""));
  const ctx = document.createElement("canvas").getContext("2d");
  const probe = "Split Search 分屏搜索 分割畫面 0123 ijkW ñé";
  const width = (font) => { ctx.font = font; return ctx.measureText(probe).width; };
  const missing = families.filter(fam =>
    ["monospace", "serif"].every(g => width(`32px ${g}`) === width(`32px "${fam}", ${g}`)));
  if (missing.length) throw new Error(`缺少字体（lang=${document.documentElement.lang}）：${missing.join("、")}（更纱黑体，github.com/be5invis/Sarasa-Gothic）。装好后用 fc-match "${missing[0]}" 确认再渲染。`);
};
