// popup.js for YT Rec Fix
// Communicates via storage (simple for v1). Content script listens to storage changes for live updates.

const ext = (typeof browser !== 'undefined' ? browser : chrome);

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

async function loadUI() {
  // Show current version (from manifest, always in sync)
  const manifest = ext.runtime.getManifest();
  const verEl = document.getElementById('version');
  if (verEl) verEl.textContent = `(ver: ${manifest.version})`;

  const data = await getStorage([
    'blockedVideoIds',
    'settings'
  ]);

  const blocked = (data.blockedVideoIds || []).length;
  document.getElementById('blocked-count').textContent = blocked;

  const settings = data.settings || {
    hideBlocked: true,
    injectButtons: true,
    autoBlockWatch: true,
    preferDislike: false,
    debug: false,
    showChannelButton: false,  // off by default (irreversible YT action)
    hideShorts: false
  };

  // Set checkboxes
  document.getElementById('hide-blocked').checked = !!settings.hideBlocked;
  document.getElementById('inject-buttons').checked = !!settings.injectButtons;
  document.getElementById('show-channel-button').checked = !!settings.showChannelButton;
  document.getElementById('auto-block-watch').checked = !!settings.autoBlockWatch;
  document.getElementById('prefer-dislike').checked = !!settings.preferDislike;
  document.getElementById('debug').checked = !!settings.debug;
  document.getElementById('hide-shorts').checked = !!settings.hideShorts;

  // Wire changes
  ['hide-blocked', 'inject-buttons', 'show-channel-button', 'auto-block-watch', 'prefer-dislike', 'debug', 'hide-shorts'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('change', async () => {
      const newSettings = {
        hideBlocked: document.getElementById('hide-blocked').checked,
        injectButtons: document.getElementById('inject-buttons').checked,
        showChannelButton: document.getElementById('show-channel-button').checked,
        autoBlockWatch: document.getElementById('auto-block-watch').checked,
        preferDislike: document.getElementById('prefer-dislike').checked,
        debug: document.getElementById('debug').checked,
        hideShorts: document.getElementById('hide-shorts').checked
      };
      await setStorage({ settings: newSettings });
      // Content scripts will pick up via storage.onChanged
    });
  });

  // Clear
  document.getElementById('clear-blocked').addEventListener('click', async () => {
    if (!confirm('Clear all locally blocked video IDs?')) return;
    await setStorage({ blockedVideoIds: [], blockedChannels: [] });
    document.getElementById('blocked-count').textContent = '0';
  });

  // Live update count if storage changes while popup is open (e.g. from content script)
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

  // Refresh hint
  document.getElementById('refresh-page').addEventListener('click', () => {
    // Best effort: tell the active tab to reload if it's YT
    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('youtube.com')) {
        ext.tabs.reload(tab.id);
      } else {
        alert('Open a YouTube tab first, then click this.');
      }
    });
  });

  // Placeholder for advanced
  const opts = document.getElementById('open-options');
  opts.addEventListener('click', (e) => {
    e.preventDefault();
    alert('Blocklist manager / options page coming in a future version.\n\nFor now, use Clear or edit storage in devtools.');
  });
}

document.addEventListener('DOMContentLoaded', loadUI);
