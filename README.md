# YT Rec Fix (Watched Blocker)

**Repository:** https://github.com/Waymoot/yt-rec-fix

Firefox addon that makes it trivial to tell YouTube "I watched this and don't want it recommended again", plus **reliable local client-side hiding** of watched/re-blocked videos so they stop appearing in recommendations immediately.

Addresses the pain: manually clicking through 5 steps (⋯ → Not interested → Tell us why → checkboxes → Submit) is tedious and often ineffective. This addon reduces it to 1 click and guarantees the video won't show up again for you via local suppression.

### This is what you have to click today

<div align="center">
  <img src="images/addon_01.png" width="70%" alt="This is what you have to click today" />
</div>

### Now you can do it in one click!

<div align="center">
  <img src="images/addon_02.png" width="45%" alt="One click: Watched button" />
  <img src="images/addon_04.png" width="45%" alt="One click: Dislike + Channel button" />
</div>

## Features (v0.1.6)
- **Reduced flash of intermediate UI**: The temporary "Video removed" + "Tell us why" state that appears during automation is now suppressed almost immediately after we submit the reasons (new in this version). The automation itself remains fully reliable.
- Adds small, quick buttons directly on recommended video cards (homepage, sidebar related, etc.):
  - "Watched" — triggers full "Not interested" + "I've already watched the video" (+ optionally "I don't like").
  - "Dislike" — stronger negative signal.
  - "Ch" / "Don't recommend channel" — **opt-in only via popup checkbox (default: OFF)**. This is a very hard/irreversible action on YouTube that cannot be easily rolled back, so the button is not shown by default to prevent misclicks. Local channel hiding (for any channels you have previously acted on) continues to work under the main "Hide blocked / watched videos" toggle.
- **Local persistent blocklist**: once blocked or auto-tracked as watched, matching recommendations are hidden instantly using DOM scanning. Survives reloads, navigation, browser restarts.
- **Reduced flash of intermediate UI** (new in 0.1.6): The temporary "Video removed" + "Tell us why" panel that YouTube shows during the flow is now hidden almost immediately after we successfully submit the chosen reasons. This makes the experience cleaner for users while the automation (clicks + network signals) remains fully reliable.
- Auto-tracks videos you open on `/watch` pages (configurable).
- Popup with:
  - Blocked count.
  - Toggles for hiding, buttons, auto-track, **"Show 'Ch' / Don't recommend channel" (off by default — irreversible YT action)**, reason preference, debug.
  - One-click clear.
- Works on YouTube's various card renderers (rich grid, compact sidebar, lockup view models, etc.).
- All client-side, no data sent anywhere except the normal YouTube feedback actions you would have triggered yourself.

## Install (Development / Temporary)
Clone the repo (or download a zip of the folder):

```bash
git clone https://github.com/Waymoot/yt-rec-fix.git
cd yt-rec-fix
```

