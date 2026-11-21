import Phaser from 'phaser';
import { GAME_W, GAME_H } from './config.js';
import { BootScene } from './scenes/BootScene.js';
import { CitySelectScene } from './scenes/CitySelectScene.js';
import { CharacterSelectScene } from './scenes/CharacterSelectScene.js';
import { NewGameScene } from './scenes/NewGameScene.js';
import { GameScene } from './scenes/GameScene.js';
import { HUDScene } from './scenes/HUDScene.js';
import { OverlayScene } from './scenes/OverlayScene.js';
import { JobAppScene } from './scenes/JobAppScene.js';
import { installTimeScale } from './core/timescale.js';
import { GamblingScene } from './scenes/GamblingScene.js';

installTimeScale(); // test speed mode: ?timescale=N / window.__setTimeScale(n)

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: '#101318',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, roundPixels: false },
  fps: { target: 60 },
  scene: [BootScene, CitySelectScene, CharacterSelectScene, NewGameScene, GameScene, HUDScene, OverlayScene, JobAppScene, GamblingScene],
});

// Handy for debugging and for the headless smoke test.
window.__game = game;
