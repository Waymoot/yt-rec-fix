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

  // Centralized strings for the "Tell us why" + reason flow (now actively used in matching).
  // These match the current YouTube UI shown in screenshots/Tell_us_why*.png.
  // Kept as constants so future YT text changes are easy to update in one place.
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
    hideShorts: false,
    hideExploreMoreTopics: false,
    hideMostRelevant: false,
    hideForYou: false,
    hideChannelFeature: false,
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
      if (data.settings.hideChannelPromote !== undefined) {
        settings.hideChannelFeature = !!data.settings.hideChannelPromote;
        delete settings.hideChannelPromote;
      }
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
  function hideCard(card, vid = null) {
    if (!card || card.hasAttribute('data-yt-rec-fix-hidden')) return;
    card.setAttribute('data-yt-rec-fix-hidden', 'true');
    // Also a class for extra styling if wanted
    card.classList.add('yt-rec-fix-just-blocked');
    // Remove the class after a moment (the attribute keeps it hidden)
    setTimeout(() => card.classList.remove('yt-rec-fix-just-blocked'), 400);
    log('hid card', vid || getVideoId(card));
  }

  function unhideCard(card) {
    if (card) card.removeAttribute('data-yt-rec-fix-hidden');
  }

  function isCardHidden(card) {
    return card && card.hasAttribute('data-yt-rec-fix-hidden');
  }

  // --- Section hiding (Shorts etc.) — active on ALL YT pages, including subscriptions ---
  const SECTION_HIDDEN_ATTR = 'data-yt-rec-fix-section-hidden';
  const SECTION_DEBUG_CLASS = 'yt-rec-fix-section-debug-hidden';
  const SECTION_MARKER_CLASS = 'yt-rec-fix-section-hidden-marker';

  function getSectionTitleText(section) {
    const shelf = section.querySelector('ytd-rich-shelf-renderer');
    const shelfTitle = shelf?.querySelector('#title, span#title');
    const shelfText = (shelfTitle?.textContent || '').trim();
    if (shelfText) return shelfText;

    const reelShelf = section.querySelector('ytd-reel-shelf-renderer');
    const reelTitle = reelShelf?.querySelector('yt-formatted-string#title, #title');
    const reelText = (reelTitle?.textContent || '').trim();
    if (reelText) return reelText;

    const channelShelf = section.querySelector('ytd-shelf-renderer');
    const channelTitle = channelShelf?.querySelector('#title, span#title');
    const channelText = (channelTitle?.textContent || '').trim();
    if (channelText) return channelText;

    const chipsShelf = section.querySelector('ytd-chips-shelf-with-video-shelf-renderer');
    if (chipsShelf) {
      const headerTitle = chipsShelf.querySelector(
        'h2 .ytAttributedStringHost, h2 span[role="text"], h2, .ytShelfHeaderLayoutTitle'
      );
      const chipsText = (headerTitle?.textContent || '').trim();
      if (chipsText) return chipsText;
    }

    const featured = section.querySelector('ytd-channel-featured-content-renderer');
    if (featured) {
      const featureTitle = (
        featured.querySelector('.ytLockupMetadataViewModelTitle, a[href*="/watch?v="]')?.textContent || ''
      ).trim();
      if (featureTitle) return `(feature) ${featureTitle.slice(0, 80)}`;
      return '(feature)';
    }

    return null;
  }

  const SECTION_DETECTORS = [
    {
      id: 'shorts',
      label: 'Shorts',
      settingKey: 'hideShorts',
      detect(section) {
        const richShelf = section.querySelector('ytd-rich-shelf-renderer');
        if (richShelf) {
          // Feed/home/subscriptions — tmp/yt-shorts-section.txt
          if (richShelf.hasAttribute('is-shorts')) {
            return { match: true, reason: 'ytd-rich-shelf-renderer[is-shorts]' };
          }
          const richTitle = (richShelf.querySelector('#title, span#title')?.textContent || '').trim();
          if (richTitle === 'Shorts') {
            return { match: true, reason: 'rich shelf #title === Shorts' };
          }
        }

        const reelShelf = section.querySelector('ytd-reel-shelf-renderer');
        if (reelShelf) {
          // Channel page Shorts — tmp/channel-shorts-section.txt
          const reelTitle = (
            reelShelf.querySelector('yt-formatted-string#title, #title')?.textContent || ''
          ).trim();
          if (reelTitle === 'Shorts') {
            if (reelShelf.querySelector('yt-horizontal-list-renderer[override-arrow-position-for-shorts]')) {
              return { match: true, reason: 'channel reel shelf + override-arrow-position-for-shorts' };
            }
            return { match: true, reason: 'ytd-reel-shelf-renderer title Shorts' };
          }
        }

        if (
          section.querySelector('ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model') &&
          section.querySelector('a[href*="/shorts"]')
        ) {
          return { match: true, reason: 'shorts lockup + /shorts/ link' };
        }

        return { match: false, reason: 'no shorts signals' };
      },
    },
    {
      id: 'explore-more-topics',
      label: 'Explore more topics',
      settingKey: 'hideExploreMoreTopics',
      detect(section) {
        const chipsShelf = section.querySelector('ytd-chips-shelf-with-video-shelf-renderer');
        if (chipsShelf) {
          const titleText = getSectionTitleText(section);
          if (titleText === 'Explore more topics') {
            return { match: true, reason: 'chips shelf + title Explore more topics' };
          }
          return { match: true, reason: 'ytd-chips-shelf-with-video-shelf-renderer' };
        }

        if (getSectionTitleText(section) === 'Explore more topics') {
          return { match: true, reason: 'title === Explore more topics' };
        }

        return { match: false, reason: 'no explore topics signals' };
      },
    },
    {
      id: 'most-relevant',
      label: 'Most relevant',
      settingKey: 'hideMostRelevant',
      detect(section) {
        const shelf = section.querySelector('ytd-rich-shelf-renderer');
        if (!shelf || shelf.hasAttribute('is-shorts')) {
          return { match: false, reason: 'no shelf or is shorts' };
        }

        if (section.querySelector('ytd-chips-shelf-with-video-shelf-renderer')) {
          return { match: false, reason: 'chips shelf section' };
        }

        const titleText = getSectionTitleText(section);
        if (titleText === 'Most relevant') {
          return { match: true, reason: 'shelf #title === Most relevant' };
        }

        return { match: false, reason: 'no most relevant signals' };
      },
    },
    {
      id: 'for-you',
      label: 'For You',
      settingKey: 'hideForYou',
      detect(section) {
        const shelf = section.querySelector('ytd-shelf-renderer');
        if (!shelf) return { match: false, reason: 'no ytd-shelf-renderer' };

        const titleText = (shelf.querySelector('#title, span#title')?.textContent || '').trim();
        if (titleText !== 'For You') return { match: false, reason: 'title not For You' };

        // tmp/yt-for-you-section.txt — channel home shelf, not latest uploads
        if (section.matches('ytd-item-section-renderer[page-subtype="channels"]')) {
          return { match: true, reason: 'channel item-section + shelf title For You' };
        }

        if (shelf.querySelector('yt-horizontal-list-renderer[is-channel]')) {
          return { match: true, reason: 'channel horizontal shelf + For You' };
        }

        return { match: true, reason: 'ytd-shelf-renderer #title === For You' };
      },
    },
    {
      id: 'channel-feature',
      label: 'Feature',
      settingKey: 'hideChannelFeature',
      detect(section) {
        const featured = section.querySelector('ytd-channel-featured-content-renderer');
        if (!featured) return { match: false, reason: 'no ytd-channel-featured-content-renderer' };

        // tmp/channel-promote-section.txt — YT "Feature" shelf on channel home
        if (
          section.querySelector('ytd-shelf-renderer, ytd-reel-shelf-renderer, ytd-rich-shelf-renderer')
        ) {
          return { match: false, reason: 'section has other shelf content' };
        }

        const hasLockup =
          !!featured.querySelector(
            'yt-lockup-view-model.ytLockupViewModelHorizontal, yt-lockup-view-model'
          ) || !!featured.querySelector('a[href*="/watch?v="]');
        if (!hasLockup) return { match: false, reason: 'no featured video lockup' };

        return { match: true, reason: 'ytd-channel-featured-content-renderer' };
      },
    },
  ];

  function findSectionContainers() {
    const containers = new Set();
    document.querySelectorAll('ytd-rich-section-renderer, ytd-item-section-renderer').forEach((el) => {
      containers.add(el);
    });
    return Array.from(containers);
  }

  function describeSection(section) {
    const richShelf = section.querySelector('ytd-rich-shelf-renderer');
    return {
      tag: section.tagName.toLowerCase(),
      hidden: section.hasAttribute(SECTION_HIDDEN_ATTR),
      hiddenAs: section.getAttribute(SECTION_HIDDEN_ATTR) || null,
      shelfIsShorts: richShelf ? richShelf.hasAttribute('is-shorts') : null,
      shelfTitle: getSectionTitleText(section),
      hasChipsShelf: !!section.querySelector('ytd-chips-shelf-with-video-shelf-renderer'),
      hasChannelShelf: !!section.querySelector('ytd-shelf-renderer'),
      hasReelShelf: !!section.querySelector('ytd-reel-shelf-renderer'),
      hasChannelFeature: !!section.querySelector('ytd-channel-featured-content-renderer'),
      hasShortsLockup: !!section.querySelector(
        'ytm-shorts-lockup-view-model-v2, ytm-shorts-lockup-view-model'
      ),
    };
  }

  function sectionHideSettingsSummary() {
    return SECTION_DETECTORS.map((d) => `${d.id}:${settings[d.settingKey] ? 'on' : 'off'}`).join(' ');
  }

  function sectionSettingsChanged(prev, next) {
    return SECTION_DETECTORS.some((d) => prev[d.settingKey] !== next[d.settingKey]);
  }

  let lastSectionScanFingerprint = '';

  function buildSectionScanRows() {
    return findSectionContainers().map((section, index) => {
      const desc = describeSection(section);
      const matches = SECTION_DETECTORS.map((det) => {
        const result = det.detect(section);
        return result.match ? `${det.id} (${result.reason})` : null;
      }).filter(Boolean);
      return {
        index,
        container: desc.tag,
        shelfTitle: desc.shelfTitle,
        isShorts: desc.shelfIsShorts,
        matches: matches.join('; ') || '-',
        hidden: desc.hiddenAs || desc.hidden || '-',
      };
    });
  }

  function logSectionScan(trigger) {
    if (!settings.debug && !DEBUG) return;

    const forceLog = trigger === 'init' || trigger === 'navigate' || trigger === 'toggle';
    const rows = buildSectionScanRows();
    const fingerprint = JSON.stringify(rows);
    if (!forceLog && fingerprint === lastSectionScanFingerprint) return;
    lastSectionScanFingerprint = fingerprint;

    console.log(
      '[YT-Rec-Fix] section scan',
      `(${trigger}) —`,
      rows.length,
      'section containers',
      `(hide: ${sectionHideSettingsSummary()})`
    );
    if (rows.length) console.table(rows);
  }

  function sectionLabelForId(sectionId) {
    const det = SECTION_DETECTORS.find((d) => d.id === sectionId);
    return det?.label || sectionId;
  }

  function ensureSectionDebugMarker(section, sectionId) {
    let marker = section.querySelector(`.${SECTION_MARKER_CLASS}`);
    if (!marker) {
      marker = document.createElement('div');
      marker.className = SECTION_MARKER_CLASS;
      section.prepend(marker);
    }
    marker.textContent = `hidden section (${sectionLabelForId(sectionId)})`;
  }

  function clearSectionDebugMarker(section) {
    section.querySelectorAll(`.${SECTION_MARKER_CLASS}`).forEach((el) => el.remove());
    section.classList.remove(SECTION_DEBUG_CLASS);
  }

  function applySectionHiddenPresentation(section, sectionId) {
    if (settings.debug) {
      section.classList.add(SECTION_DEBUG_CLASS);
      ensureSectionDebugMarker(section, sectionId);
    } else {
      clearSectionDebugMarker(section);
    }
  }

  function syncAllSectionDebugMarkers() {
    document.querySelectorAll(`[${SECTION_HIDDEN_ATTR}]`).forEach((section) => {
      applySectionHiddenPresentation(section, section.getAttribute(SECTION_HIDDEN_ATTR));
    });
  }

  function hideSectionEl(section, sectionId, reason) {
    if (!section) return;
    const alreadyHidden = section.getAttribute(SECTION_HIDDEN_ATTR) === sectionId;
    if (!alreadyHidden) {
      section.setAttribute(SECTION_HIDDEN_ATTR, sectionId);
      log('hid section', sectionId, reason || '');
    }
    applySectionHiddenPresentation(section, sectionId);
  }

  function unhideSectionEl(section) {
    if (!section) return;
    const was = section.getAttribute(SECTION_HIDDEN_ATTR);
    section.removeAttribute(SECTION_HIDDEN_ATTR);
    clearSectionDebugMarker(section);
    if (was) log('unhid section', was);
  }

  function unhideAllSections() {
    document.querySelectorAll(`[${SECTION_HIDDEN_ATTR}]`).forEach(unhideSectionEl);
    log('unhid all sections');
  }

  function processSections(opts = {}) {
    const force = !!opts.force;

    for (const det of SECTION_DETECTORS) {
      const enabled = force || settings[det.settingKey];
      if (!enabled) continue;

      for (const section of findSectionContainers()) {
        const result = det.detect(section);
        if (result.match) hideSectionEl(section, det.id, result.reason);
      }
    }

    if (!force) {
      document.querySelectorAll(`[${SECTION_HIDDEN_ATTR}]`).forEach((section) => {
        const id = section.getAttribute(SECTION_HIDDEN_ATTR);
        const det = SECTION_DETECTORS.find((d) => d.id === id);
        if (det && !settings[det.settingKey]) unhideSectionEl(section);
      });
    }

    logSectionScan(opts.scanTrigger || 'process');
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
      const isPendingFeedback = card.hasAttribute('data-yt-rec-fix-feedback-pending');
      if (shouldHideCard(card) && !isPendingFeedback) {
        hideCard(card);
        // Still allow un-hiding via clear, but buttons not needed on hidden
        continue;
      }

      if (settings.injectButtons && !isCardHidden(card) && !isPendingFeedback) {
        ensureButtons(card);
      }
    }
  }

  function debouncedProcess() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      processSections();
      processRecommendations();
    }, DEBOUNCE_MS);
  }

  // --- YT feedback automation ---
  // Core idea from nah.js + kannanmavila 1-click script.
  // IMPORTANT (2026 update): We record the local block *early* for durability, but we must
  // NOT visually hide the card (via data-yt-rec-fix-hidden) until AFTER the full YT feedback
  // automation has completed. YouTube often creates a replacement "Tell us why" panel / dialog
  // (with the reason checkboxes + Submit) in or around the original card element when the user
  // (or addon) clicks "Not interested". Hiding the card too early also hides or neuters the
  // very buttons/panel ("the new card that YT creates") that we need to interact with to send
  // the detailed "I've already watched" / "I don't like" signals. See screenshots/Tell_us_why*.png.
  // Therefore: feedback automation first (on the live UI), reliable local hide second.

  async function handleBlockAction(card, actionType) {
    const vid = getVideoId(card);
    const ch = getChannelKey(card);

    // Record the block early so it is durable (even if feedback or page navigation happens).
    // The *visual* hide is deliberately deferred until after we have talked to YT.
    if (vid) {
      blockedVideoIds.add(vid);
    }
    if (ch && actionType === 'channel') {
      blockedChannels.add(ch);
    }
    await persistBlocked();

    // Mark this specific card so that concurrent processRecommendations / MutationObserver
    // scans (which also call shouldHideCard) won't prematurely hide it while we are
    // interacting with the "Not interested" menu + the YT-created Tell us why panel.
    // The attribute is transient and removed right before the final hideCard.
    if (card) card.setAttribute('data-yt-rec-fix-feedback-pending', 'true');

    // Clean up our own injected buttons immediately (less visual noise during the short
    // automation window). We intentionally leave the card itself visible so YT can
    // render its replacement "Video removed" / "Tell us why" UI in the right place.
    const ourWrapper = card && card.querySelector('.yt-rec-fix-btn-wrapper');
    if (ourWrapper) ourWrapper.remove();

    // Now try to tell YouTube using the live (not-yet-hidden) DOM.
    // This is best-effort; local block is already persisted above.
    try {
      const fbResult = await triggerYouTubeFeedback(card, actionType, vid);
      if (settings.debug) {
        log('handleBlockAction: feedback result returned to caller', fbResult);
      }
    } catch (e) {
      log('feedback automation error (local block still active)', e);
    }

    // Feedback attempt finished (success or partial). Now it is safe to apply the reliable
    // local visual hide. Remove the transient guard first.
    if (card) card.removeAttribute('data-yt-rec-fix-feedback-pending');
    hideCard(card, vid);

    // Re-process soon in case more cards appeared
    debouncedProcess();
  }

  async function triggerYouTubeFeedback(card, actionType, vid) {
    const start = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const debugOn = !!settings.debug;

    if (debugOn) {
      console.groupCollapsed('[YT-Rec-Fix] ▶ triggerYouTubeFeedback', actionType, vid || 'no-vid');
    }

    let phase = 'start';
    let outcome = { ok: false, phase: 'start', actionType, vid: vid || null, reason: null };

    // Temporarily hide popups to reduce flicker (common trick)
    const popupContainer = document.querySelector('ytd-popup-container');
    if (popupContainer) popupContainer.style.visibility = 'hidden';

    // Ensure we always restore visibility and close group
    const finish = async (ok, reason, extra) => {
      phase = 'cleanup';
      await sleep(40);
      restorePopup(popupContainer);

      const dur = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - start;
      outcome = { ok, phase, actionType, vid: vid || null, reason: reason || null, durationMs: Math.round(dur), ...extra };

      log('Feedback automation result', outcome);

      // Only for non-channel actions that reached the "tell us why" / submit stage, look for UI proof
      if (ok && actionType !== 'channel') {
        try {
          await verifyFeedbackUIEvidence();
        } catch (e) {
          log('verify UI evidence error (non-fatal)', e);
        }
      }

      if (debugOn) {
        console.groupEnd();
      }
      return outcome;
    };

    try {
      // 1. Find the menu button inside this card (multiple possible locations)
      phase = 'find-menu-button';
      const menuBtnSelectors = [
        '#menu #button yt-icon',
        'yt-icon-button#button',
        '.ytLockupMetadataViewModelMenuButton button',
        'yt-icon-button[aria-label*="More"] button',
        'button[aria-label*="More actions"]',
        '#button yt-icon',
      ];

      let menuButton = null;
      let usedSelector = null;
      for (const sel of menuBtnSelectors) {
        const found = card.querySelector(sel);
        if (found) {
          menuButton = found;
          usedSelector = sel;
          break;
        }
      }
      if (!menuButton) {
        // Sometimes the menu lives a bit higher
        menuButton = card.querySelector('yt-icon-button, #menu button');
        if (menuButton) usedSelector = 'fallback:yt-icon-button|#menu button';
      }

      if (!menuButton) {
        log('Could not locate menu button for card', vid, 'tried selectors:', menuBtnSelectors);
        return await finish(false, 'no-menu-button', { triedSelectors: menuBtnSelectors });
      }

      log('Menu button located via', usedSelector, '->', describeEl(menuButton));

      // Click the menu
      log('Clicking 3-dot menu...');
      menuButton.click();

      // Give the menu time to render (YT is async)
      await sleep(90);
      log('Menu click done, searching for popup container...');

      // 2. Find the popup menu (try recent + classic)
      phase = 'find-popup';
      let popupWrapper = document.querySelector('tp-yt-iron-dropdown:last-of-type');
      let popupHow = 'tp-yt-iron-dropdown:last-of-type';
      if (!popupWrapper) {
        popupWrapper = document.querySelector('ytd-menu-popup-renderer');
        popupHow = 'ytd-menu-popup-renderer';
      }
      if (!popupWrapper) {
        popupWrapper = document.querySelector('yt-list-view-model');
        popupHow = 'yt-list-view-model';
      }

      if (!popupWrapper) {
        log('No popup wrapper found after menu click. Queried: tp-yt-iron-dropdown:last-of-type, ytd-menu-popup-renderer, yt-list-view-model');
        return await finish(false, 'no-popup-wrapper');
      }
      log('Popup wrapper found via', popupHow, describeEl(popupWrapper));

      // Look inside for the action items
      phase = 'find-menu-item';
      const items = Array.from(
        popupWrapper.querySelectorAll(
          'ytd-menu-service-item-renderer, yt-list-item-view-model, tp-yt-paper-item, ytd-menu-navigation-item-renderer'
        )
      );

      // IMPORTANT for debugging: dump everything we see in the menu
      const itemDump = items.map((item, idx) => {
        const text = (item.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70);
        const svg = item.querySelector('svg');
        let pathMatch = false;
        if (svg) {
          const paths = Array.from(svg.querySelectorAll('path')).map(p => p.getAttribute('d') || '');
          pathMatch = paths.some(d => d === ACTION_SVG_PATHS.nah || d === ACTION_SVG_PATHS.channel);
        }
        return { idx, text, hasSvg: !!svg, pathMatch };
      });
      log('Menu items discovered (' + items.length + '):', itemDump);

      let targetItem = null;
      let matchReason = null;
      for (const item of items) {
        const text = (item.textContent || '').trim().toLowerCase();
        const svg = item.querySelector('svg');

        if (actionType === 'channel') {
          const textHit = text.includes('recommend channel');
          const svgHit = hasMatchingPath(svg, ACTION_SVG_PATHS.channel);
          if (textHit || svgHit) {
            targetItem = item;
            matchReason = textHit ? 'text:recommend-channel' : 'svg:channel';
            break;
          }
        } else {
          // nah / watched / dislike all start with "Not interested"
          const textHit = text.includes('not interested');
          const svgHit = hasMatchingPath(svg, ACTION_SVG_PATHS.nah);
          if (textHit || svgHit) {
            targetItem = item;
            matchReason = textHit ? 'text:not-interested' : 'svg:nah';
            break;
          }
        }
      }

      if (!targetItem) {
        log('Could not find matching menu item (Not interested / channel). See itemDump above for what was actually present.');
        return await finish(false, 'no-matching-menu-item', { itemDump });
      }

      log('Target menu item chosen:', describeEl(targetItem), 'reason:', matchReason);
      targetItem.click();

      // If this is just channel block, we're done after the first level.
      if (actionType === 'channel') {
        await sleep(70);
        log('Channel-only action completed (no Tell us why step)');
        return await finish(true, 'channel-action');
      }

      // 3. "Not interested" was clicked.
      // Current YouTube behavior (see screenshots/Tell_us_why.png and Tell_us_why_submit.png):
      // YT often creates a "Tell us why" reason chooser panel directly (or via a short-lived
      // "Video removed" + "Tell us why" button in the feed). This panel contains the two
      // checkboxes we care about + Cancel/Submit. It can appear as a small dark panel or a
      // centered popup (outside the original card).
      //
      // We must NOT have hidden the card yet (see handleBlockAction + the pending attribute).
      // Strategy:
      //   - First try to find the reason chooser *directly* (newer/simpler flow).
      //   - If not present quickly, fall back to finding+clicking a "Tell us why" button
      //     (the "Video removed" row path from resulting_code.png).
      // Use waitFor for robustness instead of only fixed sleeps.
      phase = 'find-tell-us-why-or-reason-panel';
      log('Post "Not interested" — looking for YT-created Tell us why reason panel or button...');

      // Helper to recognize the direct reason chooser (the panel with the actual options).
      const findDirectReasonPanel = () => {
        // Look in likely dialog/panel containers (the chooser can be centered or near the card area).
        const candidates = document.querySelectorAll(
          'yt-confirm-dialog-renderer, [role="dialog"], ytd-dismissal-follow-up-renderer, paper-dialog, tp-yt-paper-dialog, [class*="dialog"], [class*="popup"]'
        );
        for (const c of candidates) {
          const txt = (c.textContent || '').toLowerCase();
          // Strong signal: the panel contains one (or both) of the reason strings we want to submit.
          if (txt.includes(REASON_WATCHED_TEXT.toLowerCase()) ||
              txt.includes(REASON_DISLIKE_TEXT.toLowerCase())) {
            return c;
          }
          // Also accept a container whose title/heading is exactly "Tell us why" and that has
          // interactive controls (buttons or checkboxes) — covers the panel shown in the screenshots.
          const heading = c.querySelector('h2, [role="heading"], .title, yt-formatted-string');
          if (heading && (heading.textContent || '').trim().toLowerCase() === TELL_US_WHY_TEXT.toLowerCase() &&
              (c.querySelector('button, input[type="checkbox"], tp-yt-paper-checkbox, yt-checkbox') || c.querySelectorAll('button').length >= 2)) {
            return c;
          }
        }
        return null;
      };

      // 3a. Try the direct reason panel first (covers the flow where clicking "Not interested"
      // in the menu surfaces the checkboxes titled "Tell us why" without an extra button).
      let followUp = await waitFor(findDirectReasonPanel, { timeoutMs: 900, intervalMs: 50 });

      if (followUp) {
        log('Direct reason chooser panel located (Tell us why options visible immediately):', describeEl(followUp));
      } else {
        // 3b. Fall back to the classic "find Tell us why button then open the chooser".
        // This still supports the "Video removed" + white "Tell us why" button path.
        phase = 'find-tell-us-why-button';
        log('No direct reason panel yet — looking for "Tell us why" button (older "Video removed" row path)...');

        let tellUsWhyBtn = null;
        let tellHow = null;

        const findTellUsWhyButton = () => {
          // Prefer elements near the original card, then global recent UI.
          const btns = card ? card.querySelectorAll('ytd-button-renderer button, yt-button-renderer button, button') : [];
          for (const b of btns) {
            if ((b.textContent || '').toLowerCase().includes(TELL_US_WHY_TEXT.toLowerCase())) return b;
          }
          const recent = document.querySelector('tp-yt-iron-dropdown:last-of-type ytd-button-renderer button, ytd-button-renderer button, [role="dialog"] button');
          if (recent && (recent.textContent || '').toLowerCase().includes(TELL_US_WHY_TEXT.toLowerCase())) {
            return recent;
          }
          // Last resort: any button with the text anywhere (the chooser button can be floating).
          const any = document.querySelectorAll('button, ytd-button-renderer, yt-button-renderer');
          for (const b of any) {
            if ((b.textContent || '').toLowerCase().includes(TELL_US_WHY_TEXT.toLowerCase())) return b;
          }
          return null;
        };

        tellUsWhyBtn = await waitFor(findTellUsWhyButton, { timeoutMs: 1100, intervalMs: 60 });

        if (!tellUsWhyBtn) {
          log('No "Tell us why" button and no direct reason panel found. The flow may have stopped at first-level "Not interested" (still a valid signal) or UI changed.');
          return await finish(true, 'no-tell-us-why-but-nah-sent');
        }

        log('Tell us why button found — clicking it to open the reason chooser:', describeEl(tellUsWhyBtn));
        tellUsWhyBtn.click();

        // Now wait for the actual chooser/popup that contains the checkboxes.
        followUp = await waitFor(findDirectReasonPanel, { timeoutMs: 1100, intervalMs: 50 });
        if (!followUp) {
          // Broad fallback (kept for compatibility with older YT renderers).
          followUp = document.querySelector('ytd-dismissal-follow-up-renderer') ||
                     document.querySelector('yt-confirm-dialog-renderer') ||
                     document.querySelector('[role="dialog"]');
        }

        if (!followUp) {
          log('Follow-up reason chooser not found after clicking Tell us why button. Possible UI change or timing.');
          return await finish(true, 'nah-sent-no-followup-dialog');
        }
        log('Reason chooser / follow-up located after Tell us why button:', describeEl(followUp));
      }

      // Checkboxes
      phase = 'handle-checkboxes';
      const checkboxes = followUp.querySelectorAll('tp-yt-paper-checkbox, yt-checkbox, input[type="checkbox"], .checkbox, ytd-checkbox');
      let watchedCb = null;
      let dislikeCb = null;
      const cbDump = [];

      for (const cb of checkboxes) {
        const labelText = ((cb.textContent || '') + ' ' + (cb.parentElement?.textContent || '')).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
        cbDump.push({ el: describeEl(cb), labelText });
        // Use the centralized constants (more maintainable and matches the strings in Tell_us_why*.png)
        if (labelText.includes(REASON_WATCHED_TEXT.toLowerCase())) watchedCb = cb;
        if (labelText.includes(REASON_DISLIKE_TEXT.toLowerCase()) ||
            labelText.includes("don't like") || labelText.includes('dislike') || labelText.includes('i do not like')) {
          dislikeCb = cb;
        }
      }

      log('Checkboxes found in follow-up (' + checkboxes.length + '):', cbDump);

      // Click desired reasons. User setting controls whether we also pick "I don't like".
      let reasonsClicked = [];
      if (watchedCb) {
        if (!watchedCb.checked) {
          watchedCb.click();
          reasonsClicked.push('watched');
          log('Clicked watched reason checkbox:', describeEl(watchedCb));
        } else {
          log('Watched checkbox already checked');
        }
      } else {
        log('WARNING: could not locate "I\'ve already watched" checkbox. Label dump above.');
      }

      const wantDislike = (settings.preferDislike || actionType === 'dislike');
      if (wantDislike && dislikeCb) {
        if (!dislikeCb.checked) {
          dislikeCb.click();
          reasonsClicked.push('dislike');
          log('Clicked dislike reason checkbox:', describeEl(dislikeCb));
        }
      } else if (wantDislike) {
        log('Wanted dislike reason but did not find matching checkbox (preferDislike=' + settings.preferDislike + ', action=' + actionType + ')');
      }

      // Find and click submit / done button
      phase = 'find-submit';
      const buttons = followUp.querySelectorAll('ytd-button-renderer button, yt-button-renderer button, button, yt-button');
      let submitBtn = null;
      for (const b of buttons) {
        const bt = (b.textContent || '').trim().toLowerCase();
        // Use SUBMIT_TEXT constant + common fallbacks (Cancel/Submit pattern visible in the screenshots)
        if (bt === SUBMIT_TEXT.toLowerCase() || bt.includes(SUBMIT_TEXT.toLowerCase()) ||
            bt === 'done' || bt.includes('done')) {
          submitBtn = b;
          break;
        }
      }
      if (!submitBtn && buttons.length > 0) {
        // Fallback: last button is often the affirmative action
        submitBtn = buttons[buttons.length - 1];
      }

      if (submitBtn) {
        log('Clicking submit button:', describeEl(submitBtn), 'reasonsClicked:', reasonsClicked);
        submitBtn.click();

        // Immediately suppress the YT-created "Video removed" / Tell us why panel (the
        // intermediate state visible in screenshots/resulting_code.png) now that we have
        // successfully clicked the reasons and submit. This reduces the ~1s flash for users
        // without affecting our clicks (they have already been dispatched).
        if (followUp) {
          followUp.setAttribute('data-yt-rec-fix-hidden', 'true');
        }
      } else {
        log('No submit button found among', buttons.length, 'buttons in dialog. reasonsClicked so far:', reasonsClicked);
      }

      // Give the click a moment to be processed by YT before we verify + restore
      await sleep(80);

      log('Primary feedback flow completed (Not interested + reasons submitted if found).');
      return await finish(true, 'full-flow-completed', { reasonsClicked, cbCount: checkboxes.length });

    } catch (e) {
      log('Exception during feedback automation at phase', phase, e);
      return await finish(false, 'exception', { error: String(e && e.message || e), phase });
    }
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

  /**
   * Small polling helper to wait for an element (or condition) to appear.
   * Used to make the post-"Not interested" discovery of YT's "Tell us why" panel / button
   * and the reason chooser more reliable than blind fixed sleeps.
   *
   * @param {string|Function} matcher - CSS selector string, or a function that returns the element (or null/falsy).
   * @param {{timeoutMs?: number, intervalMs?: number}} [options]
   * @returns {Promise<Element|null>}
   */
  async function waitFor(matcher, { timeoutMs = 1200, intervalMs = 60 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let result = null;
      try {
        if (typeof matcher === 'function') {
          result = matcher();
        } else if (typeof matcher === 'string') {
          result = document.querySelector(matcher);
        }
      } catch (_) {}
      if (result) return result;
      await sleep(intervalMs);
    }
    return null;
  }

  // --- Debug helpers ---
  function describeEl(el) {
    if (!el) return 'null';
    try {
      const tag = (el.tagName || 'unknown').toLowerCase();
      let txt = (el.textContent || el.getAttribute?.('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 90);
      const aria = el.getAttribute?.('aria-label');
      const role = el.getAttribute?.('role');
      let extra = '';
      if (aria) extra += ` aria="${aria.slice(0,40)}"`;
      if (role) extra += ` role=${role}`;
      // For inputs/checkboxes include checked state
      if (el.checked !== undefined) extra += ` checked=${el.checked}`;
      return `${tag}${extra} "${txt}"`;
    } catch (_) {
      return '[describe-error]';
    }
  }

  // Lightweight interceptor to prove that real YouTube feedback signals are sent over the wire.
  // When debug is enabled you will see entries like:
  //   [YT-Rec-Fix] YT network: POST https://www.youtube.com/youtubei/v1/feedback?...
  // This is the actual confirmation that our click simulation caused YT client code to transmit "not interested" etc.
  let __apiInterceptorsInstalled = false;
  function setupApiInterceptors() {
    if (__apiInterceptorsInstalled) return;
    __apiInterceptorsInstalled = true;

    // Patch fetch (primary for modern YT innertube calls)
    try {
      const origFetch = window.fetch;
      window.fetch = async function(input, init) {
        try {
          if (settings.debug) {
            const u = (typeof input === 'string' ? input : (input && input.url) || '').toString();
            if (u.includes('youtube.com') && (/feedback|dislike|like|browse|next|player/i.test(u) || u.includes('youtubei'))) {
              const method = (init && init.method ? init.method : 'GET').toUpperCase();
              log('YT network:', method, u);
              // Best-effort: surface feedback bodies (the actual signal payload)
              if (u.includes('feedback') && init && init.body) {
                const body = typeof init.body === 'string' ? init.body : null;
                if (body && body.length < 3000) {
                  log('  feedback payload (first 600):', body.slice(0, 600));
                }
              }
            }
          }
        } catch (_) {}
        return origFetch.apply(this, arguments);
      };
    } catch (e) {
      console.warn('[YT-Rec-Fix] could not patch fetch for debug', e);
    }

    // Also patch XHR (some YT paths still use it)
    try {
      const Orig = window.XMLHttpRequest;
      const origOpen = Orig.prototype.open;
      const origSend = Orig.prototype.send;
      Orig.prototype.open = function(method, url, ...rest) {
        this.__ytUrl = url;
        this.__ytMethod = method;
        return origOpen.call(this, method, url, ...rest);
      };
      Orig.prototype.send = function(body) {
        try {
          if (settings.debug && this.__ytUrl) {
            const u = String(this.__ytUrl);
            if (u.includes('youtube.com') && (/feedback|youtubei/i.test(u))) {
              log('YT XHR:', this.__ytMethod || 'POST', u);
              if (u.includes('feedback') && body && typeof body === 'string' && body.length < 2000) {
                log('  xhr feedback body:', body.slice(0, 500));
              }
            }
          }
        } catch (_) {}
        return origSend.call(this, body);
      };
    } catch (e) {
      console.warn('[YT-Rec-Fix] could not patch XHR for debug', e);
    }
  }

  // Try to find evidence in the DOM that YT registered the feedback (toast, undo banner, card state change).
  async function verifyFeedbackUIEvidence() {
    // Give YT a moment to render confirmation UI
    await sleep(180);

    const evidence = [];

    // Common toast / snackbar after not-interested
    const toasts = document.querySelectorAll('ytd-toast-renderer, paper-toast, .ytd-app[role="alert"], [class*="toast"]');
    for (const t of toasts) {
      const ttxt = (t.textContent || '').trim().toLowerCase();
      if (ttxt.includes('not interested') || ttxt.includes('recommend') || ttxt.includes('got it') || ttxt.includes('undo') || ttxt.includes('hidden')) {
        evidence.push('toast:' + describeEl(t).slice(0,120));
      }
    }

    // "Undo" link that often appears in place of the dismissed card (or as a separate row)
    const undos = document.querySelectorAll('yt-button, ytd-button-renderer, a, button');
    for (const u of undos) {
      const ut = (u.textContent || '').trim().toLowerCase();
      if (ut === 'undo' || ut.includes('undo')) {
        evidence.push('undo:' + describeEl(u));
      }
    }

    // Sometimes a temporary "We'll use this..." banner replaces the card area
    const banners = document.querySelectorAll('ytd-compact-link-renderer, .ytd-item-section-renderer, [class*="dismiss"]');
    for (const b of banners) {
      const bt = (b.textContent || '').toLowerCase();
      if (bt.includes('use this') || bt.includes('improve') || bt.includes('no longer')) {
        evidence.push('banner:' + bt.replace(/\s+/g,' ').slice(0,100));
      }
    }

    if (evidence.length) {
      log('Post-feedback UI evidence found (good sign YT reacted):', evidence);
    } else {
      log('No obvious post-feedback confirmation UI detected (this can be normal; YT UI varies)');
    }
    return evidence;
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
        processSections({ scanTrigger: 'navigate' });
        processRecommendations();
        if (location.pathname === '/watch') {
          handleWatchPage();
        }
      }, 600);

      // Another sweep a bit later (virtual lists)
      setTimeout(() => {
        processSections();
        processRecommendations();
      }, 1600);
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
        processSections({ scanTrigger: 'navigate' });
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
          const prevSettings = { ...settings };
          const oldDebug = settings.debug;
          settings = { ...settings, ...newS };
          const sectionTogglesChanged = sectionSettingsChanged(prevSettings, settings);

          if (newS.debug !== undefined) {
            // debug affects logging, interceptors, and section-hide markers on page
            if (newS.debug) {
              setupApiInterceptors();
              log('debug enabled - expect verbose feedback traces + YT network logs on next button use');
            }
            if (oldDebug !== settings.debug) {
              syncAllSectionDebugMarkers();
              if (settings.debug) processSections({ scanTrigger: 'toggle' });
            }
          }

          // If toggles changed, re-process. For showChannelButton we must clean existing injected
          // wrappers first (the dedup guard in ensureButtons is generic over any .yt-rec-fix-btn),
          // otherwise cards that already have the two primary buttons would never get/lose the Ch button.
          const channelPrefChanged = oldShowChannel !== settings.showChannelButton;
          if (
            oldHide !== settings.hideBlocked ||
            oldInject !== settings.injectButtons ||
            channelPrefChanged ||
            sectionTogglesChanged
          ) {
            if (sectionTogglesChanged) {
              processSections({ scanTrigger: 'toggle' });
            }
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

    // Install network interceptor early so we can catch feedback calls when user enables debug + clicks
    setupApiInterceptors();

    log('initialized', {
      blocked: blockedVideoIds.size,
      settings
    });
    if (settings.debug) {
      log('Debug mode active on startup. Open browser console (F12) for section scans + feedback traces.');
    }

    // First sweep
    processSections({ scanTrigger: 'init' });
    processRecommendations();

    // If we landed on a watch page, track it
    if (location.pathname === '/watch' || location.pathname.startsWith('/watch')) {
      // small delay so the player etc. exist
      setTimeout(handleWatchPage, 800);
    }

    setupObservers();

    // One more sweep after everything likely loaded
    setTimeout(() => {
      processSections();
      processRecommendations();
    }, 2200);

    // Expose a tiny API for feedback debugging (rec blocking — not section hiding)
    window.__YT_REC_FIX__ = {
      getBlocked: () => Array.from(blockedVideoIds),
      block: async (id) => { blockedVideoIds.add(id); await persistBlocked(); debouncedProcess(); },
      clear: async () => { blockedVideoIds.clear(); blockedChannels.clear(); await persistBlocked(); document.querySelectorAll('[data-yt-rec-fix-hidden]').forEach(unhideCard); },
      reprocess: processRecommendations,
      settings,
      debugTriggerFeedback: async (cardEl, actionType = 'watched') => {
        if (!cardEl) {
          console.warn('[YT-Rec-Fix] Pass a card DOM element (e.g. a ytd-rich-item-renderer that contains a video)');
          return null;
        }
        const v = getVideoId(cardEl);
        console.log('[YT-Rec-Fix] manual debug feedback on', v, actionType);
        try {
          return await triggerYouTubeFeedback(cardEl, actionType, v);
        } catch (e) {
          console.error('[YT-Rec-Fix] manual debug feedback error', e);
          return { ok: false, error: String(e) };
        }
      },
      debugTriggerOnFirstCard: async (actionType = 'watched') => {
        const cards = findCards().filter((c) => !isCardHidden(c));
        if (!cards.length) {
          console.warn('[YT-Rec-Fix] No visible cards found');
          return null;
        }
        return window.__YT_REC_FIX__.debugTriggerFeedback(cards[0], actionType);
      },
      describeEl,
      setupApiInterceptors,
    };
  }

  // Kick off
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
