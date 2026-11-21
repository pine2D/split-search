---
layout: default
title: Privacy Policy
---

# Split Search Privacy Policy

[简体中文](privacy.zh-CN.html)

Effective date: 2026-10-27  
Policy URL: https://pine2d.github.io/split-search/privacy

Split Search (“the extension”) is a Chrome extension developed by pine2D. It opens search results from two engines side by side in Chrome’s split view, or looks up selected text and images next to the page you are reading. This policy explains how the extension handles data.

## Core principle: queries go only to the engines you choose, never to the developer or other third parties

- The extension sends no data to the developer or any third party and does not sell data. It has no servers, makes no network requests of its own, and contains no analytics, advertising, third-party code, or remote code.
- Your browser sends search terms, selected text, and image URLs directly to the search engines you choose.
- The extension stores only your settings and temporary session records of open split views (including what was searched; kept only in browser memory and cleared when the browser closes, as detailed in item 4).
- To open and manage split views, the extension reads locally on your device: the search URL you trigger; selected text or an image URL when you click its right-click menu items; the active tab’s URL when you click the toolbar icon; and, when needed, the paired tab’s URL. None of these URLs are stored.

## Data handled on your device

1. Pair URLs and search terms. When you search using a pair URL added to Chrome (only URLs carrying the extension’s `_ss` parameter reach the extension), the extension reads that URL locally, extracts the search terms and engine IDs from `_ss`, builds the right-side engine URL, and opens both result pages in two tabs.
2. Selected text and image URLs from the right-click menu. Only when you click one of the extension’s context-menu items does it read the selected text (up to 500 characters) or image URL passed by Chrome. Text goes only to your chosen text lookup engine, and image URLs go only to your chosen image search engine (whose server fetches the image). The extension uses no content scripts, never reads the page URL or other page content, and opens lookup tabs without sending the source page’s Referer; selections inside editable fields are ignored. An image URL may reveal its source site, or carry temporary access tokens (such as signed URLs) that let the chosen engine fetch the image.
3. Active tab URL. Clicking the toolbar icon grants temporary `activeTab` access to the current tab. The popup reads that tab’s URL locally to check whether it matches a configured search engine’s results page and extract its search terms (also matching them locally against your keyword rules to order suggestions), so you can open a second engine beside it. The URL is neither stored nor sent anywhere; if you open a split view from the popup, the query is recorded in memory as in item 4.
4. Split records. When opening a split view (or adjacent tabs in narrow windows), the extension stores in `chrome.storage.session` the two tab IDs, each tab’s role (search, original page, or lookup), the engine shown, and the query (search terms, selected text, or image URL; plus the matched rule ID and original right engine when switched by a keyword rule), with no page URLs; if linked closing is enabled, paired tab IDs are also noted. The popup and keyboard shortcut use this record to display the active query and switch engines. Records stay in browser memory, are never synced or uploaded, and are deleted when a tab closes or cleared completely when the browser closes or the extension reloads, updates, or is disabled.
5. Paired tab URL. To check whether a tab pair belongs to Split Search, the extension first checks item 4. If no record exists (such as after a browser restart), handling a search, opening the popup, or pressing the shortcut reads the other tab’s URL (only on sites you granted access to) and checks only its origin, path, and whether a query parameter is present. It never overwrites an existing tab based on that check, opening a new pair beside it instead. Right-click lookups do not check the other tab’s URL. The URL is not stored, and browsing history is never read.
6. Settings. Configured engines, order, hidden built-in engines, default pair, interface language, narrow-window and linked-closing switches, shortcut rotation choices, lookup and image search engines, and keyword rules are saved in `chrome.storage.sync`. They never contain search queries, selected text, or image URLs (rule words are typed manually in settings, never taken from searches). If Chrome sync is enabled, Chrome syncs these settings under Google’s privacy policies without developer access. One local status flag in `chrome.storage.local` notes whether a site search URL has opened a result pair so first-run setup prompts can collapse once completed; tab IDs from “Run example search” stay in `chrome.storage.session` only until the browser closes.

## Data sent to search engines

Your browser sends your search terms, selected text, and image URLs directly to the engines you choose, including an engine you switch to from the popup or with the keyboard shortcut, and to no one else. This is the same as searching on those sites yourself. For an image search, the engine’s server fetches the image from its URL. How those sites handle your searches is governed by their own privacy policies.

## Permissions

- activeTab: when you click the toolbar icon, reads the current tab’s URL to check whether it is a search results page. Chrome also grants this temporary access when you choose one of the extension’s right-click menu items or press its keyboard shortcut, though the extension does not read the tab URL then.
- contextMenus: adds two items to the right-click menu on web pages, one for selected text and one for images with a public URL.
- declarativeNetRequest: redirects only search URLs carrying the extension’s `_ss` marker parameter to the extension’s own page. It never blocks other requests or modifies request or response headers.
- storage: stores the settings and split records described above.
- Site access: no site access is granted at install. Access to a specific search engine’s site is requested only when you click “Grant access” for an engine on the settings page; adding an engine from the catalog requests nothing, and image search engines need no site access at all. You can revoke access at any time under “Site access” on the extension’s details page in `chrome://extensions`.

The extension does not run in Incognito windows. The keyboard shortcut is not set by default and works only after you set it on Chrome’s Keyboard shortcuts page.

## Data sharing

The extension does not share, sell, or transfer data to anyone. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Data deletion

Closing a tab or the browser deletes the split records. Uninstalling the extension deletes the settings stored on your device; if Chrome sync is on, synced data is handled by Chrome under its own rules. You can also delete custom engines, image search engines, and keyword rules on the settings page, or revoke site access in `chrome://extensions`.

## Children

The extension is not directed at children and collects no personal information from anyone.

## Changes

If this policy changes, this page will be updated along with the effective date. If a new version changes how the extension handles data in a material way, the release notes will say so. Release notes for every version are at https://github.com/pine2D/split-search/blob/main/CHANGELOG.md.

## Contact

Developer: pine2D  
Contact: https://github.com/pine2D/split-search/issues
