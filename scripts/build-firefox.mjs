import { spawn } from 'node:child_process';
import path from 'node:path';
import { ROOT } from './build-shared.mjs';

const WEB_EXT_BIN = path.join(ROOT, 'node_modules', 'web-ext', 'bin', 'web-ext.js');

function runWebExt(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WEB_EXT_BIN, ...args], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`web-ext exited with code ${code}`));
    });
  });
}

const IGNORE_FILES = [
  'package.json',
  'package-lock.json',
  'images',
  'images/**',
  'tmp',
  'tmp/**',
  'mcps',
  'mcps/**',
  'dev-testing.md',
  'README.md',
  'CHANGELOG.md',
  '.github',
  '.github/**',
  'scripts',
  'scripts/**',
  'dist',
  'dist/**',
];

async function main() {
  const args = [
    'build',
    '--overwrite-dest',
    '--source-dir',
    '.',
    '--artifacts-dir',
    'dist',
    '--filename',
    'yt-rec-fix-{version}.zip',
    '--ignore-files',
    ...IGNORE_FILES,
  ];

  await runWebExt(args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});