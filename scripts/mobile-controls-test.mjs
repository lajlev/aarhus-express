// Touch-only navigation and multi-touch driving, using Chromium's real touch pipeline.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser } from './test/lib/browser.mjs';

const browser = await launchBrowser();
const shots = process.env.SHOTS_DIR || 'screenshots/mobile';
mkdirSync(shots, { recursive: true });
const url = process.argv[2] || process.env.TEST_URL || 'http://127.0.0.1:4173/';
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  await page.goto(url);
  const button = key => page.locator(`#mobile-controls button[data-key=${JSON.stringify(key)}]`);
  const menu = () => page.getByRole('button', { name: 'Menu', exact: true });
  const tap = async key => {
    if (!await button(key).isVisible()) await menu().tap();
    await button(key).tap();
    await page.waitForTimeout(180);
  };
  const scene = name => page.waitForFunction(name => window.__game?.scene.isActive(name), name);
  await scene('CitySelect');
  await tap('Enter'); await scene('CharacterSelect');
  await tap('Enter'); await scene('NewGame');
  for (let i = 0; i < 3; i++) await tap('ArrowDown');
  await tap('Enter'); await scene('Game');
  await page.waitForFunction(() => !!window.__game.scene.getScene('Game').player);
  assert.equal(await page.locator('#mobile-controls button:visible').count(), 7, 'only movement, Use, Run and Menu remain visible');
  for (const key of ['h', 'y', 'n', 'Tab', 'j', 'm', 'p', 'b', 'k', 'r', 't', 'v']) {
    assert.equal(await button(key).isVisible(), false, `${key} starts in collapsed menu`);
  }
  await menu().tap();
  assert.equal(await menu().getAttribute('aria-expanded'), 'true');
  await menu().tap();
  assert.equal(await menu().getAttribute('aria-expanded'), 'false');
  const cdp = await page.context().newCDPSession(page);
  const touches = new Map();
  async function hold(key, id) {
    const box = await button(key).boundingBox();
    assert(box, `Visible control ${key}`);
    touches.set(id, { id, x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...touches.values()] });
    await page.waitForTimeout(100);
  }
  async function release(id) {
    const point = touches.get(id);
    touches.delete(id);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: point ? [point] : [] });
    await page.waitForTimeout(100);
  }
  const keys = () => page.evaluate(() => { const k = window.__game.scene.getScene('Game').player.keys; return { up: k.up2.isDown, right: k.right2.isDown, brake: k.handbrake.isDown }; });
  await hold('ArrowUp', 1); await hold('ArrowRight', 2);
  assert.deepEqual(await keys(), { up: true, right: true, brake: false });
  await release(1); assert.equal((await keys()).right, true, 'second finger remains held'); await release(2);
  await hold('ArrowUp', 1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); touches.clear();
  await page.waitForTimeout(100); assert.equal((await keys()).up, false);
  await page.evaluate(() => {
    const g = window.__game.scene.getScene('Game');
    const v = g.vehicles.find(v => v.owned && v.drivable);
    if (!v) throw new Error('No owned vehicle');
    const p = v.exitPoint(); g.player.x = p.x; g.player.y = p.y;
  });
  await tap('e');
  await page.waitForFunction(() => !!window.__game.scene.getScene('Game').player.vehicle);
  await hold('ArrowUp', 1); await hold('ArrowRight', 2);
  assert.deepEqual(await page.evaluate(() => { const i = window.__game.scene.getScene('Game').player.vehicle.input; return { throttle: i.throttle, steer: i.steer }; }), { throttle: 1, steer: 1 });
  await release(2); await hold(' ', 2); assert.equal((await keys()).brake, true);
  await release(2);
  await menu().tap();
  assert.equal((await keys()).up, false, 'opening menu clears held movement');
  await release(1);
  await tap('j'); await scene('JobApp');
  await tap('ArrowRight');
  assert.equal(await page.evaluate(() => window.__game.scene.getScene('JobApp').tab), 1);
  await tap('Escape'); await scene('Game'); assert.equal((await keys()).up, false);
  await tap('m'); await scene('Overlay'); await tap('Escape'); await scene('Game');
  await hold('ArrowUp', 1); await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal((await keys()).up, false); await release(1);
  for (const [name, width, height] of [['iphone-portrait', 390, 844], ['iphone-landscape', 844, 390], ['ipad-portrait', 820, 1180], ['ipad-landscape', 1180, 820]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('canvas').getBoundingClientRect();
      const controls = [...document.querySelectorAll('#mobile-controls button')].filter(b => b.getBoundingClientRect().width && b.getBoundingClientRect().height).map(b => { const r = b.getBoundingClientRect(); return { key: b.dataset.key, x: r.x, y: r.y, width: r.width, height: r.height }; });
      return { canvas: { x: canvas.x, y: canvas.y, right: canvas.right, bottom: canvas.bottom }, controls, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(layout.overflow, false, name);
    const expectedWidth = Math.min(width, height * 1280 / 720);
    assert(Math.abs(layout.canvas.right - layout.canvas.x - expectedWidth) < 2, `${name}: controls must not shrink canvas`);
    assert.equal(layout.controls.length, 7, `${name}: compact controls`);
    assert(await page.evaluate(() => {
      const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + 8) === c;
    }), `${name}: unused overlay space passes touches to game`);
    for (const b of layout.controls) {
      assert(b.width >= 44 && b.height >= 44, `${name}: undersized ${b.key}`);
      assert(b.x >= -1 && b.y >= -1 && b.x + b.width <= width + 1 && b.y + b.height <= height + 1, `${name}: offscreen ${b.key}`);
      assert(b.x >= layout.canvas.x - 1 && b.y >= layout.canvas.y - 1 && b.x + b.width <= layout.canvas.right + 1 && b.y + b.height <= layout.canvas.bottom + 1, `${name}: ${b.key} must overlay the canvas`);
    }
    await page.screenshot({ path: join(shots, `${name}.png`) });
    await menu().tap();
    await page.screenshot({ path: join(shots, `${name}-menu.png`) });
    for (const key of ['h', 'y', 'n', 'Tab', 'j', 'm', 'p', 'b', 'k', 'r', 't', 'v']) {
      await button(key).scrollIntoViewIfNeeded();
      const box = await button(key).boundingBox();
      assert(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `${name}: menu action ${key} reachable`);
    }
    await tap('h');
    assert.equal(await menu().getAttribute('aria-expanded'), 'false', 'selection dismisses menu');
    await menu().tap();
    await page.evaluate(() => {
      window.canvasDismissTouches = 0;
      document.querySelector('canvas').addEventListener('pointerdown', () => window.canvasDismissTouches++, { once: true });
    });
    await page.touchscreen.tap(layout.canvas.x + 2, layout.canvas.y + 2);
    assert.equal(await menu().getAttribute('aria-expanded'), 'false', 'outside tap dismisses menu');
    assert.equal(await page.evaluate(() => window.canvasDismissTouches), 0, 'dismissal does not activate canvas');
  }
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: false });
  await desktop.goto(url); await desktop.waitForFunction(() => window.__game?.scene.isActive('CitySelect'));
  assert.equal(await desktop.locator('#mobile-controls').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS touch menus, multi-touch movement/driving/braking, cancel/blur/overlay release, four full-canvas overlay layouts, compact menu and dismissal, desktop unchanged');
} finally {
  await browser.close();
}
