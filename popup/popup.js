// popup.js for YT Rec Fix
// Communicates via storage (simple for v1). Content script listens to storage changes for live updates.

const ext = (typeof browser !== 'undefined' ? browser : chrome);

const DEFAULT_SETTINGS = {
  hideBlocked: true,
  injectButtons: true,
  autoBlockWatch: true,
  preferDislike: false,
  debug: false,
  showChannelButton: false,
  hideShorts: false,
  hideExploreMoreTopics: false,
  hideMostRelevant: false,
  hideForYou: false,
  hideChannelFeature: false,
};

const SETTING_CONTROLS = [
  { id: 'hide-blocked', key: 'hideBlocked' },
  { id: 'inject-buttons', key: 'injectButtons' },
  { id: 'show-channel-button', key: 'showChannelButton' },
  { id: 'auto-block-watch', key: 'autoBlockWatch' },
  { id: 'prefer-dislike', key: 'preferDislike' },
  { id: 'hide-shorts', key: 'hideShorts' },
  { id: 'hide-explore-topics', key: 'hideExploreMoreTopics' },
  { id: 'hide-most-relevant', key: 'hideMostRelevant' },
  { id: 'hide-for-you', key: 'hideForYou' },
  { id: 'hide-channel-feature', key: 'hideChannelFeature' },
  { id: 'debug', key: 'debug' },
];

async function getStorage(keys) {
  return new Promise((resolve) => {
    ext.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

async function setStorage(obj) {
  return new Promise((resolve) => {
    ext.storage.local.set(obj, () => resolve());
  });
}

function readSettingsFromUI() {
  const settings = { ...DEFAULT_SETTINGS };
  for (const { id, key } of SETTING_CONTROLS) {
    const el = document.getElementById(id);
    if (el) settings[key] = !!el.checked;
  }
  return settings;
}

async function loadUI() {
  const manifest = ext.runtime.getManifest();
  const verEl = document.getElementById('version');
  if (verEl) verEl.textContent = `(ver: ${manifest.version})`;

  const data = await getStorage(['blockedVideoIds', 'settings']);

  const blocked = (data.blockedVideoIds || []).length;
  document.getElementById('blocked-count').textContent = blocked;

  const stored = { ...(data.settings || {}) };
  if (stored.hideChannelPromote !== undefined) {
    stored.hideChannelFeature = !!stored.hideChannelPromote;
    delete stored.hideChannelPromote;
  }
  const settings = { ...DEFAULT_SETTINGS, ...stored };

  for (const { id, key } of SETTING_CONTROLS) {
    const el = document.getElementById(id);
    if (el) el.checked = !!settings[key];
  }

  for (const { id } of SETTING_CONTROLS) {
    const el = document.getElementById(id);
    el.addEventListener('change', async () => {
      await setStorage({ settings: readSettingsFromUI() });
    });
  }

  document.getElementById('clear-blocked').addEventListener('click', async () => {
    if (!confirm('Clear all locally blocked video IDs?')) return;
    await setStorage({ blockedVideoIds: [], blockedChannels: [] });
    document.getElementById('blocked-count').textContent = '0';
  });

  if (ext.storage && ext.storage.onChanged) {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.blockedVideoIds) {
        const c = (changes.blockedVideoIds.newValue || []).length;
        const el = document.getElementById('blocked-count');
        if (el) el.textContent = c;
      }
    });
  }

  document.getElementById('refresh-page').addEventListener('click', () => {
    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('youtube.com')) {
        ext.tabs.reload(tab.id);
      } else {
        alert('Open a YouTube tab first, then click this.');
      }
    });
  });

  const opts = document.getElementById('open-options');
  opts.addEventListener('click', (e) => {
    e.preventDefault();
    alert('Blocklist manager / options page coming in a future version.\n\nFor now, use Clear or edit storage in devtools.');
  });
}

document.addEventListener('DOMContentLoaded', loadUI);