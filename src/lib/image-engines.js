// 以图搜图引擎：内置 lens 与设置页一键添加的引擎库。数据写在代码里，不来自网络。
// 纯数据，不 import 任何模块（engines.js 引用本文件，反过来会循环引用）。不得引用 chrome。
// %s 代表整个图片网址；不经过 DNR，不申请 host 权限。

export const IMAGE_PRESET = Object.freeze({ id: "lens", name: "Google Lens", url: "https://lens.google.com/uploadbyurl?url=%s" });

// 收录前都在真机点过一遍（spec 3.5、附录 B）；TinEye、SauceNAO 由用户 2026-10-25 用住宅 IP 验证
export const IMAGE_CATALOG = [
  { id: "bing-img", name: "Bing Visual Search", url: "https://www.bing.com/images/searchbyimage?cbir=sbi&imgurl=%s" },
  { id: "yandex-img", name: "Yandex Images", url: "https://yandex.com/images/search?rpt=imageview&url=%s" },
  { id: "tineye", name: "TinEye", url: "https://tineye.com/search?url=%s" },
  { id: "saucenao", name: "SauceNAO", url: "https://saucenao.com/search.php?url=%s" },
];
