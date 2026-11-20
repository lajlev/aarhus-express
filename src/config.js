// Global constants shared by every module.
export const TITLE = 'Lillefar: Aarhus Express';
export const GAME_W = 1280;
export const GAME_H = 720;
/** World pixels per metre. Must match SCALE in scripts/build-map.mjs. */
export const PX = 8;
/** Generated textures are drawn at this multiple and displayed at 1/TEX_RES. */
export const TEX_RES = 2;
export const SAVE_PREFIX = 'aarhus-express:v1';
export const FONT = '"Trebuchet MS", "Segoe UI", Helvetica, Arial, sans-serif';
export const MONO = '"Courier New", Menlo, monospace';

// Render depths (world camera).
export const DEPTH = {
  map: 0,
  marker: 5,
  pedestrian: 8,
  playerFoot: 9,
  vehicle: 10,
  effects: 20,
  label: 30,
};
