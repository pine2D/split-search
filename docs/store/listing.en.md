# 商店详情：English（草稿）

> 状态：草稿，待审。

## 前提：要不要启用英文详情

控制台里每种语言的详情对应扩展包中的一个 `_locales/<语言代码>` 目录。当前 `src/` 没有 `_locales`，也没有 `default_locale`，所以控制台只会提供一种语言的详情。

两种做法：

- **A（v0.1 建议）**：只上中文详情。本文件留作以后用，或供 GitHub 和其他英文渠道使用。
- **B**：新增 `_locales/zh_CN/messages.json` 和 `_locales/en/messages.json`，只放 `extName`、`extDescription` 两条，manifest 改为 `"name": "__MSG_extName__"`、`"description": "__MSG_extDescription__"`、`"default_locale": "zh_CN"`。这样做只本地化商店名称和简介，设置页仍然只有简体中文，不违反“界面只用简体中文”的约束。不过 `test/manifest.test.js` 断言了 `name === "Split Search"`，测试要一起改。这件事需要你来决定。

字数按 Unicode 字符计。

## Name (max 75)

```text
Split Search
```

字数：12 / 75

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
No servers, no analytics, no ads. The extension sends no data to the developer or anyone else. Your search terms go only from your browser to the two engines you chose. Settings are stored in chrome.storage.sync, which Chrome syncs across your devices only if you have Chrome sync turned on.
```

字数：3269（含换行）

## Category / Language

- Category: **Tools**（备选 Functionality & UI），与中文详情一致。
- Language: English（仅在采用做法 B 时出现）。
