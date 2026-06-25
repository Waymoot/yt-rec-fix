import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const EXTENSION_DIRS = ['content', 'popup', 'icons'];
export const EXTENSION_FILES = ['LICENSE'];

export async function readManifest() {
  const raw = await fs.readFile(path.join(ROOT, 'manifest.json'), 'utf8');
  return JSON.parse(raw);
}

export async function emptyDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function copyEntry(src, dest) {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const entry of entries) {
      await copyEntry(path.join(src, entry), path.join(dest, entry));
    }
    return;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

export async function copyExtensionFiles(destDir) {
  for (const dir of EXTENSION_DIRS) {
    await copyEntry(path.join(ROOT, dir), path.join(destDir, dir));
  }
  for (const file of EXTENSION_FILES) {
    const src = path.join(ROOT, file);
    try {
      await fs.access(src);
      await copyEntry(src, path.join(destDir, file));
    } catch {
      // LICENSE is optional in local trees.
    }
  }
}

export async function writeManifest(destDir, manifest) {
  const out = `${JSON.stringify(manifest, null, 2)}\n`;
  await fs.writeFile(path.join(destDir, 'manifest.json'), out, 'utf8');
}