// Programmatic textures. Everything faces +x (angle 0 = east) and is drawn at
// TEX_RES; display sprites with setScale(1 / TEX_RES).
// Tinted vehicles are drawn in light greys so `setTint(paint)` colours them.
import { PX, TEX_RES } from '../config.js';
import { VEHICLES } from '../data/vehicles.js';
import { CHARACTERS } from '../data/characters.js';

const S = PX * TEX_RES; // texture px per metre

function carTexture(scene, key, def, opts = {}) {
  const L = def.length * S, W = def.width * S;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const pad = 2;
  const r = Math.min(W * 0.28, 10);
  // body
  g.fillStyle(0x000000, 0.35).fillRoundedRect(pad + 2, pad + 3, L, W, r);
  g.fillStyle(opts.body ?? 0xf2f2f2, 1).fillRoundedRect(pad, pad, L, W, r);
  // side shading
  g.fillStyle(0x000000, 0.12).fillRect(pad + r, pad + W - W * 0.14, L - 2 * r, W * 0.14);
  g.fillStyle(0xffffff, 0.35).fillRect(pad + r, pad, L - 2 * r, W * 0.1);
  if (opts.van) {
    // cab + cargo box
    g.fillStyle(0x1f2a33, 1).fillRoundedRect(pad + L * 0.74, pad + W * 0.12, L * 0.12, W * 0.76, 4);
    g.fillStyle(0xd9d9d9, 1).fillRect(pad + L * 0.05, pad + W * 0.08, L * 0.64, W * 0.84);
    g.lineStyle(2, 0xb0b0b0, 1).strokeRect(pad + L * 0.05, pad + W * 0.08, L * 0.64, W * 0.84);
  } else {
    // windscreen, roof, rear window
    g.fillStyle(0x1f2a33, 1).fillRoundedRect(pad + L * 0.58, pad + W * 0.12, L * 0.16, W * 0.76, 5);
    g.fillStyle(0x1f2a33, 1).fillRoundedRect(pad + L * 0.14, pad + W * 0.16, L * 0.12, W * 0.68, 5);
    g.fillStyle(opts.roof ?? 0xe0e0e0, 1).fillRoundedRect(pad + L * 0.27, pad + W * 0.14, L * 0.3, W * 0.72, 5);
  }
  // lights
  g.fillStyle(0xfff6c8, 1).fillRect(pad + L - 4, pad + W * 0.1, 4, W * 0.18).fillRect(pad + L - 4, pad + W * 0.72, 4, W * 0.18);
  g.fillStyle(0xc0392b, 1).fillRect(pad, pad + W * 0.1, 3, W * 0.16).fillRect(pad, pad + W * 0.74, 3, W * 0.16);
  if (opts.police) {
    g.fillStyle(0x1b4f9c, 1).fillRect(pad + L * 0.05, pad + W * 0.42, L * 0.9, W * 0.16);
    g.fillStyle(0xe6f23a, 1);
    for (let i = 0; i < 6; i++) g.fillRect(pad + L * 0.08 + i * L * 0.14, pad, L * 0.07, W * 0.08).fillRect(pad + L * 0.15 + i * L * 0.14, pad + W * 0.92, L * 0.07, W * 0.08);
    g.fillStyle(0x2f6bff, 1).fillRect(pad + L * 0.36, pad + W * 0.2, L * 0.08, W * 0.28);
    g.fillStyle(0xff3b3b, 1).fillRect(pad + L * 0.36, pad + W * 0.52, L * 0.08, W * 0.28);
  }
  if (opts.stripe) g.fillStyle(0xffffff, 0.8).fillRect(pad, pad + W * 0.44, L, W * 0.12);
  g.generateTexture(key, Math.ceil(L + pad * 2 + 3), Math.ceil(W + pad * 2 + 4));
  g.destroy();
}

function bikeTexture(scene, key, def, cargo) {
  const L = def.length * S, W = def.width * S;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const pad = 2, cy = pad + W / 2;
  g.fillStyle(0x000000, 0.3).fillEllipse(pad + L / 2 + 2, cy + 3, L, W * 0.7);
  // wheels
  g.fillStyle(0x1b1b1b, 1).fillRoundedRect(pad, cy - 3, L * 0.22, 6, 3).fillRoundedRect(pad + L * 0.78, cy - 3, L * 0.22, 6, 3);
  if (cargo) {
    g.fillStyle(0xeeeeee, 1).fillRoundedRect(pad + L * 0.52, pad, L * 0.46, W, 5); // box in front
    g.lineStyle(2, 0x9a9a9a, 1).strokeRoundedRect(pad + L * 0.52, pad, L * 0.46, W, 5);
    g.fillStyle(0xcfcfcf, 1).fillRect(pad + L * 0.12, cy - 3, L * 0.42, 6);
  } else {
    g.fillStyle(0xeeeeee, 1).fillRoundedRect(pad + L * 0.12, cy - W * 0.32, L * 0.7, W * 0.64, 8);
    g.fillStyle(0x333333, 1).fillRoundedRect(pad + L * 0.2, cy - W * 0.18, L * 0.32, W * 0.36, 5); // seat
  }
  // handlebar
  g.fillStyle(0x2b2b2b, 1).fillRect(pad + L * (cargo ? 0.42 : 0.76), pad + W * 0.08, 4, W * 0.84);
  g.generateTexture(key, Math.ceil(L + pad * 2 + 3), Math.ceil(W + pad * 2 + 4));
  g.destroy();
}

