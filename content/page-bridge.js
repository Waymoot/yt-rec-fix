// Runs in the PAGE context (not the extension isolated world).
// Loaded only when VERBOSE_SECTION_DEBUG = true in content/yt-rec-fix.js (off by default).
// Lets you type __YT_REC_FIX__ in the normal DevTools console on youtube.com.
(function () {
  'use strict';

  if (window.__YT_REC_FIX__ && window.__YT_REC_FIX__.__bridge) return;

  const pending = new Map();
  let seq = 0;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'YT_REC_FIX_RESPONSE') return;
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error));
    else p.resolve(data.result);
  });

  function call(cmd, args) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.postMessage({ type: 'YT_REC_FIX_CMD', id, cmd, args: args || [] }, '*');
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('YT Rec Fix: timeout — ladda om tillägget och YouTube-fliken.'));
      }, 12000);
    });
  }

  const HELP = `
[YT-Rec-Fix] Konsolhjälp (svenska)
==================================
Skriv dessa i konsolen (här på youtube.com):

  __YT_REC_FIX__.help()
      → visar denna hjälp

  await __YT_REC_FIX__.dumpDebugTrace()
      → sammanfattning av vad som hänt (sök-fetch, gömda Shorts, m.m.)
      → "await" behövs — resultatet sparas i variabeln om du vill:
        let r = await __YT_REC_FIX__.dumpDebugTrace()

  await __YT_REC_FIX__.listShortsSections()
      → lista alla Shorts-element i DOM (med #id)

  await __YT_REC_FIX__.getShortsSectionStats()
      → { total, hidden, hiddenByUs }

Tips:
  • Öppna konsolen: F12 → fliken "Konsol" / "Console"
  • Debug-kryssrutan måste vara PÅ i tilläggspopupen
  • Efter en sökning: kör dumpDebugTrace() och titta på "key timeline"
  • Varje ny Shorts-rad "#N" = YouTube lade till ett NYTT element

Varför "await"?
  Kommandona pratar med tillägget i bakgrunden och returnerar ett Promise.
`;

  window.__YT_REC_FIX__ = {
    __bridge: true,
    help: () => {
      console.log(HELP);
      return 'Skriv: await __YT_REC_FIX__.dumpDebugTrace()';
    },
    dumpDebugTrace: (opts) => call('dumpDebugTrace', [opts || {}]),
    listShortsSections: () => call('listShortsSections'),
    getShortsSectionStats: () => call('getShortsSectionStats'),
    getDebugTrace: () => call('getDebugTrace'),
    clearDebugTrace: () => call('clearDebugTrace'),
    getBlocked: () => call('getBlocked'),
  };

  console.log(
    '%c[YT-Rec-Fix]%c Konsol-API redo. Skriv: %c__YT_REC_FIX__.help()',
    'color:#c62828;font-weight:bold',
    'color:inherit',
    'color:#0af;font-weight:bold'
  );
})();