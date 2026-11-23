import './mobile-controls.css';

const SPECIAL_KEYS = {
  ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'],
  ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'],
  Enter: [13, 'Enter'], Escape: [27, 'Escape'], Tab: [9, 'Tab'],
  Shift: [16, 'ShiftLeft'], ' ': [32, 'Space'], '+': [187, 'Equal'], '-': [189, 'Minus'],
};

/** Touch-only DOM controls share the existing keyboard bindings, including menu actions. */
export function installMobileControls(game) {
  if (!(navigator.maxTouchPoints > 0 || window.matchMedia('(any-pointer: coarse)').matches)) return () => {};

  const root = document.createElement('section');
  root.id = 'mobile-controls';
  root.setAttribute('aria-label', 'Touch game controls');
  const hint = document.createElement('p');
  hint.className = 'mobile-controls-hint';
  const pad = document.createElement('div');
  pad.className = 'mobile-controls-pad';
  pad.setAttribute('aria-label', 'Direction controls');
  const actions = document.createElement('div');
  actions.className = 'mobile-controls-actions';
  const extra = document.createElement('div');
  extra.className = 'mobile-controls-extra';
  extra.id = 'mobile-controls-extra';
  extra.hidden = true;
  root.append(hint, pad, actions, extra);
  document.body.append(root);
  document.body.classList.add('has-mobile-controls');

  const held = new Map(); // pointer id -> button/key, so separate fingers release independently
  const physical = new Set();
  const pendingRelease = new Set();
  const touched = new Set();
  const cleanups = [];
  let context = '';
  let destroyed = false;

  function listen(target, name, fn, options) {
    target.addEventListener(name, fn, options);
    cleanups.push(() => target.removeEventListener(name, fn, options));
  }

  function keyInfo(key) {
    return SPECIAL_KEYS[key] || [key.toUpperCase().charCodeAt(0), `Key${key.toUpperCase()}`];
  }

  function emit(type, key) {
    const [keyCode, code] = keyInfo(key);
    window.dispatchEvent(new KeyboardEvent(type, {
      key, code, keyCode, which: keyCode, bubbles: true, cancelable: true,
      shiftKey: key === 'Shift', repeat: false,
    }));
  }

  function isHeld(key) {
    for (const press of held.values()) if (press.key === key) return true;
    return false;
  }

  function release(id) {
    const press = held.get(id);
    if (!press) return;
    held.delete(id);
    if (!isHeld(press.key)) {
      press.button.classList.remove('is-held');
      pendingRelease.add(press.key);
    }
  }

  function flushReleases() {
    for (const key of pendingRelease) {
      if (!isHeld(key) && !physical.has(keyInfo(key)[0])) emit('keyup', key);
    }
    pendingRelease.clear();
  }

  function reset() {
    for (const id of [...held.keys()]) release(id);
    flushReleases();
    // Paused scenes do not receive keyup. Clear only keys touched by this adapter,
    // not other keys being held on an attached hardware keyboard.
    for (const scene of game.scene.scenes) {
      for (const code of touched) {
        if (!physical.has(code)) scene.input?.keyboard?.keys[code]?.reset();
      }
    }
    touched.clear();
  }

  function button(key, label, title = label) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.dataset.key = key;
    el.setAttribute('aria-label', title);
    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      el.setPointerCapture(event.pointerId);
      const wasHeld = isHeld(key);
      held.set(event.pointerId, { key, button: el });
      touched.add(keyInfo(key)[0]);
      el.classList.add('is-held');
      if (!wasHeld && !physical.has(keyInfo(key)[0])) emit('keydown', key);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      el.addEventListener(name, (event) => release(event.pointerId));
    }
    // Assistive activation / keyboard-generated clicks do not have a pointerdown.
    el.addEventListener('click', (event) => {
      if (event.detail !== 0) return;
      touched.add(keyInfo(key)[0]);
      emit('keydown', key);
      pendingRelease.add(key);
    });
    return el;
  }

  for (const [key, label, name] of [
    ['ArrowUp', '▲', 'Up / accelerate'], ['ArrowLeft', '◀', 'Left / steer left'],
    ['ArrowDown', '▼', 'Down / reverse'], ['ArrowRight', '▶', 'Right / steer right'],
  ]) pad.append(button(key, label, name));

  function render() {
    if (destroyed) return;
    const scenes = game.scene;
    const active = ['Gamble', 'JobApp', 'Overlay', 'Game', 'NewGame', 'CharacterSelect', 'CitySelect'].find((key) => scenes.isActive(key)) || 'Boot';
    const scene = scenes.keys[active];
    const vehicle = active === 'Game' && !!scene.player?.vehicle;
    const mode = scene?.mode || '';
    const tab = active === 'JobApp' ? scene.tabs?.[scene.tab] : '';
    const next = `${active}:${vehicle}:${mode}:${tab}`;
    if (next === context) return;
    reset();
    context = next;
    root.dataset.scene = active;
    extra.hidden = true;
    actions.replaceChildren();
    extra.replaceChildren();
    const playing = active === 'Game';
    hint.textContent = playing ? (vehicle ? '▲ accelerate · ▼ reverse · ◀ ▶ steer' : 'Hold arrows to walk · hold Run to sprint') : 'Arrows to choose · Confirm to select';
    const main = playing ? [
      ['e', 'Use', 'Interact / enter or exit vehicle'],
      [vehicle ? ' ' : 'Shift', vehicle ? 'Brake' : 'Run'], ['h', 'Horn'],
      ['y', 'Accept'], ['n', 'Decline'], ['Tab', 'Task', 'Track next task'],
      ['j', 'Jobs'], ['m', 'Map'], ['p', 'Pause'],
    ] : [['Enter', 'Confirm'], ['Escape', 'Back']];
    const more = playing ? [
      ['b', 'Shop'], ['k', 'Skills'], ['r', 'Radio'], ['t', 'Station'], ['v', 'Mute'],
    ] : active === 'JobApp' ? [
      ['x', 'Abandon'], ['d', 'Decline'], ['a', 'Pay all'], ['+', 'Stake +'], ['-', 'Stake −'],
    ] : active === 'Gamble' ? [['a', 'Reveal all']] : active === 'Overlay' ? [
      ['b', 'Shop'], ['k', 'Skills'], ['m', 'Map'],
      ...(mode === 'pause' ? [['q', 'Quit to menu']] : mode === 'map' ? [['x', 'Abandon']] : []),
    ] : [];
    for (const args of main) actions.append(button(...args));
    if (more.length) {
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.textContent = 'More';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', extra.id);
      toggle.addEventListener('click', () => {
        reset();
        extra.hidden = !extra.hidden;
        toggle.setAttribute('aria-expanded', String(!extra.hidden));
      });
      actions.append(toggle);
      for (const args of more) extra.append(button(...args));
    }
  }

  listen(window, 'keydown', (event) => { if (event.isTrusted) physical.add(event.keyCode); }, true);
  listen(window, 'keyup', (event) => { if (event.isTrusted) physical.delete(event.keyCode); }, true);
  listen(window, 'blur', () => { physical.clear(); reset(); });
  listen(document, 'visibilitychange', () => { if (document.hidden) { physical.clear(); reset(); } });
  listen(window, 'resize', reset);
  listen(window, 'orientationchange', reset);
  listen(root, 'contextmenu', (event) => event.preventDefault());
  // Let even very short taps reach one simulation update before keyup clears JustDown.
  function afterStep() { render(); flushReleases(); }
  game.events.on('poststep', afterStep);
  render();
  // CSS changes the available canvas area without modifying the game's logical resolution.
  if (game.isBooted) game.scale.refresh();

  function destroy() {
    reset();
    destroyed = true;
    game.events.off('poststep', afterStep);
    game.events.off('destroy', destroy);
    for (const cleanup of cleanups) cleanup();
    root.remove();
    document.body.classList.remove('has-mobile-controls');
  }
  game.events.once('destroy', destroy);
  return destroy;
}
