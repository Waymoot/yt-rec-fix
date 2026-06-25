# YT Rec Fix — Privacy Policy

**Last updated:** 2026-06-25  
**Applies to:** YT Rec Fix browser extension (Firefox and Chrome), version 0.2.0 and later.

**Also published at:** https://danne.lindskog.eu/yt-rec-fix/#privacy-heading

---

## Summary

YT Rec Fix runs entirely in your browser on YouTube pages you already have open. Blocklist, settings, and section-hide preferences are stored locally on your device. Normal browsing on YouTube is handled by your browser and YouTube — not by data collection performed by this extension.

Network activity is limited to normal YouTube requests triggered by automated UI actions **when you click Watched, Dislike, or Ch** — the same actions as using YouTube's own menus.

There is **no analytics**, **no external servers operated by the developer**, and **no accounts**.

---

## What we store (locally only)

When you block videos or change settings, YT Rec Fix saves the following in your browser's local extension storage (`browser.storage.local` / `chrome.storage.local`):

- Blocked video IDs and optional channel keys for the local blocklist
- Extension settings (hide blocked videos, inject buttons, auto-block on watch, prefer dislike reason, optional Ch button)
- Section-hide toggles (Shorts, Explore more topics, Most relevant, channel For You, channel Feature)
- Debug mode preference

This data **never leaves your browser** through YT Rec Fix. It is not transmitted to the developer or to any third-party service operated by the developer.

---

## What we do not collect

YT Rec Fix does **not** collect, store, or transmit to the developer:

- Personal identifying information (name, email, address, etc.)
- Browsing history outside what you already do on YouTube in your browser
- Authentication credentials
- Financial or payment information
- Health information
- Location data
- Analytics or usage telemetry

The developer cannot see your blocklist, settings, or YouTube activity.

---

## Network activity

The extension does not add its own backend or proxy. The only network requests related to extension actions are normal YouTube requests that occur when you use the feedback buttons (Watched / Dislike / Ch) — equivalent to using YouTube's native "Not interested" flow yourself.

---

## Your control

You can at any time:

- Clear all blocked videos from the toolbar popup
- Toggle any feature off in the popup
- Uninstall the extension
- Clear extension data in your browser settings to remove stored blocklist and settings

---

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Save blocklist and settings on your device only |
| `activeTab` | Refresh the current YouTube tab from the popup when you request it |
| `tabs` | Find and reload the active YouTube tab from the popup (e.g. after granting site access) |
| `https://www.youtube.com/*` (host) | Run on YouTube to inject buttons, hide blocked cards, and hide optional page sections |

**Firefox:** `data_collection_permissions` is set to **none** in the extension manifest.

**Chrome:** Host access is declared as `host_permissions` for `https://www.youtube.com/*` only. No other sites are accessed.

---

## Third parties

YT Rec Fix is **not affiliated with, endorsed by, or supported by Google LLC or YouTube**. The extension does not use the YouTube API. YouTube's own privacy policy applies to your use of youtube.com.

---

## Children's privacy

YT Rec Fix is not directed at children under 13 and does not knowingly collect personal information from anyone.

---

## Changes to this policy

If this policy changes, the "Last updated" date above will be revised. Material changes will be reflected in store listings before updates when practical.

---

## Contact

- **Issues / questions:** https://github.com/Waymoot/yt-rec-fix/issues
- **Source code:** https://github.com/Waymoot/yt-rec-fix