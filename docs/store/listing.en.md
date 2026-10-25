# 商店详情：English

> 状态：v0.2.0 版已于 2026-10-25 提交；详细说明已按 v0.4 改写（2026-10-25），下次上传时更新控制台。

## 提交说明

控制台里每种语言的详情对应扩展包中的一个 `_locales/<语言代码>` 目录。v0.2 加入 `_locales`（`en`、`zh_CN`、`zh_TW`、`es`，设置页可切换语言），首次提交（v0.2.0）时 4 种语言的详情一起提交，英文是默认语言（`default_locale: en`），见 `docs/superpowers/specs/2026-10-24-i18n-design.md`。英文文案按 CLAUDE.md“文案”一节用 humanizer 润色。其余必做项见 `listing.zh-CN.md`“提交前必做”。

字数按 Unicode 字符计。

## Name (max 75)

```text
Split Search
```

字数：12 / 75

已定（2026-10-24 用户决定）：所有语言都叫 Split Search，不加本地副标题。

## Summary (max 132)

```text
Search from the address bar or drag text to the tab strip to compare two search engines side by side in Chrome’s split view.
```

字数：124 / 132

## Description

```text
Search from the address bar or drag selected text onto the tab strip, and Split Search opens results from two search engines side by side in Chrome’s split view, so you can compare them.

FEATURES
• Works from the address bar, from text dragged onto the tab strip, and from the Search [engine] for “…” item in Chrome’s right-click menu
• On a results page from one of your engines, click the toolbar button and pick another engine to open the same search next to it in a split view
• Select text on a web page and right-click to look it up in a split view, with the page staying on the left
• Right-click an image to search it with Google Lens or another image search engine, next to the page you’re on
• Google, Bing, DuckDuckGo, Perplexity and Kagi are built in, and you can add other search engines
• The engine catalog has translation, reference, video, map and other sites that work well on the right side, plus AI assistants, ready to add
• Set up several engine pairs, each with its own shortcut. For example, type “gb your search” to compare Google and Bing
• Click the toolbar button to switch the right side to another engine without searching again
• Or press a keyboard shortcut to switch the right side to the next engine. No shortcut is set by default; set one on Chrome’s Keyboard shortcuts page (chrome://extensions/shortcuts)
• When the window is narrow, the right side opens in a background tab next to the left one instead. You can turn this off
• Both sides are regular tabs, so you stay signed in and your site settings still apply

SETUP
1. On the settings page, grant access to the engines you want to use
2. Pick a left and a right engine, then copy the generated URL
3. In Chrome settings, add that URL under “Site search” and choose “Make default”
The settings page walks you through each step.

GOOD TO KNOW
• Requires Chrome 155 or later
• In Incognito windows, on other devices, or when the extension isn’t active, you get a normal search
• After you choose “Make default”, the address bar no longer shows search suggestions
• Only images with a public address can be searched, and engines usually can’t get images that need a sign-in

PRIVACY
Split Search sends nothing to the developer or any other third party. What you look up goes only to the engines you chose, including one you switch to from the popup or with the keyboard shortcut. It has no servers, analytics or ads. To open the split view, it reads the URL of your search on your device, the current tab’s URL when you click the toolbar button, and the other tab’s URL when needed. It doesn’t store those URLs. It reads the selected text or an image’s address only when you choose one of its right-click menu items, and it doesn’t read the page’s URL or anything else on the page. Some image addresses include access credentials, so the engine can open that image too. What you searched and the two engines are kept in browser memory so the popup can show them and switch engines, and they’re cleared when you close the browser. Split Search doesn’t read your browsing history.
```

字数：3068（含换行）

措辞说明：

- 按 `listing.zh-CN.md` 的新版详细说明转写（2026-10-24），结构相同：开头一句、FEATURES、SETUP、GOOD TO KNOW、PRIVACY；已过 humanizer。
- 术语取 Chrome 英文界面（`docs/i18n/chrome-terms.md`）：split view、address bar、tab strip、Site search、Make default、Search [engine] for “…”（Chrome 自带的右键菜单项；本扩展自己的两项按功能写成 look it up、search it，不写菜单原文）。引号用弯引号，与 `src/_locales/en` 一致。
- 实现细节（`_ss` 参数、授权不随同步、Service Worker 退化等）不写进详情，留给设置页的逐步说明和内部文档。
- PRIVACY 段与 `privacy.md` 一致（v0.4 改写，2026-10-25）：第一句说不发给开发者或其他第三方、要查的内容只发给所选引擎，不再说“Your data stays on your device”；写明本机读取的网址不保存、只在用户选了菜单项时才读选区和图片网址、查询内容和两侧引擎只暂存在浏览器内存、关闭浏览器即清除，不读浏览记录。数据使用披露勾 Web history 和 Website content，这一段是对此的公开说明，不要删减。v0.4 新增的 FEATURES、GOOD TO KNOW 条目和 PRIVACY 段已过 humanizer。
- 网站搜索的 Shortcut（Chrome 术语）写作 “shortcut”，扩展的快捷键一律写 “keyboard shortcut”，页面名照 Chrome 界面写 “Keyboard shortcuts”。v0.3 新增的 FEATURES 条目已过 humanizer。

## Category / Language

- Category: **Tools**（备选 Functionality & UI），与中文详情一致。
- Language: English（默认语言）。
