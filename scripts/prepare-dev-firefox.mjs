/**
 * Prepare a Firefox *dev* unpack for about:debugging.
 *
 * Uses a SEPARATE gecko.id so the signed production .xpi can stay installed
 * without sharing storage/permissions (blocklist wipe risk).
 *
 * Load: about:debugging → Load Temporary Add-on → dist/firefox-dev/manifest.json
 * NEVER load the repo-root manifest.json while the signed addon is installed.
 */
import path from 'node:path';
import {
  ROOT,
  emptyDir,
  copyExtensionFiles,
  readManifest,
  writeManifest,
} from './build-shared.mjs';

const DEV_GECKO_ID = 'yt-rec-fix-dev@danney.ytaddon';
const OUT_DIR = path.join(ROOT, 'dist', 'firefox-dev');

async function main() {
  const manifest = await readManifest();

  const prodId = manifest.browser_specific_settings?.gecko?.id;
  if (!prodId) {
    throw new Error('manifest.json missing browser_specific_settings.gecko.id');
  }
  if (prodId === DEV_GECKO_ID) {
    throw new Error(
      'Production manifest already has the DEV gecko id — refuse to overwrite. Restore yt-rec-fix@danney.ytaddon first.'
    );
  }

  await emptyDir(OUT_DIR);
  await copyExtensionFiles(OUT_DIR);

  manifest.name = 'YT Rec Fix DEV';
  manifest.description = `[DEV] ${manifest.description}`;
  manifest.browser_specific_settings.gecko.id = DEV_GECKO_ID;

  await writeManifest(OUT_DIR, manifest);

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║  YT Rec Fix — Firefox DEV unpack ready                           ║
╠══════════════════════════════════════════════════════════════════╣
║  Output:   dist/firefox-dev/                                     ║
║  gecko.id: ${DEV_GECKO_ID}
║  (production stays: ${prodId})
║                                                                  ║
║  KEEP the signed .xpi ENABLED in about:addons.                   ║
║  Do NOT disable it and load repo-root manifest.json.             ║
║                                                                  ║
║  1. about:debugging#/runtime/this-firefox                        ║
║  2. Load Temporary Add-on…                                       ║
║  3. Select: dist/firefox-dev/manifest.json                       ║
║  4. Grant YouTube access on the DEV addon if prompted            ║
║  5. After code changes: npm run prepare:dev-firefox + Reload     ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
