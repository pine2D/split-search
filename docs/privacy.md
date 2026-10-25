---
layout: default
title: Privacy Policy
---

# Split Search Privacy Policy

[简体中文](privacy.zh-CN.html)

Effective date: 2026-10-25  
Policy URL: https://pine2d.github.io/split-search/privacy

Split Search (“the extension”) is a Chrome extension developed by pine2D. It opens a search in two search engines side by side in Chrome’s split view. This policy explains how the extension handles your data.

## In short: your data stays on your device

- The extension sends no data to the developer or any third party and does not sell data. It has no servers, makes no network requests, and contains no analytics, advertising, third-party code or remote code.
- Your browser sends your search terms only to the search engines you chose.
- The extension stores only your settings and a record of the split views it opened, which includes the search terms. That record is kept in browser memory and cleared when the browser closes (see item 2 below).
- To do its job, it reads the URL of the search you start on your device and, when needed, the URL of the other tab, which it doesn’t store. Each item is explained below.

## Data handled on your device

1. Trigger URLs and search terms. When you search using a trigger URL you added to Chrome (only URLs carrying the extension’s marker parameter “_ss” are handed to it), the extension reads that URL on your device, extracts the search terms and the engine IDs in “_ss”, builds the right-hand engine’s URL, and opens both engines’ result pages in two tabs.
2. Split records. After the extension opens a split view (or two tabs side by side when the window is narrow), it records in chrome.storage.session the IDs of the two tabs, the engine each tab shows, and the search terms. The toolbar popup uses this record to show the current search, and when you switch the right-side engine from the popup or with the keyboard shortcut, the extension uses it to build the new engine’s URL. The record stays in browser memory and is never synced or uploaded. A tab’s record is deleted when the tab closes, and all records are cleared when the browser closes, or when the extension is reloaded, updated or turned off.
3. URL of the other tab. To tell whether a pair of tabs is one it opened, the extension first checks the record in item 2. Without a record (for example after a browser restart), it reads the other tab’s URL and compares only its origin and path, to see whether it looks like a results page of one of your configured engines. Chrome provides that URL only for sites you have granted access to. The URL is used for that check only and is not stored. The extension does not read your browsing history or any page content.
4. Settings. Your search engines (names and URL templates), their order, hidden built-in engines, your default pair, the interface language, how narrow windows are handled, and which engines the keyboard shortcut rotates through are stored in chrome.storage.sync. They contain no search terms. If you have Chrome sync turned on, Chrome syncs these settings across your devices through your Google Account; this is governed by Chrome’s and Google’s privacy policies, and the developer has no access to it.

## Data sent to search engines

Your browser sends your search terms directly to the search engines you chose, including an engine you switch to on the right side from the popup or with the keyboard shortcut, and to no one else. This is the same as searching on those sites yourself. How those sites handle your searches is governed by their own privacy policies.

## Permissions

- declarativeNetRequest: redirects only search URLs that carry the extension’s marker parameter “_ss” to the extension’s own page. It never blocks requests or modifies request or response headers.
- storage: stores the settings and split records described above.
- Site access: no site access is granted at install. Access to a specific search engine’s site is requested only when you click “Grant access” next to an engine on the settings page; adding an engine from the catalog requests nothing. You can revoke it at any time under “Site access” on the extension’s details page in chrome://extensions.

The extension does not run in Incognito windows. The keyboard shortcut is not set by default and works only after you set it on Chrome’s Keyboard shortcuts page.

## Data sharing

The extension does not share, sell or transfer data to anyone. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Data deletion

Closing a tab or the browser deletes the split records. Uninstalling the extension deletes the settings it stored on your device; if Chrome sync is on, synced data is handled by Chrome under its own rules. You can also delete custom engines on the settings page or revoke site access in chrome://extensions.

## Children

The extension is not directed at children and collects no personal information from anyone.

## Changes

If this policy changes, this page will be updated along with the effective date. If a new version changes how the extension handles data in a material way, the release notes will say so. Starting with v0.3.0, the extension keeps search terms in browser memory (see item 2).

## Contact

Developer: pine2D  
Contact: https://github.com/pine2D/split-search/issues
