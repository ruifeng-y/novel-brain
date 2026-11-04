import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pages = [
  'auth',
  'dashboard',
  'new-project',
  'work-overview',
  'bible',
  'settings',
  'outline',
  'foreshadows',
  'writing',
  'batch',
  'changes',
  'export-publish',
  'work-settings',
  'entity-detail',
  'account-settings',
  'help',
  'legal',
  'states',
];

const viewports = [
  { width: 390, height: 844 },
  { width: 900, height: 900 },
  { width: 1180, height: 900 },
  { width: 1440, height: 900 },
];

const prototypeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const outputDir = path.join(prototypeRoot, 'screens', 'v1-baseline');
const prototypeUrl = pathToFileURL(
  path.join(prototypeRoot, 'index.html'),
).href;

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

for (const pageName of pages) {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${prototypeUrl}#${pageName}`, {
      waitUntil: 'load',
    });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(outputDir, `${pageName}-${viewport.width}.png`),
      fullPage: true,
    });
  }
}

await browser.close();
