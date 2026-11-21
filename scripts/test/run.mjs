#!/usr/bin/env node
// Parallel regression runner.
//   node scripts/test/run.mjs                    quick check only (smoke + node unit tests)
//   node scripts/test/run.mjs --changed          quick check + suites whose `covers` globs match changed files (git diff HEAD + untracked)
//   node scripts/test/run.mjs --all              every `full` suite (pre-deploy)
//   node scripts/test/run.mjs --only a,b         named suites;  --tag realistic,economy  by tag;  --list  show the manifest
//   --timescale N   game speed (default from suites.mjs; clamped per suite to its maxScale)
//   --jobs N        concurrency (default min(4, cores/2));  --no-build / --dist DIR  reuse a build;  --keep-going is always on
// Builds once into a temp dir, starts one `vite preview` per worker on its own port (4301+), always cleans up (also on Ctrl-C).
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync, existsSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { suites, DEFAULT_TIMESCALE } from './suites.mjs';
import { selectSuites } from './lib/select.mjs';
import { buildOnce, startServers, removeDir } from './lib/servers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(ROOT);

function parseArgs(argv) {
  const o = { timescale: DEFAULT_TIMESCALE, jobs: Math.max(1, Math.min(4, Math.floor(cpus().length / 2))), basePort: 4301 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--changed') o.changed = true;
    else if (a === '--all') o.all = true;
    else if (a === '--list') o.list = true;
    else if (a === '--only') o.only = next().split(',').filter(Boolean);
    else if (a === '--tag') o.tag = next().split(',').filter(Boolean);
    else if (a === '--timescale') o.timescale = Math.max(1, Number(next()) || 1);
    else if (a === '--jobs') o.jobs = Math.max(1, Number(next()) || 1);
    else if (a === '--port') o.basePort = Number(next()) || 4301;
    else if (a === '--no-build') o.noBuild = true;
    else if (a === '--dist') o.dist = resolve(next());
    else if (a === '--json') o.json = resolve(next());
    else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.list) {
  for (const s of suites) console.log(`${s.name.padEnd(22)} ${(s.server ? 'browser' : 'node').padEnd(8)} max x${s.maxScale ?? '-'}  [${s.tags.join(',')}]  ${s.file}`);
  process.exit(0);
}

let selection;
try { selection = selectSuites(suites, opts, ROOT); } catch (e) { console.error(e.message); process.exit(2); }
selection.log.forEach((l) => console.log(l));
const picked = selection.picked.filter((s) => {
  if (existsSync(join(ROOT, s.file))) return true;
  console.log(`SKIP ${s.name}: ${s.file} not found`);
  return false;
});
if (!picked.length) { console.log('nothing to run'); process.exit(0); }

// ---------------------------------------------------------------- cleanup
const cleanups = [];
const children = new Set();
let cleaning = false;
async function cleanup() {
  if (cleaning) return; cleaning = true;
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* gone */ } }
  await new Promise((r) => setTimeout(r, 150));
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* best effort */ } }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { console.log(`\n${sig}: stopping servers and tests`); await cleanup(); process.exit(130); });
process.on('uncaughtException', async (e) => { console.error(e); await cleanup(); process.exit(1); });

