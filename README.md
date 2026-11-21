# Split Search

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md)

Search once and compare results from two search engines side by side in Chrome’s split view.

![Chrome split view with DuckDuckGo on the left and Bing on the right, both showing results for “rust programming”](assets/readme/en/hero.png)

## Features

- Search from the address bar or drag text to the tab strip to open two engines side by side. Add custom engines and set up multiple pairs, each with its own shortcut.
- Right-click selected text or an image to look it up next to the page you’re reading.
- Click the toolbar icon on a configured engine’s results page to add a second engine on the right, or switch the right-side engine anytime from the toolbar or with a keyboard shortcut without retyping.
- Automatically switch the right-side engine by keyword or writing system (for example, use YouTube when a search contains “video” and optionally strip that word).

## Install

Requires Chrome 155 or later.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/Split%20Search/ebefmgpipceocigodihbbbhdiagmjdak)**

Manual install:

1. Download `split-search-<version>.zip` from [Releases](https://github.com/pine2D/split-search/releases/latest) and unzip it.
2. Open `chrome://extensions`, turn on “Developer mode” in the top right, click “Load unpacked”, and select the unzipped folder.
3. The settings page opens automatically.

To update, extract the new release into the same folder and click “Reload” on the extension card. Using a different folder creates a separate extension without your saved settings.

## Quick start

Use it right on results pages: open a Google or Bing results page, click Split Search in the toolbar, and pick a second engine. Your default search stays untouched. Or open “Get started” in settings, grant access to the left engine, and click “Run example search”.

To split searches directly from the address bar, add a site search in Chrome:

1. Pick your left and right engines under “Search pairs” (grant access to the left engine if prompted), open “Add to Chrome”, copy the pair URL, and click “Open Chrome search settings”.
2. Click “Add” next to “Site search”, enter a name and shortcut (such as `gb`), paste the URL into “URL with %s in place of query”, and click “Add”.
3. Type the shortcut in the address bar, press Tab, then enter your search. To also split direct searches and text dragged to the tab strip, open the entry’s ⋮ menu and choose “Make default” (default site searches don’t show address bar search suggestions).

## Notes

- Under “Search pairs”, you can turn on “Close both tabs when you close either side” (off by default). It applies only to search split views opened by Split Search in the current browser session, even after clicking links; right-click lookups and adjacent tabs in narrow windows stay separate. Closing a tab immediately after separating a split view may still close the other tab.
- In windows narrower than 960 px, results open in adjacent tabs by default: searches open the second engine in the background, while right-click lookups switch to the lookup tab.
- In Incognito windows, on other devices without the extension, or before left-engine access is granted, the pair URL runs a normal search on the left engine.

## Privacy

Search terms, selected text, and image URLs go only to the engines you choose, never to the developer or any other third party. Split Search has no servers, analytics, or ads. It reads search URLs and the active tab’s URL locally to open split views without storing those URLs, reads selected text or image URLs only when you click its context-menu items, and keeps active split queries in browser memory only until the browser closes. See the [privacy policy](https://pine2d.github.io/split-search/privacy).