/** Top-down person: shoulders, arms, head, hair/hat. Diameter ~1.3 m. */
export function personTexture(scene, key, look) {
  const D = 1.3 * S;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const c = D / 2 + 2;
  g.fillStyle(0x000000, 0.25).fillEllipse(c + 2, c + 3, D * 0.62, D);
  g.fillStyle(look.shirt, 1).fillEllipse(c, c, D * 0.55, D * 0.95); // shoulders (across y)
  g.fillStyle(look.skin, 1).fillCircle(c + D * 0.18, c - D * 0.38, D * 0.09).fillCircle(c + D * 0.18, c + D * 0.38, D * 0.09); // hands
  g.fillStyle(look.skin, 1).fillCircle(c + D * 0.04, c, D * 0.22); // head
  g.fillStyle(look.hair, 1).fillCircle(c - D * 0.03, c, D * 0.2);
  switch (look.hat) {
    case 'cap': g.fillStyle(look.accent, 1).fillCircle(c - D * 0.02, c, D * 0.2).fillRect(c + D * 0.1, c - D * 0.12, D * 0.16, D * 0.24); break;
    case 'beanie': g.fillStyle(look.accent, 1).fillCircle(c - D * 0.04, c, D * 0.19); break;
    case 'scarf': g.fillStyle(look.accent, 1).fillRect(c - D * 0.06, c - D * 0.3, D * 0.12, D * 0.6); break;
    case 'bun': g.fillStyle(look.hair, 1).fillCircle(c - D * 0.22, c, D * 0.1); g.fillStyle(look.accent, 1).fillRect(c + D * 0.1, c - D * 0.3, D * 0.06, D * 0.6); break;
    case 'glasses': g.fillStyle(look.accent, 1).fillRect(c + D * 0.18, c - D * 0.14, D * 0.06, D * 0.28); break;
    default: break;
  }
  g.generateTexture(key, Math.ceil(c * 2 + 3), Math.ceil(c * 2 + 4));
  g.destroy();
}

const PED_LOOKS = [
  { shirt: 0x5d7fa3, hair: 0x3b2a20, skin: 0xf0c8a8, accent: 0x222222 },
  { shirt: 0xa34d5d, hair: 0xd9b25c, skin: 0xf3d1b8, accent: 0x222222, hat: 'bun' },
  { shirt: 0x4f7a4a, hair: 0x1b1b1b, skin: 0xb07a54, accent: 0xdddddd, hat: 'beanie' },
  { shirt: 0x7a6a9a, hair: 0x9a9a9a, skin: 0xe6b996, accent: 0x333333, hat: 'glasses' },
  { shirt: 0xd4a43a, hair: 0x5a3a24, skin: 0xd9a17c, accent: 0x1d4ea3, hat: 'cap' },
  { shirt: 0x2f2f3a, hair: 0xc8552b, skin: 0xf6d4bd, accent: 0xb8312f, hat: 'scarf' },
];
export const PED_TEXTURES = PED_LOOKS.map((_, i) => `ped-${i}`);

