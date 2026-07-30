# Changelog

All notable changes to **YT Rec Fix** (*YouTube Recommendation Fix*) are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.4] — 2026-07-30

### Added

- **Hide "Breaking news" on Home** — new toggle for YouTube’s news Shorts shelf (`ytd-rich-shelf-renderer` titled “Breaking news”). This shelf is **not** the same as regular Shorts (`is-shorts`); it uses `ytd-rich-grid-media` items linking to `/shorts/…`, so it needs its own detector. Checkbox under **Hide sections** in the popup. Tested on Firefox and Chrome.

## [0.2.3] — 2026-07-09

### Fixed

- **Hide Shorts on search results** — no longer triggers repeated search reloads / duplicate fetches. YouTube’s new `grid-shelf-view-model` Shorts shelf on `/results` is hidden correctly (only the inner shelf, not parent `ytd-item-section-renderer` wrappers). Fixes the loop that could stack dozens of hidden Shorts sections in the DOM.
- **Search Shorts hiding** uses soft-collapse CSS on `/results` (not `display: none`) to avoid provoking YouTube resize-observer refetches.

### Changed

- **Verbose section debug is off by default** — the extended trace tooling (`dumpDebugTrace`, `listShortsSections`, page-console `__YT_REC_FIX__`, search-fetch timeline, section `#id` markers) remains in source behind `VERBOSE_SECTION_DEBUG = false` in `content/yt-rec-fix.js`. Popup **Debug** still enables the original v0.2 section scans, on-page markers, and feedback/network logging. Set the flag to `true` and reload the extension when deep-diving Shorts/search issues.

## [0.2.2] — 2026-07-03

### Added
- **Hide "Popular videos" on channel pages** — new toggle to hide the "Popular videos" (and Swedish "Populära videos") horizontal shelf that appears on channel home pages, right next to the existing "For You" shelf. Checkbox placed under "For You" in the popup's **Hide sections** area.
- Supports both English and localized titles. Uses the same `ytd-shelf-renderer` + channel page detection pattern.

## [0.2.0] — 2026-06-24

### Added — Hide sections on YouTube

- **Section hiding framework** — hide whole shelves without affecting normal video grids or the rec-blocklist logic.
- **Popup: “Hide sections”** — grouped toggles (separate from recommendation settings):
  - **Shorts** — feed/subscriptions (`ytd-rich-shelf-renderer[is-shorts]`) and **channel** Shorts (`ytd-reel-shelf-renderer`).
  - **Explore more topics** — topic chip shelves on Home/feed.
  - **Most relevant** — “Most relevant” shelves on feed-style pages.
  - **Channel For You** — horizontal recommendation shelf on channel home.
  - **Channel Feature** — single promoted “Feature” card (`ytd-channel-featured-content-renderer`).
- **Debug section scans** — with debug enabled, automatic `[YT-Rec-Fix]` console tables when sections change (no manual console commands).
- **Debug markers** — optional on-page `hidden section (…)` placeholders when debug is on.
- **Wider popup** — three sections: Recommendations · Hide sections · Debugging (two-column toggles).

### Changed

- Product naming: **YT Rec Fix** = short name; full name **YouTube Recommendation Fix**; v0.2 tagline adds **Section Hider**.
- `findSectionContainers()` now includes `ytd-item-section-renderer` (channel pages), not only `ytd-rich-section-renderer`.
- README rewritten for v0.2 (English, screenshots, privacy, install).

### Migration

- Settings key `hideChannelPromote` renamed to `hideChannelFeature` (auto-migrated on load).

### Known issues (after release)

- After manual `.xpi` upgrades, Firefox may re-prompt for host permission. Right-click the icon → **Always Allow on www.youtube.com** (see README Install section for details). We are investigating optional_host_permissions to improve this.

## [0.1.6] — earlier

### Recommendation blocking (core)

- One-click **Watched** / **Dislike** buttons on recommendation cards with full “Not interested” + “Tell us why” automation.
- Persistent **local blocklist** and instant card hiding.
- Optional **Ch / Don't recommend channel** (off by default).
- Auto-block on `/watch` pages, debug logging, reduced feedback UI flash.
- Firefox MV3, `storage.local`, unlisted signed `.xpi` releases.

[0.2.4]: https://github.com/Waymoot/yt-rec-fix/releases/tag/v0.2.4
[0.2.3]: https://github.com/Waymoot/yt-rec-fix/releases/tag/v0.2.3
[0.2.2]: https://github.com/Waymoot/yt-rec-fix/releases/tag/v0.2.2
[0.2.0]: https://github.com/Waymoot/yt-rec-fix/releases/tag/v0.2.0