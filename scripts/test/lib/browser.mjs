// Shared Chromium discovery + launch (same lookup as scripts/smoke-test.mjs).
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).sort().reverse()) {
      for (const rel of ['chrome-headless-shell-mac-arm64/chrome-headless-shell', 'chrome-headless-shell-linux64/chrome-headless-shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux/chrome']) {
        const p = join(root, d, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}

export const CHROME_ARGS = ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'];
export const IGNORED_CONSOLE = /GL Driver Message|GPU stall/;

export async function launchBrowser() {
  return chromium.launch({ executablePath: findChrome(), args: CHROME_ARGS });
}
