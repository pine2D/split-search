---
layout: default
title: Privacy Policy
---

# Split Search Privacy Policy

[简体中文](privacy.zh-CN.html)

Effective date: 2026-10-24  
Policy URL: https://pine2d.github.io/split-search/privacy

Split Search (“the extension”) is a Chrome extension developed by pine2D. It opens a search in two search engines side by side in Chrome’s split view. This policy explains how the extension handles your data.

## In short: we collect no data

- The extension sends no data to the developer or any third party and does not sell data. It has no servers, makes no network requests, and contains no analytics, advertising, third-party code or remote code.
- It stores nothing except your settings (plus split-view tab IDs that are cleared when the browser closes; see item 4 below).
- To do its job, it reads a small amount of information on your device: the trigger URL of the search you start (including the search terms) and, when the current tab is already in a split view, the URL of the other tab. It uses that URL only to compare its origin and doesn’t store it. Each item is explained below.

## Data handled on your device

1. Trigger URLs and search terms. When you search using a trigger URL you added to Chrome (only URLs carrying the extension’s marker parameter “_ss” are handed to it), the extension reads that URL on your device, extracts the search terms and the engine IDs in “_ss”, builds the right-hand engine’s URL, and opens both engines’ result pages in two tabs. Search terms are not stored and are not sent to anyone other than those two engines.
2. URL of the other tab in a split view. When the current tab is already in a split view, the extension reads the other tab’s URL and checks only whether its origin belongs to one of your configured engines, to tell whether it opened that split view. It does not read your browsing history or any page content. Chrome provides that URL only for sites you have granted access to. It is used for that check only and is not stored.
3. Settings. Your search engines (names and URL templates), their order, hidden built-in engines, your default pair and the interface language you chose are stored in chrome.storage.sync. If you have Chrome sync turned on, Chrome syncs these settings across your devices through your Google Account; this is governed by Chrome’s and Google’s privacy policies, and the developer has no access to it.
4. Split records. Tab-ID pairs of split views the extension created are kept in chrome.storage.session, in memory only, and are cleared when the browser closes.

## Data sent to search engines

Your browser sends your search terms directly to the two engines you chose, exactly as if you had searched on those sites yourself. How those sites handle your searches is governed by their own privacy policies.

## Permissions

- declarativeNetRequest: redirects only search URLs that carry the extension’s marker parameter “_ss” to the extension’s own page. It never blocks requests or modifies request or response headers.
- storage: stores the settings and split records described above.
- Site access: no site access is granted at install. Access to a specific search engine’s site is requested only when you click “Grant access” next to an engine on the settings page. You can revoke it at any time under “Site access” on the extension’s details page in chrome://extensions.

The extension does not run in Incognito windows.

## Data sharing

The extension does not share, sell or transfer data to anyone. Its use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Data deletion

Uninstalling the extension deletes the settings it stored on your device; if Chrome sync is on, synced data is handled by Chrome under its own rules. You can also delete custom engines on the settings page or revoke site access in chrome://extensions.

## Children

The extension is not directed at children and collects no personal information from anyone.

## Changes

If this policy changes, this page will be updated along with the effective date. If a new version changes how the extension handles data in a material way, the release notes will say so.

## Contact

Developer: pine2D  
Contact: https://github.com/pine2D/split-search/issues
