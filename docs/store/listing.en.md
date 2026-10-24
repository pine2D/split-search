# 商店详情：English（草稿）

> 状态：草稿，待审。

## 状态：v0.3 时提交（2026-10-24 用户决定）

控制台里每种语言的详情对应扩展包中的一个 `_locales/<语言代码>` 目录。v0.2 加入 `_locales`（`en`、`zh_CN`、`zh_TW`、`es`，设置页可切换语言），v0.3 首次提交时 4 种语言的详情一起提交，英文是默认语言（`default_locale: en`），见 `docs/superpowers/specs/2026-10-24-i18n-design.md`。提交前：下文“settings page in Simplified Chinese only”两处删掉，改为一句说明设置页可以切换语言；文案用 humanizer 和 lieflat-less-ai-tone 润色。其余必做项见 `listing.zh-CN.md`“提交前必做”。

字数按 Unicode 字符计。

## Name (max 75)

```text
Split Search
```

字数：12 / 75

已定（2026-10-24 用户决定）：所有语言都叫 Split Search，不加本地副标题。

## Summary (max 132)

```text
Search from the address bar or drag text to the tab strip to see two search engines side by side in Chrome's native split view.
```

字数：127 / 132

## Description

```text
Split Search shows one search in two search engines at once. Type in the address bar, or drag selected text onto the tab strip, and Chrome opens both result pages side by side in its native Split View.

Note: the extension's settings page is available in Simplified Chinese only.

Both sides are ordinary Chrome tabs, so your sign-ins and site settings work as usual. The extension uses no iframes and does not modify any website's responses.

FEATURES
• Works from the address bar, from dragging text onto the tab strip, and from Chrome's built-in right-click "Search [engine] for …" item
• Ships with Google, Bing, DuckDuckGo, Perplexity and Kagi; add other engines with a URL template (%s stands for the search terms), then edit, hide or reorder them (the Baidu engine in some screenshots was added this way)
• Generate a trigger URL for each engine pair and give each one your own keyword, e.g. "gb terms" for Google | Bing and "dk terms" for DuckDuckGo | Kagi
• Searching again inside a split the extension opened refreshes both sides in place; splits whose other tab isn't one of your search engines are left untouched, and new results open as a new pair next to them

SET UP IN THREE STEPS
Chrome does not let extensions change your search engines, so you add one entry yourself, once:
1. Grant access: on the settings page, click "授权" (Grant) for the engines you use. The extension asks only for access to those engines' own sites. Required for the left engine, recommended for the right.
2. Copy the trigger URL: pick a left and a right engine, then copy the trigger URL the settings page generates.
3. Add it as a site search: open chrome://settings/searchEngines, add an entry under "Site search", paste the trigger URL and choose a shortcut. As the default, it splits address-bar searches, text dragged onto the tab strip and Chrome's right-click "Search [engine] for …" item. If you keep your current default, only typing "shortcut + space + terms" opens a split.

ON OTHER DEVICES AND IN INCOGNITO
A trigger URL is the left engine's real search URL plus one marker parameter, _ss. Wherever the extension isn't active (other computers and phones that sync your search settings, Incognito windows, or when the extension is disabled or not granted access), it simply runs a normal search on the left engine. Nothing breaks.

LIMITATIONS
• Requires Chrome 155 or later (native Split View API)
• Two engines at a time: a Chrome split holds two tabs
• No split in Incognito windows; searches run normally there
• Custom site searches have no suggestions, so the address bar stops showing search suggestions while one is your default
• Site access grants don't sync; grant access on each device
• If an engine's own service worker takes over the navigation, that search falls back to a normal search on the left engine
• After changing the default pair or the left engine's URL, add the new trigger URL to Chrome again
• Settings page in Simplified Chinese only

PRIVACY
Important: the extension collects no data. It has no servers, makes no network requests, contains no analytics, ads or remote code, and sends no data to the developer or anyone else. To do its job it reads, only inside your browser, the URL of the search you start (including the search terms) and the URL of the other tab in a split view, used only to compare its site origin and not stored. It does not read your browsing history or page content, and stores nothing except your settings and temporary split records that are cleared when the browser closes. Your search terms go only from your browser to the two engines you chose. Settings are stored in chrome.storage.sync, which Chrome syncs across your devices only if you have Chrome sync turned on.
```

字数：3733（含换行）

## Category / Language

- Category: **Tools**（备选 Functionality & UI），与中文详情一致。
- Language: English（默认语言，v0.3 提交）。
