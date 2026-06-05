// YT Rec Fix - content script
// Focused on stopping re-recommendation of watched videos via:
// 1. One-click full feedback automation (Not interested + Tell us why reasons).
// 2. Reliable persistent local hiding of blocked/watched video IDs.
// Reuses patterns from public YT extension/userscript work (label+SVG matching, follow-up dialog handling,
// storage polyfill, observer+interval, multiple renderer support).

(function () {
  'use strict';

  // --- Guard: only top level YT, not iframes or sandboxes ---
  if (window !== window.top ||
      !window.location.hostname.includes('youtube.com') ||
      document.documentElement.hasAttribute('sandbox')) {
    return;
  }

  const ext = (typeof browser !== 'undefined' ? browser : chrome);

  // --- Config / constants ---
  const DEBUG = false; // overridden by settings
  const POLL_INTERVAL_MS = 1800;
  const DEBOUNCE_MS = 250;

  // Broad list of containers that hold recommendation video cards.
  // Expand as YT updates their web components.
  const CARD_SELECTORS = [
    'ytd-rich-item-renderer',
    'ytd-compact-video-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'yt-lockup-metadata-view-model', // recent homepage/lockup style
    'ytd-rich-grid-media',           // sometimes the inner
    // Add more as discovered via devtools
  ];

  // Places inside a card where we can relatively position our buttons.
  // We append to the first that exists and doesn't already have our buttons.
  const BUTTON_PARENT_SELECTORS = [
    '#details',                          // many compact + some rich
    'yt-lockup-metadata-view-model',     // new style
    '.ytd-video-meta-block',             // metadata area
    '#meta',                             // fallback
    'ytd-video-meta-block',              // another variant
  ];

  // Labels and icon paths (stable-ish) used for menu item detection.
  // Adapted from "Nah" extension for resilience.
  const ACTION_LABELS = {
    nah: 'Not interested',
    channel: "Don't recommend channel",
  };

  const ACTION_SVG_PATHS = {
    nah: 'M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 018.246 12.605L4.755 6.661A8.99 8.99 0 0112 3ZM3.754 8.393l15.491 8.944A9 9 0 013.754 8.393Z',
    channel: 'M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 110 18.001A9 9 0 0112 3Zm4 8H8a1 1 0 000 2h8a1 1 0 000-2Z',
  };

  // For the "Tell us why" follow-up (from 1-click userscript + observation).
  // These are fragile; we fall back to text queries too.
  const TELL_US_WHY_TEXT = 'Tell us why';
  const REASON_WATCHED_TEXT = "I've already watched the video";
  const REASON_DISLIKE_TEXT = "I don't like the video";
  const SUBMIT_TEXT = 'Submit';

  // --- Recommendation surfaces where we disable the addon ---
  // The "pathname" (window.location.pathname) is the part of the URL after the domain.
  // We only want the addon active on main algorithmic recommendation pages (home, trending, etc.).
  // Search (/results), channel pages (/@...), subscriptions, history, playlists and watch are intentionally disabled
  // (different card designs or not relevant as rec feeds).
  // On the paths below we skip button injection, card hiding, and recommendation scanning entirely.
  // (Auto-tracking the video you actually watch on /watch pages is handled separately in handleWatchPage.)
  const DISABLED_RECOMMENDATION_PATH_PREFIXES = [
    '/watch',               // Watch page (sidebar "Up next", related videos, end-of-video recs)
    '/feed/subscriptions',  // Your own subscriptions feed — not algo recommendations
    '/feed/history',        // Your watch history — not algo recommendations
    '/playlist',            // Playlists (your own lists, not recommendations)
    '/@',                   // Channel/user profile pages (/@username) — uploads & own content, not algo recs
    '/results',             // Search results pages — different card design, prevent mismatched buttons/hiding
  ];

  function isRecommendationProcessingDisabled() {
    const path = location.pathname;
    return DISABLED_RECOMMENDATION_PATH_PREFIXES.some(prefix =>
      path === prefix || path.startsWith(prefix)
    );
  }

  // In-memory state
  let blockedVideoIds = new Set();
  let blockedChannels = new Set(); // channel names/handles for now
  let settings = {
    hideBlocked: true,
    injectButtons: true,
    autoBlockWatch: true,
    preferDislike: false,
    debug: false,
    showChannelButton: false,  // off by default: "Don't recommend channel" is irreversible on YT; user must opt-in via popup
  };
  let lastUrl = location.href;
  let debounceTimer = null;
  let pollTimer = null;

  // --- Storage helpers (Promise + polyfill, adapted from nah) ---
  function getStorage(keys) {
    return new Promise((resolve) => {
      if (!ext || !ext.storage) {
        resolve({});
        return;
      }
      ext.storage.local.get(keys, (result) => {
        if (ext.runtime && ext.runtime.lastError) {
          console.warn('[YT-Rec-Fix] storage get error', ext.runtime.lastError);
          resolve({});
        } else {
          resolve(result || {});
        }
      });
    });
  }

  function setStorage(obj) {
    return new Promise((resolve) => {
      if (!ext || !ext.storage) {
        resolve();
        return;
      }
      ext.storage.local.set(obj, () => {
        if (ext.runtime && ext.runtime.lastError) {
          console.warn('[YT-Rec-Fix] storage set error', ext.runtime.lastError);
        }
        resolve();
      });
    });
  }

  async function loadState() {
    const data = await getStorage(['blockedVideoIds', 'blockedChannels', 'settings']);
    if (Array.isArray(data.blockedVideoIds)) {
      blockedVideoIds = new Set(data.blockedVideoIds);
    }
    if (Array.isArray(data.blockedChannels)) {
      blockedChannels = new Set(data.blockedChannels);
    }
    if (data.settings && typeof data.settings === 'object') {
      settings = { ...settings, ...data.settings };
    }
    // Apply debug
    // (we read settings.debug in logger)
  }

  async function persistBlocked() {
    await setStorage({
      blockedVideoIds: Array.from(blockedVideoIds),
      blockedChannels: Array.from(blockedChannels),
    });
  }

  async function saveSettings() {
    await setStorage({ settings });
  }

  // --- Logging ---
  function log(...args) {
    if (settings.debug || DEBUG) {
      console.log('[YT-Rec-Fix]', ...args);
    }
  }

  // --- Video ID extraction (reliable common pattern) ---
  function getVideoId(el) {
    if (!el) return null;
    // Look for the primary link
    const link = el.querySelector('a[href*="/watch?v="]') ||
                 el.querySelector('a#thumbnail') ||
                 el.querySelector('a#video-title') ||
                 el.querySelector('yt-lockup-metadata-view-model a');
    if (!link) return null;
    const href = link.getAttribute('href') || '';
    const m = href.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function getCurrentVideoId() {
    const m = location.search.match(/[?&]v=([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  // --- Channel (best effort name/handle) ---
  function getChannelKey(el) {
    if (!el) return null;
    const nameEl = el.querySelector('#channel-name a, #text.ytd-channel-name, yt-formatted-string.ytd-channel-name, a[href*="/@"], a[href*="/channel/"]');
    if (nameEl) {
      const txt = (nameEl.textContent || nameEl.getAttribute('title') || '').trim();
      if (txt) return txt.toLowerCase();
      const h = nameEl.getAttribute('href') || '';
      if (h) return h.split('/').pop().toLowerCase();
    }
    return null;
  }

  // --- Hiding ---
  function hideCard(card) {
    if (!card || card.hasAttribute('data-yt-rec-fix-hidden')) return;
    card.setAttribute('data-yt-rec-fix-hidden', 'true');
    // Also a class for extra styling if wanted
    card.classList.add('yt-rec-fix-just-blocked');
    // Remove the class after a moment (the attribute keeps it hidden)
    setTimeout(() => card.classList.remove('yt-rec-fix-just-blocked'), 400);
    log('hid card', getVideoId(card));
  }

  function unhideCard(card) {
    if (card) card.removeAttribute('data-yt-rec-fix-hidden');
  }

  function isCardHidden(card) {
    return card && card.hasAttribute('data-yt-rec-fix-hidden');
  }

  // --- Core scan + hide + button injection ---
  function findCards() {
    const cards = new Set();
    for (const sel of CARD_SELECTORS) {
      document.querySelectorAll(sel).forEach((c) => {
        // Skip if this is inside a non-rec context we don't care about (e.g. playlist, history own list sometimes)
        // Heuristic: must contain a watch link
        if (c.querySelector('a[href*="/watch?v="]')) {
          cards.add(c);
        }
      });
    }
    return Array.from(cards);
  }

  function shouldHideCard(card) {
    if (!settings.hideBlocked) return false;
    const vid = getVideoId(card);
    if (vid && blockedVideoIds.has(vid)) return true;
    const ch = getChannelKey(card);
    if (ch && blockedChannels.has(ch)) return true;
    return false;
  }

  function ensureButtons(card) {
    if (!settings.injectButtons) return;

    // Avoid duplicating
    if (card.querySelector('.yt-rec-fix-btn')) return;

    // Find a good parent container for absolute positioning
    let parent = null;
    for (const psel of BUTTON_PARENT_SELECTORS) {
      parent = card.querySelector(psel);
      if (parent) break;
    }
    if (!parent) {
      // fallback: use the card itself
      parent = card;
      // ensure it can contain absolute children
      if (getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
    } else if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    // Create a small wrapper so we can stack buttons cleanly
    const wrapper = document.createElement('div');
    wrapper.className = 'yt-rec-fix-btn-wrapper';
    // Position the wrapper near top-right of the parent area
    wrapper.style.position = 'absolute';
    wrapper.style.top = '40px';
    wrapper.style.right = '4px';
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.gap = '2px';
    wrapper.style.zIndex = '9999';

    const makeBtn = (label, title, cls, handler) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `yt-rec-fix-btn ${cls}`;
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        handler(card, e);
      });
      return btn;
    };

    // Primary actions the user asked for
    const watchedBtn = makeBtn('Watched', 'Mark watched + Not interested (full flow)', 'yt-rec-fix-watched',
      (c) => handleBlockAction(c, 'watched'));

    const dislikeBtn = makeBtn('👎', "Don't like + Not interested (stronger signal)", 'yt-rec-fix-dislike',
      (c) => handleBlockAction(c, 'dislike'));

    wrapper.appendChild(watchedBtn);
    wrapper.appendChild(dislikeBtn);

    // "Don't recommend channel" is a hard/irreversible YT action (cannot be easily rolled back).
    // Only show this button when the user has explicitly enabled it in the popup (default: false).
    if (settings.showChannelButton) {
      const channelBtn = makeBtn('Ch', "Don't recommend channel", 'yt-rec-fix-channel',
        (c) => handleBlockAction(c, 'channel'));
      wrapper.appendChild(channelBtn);
    }

    parent.appendChild(wrapper);
  }

  function processRecommendations() {
    if (isRecommendationProcessingDisabled()) {
      // Clean up any buttons we injected before navigating here (YouTube is an SPA).
      document.querySelectorAll('.yt-rec-fix-btn-wrapper').forEach(w => w.remove());
      return;
    }

    const cards = findCards();

    for (const card of cards) {
      if (shouldHideCard(card)) {
        hideCard(card);
        // Still allow un-hiding via clear, but buttons not needed on hidden
        continue;
      }

      if (settings.injectButtons && !isCardHidden(card)) {
        ensureButtons(card);
      }
    }
  }

  function debouncedProcess() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processRecommendations, DEBOUNCE_MS);
  }

  // --- YT feedback automation ---
  // Core idea from nah.js + kannanmavila 1-click script.
  // We do local block + hide FIRST (reliable), then attempt the full menu dance.

  async function handleBlockAction(card, actionType) {
    const vid = getVideoId(card);
    const ch = getChannelKey(card);

    // Always do the reliable local thing immediately
    if (vid) {
      blockedVideoIds.add(vid);
    }
    if (ch && actionType === 'channel') {
      blockedChannels.add(ch);
    }
    await persistBlocked();

    hideCard(card);

    // Now try to tell YouTube (best effort, non-blocking for UX)
    try {
      await triggerYouTubeFeedback(card, actionType, vid);
    } catch (e) {
      log('feedback automation error (local block still active)', e);
    }

    // Re-process soon in case more cards appeared
    debouncedProcess();
  }

  async function triggerYouTubeFeedback(card, actionType, vid) {
    // 1. Find the menu button inside this card (multiple possible locations)
    const menuBtnSelectors = [
      '#menu #button yt-icon',
      'yt-icon-button#button',
      '.ytLockupMetadataViewModelMenuButton button',
      'yt-icon-button[aria-label*="More"] button',
      'button[aria-label*="More actions"]',
      '#button yt-icon',
    ];

    let menuButton = null;
    for (const sel of menuBtnSelectors) {
      menuButton = card.querySelector(sel);
      if (menuButton) break;
    }
    if (!menuButton) {
      // Sometimes the menu lives a bit higher
      menuButton = card.querySelector('yt-icon-button, #menu button');
    }
    if (!menuButton) {
      log('Could not locate menu button for card', vid);
      return;
    }

    // Temporarily hide popups to reduce flicker (common trick)
    const popupContainer = document.querySelector('ytd-popup-container');
    if (popupContainer) popupContainer.style.visibility = 'hidden';

    // Click the menu
    menuButton.click();

    // Give the menu time to render (YT is async)
    await sleep(80);

    // 2. Find the popup menu (try recent + classic)
    const popupWrapper = document.querySelector('tp-yt-iron-dropdown:last-of-type') ||
                         document.querySelector('ytd-menu-popup-renderer') ||
                         document.querySelector('yt-list-view-model');

    if (!popupWrapper) {
      log('No popup wrapper found after menu click');
      restorePopup(popupContainer);
      return;
    }

    // Look inside for the action items (ytd-menu-service-item-renderer or yt-list-item-view-model)
    const items = Array.from(
      popupWrapper.querySelectorAll(
        'ytd-menu-service-item-renderer, yt-list-item-view-model, tp-yt-paper-item, ytd-menu-navigation-item-renderer'
      )
    );

    let targetItem = null;
    for (const item of items) {
      const text = (item.textContent || '').trim().toLowerCase();
      const svg = item.querySelector('svg');

      if (actionType === 'channel') {
        if (text.includes('recommend channel') || hasMatchingPath(svg, ACTION_SVG_PATHS.channel)) {
          targetItem = item;
          break;
        }
      } else {
        // nah / watched / dislike all start with "Not interested"
        if (text.includes('not interested') || hasMatchingPath(svg, ACTION_SVG_PATHS.nah)) {
          targetItem = item;
          break;
        }
      }
    }

    if (!targetItem) {
      log('Could not find matching menu item (Not interested / channel)');
      restorePopup(popupContainer);
      return;
    }

    targetItem.click();

    // If this is just channel block, we're done after the first level.
    if (actionType === 'channel') {
      await sleep(60);
      restorePopup(popupContainer);
      return;
    }

    // 3. "Not interested" was clicked → now handle "Tell us why" follow-up if it appears.
    // The "Tell us why" button usually appears in the place of the original card or as a small button after dismiss.
    await sleep(120);

    // Try to find a "Tell us why" button that is associated with this action.
    // It can be inside the original card area (ytd-button-renderer) or global recent.
    let tellUsWhyBtn = null;

    // Common locations after dismiss
    const possibleTell = card.querySelectorAll('ytd-button-renderer button, yt-button-renderer button, button');
    for (const b of possibleTell) {
      if ((b.textContent || '').toLowerCase().includes('tell us why')) {
        tellUsWhyBtn = b;
        break;
      }
    }
    if (!tellUsWhyBtn) {
      // broader search in recent dropdowns
      const recent = document.querySelector('tp-yt-iron-dropdown:last-of-type ytd-button-renderer button, ytd-button-renderer button');
      if (recent && (recent.textContent || '').toLowerCase().includes('tell us why')) {
        tellUsWhyBtn = recent;
      }
    }

    if (tellUsWhyBtn) {
      tellUsWhyBtn.click();
      await sleep(100);

      // 4. The follow-up dialog: ytd-dismissal-follow-up-renderer (or similar)
      const followUp = document.querySelector('ytd-dismissal-follow-up-renderer') ||
                       document.querySelector('yt-confirm-dialog-renderer') ||
                       document.querySelector('[role="dialog"]');

      if (followUp) {
        const checkboxes = followUp.querySelectorAll('tp-yt-paper-checkbox, yt-checkbox, input[type="checkbox"], .checkbox');
        let watchedCb = null;
        let dislikeCb = null;

        for (const cb of checkboxes) {
          const labelText = (cb.textContent || cb.parentElement?.textContent || '').toLowerCase();
          if (labelText.includes('already watched')) watchedCb = cb;
          if (labelText.includes("don't like") || labelText.includes('dislike')) dislikeCb = cb;
        }

        // Click desired reasons. User setting controls whether we also pick "I don't like".
        if (watchedCb) {
          if (!watchedCb.checked) watchedCb.click();
        }
        if ((settings.preferDislike || actionType === 'dislike') && dislikeCb) {
          if (!dislikeCb.checked) dislikeCb.click();
        }

        // Find and click submit / done button
        const buttons = followUp.querySelectorAll('ytd-button-renderer button, yt-button-renderer button, button');
        let submitBtn = null;
        for (const b of buttons) {
          if ((b.textContent || '').trim().toLowerCase() === 'submit' ||
              (b.textContent || '').trim().toLowerCase().includes('submit')) {
            submitBtn = b;
            break;
          }
        }
        if (submitBtn) {
          submitBtn.click();
        } else {
          // Sometimes the last button is submit
          if (buttons.length > 0) buttons[buttons.length - 1].click();
        }
      }
    }

    await sleep(60);
    restorePopup(popupContainer);
    log('Feedback automation complete for', vid || 'unknown', actionType);
  }

  function hasMatchingPath(svgEl, targetPath) {
    if (!svgEl) return false;
    const paths = svgEl.querySelectorAll('path');
    for (const p of paths) {
      if (p.getAttribute('d') === targetPath) return true;
    }
    return false;
  }

  function restorePopup(popupContainer) {
    if (popupContainer) popupContainer.style.visibility = '';
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // --- Watch page tracking ---
  function handleWatchPage() {
    if (!settings.autoBlockWatch) return;

    const vid = getCurrentVideoId();
    if (!vid || blockedVideoIds.has(vid)) return;

    // Add immediately on page load (conservative). User can clear later if they want.
    blockedVideoIds.add(vid);
    persistBlocked().then(() => {
      log('auto-blocked watch page video', vid);
      // If the video appears in related on this page, hide it
      debouncedProcess();
    });

    // Also listen for ended event for "I actually finished it"
    const video = document.querySelector('video');
    if (video) {
      const onEnded = () => {
        if (!blockedVideoIds.has(vid)) {
          blockedVideoIds.add(vid);
          persistBlocked();
          log('auto-blocked on video ended', vid);
        }
        video.removeEventListener('ended', onEnded);
      };
      video.addEventListener('ended', onEnded, { once: true });
    }
  }

  // --- SPA navigation handling ---
  function checkNavigation() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      log('navigated to', lastUrl);

      // Re-process everything on new "page"
      // Small delay for YT to render new content
      setTimeout(() => {
        processRecommendations();
        if (location.pathname === '/watch') {
          handleWatchPage();
        }
      }, 600);

      // Another sweep a bit later (virtual lists)
      setTimeout(processRecommendations, 1600);
    }
  }

  // --- Observers and timers ---
  function setupObservers() {
    // Main content area + body for broad coverage
    const target = document.body || document.documentElement;

    const observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          shouldProcess = true;
          break;
        }
      }
      if (shouldProcess) debouncedProcess();
    });

    observer.observe(target, { childList: true, subtree: true });

    // Also watch url changes more aggressively (YT doesn't always fire popstate)
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      checkNavigation();
      // Occasional full sweep (catches virtual scroll / lazy)
      debouncedProcess();
    }, POLL_INTERVAL_MS);

    // YT-specific navigation event (very helpful)
    window.addEventListener('yt-navigate-finish', () => {
      setTimeout(() => {
        processRecommendations();
        if (location.pathname === '/watch') handleWatchPage();
      }, 400);
    });

    // Storage changes (popup toggles, other tabs)
    if (ext.storage && ext.storage.onChanged) {
      ext.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;

        if (changes.blockedVideoIds) {
          blockedVideoIds = new Set(changes.blockedVideoIds.newValue || []);
          debouncedProcess();
        }
        if (changes.blockedChannels) {
          blockedChannels = new Set(changes.blockedChannels.newValue || []);
          debouncedProcess();
        }
        if (changes.settings) {
          const newS = changes.settings.newValue || {};
          const oldHide = settings.hideBlocked;
          const oldInject = settings.injectButtons;
          const oldShowChannel = settings.showChannelButton;
          settings = { ...settings, ...newS };

          if (newS.debug !== undefined) {
            // debug just affects logging
          }

          // If toggles changed, re-process. For showChannelButton we must clean existing injected
          // wrappers first (the dedup guard in ensureButtons is generic over any .yt-rec-fix-btn),
          // otherwise cards that already have the two primary buttons would never get/lose the Ch button.
          const channelPrefChanged = oldShowChannel !== settings.showChannelButton;
          if (oldHide !== settings.hideBlocked || oldInject !== settings.injectButtons || channelPrefChanged) {
            if (channelPrefChanged) {
              // Remove all our button wrappers so ensureButtons will re-evaluate the channel button
              // based on the *current* setting value. This enables live toggling without page reload.
              document.querySelectorAll('.yt-rec-fix-btn-wrapper').forEach(w => w.remove());
            }
            // Unhide everything if user disabled hiding (for easy testing)
            if (!settings.hideBlocked) {
              document.querySelectorAll('[data-yt-rec-fix-hidden]').forEach(unhideCard);
            }
            debouncedProcess();
          }
        }
      });
    }
  }

  // --- Initial bootstrap ---
  async function init() {
    await loadState();

    log('initialized', {
      blocked: blockedVideoIds.size,
      settings
    });

    // First sweep
    processRecommendations();

    // If we landed on a watch page, track it
    if (location.pathname === '/watch' || location.pathname.startsWith('/watch')) {
      // small delay so the player etc. exist
      setTimeout(handleWatchPage, 800);
    }

    setupObservers();

    // One more sweep after everything likely loaded
    setTimeout(processRecommendations, 2200);

    // Expose a tiny API for debugging / popup advanced use
    window.__YT_REC_FIX__ = {
      getBlocked: () => Array.from(blockedVideoIds),
      block: async (id) => { blockedVideoIds.add(id); await persistBlocked(); debouncedProcess(); },
      clear: async () => { blockedVideoIds.clear(); blockedChannels.clear(); await persistBlocked(); document.querySelectorAll('[data-yt-rec-fix-hidden]').forEach(unhideCard); },
      reprocess: processRecommendations,
      settings,
    };
  }

  // Kick off
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