// ---------------------------------------------------------------- run one suite
function runSuite(s, slotUrl, outDir) {
  return new Promise((done) => {
    const scale = Math.max(1, Math.min(opts.timescale, s.maxScale ?? opts.timescale));
    const shots = join('screenshots', 'test', s.name);
    mkdirSync(shots, { recursive: true });
    const url = slotUrl; // scale travels in TIMESCALE: speedUp() switches the game to xN only while a script waits
    const args = (s.args || ['{url}']).map((a) => a.replace('{url}', url).replace('{shots}', shots));
    if (s.server && !(s.args || ['{url}']).some((a) => a.includes('{url}'))) args.unshift(url);
    const logFile = join(outDir, `${s.name}.log`);
    const logStream = createWriteStream(logFile);
    const t0 = Date.now();
    const child = spawn(process.execPath, [s.file, ...(s.server ? args : (s.args || []))], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TIMESCALE: String(scale), TEST_URL: s.server ? url : '', SHOTS_DIR: shots },
    });
    children.add(child);
    let out = '';
    const onData = (d) => { out += d; logStream.write(d); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, s.timeoutMs || 300000);
    child.on('close', (code, sig) => {
      clearTimeout(timer); children.delete(child); logStream.end();
      const errs = out.split('\n').filter((l) => /\[(pageerror|error)\]/.test(l)).map((l) => l.trim().slice(0, 240));
      const fails = out.split('\n').filter((l) => /^FAIL\b/.test(l)).map((l) => l.trim().slice(0, 240));
      const ok = code === 0 && !timedOut && fails.length === 0; // legacy scripts print FAIL lines and may exit 0
      done({ name: s.name, ok, code, signal: sig, timedOut, scale, seconds: +((Date.now() - t0) / 1000).toFixed(1), consoleErrors: errs.length, errors: errs.slice(0, 8), failures: fails.slice(0, 12), log: logFile });
    });
  });
}

// ---------------------------------------------------------------- main
const started = Date.now();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(ROOT, 'test-results', stamp);
mkdirSync(outDir, { recursive: true });

const needsBrowser = picked.some((s) => s.server);
const workers = Math.max(1, Math.min(opts.jobs, picked.length));
let urls = [];
if (needsBrowser) {
  const dir = opts.dist || (opts.noBuild ? join(ROOT, 'dist') : null);
  const built = await buildOnce(ROOT, { outDir: dir && existsSync(dir) ? dir : undefined });
  if (built.temp) cleanups.push(() => removeDir(built.dir));
  const srv = await startServers(ROOT, built.dir, workers, opts.basePort);
  cleanups.push(() => srv.close());
  urls = srv.urls;
}
console.log(`running ${picked.length} suite(s) with ${workers} worker(s) at timescale x${opts.timescale}: ${picked.map((s) => s.name).join(', ')}`);

const queue = [...picked].sort((a, b) => (b.timeoutMs || 0) - (a.timeoutMs || 0)); // long suites first
const results = [];
await Promise.all(Array.from({ length: workers }, async (_, w) => {
  while (queue.length) {
    const s = queue.shift();
    console.log(`> [${w}] ${s.name}`);
    const r = await runSuite(s, urls[w] || '', outDir);
    results.push(r);
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.seconds}s)`);
  }
}));
await cleanup();

results.sort((a, b) => picked.findIndex((s) => s.name === a.name) - picked.findIndex((s) => s.name === b.name));
const wall = +((Date.now() - started) / 1000).toFixed(1);
console.log('\n' + 'suite'.padEnd(24) + 'result  time     scale  console errors');
for (const r of results) console.log(r.name.padEnd(24) + (r.ok ? 'PASS' : r.timedOut ? 'TIMEOUT' : 'FAIL').padEnd(8) + `${r.seconds}s`.padEnd(9) + `x${r.scale}`.padEnd(7) + r.consoleErrors);
const failed = results.filter((r) => !r.ok);
for (const r of failed) { console.log(`\n-- ${r.name}: see ${r.log}`); [...r.failures, ...r.errors].slice(0, 8).forEach((l) => console.log('   ' + l)); }
console.log(`\n${results.length - failed.length}/${results.length} passed in ${wall}s wall, ${results.reduce((a, r) => a + r.seconds, 0).toFixed(1)}s of suite time`);
const json = opts.json || join(outDir, 'results.json');
writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), timescale: opts.timescale, workers, wallSeconds: wall, results }, null, 2));
writeFileSync(join(ROOT, 'test-results', 'latest.json'), JSON.stringify({ at: new Date().toISOString(), timescale: opts.timescale, workers, wallSeconds: wall, results }, null, 2));
console.log(`results: ${json}`);
process.exit(failed.length ? 1 : 0);
