import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  copyExtensionFiles,
  emptyDir,
  readManifest,
  writeManifest,
} from './build-shared.mjs';

const OUT_DIR = path.join(ROOT, 'dist', 'chrome');

function toChromeManifest(manifest) {
  const chromeManifest = structuredClone(manifest);

  delete chromeManifest.browser_specific_settings;

  const optionalHosts = chromeManifest.optional_host_permissions || [];
  delete chromeManifest.optional_host_permissions;

  const hostPermissions = new Set(chromeManifest.host_permissions || []);
  for (const origin of optionalHosts) {
    hostPermissions.add(origin);
  }
  if (hostPermissions.size > 0) {
    chromeManifest.host_permissions = [...hostPermissions];
  }

  chromeManifest.minimum_chrome_version = '109';

  const chromeDescription =
    'One-click watched/dislike on YouTube recs + local blocklist. Hide Shorts, For You, Feature, topics & more. No servers.';
  if (chromeDescription.length > 132) {
    throw new Error(`Chrome description too long (${chromeDescription.length} > 132)`);
  }
  chromeManifest.description = chromeDescription;

  return chromeManifest;
}

async function main() {
  const manifest = await readManifest();
  const chromeManifest = toChromeManifest(manifest);

  await emptyDir(OUT_DIR);
  await copyExtensionFiles(OUT_DIR);
  await writeManifest(OUT_DIR, chromeManifest);

  const zipName = `yt-rec-fix-chrome-${manifest.version}.zip`;
  const zipPath = path.join(ROOT, 'dist', zipName);

  await fs.rm(zipPath, { force: true });

  if (process.platform === 'win32') {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const psOut = zipPath.replace(/'/g, "''");
    const psIn = OUT_DIR.replace(/'/g, "''");
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${psIn}\\*' -DestinationPath '${psOut}' -Force`,
    ]);
  }

  console.log(`Chrome unpacked build: ${OUT_DIR}`);
  if (process.platform === 'win32') {
    console.log(`Chrome zip build: ${zipPath}`);
  } else {
    console.log('Zip skipped (Windows-only helper). Load the unpacked folder in chrome://extensions.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});