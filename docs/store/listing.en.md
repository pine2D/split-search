# 商店详情：English

> 状态：v0.2.0 版已于 2026-10-25 提交；详细说明已按 v0.3 改写（2026-10-25），随 v0.3.0 上传时更新控制台。

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
• Google, Bing, DuckDuckGo, Perplexity and Kagi are built in, and you can add other search engines
• The engine catalog has translation, reference, video, map and other sites that work well on the right side, ready to add
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

PRIVACY
Your data stays on your device. Split Search has no servers, analytics or ads, and sends nothing to the developer or any third party. Your search terms go only to the search engines you chose, including one you switch to from the popup or with the keyboard shortcut. To open the split view, it reads the URL of your search on your device and, when needed, the URL of the other tab. It doesn’t store those URLs. Your search terms and the two engines are kept in browser memory so the popup can show them and switch the right side, and they’re cleared when you close the browser. Split Search doesn’t read your browsing history or page content.
```

字数：2318（含换行）

措辞说明：

- 按 `listing.zh-CN.md` 的新版详细说明转写（2026-10-24），结构相同：开头一句、FEATURES、SETUP、GOOD TO KNOW、PRIVACY；已过 humanizer。
- 术语取 Chrome 英文界面（`docs/i18n/chrome-terms.md`）：split view、address bar、tab strip、Site search、Make default、Search [engine] for “…”（右键菜单项，扩展自身没有右键菜单）。引号用弯引号，与 `src/_locales/en` 一致。
- 实现细节（`_ss` 参数、授权不随同步、Service Worker 退化等）不写进详情，留给设置页的逐步说明和内部文档。
- PRIVACY 段与 `privacy.md` 一致（v0.3 改写，2026-10-25）：说“Your data stays on your device”，写明本机读取的网址不保存、关键词和两侧引擎只暂存在浏览器内存、关闭浏览器即清除，不读浏览记录和网页内容。v0.3 起数据使用披露只勾 Web history，这一段是对此的公开说明，不要删减。
- 网站搜索的 Shortcut（Chrome 术语）写作 “shortcut”，扩展的快捷键一律写 “keyboard shortcut”，页面名照 Chrome 界面写 “Keyboard shortcuts”。v0.3 新增的 FEATURES 条目已过 humanizer。

## Category / Language

- Category: **Tools**（备选 Functionality & UI），与中文详情一致。
- Language: English（默认语言）。
