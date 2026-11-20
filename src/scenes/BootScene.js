import Phaser from 'phaser';
import { generateTextures, loadArt, applyArt } from '../world/textures.js';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    loadArt(this);
    // landmark rooftop sprites: public/art/landmarks/manifest.json (separate from the main art manifest)
    this.load.json('lm-manifest', './art/landmarks/manifest.json');
    this.load.once('filecomplete-json-lm-manifest', (key, type, m) => {
      for (const [id, e] of Object.entries(m.landmarks || {})) this.load.image(`lmart-${id}`, `./${e.game}`);
    });
  }

  create() {
    generateTextures(this); // programmatic fallbacks
    if (!location.search.includes("noart")) applyArt(this); // generated art over the same keys (add ?noart to see the programmatic fallbacks)
    this.scene.start('CitySelect');
  }
}