1. In Firefox, go to `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on...".
3. Select the `manifest.json` file inside this folder.
4. (First time) You may need to grant "Access your data for www.youtube.com" / host permission via the puzzle piece menu or Add-ons Manager for the extension.
5. Open https://www.youtube.com and test.

For repeated development:
- `npm install -g web-ext` (optional but recommended)
- Then `npm run dev` (or `web-ext run --target=firefox-desktop`) from the project root (auto-reloads on file changes). Requires Node.

Reload the addon in about:debugging after edits.

**Native Windows / PowerShell note**: The default `npm run dev` works directly when running natively on Windows (Firefox is usually auto-detected). Use `npm run dev:win` (and edit the path in package.json if needed) for a pre-configured Windows Firefox location. No WSL path translation required.
## Install (Latest Unlisted Version)

For normal use, download the latest signed unlisted version from GitHub Releases (signed by Mozilla, not listed in the public store).

1. Go to the [latest release](https://github.com/Waymoot/yt-rec-fix/releases/latest).
2. Download the `.xpi` file.
3. In Firefox, go to `about:addons`.
4. Click the gear icon (top right) → "Install Add-on From File...".
5. Select the downloaded `.xpi` file.

**Notes:**
- This version is **unlisted** — it will not appear in AMO search and will **not auto-update**. Check the releases page for new versions.
- The addon is signed by Mozilla, so it works on regular Firefox releases.
- For development or testing the latest code, use the temporary load method above.

## Contributing
Issues and pull requests welcome. This project is set up so Grok (in this environment) can drive changes, reviews (`/review`), PR babysitting, and stacked work using the authenticated `gh` CLI + git after the initial setup.

See the session plan for the GitHub access method (gh CLI is primary; GitHub MCP server is also configured for tool calls).


## Usage
- Browse YouTube normally.
- On recommendation cards you don't want: click the small button(s) that appear (top-right of the card thumbnail area or details).
- Watched videos you visit will be added to the blocklist (if toggle enabled) so future recs hide them.
- Use the toolbar icon popup for stats, settings, and clearing the list.
- After using the buttons, the video should quickly disappear from the current view and be suppressed going forward (local guarantee + YT signal attempt).

Tips for best results:
- Use the "Dislike" variant for videos you actively disliked.
- The addon still lets YouTube's own watched badges and progress work; we layer on top.
- If YT changes their UI, buttons or automation may stop working temporarily — local hiding continues to function. Update selectors as needed (see content script).

The toolbar icon opens a popup with stats and settings:

<div align="center">
  <img src="images/addon_03.png" width="52%" alt="Popup settings and toggles for the addon" />
</div>

This is the popup with settings and adjustments you can make for the addon:
- **Blocked videos** count (live updating).
- **Hide blocked / watched videos in recs** — master toggle for local hiding.
- **Show quick block buttons on recommendations** — injects the Watched / Dislike / (Ch) buttons on rec cards.
- **Show "Ch" / "Don't recommend channel" button** — off by default (irreversible YT action).
- **Auto-block videos when I visit/watch them**.
- **Prefer "I don't like the video" reason** (stronger negative signal).
- **Enable debug logging (console)**.
- Buttons to clear the blocklist or refresh the current YouTube tab.

## How it works (technical)
- Content script + MutationObserver + periodic scan for robustness on a heavy SPA.
- Video ID extraction from standard `a[href*="watch?v="]` links (11-char IDs).
- Storage: `blockedVideoIds` array + settings object.
- Menu automation adapted from proven patterns (label + icon SVG matching for "Not interested", "Don't recommend channel"; follow-up reason chooser for "Tell us why"). The "Don't recommend channel" button itself is now gated behind an explicit user setting (default off) per the update request.
- **Important execution detail (2026)**: Local visual hiding is deliberately deferred until *after* the full feedback automation (Not interested + Tell us why reason panel with "I've already watched the video" / "I don't like the video" + Submit) has run against the live UI that YouTube creates. Hiding the card too early would also hide the replacement panel ("the new card that YT creates") containing the buttons we need to press for the detailed signal. See `screenshots/Tell_us_why.png` + `Tell_us_why_submit.png` (and the code comments in handleBlockAction / triggerYouTubeFeedback).
- As a UX improvement, the intermediate "Video removed" / Tell us why panel that YouTube shows during the flow is now hidden immediately after our automated submit (right after the clicks succeed). This greatly reduces the visible flash of that temporary state while still allowing the full reason selection to complete reliably.
- When "Enable debug logging" is on, the automation produces very detailed console output + intercepts the actual `youtubei/v1/feedback` (and related) calls that YouTube's client code makes as a result of the simulated clicks. This gives much stronger evidence that the "watched / not interested / don't like" feedback was transmitted than before. The waitFor polling + broader discovery of the current reason panel helps reliability across YT UI variations.
- Local hide uses a `data-yt-rec-fix-hidden` attribute + CSS for clean suppression (easy to toggle).
- No background page needed initially.

## Verification / Testing the Fix
See the plan.md (in session) or manually:
1. Load addon.
2. Go to home page, find 2-3 rec videos you recognize as recently watched or uninteresting.
3. Use the addon buttons on them.
4. Hard refresh or navigate away and back: they should be gone.
5. Watch a new video fully: check that it gets blocked (visit home — it shouldn't reappear in recs).
6. Use popup clear and confirm recs can return when list empty.
7. Check browser console with debug on for logs.
   With debug enabled you now get:
   - Step-by-step traces inside triggerYouTubeFeedback (menu found via which selector, every menu item text+SVG match result, "Tell us why", exact checkbox label texts discovered, which reasons were clicked, submit).
   - Confirmation of real network signals: look for `[YT-Rec-Fix] YT network: POST .../youtubei/v1/feedback...` (and the payload snippet). This is the actual evidence sent to YouTube.
   - Post-action UI evidence scan (toast / "Undo" / improvement banner if YT renders one).
   - Console helpers: `window.__YT_REC_FIX__.debugTriggerOnFirstCard('dislike')` or pass your own card element.

## Limitations & Notes
- Click simulation for YT feedback is inherently a bit brittle (YouTube frequently updates web components, class names, and the exact menu/dialog structure). The local blocklist is the dependable part of the "fix".
- Current icons are simple solid red squares (generated at scaffold time). Replace `icons/*.png` with proper artwork before any store submission.
- Only targets desktop www.youtube.com primarily (add mobile if needed).
- Does not remove videos from playlists, subscriptions, search (unless they match block criteria in results), or "Watch again" rows you might want.
- "Don't recommend channel" (and per-video signals) are sent via the UI the same way a human would; effectiveness depends on YouTube. Because this channel action is irreversible on YT, the button is hidden unless you enable the dedicated popup checkbox ("Show 'Ch' / ..."). Local hiding of channels is still available and independent of whether the button is shown.
- For production AMO listing: add better icons, screenshots, privacy policy, more testing, perhaps a full options page for blocklist management.

## Roadmap / Ideas
- Blocklist viewer + per-item unblock + titles.
- Keyword / title pattern blocking.
- Better progress detection for "ended" auto-block.
- Options page.
- Export/import block list (JSON).
- Support more surfaces (endscreen, shorts if desired).

## Development

### Loading the Temporary Add-on (for development)

See the "Install (Development / Temporary)" section above for basic steps.

**Important notes and common pitfalls** (from real testing):
- Make sure you completely remove any previously installed `.xpi` version of the addon first (same extension ID). Having both the signed `.xpi` and a temporary load active at the same time causes conflicts.
- You will often see a green dot on the extension icon and messages like "Behörigheter behövs" / "Kör endast för detta besök" (Permissions needed / Only run for this visit).
- The content script may not auto-inject on YouTube pages until you explicitly grant host permission: click the puzzle piece menu (or the addon icon) → find YT Rec Fix → click the cogwheel/settings → allow "Access your data for www.youtube.com" (or equivalent).
- After granting, hard reload the YouTube tab. The addon should then work without having to click the addon icon after every page reload.
- After editing files (especially popup), use the **Reload** button for the temporary addon in `about:debugging` to pick up the changes (popup HTML/CSS/JS changes are not always hot-reloaded automatically).
- For a smoother dev experience: `npm run dev` (or `web-ext run --target=firefox-desktop`). This uses the local web-ext and supports auto-reload on file changes.

- Main logic lives in `content/yt-rec-fix.js` (will be the largest file).
- Use the debug toggle in the popup + browser console for logs.
- To inspect current YT menus: right-click a rec → Inspect, trigger the real 3-dot menu, look at the rendered `ytd-menu-popup-renderer`, `ytd-dismissal-follow-up-renderer`, checkboxes, etc. Update matching code accordingly.
- Keep selectors defensive (arrays of fallbacks + text/SVG matching).

## Credits / Inspiration
- Patterns and robustness tricks drawn from open work:
  - "Nah - Youtube Not Interested Button" (https://github.com/lozog/not-interested-youtube)
  - "Youtube 1-Click Not-Interested" userscript (https://github.com/kannanmavila/youtube-1-click-not-interested)
  - RYS — Remove YouTube Suggestions (https://github.com/lawrencehook/remove-youtube-suggestions) for overall YT extension architecture and dynamic handling.
- YouTube user frustration reports around weak "watched" signals.

## License
MIT or whatever you prefer for personal tool. (Add explicit license file if distributing.)

---

Made to solve one specific annoying loop. Local control > hoping the algo listens.
