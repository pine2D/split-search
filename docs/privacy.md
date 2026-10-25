---
layout: default
title: Privacy Policy
---

# Split Search Privacy Policy

[简体中文](privacy.zh-CN.html)

Effective date: 2026-10-25  
Policy URL: https://pine2d.github.io/split-search/privacy

Split Search (“the extension”) is a Chrome extension developed by pine2D. It opens search results side by side in Chrome’s split view: results from two search engines, or a search or image search next to the page you are reading. This policy explains how the extension handles your data.

## In short: what you look up goes only to the engines you choose, never to the developer or other third parties

- The extension sends no data to the developer or any third party and does not sell data. It has no servers, makes no network requests of its own, and contains no analytics, advertising, third-party code or remote code.
- Your browser sends your search terms, and any text or image address you look up from the right-click menu, only to the engines you chose.
- The extension stores only your settings and a record of the split views it opened, which includes what was searched. That record is kept in browser memory and cleared when the browser closes (see item 4 below).
- To do its job, it reads a few things on your device: the URL of the search you start; the selected text or the image’s address when you choose one of its right-click menu items; the current tab’s URL when you click its toolbar button; and, when needed, the URL of the other tab. It stores none of these URLs. Each item is explained below.

## Data handled on your device

1. Trigger URLs and search terms. When you search using a trigger URL you added to Chrome (only URLs carrying the extension’s marker parameter “_ss” are handed to it), the extension reads that URL on your device, extracts the search terms and the engine IDs in “_ss”, builds the right-hand engine’s URL, and opens both engines’ result pages in two tabs.
2. Selected text and image addresses from the right-click menu. Only when you choose one of the extension’s items in the right-click menu does it read the text you selected (up to the first 500 characters) or the address of that image, which Chrome passes along with that click. Text goes only to the lookup engine you chose, and an image address goes only to the image search engine you chose; the engine’s server then downloads the image itself. The extension does not read the page’s URL or anything else on the page, and it has no content scripts. The result pages it opens don’t carry the URL of the page you are reading. Text selected in an editable field, such as a text box, is ignored. Note that some image addresses work as access credentials (for example, signed addresses that expire), so sending one to an engine lets that engine open the image too, and that an image address can reveal the site or page it comes from.
3. URL of the current tab. When you click the toolbar button, Chrome gives the extension temporary access to the current tab (activeTab). The popup reads that tab’s URL to check whether it is a results page of one of your configured search engines and to read its search terms, so you can open the same search in another engine next to it. That URL is not stored or sent anywhere. If you then open the split view, the search terms are recorded like any other split view (see item 4).
4. Split records. After the extension opens a split view (or two tabs side by side when the window is narrow), it records in chrome.storage.session the IDs of the two tabs, each tab’s role (search results, your page, or lookup results), the engine each tab shows, and what was searched: search terms, selected text or an image address. The record contains no page URLs. The toolbar popup uses it to show the current search, and when you switch engines from the popup or with the keyboard shortcut, the extension uses it to build the new engine’s URL. The record stays in browser memory and is never synced or uploaded. A tab’s record is deleted when the tab closes, and all records are cleared when the browser closes, or when the extension is reloaded, updated or turned off.
5. URL of the other tab. To tell whether a pair of tabs is one it opened, the extension first checks the record in item 4. If there is no record (for example after a browser restart), it reads the other tab’s URL to see whether it looks like a results page of one of your configured engines. It compares only the origin, the path and whether the URL has a search-terms parameter. It does this when it handles a search (started from the address bar, by dragging text, or from Chrome’s own right-click search item, such as “Search Google for …”), when you open the toolbar popup, and when you switch engines with the keyboard shortcut. The result only informs the decision: the extension never overwrites a tab because of it, and opens a new pair next to it when needed. The extension’s own right-click menu items (for looking up selected text or an image) do not compare the other tab’s URL. Chrome provides that URL only for sites you have granted access to. The URL is used for that check only and is not stored. The extension does not read your browsing history.
6. Settings. Your search engines (names and URL templates), their order, hidden built-in engines, your default pair, the interface language, how narrow windows are handled, which engines the keyboard shortcut rotates through, your choice of lookup engine and image search engine, and any image search engines you added (names and URL templates) are stored in chrome.storage.sync. They contain no search terms, selected text or image addresses. If you have Chrome sync turned on, Chrome syncs these settings across your devices through your Google Account; this is governed by Chrome’s and Google’s privacy policies, and the developer has no access to it.

## Data sent to search engines

Your browser sends your search terms, selected text and image addresses directly to the engines you chose, including an engine you switch to from the popup or with the keyboard shortcut, and to no one else. This is the same as searching on those sites yourself. For an image search, the engine’s server downloads the image from its address. How those sites handle your searches is governed by their own privacy policies.

## Permissions

- activeTab: when you click the toolbar button, reads the current tab’s URL to check whether it is a search results page. Chrome also grants this temporary access when you choose one of the extension’s right-click menu items or press its keyboard shortcut; the extension doesn’t use it then.
- contextMenus: adds two items to the right-click menu on web pages, one for selected text and one for images that have a public address.
- declarativeNetRequest: redirects only search URLs that carry the extension’s marker parameter “_ss” to the extension’s own page. It never blocks requests or modifies request or response headers.
- storage: stores the settings and split records described above.
- Site access: no site access is granted at install. Access to a specific search engine’s site is requested only when you click “Grant access” next to an engine on the settings page; adding an engine from the catalog requests nothing, and image search engines need no site access at all. You can revoke access at any time under “Site access” on the extension’s details page in chrome://extensions.

The extension does not run in Incognito windows. The keyboard shortcut is not set by default and works only after you set it on Chrome’s Keyboard shortcuts page.

## Data sharing

The extension does not share, sell or transfer data to anyone. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Data deletion

Closing a tab or the browser deletes the split records. Uninstalling the extension deletes the settings it stored on your device; if Chrome sync is on, synced data is handled by Chrome under its own rules. You can also delete custom engines and image search engines on the settings page, or revoke site access in chrome://extensions.

## Children

The extension is not directed at children and collects no personal information from anyone.

## Changes

If this policy changes, this page will be updated along with the effective date. If a new version changes how the extension handles data in a material way, the release notes will say so. Release notes for every version are at https://github.com/pine2D/split-search/blob/main/CHANGELOG.md.

## Contact

Developer: pine2D  
Contact: https://github.com/pine2D/split-search/issues
