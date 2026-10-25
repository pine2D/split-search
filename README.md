# Split Search

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md)

Search from the address bar or drag text to the tab strip, and Split Search opens results from two search engines side by side in Chrome’s split view, so you can compare them.

![Chrome split view with DuckDuckGo on the left and Bing on the right, both showing results for “rust programming”](assets/readme/en/hero.png)

## Features

- Works from the address bar, from text dragged to the tab strip, and from the Search [engine] for “…” item in Chrome’s right-click menu
- On a results page from one of your engines, click the toolbar button and pick another engine to open the same search next to it in a split view
- Select text on a web page and right-click to look it up in a split view, with the page staying on the left
- Right-click an image to search it with Google Lens or another image search engine, next to the page you’re on
- Google, Bing, DuckDuckGo, Perplexity and Kagi are built in, and you can add other search engines
- The engine catalog has translation, reference, video, map and other sites that work well on the right side, plus AI assistants, ready to add
- Set up several engine pairs, each with its own shortcut. For example, type “gb your search” to compare Google and Bing
- Click the toolbar button to switch the right side to another engine without searching again
- Or press a keyboard shortcut to switch the right side to the next engine. No shortcut is set by default; set one at `chrome://extensions/shortcuts`
- When the window is narrow, the right side opens in a background tab next to the left one instead. You can turn this off on the settings page
- Both sides are regular tabs, so you stay signed in and your site settings still apply

## Install

Requires Chrome 155 or later.

1. Download this repository, open `chrome://extensions` and turn on “Developer mode” in the top-right corner.
2. Click “Load unpacked” and select the `src` folder in the repository.
3. The settings page opens automatically after installation.

## Setup

1. **Grant access**: on the settings page, click “Grant access” for each engine you want to use.
2. **Copy the URL**: under “Default pair”, pick a left and a right engine, then copy the generated URL from “Add to Chrome”.
3. **Add it and make it default**: enter `chrome://settings/searchEngines` in the address bar. Under “Site search”, click “Add”. Enter any name and a shortcut of your choice (for example, `gb`), paste the URL you copied into “URL with %s in place of query” and click “Add”. Then open the ⋮ menu next to the new entry and choose “Make default”.

If you only want the shortcut, skip “Make default” and type “shortcut + space + search terms” in the address bar. Dragged text and Chrome’s own right-click search then still use your current default search engine.

## Good to know

- In Incognito windows, on other devices, or when the extension isn’t active, you get a normal search.
- After you choose “Make default”, the address bar no longer shows search suggestions.
- Only images with a public address can be searched, and engines usually can’t get images that need a sign-in.

## Privacy

Split Search sends nothing to the developer or any other third party, and what you look up goes only to the engines you chose. It has no servers, analytics or ads. It reads the selected text or an image’s address only when you choose one of its right-click menu items, and it doesn’t read the page’s URL or anything else on the page. What you searched and the two engines are kept in browser memory so the popup and keyboard shortcut can switch engines, and they’re cleared when you close the browser. Read the [privacy policy](https://pine2d.github.io/split-search/privacy).