export function generateTextures(scene) {
  for (const [id, def] of Object.entries(VEHICLES)) {
    if (scene.textures.exists(def.tex)) continue;
    if (id === 'cargobike') bikeTexture(scene, def.tex, def, true);
    else if (id === 'bike') { bikeTexture(scene, def.tex, def, false); bikeTexture(scene, 'veh-bike-rider', def, false); }
    else if (id === 'scooter') bikeTexture(scene, def.tex, def, false);
    else carTexture(scene, def.tex, def, { van: id === 'van', police: id === 'police', body: id === 'police' ? 0xf7f7f7 : 0xf0f0f0, stripe: id === 'coupe' });
  }
  { // programmatic bike-rack fallback: concrete strip with hoops
    const W = 5.6 * S, H = 0.9 * S, g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x8d8a84, 1).fillRect(0, 0, W, H);
    g.lineStyle(3, 0xcfd3d6, 1);
    for (let i = 0; i < 8; i++) g.strokeRect(W * (0.06 + i * 0.115), H * 0.2, W * 0.07, H * 0.6);
    g.generateTexture('prop-bikerack', Math.ceil(W), Math.ceil(H));
    g.destroy();
  }
  carTexture(scene, 'veh-wreck', VEHICLES.smallcar, { body: 0x2b2725, roof: 0x1e1b19 });
  for (const ch of CHARACTERS) personTexture(scene, `char-${ch.id}`, ch.look);
  PED_LOOKS.forEach((l, i) => personTexture(scene, `ped-${i}`, l));

  // generic particles / markers
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xffffff, 1).fillCircle(8, 8, 8);
  g.generateTexture('dot', 16, 16);
  g.clear();
  for (let r = 16; r > 0; r -= 2) g.fillStyle(0xffffff, (1 - r / 16) * 0.25).fillCircle(16, 16, r);
  g.generateTexture('soft', 32, 32);
  g.clear();
  g.fillStyle(0xffffff, 1).fillTriangle(0, 0, 28, 12, 0, 24).fillStyle(0x000000, 0.25).fillTriangle(0, 18, 28, 12, 0, 24);
  g.generateTexture('arrow', 28, 24);
  g.destroy();
}

// ---------------------------------------------------------------------------
// Generated art (public/art, see manifest.json). Loaded in BootScene.preload and
// baked over the programmatic textures under the SAME keys, at the same
// resolution (TEX_RES) and facing (+x), so entities need no changes. If an image
// is missing the programmatic texture stays as the fallback.
// ---------------------------------------------------------------------------
const ART_BASE = './art/';
const MANIFEST_KEY = 'art-manifest';
const imgKey = (group, id) => `art:${group}:${id}`;

// texture key -> [manifest vehicle id, length m, max width m, look]
const VEHICLE_ART = {
  'veh-smallcar': ['hatchback', 4.0, 1.85, 'paint'],
  'veh-van': ['delivery_van', 5.3, 2.1, 'paint'],
  'veh-coupe': ['hatchback', 4.3, 1.9, 'paint'],
  'veh-police': ['police_car', 4.7, 1.95, 'color'],
  'veh-scooter': ['scooter', 1.9, 0.8, 'color'],
  'veh-cargobike': ['cargo_bike', 2.6, 1.0, 'color'],
  'veh-bike': ['city_bike', 1.9, 0.6, 'color'], // parked / empty Danish city bike
  'veh-bike-rider': ['city_bike_rider', 1.9, 0.9, 'color'], // same bike with a cyclist on it
  'veh-wreck': ['hatchback', 4.0, 1.85, 'wreck'],
  'veh-tram': ['tram', 24, 2.65, 'color'],
  'veh-bus': ['bus', 12, 2.55, 'color'], // city bus (JOBS); 'bus' vehicle type is registered at runtime by missions/careers/bus.js if data/vehicles.js lacks it
};
const CHAR_ART = { freja: 'barista', kasper: 'superfan', noor: 'art_student', henning: 'dock_worker', ingrid: 'tram_driver' };
const PERSON_M = 1.9; // longest side of a person sprite in metres

/** Call from Scene.preload(). Queues the manifest, then every game-ready image. */
export function loadArt(scene) {
  scene.load.setPath('');
  scene.load.json(MANIFEST_KEY, `${ART_BASE}manifest.json`);
  scene.load.once(`filecomplete-json-${MANIFEST_KEY}`, (key, type, m) => {
    for (const [group, entries] of Object.entries(m)) {
      if (group === 'tiles' || group.startsWith('_')) continue; // tiles are loaded on demand by MapRenderer if used
      for (const [id, e] of Object.entries(entries)) {
        scene.load.image(imgKey(group, id), `./${e.game}`);
        if (e.small) scene.load.image(imgKey(group + '-small', id), `./${e.small}`);
      }
    }
  });
  scene.load.on('loaderror', (f) => console.warn('[art] missing', f.src));
}

function srcImage(scene, group, id) {
  const k = imgKey(group, id);
  return scene.textures.exists(k) ? scene.textures.get(k).getSourceImage() : null;
}

function pixels(ctx, w, h, fn) {
  const d = ctx.getImageData(0, 0, w, h);
  fn(d.data);
  ctx.putImageData(d, 0, 0);
}

/** Make the body luminance ~0.9 greyscale so setTint(paint) gives a true paint colour with detail kept. */
function normaliseForTint(ctx, w, h) {
  pixels(ctx, w, h, (p) => {
    const lums = [];
    for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 200) lums.push(0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]);
    lums.sort((a, b) => a - b);
    const med = lums[Math.floor(lums.length * 0.6)] || 128;
    const gain = 235 / Math.max(med, 40);
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.min(255, (0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]) * gain);
      p[i] = p[i + 1] = p[i + 2] = v;
    }
  });
}

