// UI theme: "courier app" look. Ink panels, paper text, orange accent. Original styling.
// OWNER: UI specialist
import { FONT } from '../config.js';

export const C = {
  ink: 0x16181d, ink2: 0x20242c, ink3: 0x2c313b,
  paper: 0xf3eee4, orange: 0xff6a2b, red: 0xe5484d, green: 0x4cc38a, blue: 0x4da3ff, muted: 0x8b909b, gold: 0xf2b134,
};
export const S = {
  ink: '#16181D', paper: '#F3EEE4', orange: '#FF6A2B', red: '#FF5A5F', green: '#4CC38A', blue: '#4DA3FF', muted: '#9AA0AB', gold: '#F2B134',
};
export const F = {
  head: `Oswald, "Arial Narrow", "Helvetica Neue Condensed Bold", Impact, ${FONT}`,
  body: `Rubik, "Segoe UI", system-ui, ${FONT}`,
};

let fontsRequested = false;
/** Inject the Google Fonts stylesheet once (best effort; system fonts are the fallback). */
export function ensureFonts() {
  if (fontsRequested || typeof document === 'undefined') return;
  fontsRequested = true;
  try {
    if (navigator.webdriver) return; // headless test runs: stay offline-safe, no failed requests
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Rubik:wght@400;500;700&display=swap';
    document.head.appendChild(link);
  } catch (e) { /* ignore */ }
}

/** Text factory with consistent defaults (2x resolution so it stays crisp when the canvas scales). */
export function txt(scene, x, y, str, o = {}) {
  const t = scene.add.text(x, y, str, {
    fontFamily: o.head ? F.head : F.body,
    fontSize: `${o.size || 16}px`,
    fontStyle: o.bold ? '700' : (o.head ? '700' : '400'),
    color: o.color || S.paper,
    stroke: o.stroke || undefined,
    strokeThickness: o.strokeThickness || 0,
    align: o.align || 'left',
    wordWrap: o.wrap ? { width: o.wrap } : undefined,
    resolution: 2,
  });
  t.setOrigin(o.ox ?? 0, o.oy ?? 0);
  return t;
}

/** Rounded dark panel with an orange accent edge. */
export function panel(g, x, y, w, h, o = {}) {
  const r = o.r ?? 12;
  g.fillStyle(o.fill ?? C.ink, o.alpha ?? 0.88).fillRoundedRect(x, y, w, h, r);
  g.lineStyle(o.lw ?? 2, o.stroke ?? C.ink3, 1).strokeRoundedRect(x, y, w, h, r);
  if (o.accent !== false) g.fillStyle(o.accent ?? C.orange, 1).fillRoundedRect(x, y + 8, 4, h - 16, 2);
  return g;
}

/** Icon: uses the art texture when present, otherwise draws a shape. Returns a game object centred at (x, y). */
export function icon(scene, kind, x, y, size = 22) {
  const key = `icon-${kind}`;
  if (scene.textures.exists(key)) {
    const im = scene.add.image(x, y, key);
    im.setScale(size / Math.max(im.width, im.height));
    return im;
  }
  const g = scene.add.graphics({ x, y });
  const r = size / 2;
  if (kind === 'money') {
    g.fillStyle(C.gold, 1).fillCircle(0, 0, r).lineStyle(2, 0x8a5d00, 1).strokeCircle(0, 0, r);
    g.lineStyle(2, 0x8a5d00, 1).strokeCircle(0, 0, r * 0.55);
  } else if (kind === 'heart') {
    g.fillStyle(C.red, 1).fillCircle(-r * 0.45, -r * 0.2, r * 0.55).fillCircle(r * 0.45, -r * 0.2, r * 0.55);
    g.fillTriangle(-r * 0.98, 0, r * 0.98, 0, 0, r * 0.95);
  } else if (kind === 'heat') {
    g.fillStyle(C.orange, 1).beginPath().arc(0, 2, r * 0.8, Math.PI, 0).closePath().fillPath();
    g.fillRect(-r, 2, size, r * 0.35);
  } else if (kind === 'phone') {
    g.fillStyle(C.paper, 1).fillRoundedRect(-r * 0.6, -r, r * 1.2, size, 4);
    g.fillStyle(C.ink, 1).fillRect(-r * 0.42, -r * 0.72, r * 0.84, size * 0.62);
    g.fillStyle(C.orange, 1).fillCircle(0, r * 0.72, 2);
  }
  return g;
}

export const fmtKr = (n) => (n >= 9e8 ? 'kr ∞' : `kr ${Math.round(n).toLocaleString('da-DK')}`); // 1e9 = the infinite-money balance
export const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const lqThreshold = (n) => 40 * n + 10 * n * n;
