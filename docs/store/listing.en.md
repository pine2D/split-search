# 商店详情：English

> 状态：v0.2.0 版已于 2026-10-25 提交；详细说明已按 v0.4 改写（2026-10-25），2026-10-27 按 v0.5 在 FEATURES 加了 keyword rules 一条，下次上传时更新控制台。

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
• Compare two engines from the address bar or by dragging text onto the tab strip. Pick your engines, add your own, and set up several pairs, each with its own shortcut
• Right-click selected text or an image to look it up next to the page you’re on
• Click the toolbar button to switch the right side to another engine without searching again
• The right-side engine can switch automatically by keyword, for example to YouTube when your search contains “video”

SETUP
1. On the settings page, grant access to your search engines
2. Copy the URL the settings page generates, add it under “Site search” in Chrome settings, and choose “Make default”
The settings page walks you through each step.

GOOD TO KNOW
• Requires Chrome 155 or later
• After you choose “Make default”, the address bar no longer shows search suggestions
• In Incognito windows or on other devices, you get a normal search

PRIVACY
What you look up goes only to the search engines you choose, never to the developer or any other third party. Split Search has no servers, analytics or ads. To open the split view, it reads your search URL and the current tab’s URL on your device and doesn’t store them. It reads selected text or an image’s address only when you use its right-click menu. Your searches are kept in browser memory and cleared when you close the browser.
```

字数：1536（含换行）

措辞说明：2026-10-28 按用户要求精简为核心内容：四条功能、两步设置、三条须知，次要功能和实现细节不写。隐私段仍写明本机读取哪些网址且不保存、只在用户用右键菜单时读选区和图片网址、查询只暂存在内存；不说“不收集”“不读取网页内容”，与 privacy.md 和数据使用披露（网页浏览记录、网站内容）一致，再删要先对照 privacy.md。术语沿用此前各版核实过的 Chrome 界面叫法。

## Category / Language

- Category: **Tools**（备选 Functionality & UI），与中文详情一致。
- Language: English（默认语言）。