function hueRotate(ctx, w, h, deg, sat = 1) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const m = [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
  pixels(ctx, w, h, (p) => {
    for (let i = 0; i < p.length; i += 4) {
      const r = p[i], g = p[i + 1], b = p[i + 2];
      p[i] = Math.max(0, Math.min(255, r * m[0] + g * m[1] + b * m[2]));
      p[i + 1] = Math.max(0, Math.min(255, r * m[3] + g * m[4] + b * m[5]));
      p[i + 2] = Math.max(0, Math.min(255, r * m[6] + g * m[7] + b * m[8]));
    }
  });
}

/** Draw an up-facing image into a +x-facing canvas texture. along/across in texture px. */
function bakeRotated(scene, key, img, along, across, post) {
  const pad = 2;
  const cw = Math.ceil(along) + pad * 2, ch = Math.ceil(across) + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(Math.PI / 2); // image nose-up -> nose-right
  ctx.drawImage(img, -across / 2, -along / 2, across, along);
  if (post) post(ctx, cw, ch);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, cv);
}

/** Call after generateTextures() once loading is complete. */
export function applyArt(scene) {
  const T = scene.textures;
  try {
    // vehicles
    for (const [key, [id, lenM, widM, look]] of Object.entries(VEHICLE_ART)) {
      const img = srcImage(scene, 'vehicles', id);
      if (!img) continue;
      const along = lenM * S;
      const across = Math.min(along * (img.width / img.height), widM * S * 1.15);
      bakeRotated(scene, key, img, along, across, (ctx, w, h) => {
        if (look === 'paint') normaliseForTint(ctx, w, h);
        if (look === 'wreck') {
          pixels(ctx, w, h, (p) => { for (let i = 0; i < p.length; i += 4) { const v = (0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2]) * 0.35; p[i] = v * 1.05; p[i + 1] = v; p[i + 2] = v * 0.95; } });
        }
      });
    }
    // bike rack (props group): drawn along +x, 5.6 m long
    const rack = srcImage(scene, 'props', 'bike_rack');
    if (rack) {
      const w = Math.ceil(5.6 * S), h = Math.ceil(w * rack.height / rack.width);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(rack, 0, 0, w, h);
      if (T.exists('prop-bikerack')) T.remove('prop-bikerack');
      T.addCanvas('prop-bikerack', cv);
    }
    // playable characters
    const personTex = (key, img, post) => {
      const k = PERSON_M * S / Math.max(img.width, img.height);
      bakeRotated(scene, key, img, img.height * k, img.width * k, post);
    };
    for (const [cid, aid] of Object.entries(CHAR_ART)) {
      const img = srcImage(scene, 'characters', aid);
      if (img) personTex(`char-${cid}`, img);
    }
    const police = srcImage(scene, 'characters', 'police_officer');
    if (police) personTex('char-police_officer', police);
    // pedestrians: one sprite, hue-shifted variants
    const ped = srcImage(scene, 'characters', 'pedestrian');
    if (ped) [0, 70, 150, 220, 290, 330].forEach((deg, i) => personTex(`ped-${i}`, ped, deg ? (ctx, w, h) => hueRotate(ctx, w, h, deg) : null));
    // UI: markers and icons registered under the keys other systems expect
    const alias = { 'marker-pickup': ['ui', 'marker_pickup'], 'marker-dropoff': ['ui', 'marker_dropoff'], 'icon-money': ['ui', 'icon_money'], 'icon-heart': ['ui', 'icon_heart'], 'icon-heat': ['ui', 'icon_heat'], 'icon-phone': ['ui', 'icon_phone'] };
    for (const [key, [g, id]] of Object.entries(alias)) {
      const img = srcImage(scene, g, id);
      if (!img) continue;
      if (T.exists(key)) T.remove(key);
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      cv.getContext('2d').drawImage(img, 0, 0);
      T.addCanvas(key, cv);
    }
    const mk = srcImage(scene, 'ui', 'marker_pickup');
    if (mk) { // contact marker: pickup marker hue-shifted to blue/purple
      const cv = document.createElement('canvas');
      cv.width = mk.width; cv.height = mk.height;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(mk, 0, 0);
      hueRotate(ctx, cv.width, cv.height, 120);
      if (T.exists('marker-contact')) T.remove('marker-contact');
      T.addCanvas('marker-contact', cv);
    }
  } catch (e) {
    console.warn('[art] failed, keeping programmatic textures', e);
  }
}
