# YT Rec Fix — agent / session rules

This file is for **humans and AI assistants** working in this repo.

---

## ⛔ CRITICAL: Firefox dev vs signed release (blocklist safety)

**Never** load the repo-root `manifest.json` as a temporary add-on in the same Firefox profile that has the **signed** YT Rec Fix `.xpi` installed — and **never** tell the user to disable the signed addon to test code.

### Why

Production and temporary builds used to share the same `gecko.id` (`yt-rec-fix@danney.ytaddon`). Disabling the signed build, loading temp from the repo, then re-enabling the signed build can **wipe `browser.storage.local`** (blocklist → 0) and reset optional host permissions.

### Correct workflow (dev ID)

1. Leave the **signed** release **enabled** (user’s real blocklist stays on production id).
2. Build the **dev** unpack with a **different** gecko id:

   ```bash
   npm run prepare:dev-firefox
   ```

3. Firefox → `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**
4. Select **`dist/firefox-dev/manifest.json`** (not the project root).
5. Dev id: `yt-rec-fix-dev@danney.ytaddon` — name shows as **YT Rec Fix DEV**.
6. After code changes: re-run `npm run prepare:dev-firefox`, then **Reload** the temporary addon; hard-reload YouTube.

### Release / upgrade testing

- Install a new signed `.xpi` **over** the existing signed install (do not mix with temp using the production id).
- Optional host permission re-prompt after manual `.xpi` upgrade is expected; blocklist should remain.

### What to remind the user (clearly)

At the **start** of any session that involves:

- testing in Firefox,
- `about:debugging`,
- temporary add-on load,
- or “try this change in the browser”,

state explicitly:

> **Use `npm run prepare:dev-firefox` and load `dist/firefox-dev/manifest.json`. Keep the signed addon enabled. Do not load root `manifest.json` or disable the signed .xpi for dev.**

If the user is about to do the old “disable signed → load temp from root” flow, **stop them** and point to this rule.

---

## ⛔ CRITICAL: PR / release — always production `gecko.id`

When preparing a **PR**, **version bump**, **`npm run build`**, AMO upload, or **GitHub release**:

| Step | gecko.id | Source |
|------|----------|--------|
| **Release / PR build** | **`yt-rec-fix@danney.ytaddon`** (unchanged) | Repo-root `manifest.json` → `npm run build` / `build:firefox` / `build:chrome` |
| **Local temp testing only** | `yt-rec-fix-dev@danney.ytaddon` | **Only** under `dist/firefox-dev/` via `npm run prepare:dev-firefox` |

### Rules

1. **Never** commit the DEV id into root `manifest.json`. Production id must stay `yt-rec-fix@danney.ytaddon` for all releases so Firefox treats the new `.xpi` as an **upgrade** of the same addon (storage/blocklist continuity).
2. `prepare:dev-firefox` only writes into **`dist/firefox-dev/`** (gitignored via `dist/`). It must not rewrite root `manifest.json`.
3. Release pipeline is always the real build:
   ```bash
   npm run build          # or build:firefox + build:chrome
   ```
   That packages **root** `manifest.json` → same production gecko id as previous releases.
4. Before tagging/releasing, agents should **confirm** root `manifest.json` still has `"id": "yt-rec-fix@danney.ytaddon"` (not `-dev@`).
5. When discussing “ship 0.x.y”, remind the user briefly:
   > **Release uses production id (`yt-rec-fix@danney.ytaddon`) via `npm run build`. DEV id is only for local temp load.**

---

## Product context (short)

- Firefox + Chrome MV3 extension: rec-blocklist + optional section hiding on YouTube.
- Section detectors live in `content/yt-rec-fix.js` (`SECTION_DETECTORS`).
- Popup toggles in `popup/popup.html` + `popup/popup.js`.
- Version in `manifest.json` + `package.json`; release notes in `CHANGELOG.md`.
- Local HTML/screenshots for new shelves go in `tmp/` (gitignored).

## Builds

- `npm run build` / `build:firefox` / `build:chrome` → **production** packages (gecko id `yt-rec-fix@danney.ytaddon` from root `manifest.json`)
- `npm run prepare:dev-firefox` → `dist/firefox-dev/` only (gecko id `yt-rec-fix-dev@danney.ytaddon`) — **not** for release
- Production gecko id: `yt-rec-fix@danney.ytaddon` (**required** for PR/release; never change casually)
- Dev gecko id: `yt-rec-fix-dev@danney.ytaddon` (**only** in `dist/firefox-dev`)
