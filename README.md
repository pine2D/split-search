# Split Search

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md)

Search from the address bar or drag text to the tab strip, and Split Search opens results from two search engines side by side in Chrome’s split view, so you can compare them.

![Chrome split view with DuckDuckGo on the left and Bing on the right, both showing results for “rust programming”](assets/readme/en/hero.png)

## Features

- Compare two engines from the address bar or by dragging text onto the tab strip. Pick your engines, add your own, and set up several pairs, each with its own shortcut
- Right-click selected text or an image to look it up next to the page you’re on
- Click the toolbar button to switch the right side to another engine without searching again
- The right-side engine can switch automatically by keyword, for example to YouTube when your search contains “video”

## Install

Requires Chrome 155 or later.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/Split%20Search/ebefmgpipceocigodihbbbhdiagmjdak)**

To install it manually:

1. Download `split-search-<version>.zip` from [Releases](https://github.com/pine2D/split-search/releases/latest) and unzip it.
2. Open `chrome://extensions`, turn on “Developer mode” in the top-right corner, click “Load unpacked” and select the unzipped folder.
3. The settings page opens automatically after installation.

To update, unzip the new version into the same folder and click “Reload” on the extension’s card. A different folder counts as a different extension, and your settings won’t carry over.

## Setup

The first time you open the settings page, the “Get started” card on the “Add to Chrome” tab walks you through these steps and ends with a test search.

1. **Grant access**: on the “Search engines” tab of the settings page, click “Grant access” for each engine you want to use.
2. **Copy the URL**: on the “Search pairs” tab, pick a left and a right engine for the default pair. Then copy the generated URL on the “Add to Chrome” tab.
3. **Add it and make it default**: enter `chrome://settings/searchEngines` in the address bar. Under “Site search”, click “Add”. Enter any name and a shortcut of your choice (for example, `gb`), paste the URL you copied into “URL with %s in place of query” and click “Add”. Then open the ⋮ menu next to the new entry and choose “Make default”.

## Good to know

- After you choose “Make default”, the address bar no longer shows search suggestions.
- In Incognito windows or on other devices, you get a normal search.

## Privacy

What you look up goes only to the search engines you choose, never to the developer or any other third party. Split Search has no servers, analytics or ads. To open the split view, it reads your search URL and the current tab’s URL on your device and doesn’t store them. It reads selected text or an image’s address only when you use its right-click menu. Your searches are kept in browser memory and cleared when you close the browser. Read the [privacy policy](https://pine2d.github.io/split-search/privacy).
