// Build once into a temp dir, then serve it from one in-process `vite preview` per worker slot (own port each).
import { build, preview } from 'vite';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function freePort(start, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const tryPort = (p) => {
      if (p > start + 200) return reject(new Error('no free port'));
      const s = createServer();
      s.once('error', () => tryPort(p + 1));
      s.once('listening', () => s.close(() => resolve(p)));
      s.listen(p, host);
    };
    tryPort(start);
  });
}

export async function buildOnce(root, { outDir, log = console.log } = {}) {
  const dir = outDir || mkdtempSync(join(tmpdir(), 'aarhus-test-dist-'));
  if (outDir && existsSync(outDir)) { log(`reusing build in ${outDir}`); return { dir, temp: false }; }
  const t0 = Date.now();
  await build({ root, logLevel: 'error', build: { outDir: dir, emptyOutDir: true, chunkSizeWarningLimit: 4000 } });
  log(`build ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${dir}`);
  return { dir, temp: !outDir };
}

/** Start `count` preview servers on distinct free ports from basePort. Returns { urls, close() }. */
export async function startServers(root, dir, count, basePort = 4301) {
  const servers = [], urls = [];
  let next = basePort;
  for (let i = 0; i < count; i++) {
    const port = await freePort(next);
    next = port + 1;
    const s = await preview({ root, logLevel: 'error', build: { outDir: dir }, preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
    servers.push(s);
    urls.push(`http://127.0.0.1:${port}/`);
  }
  return {
    urls,
    async close() { await Promise.allSettled(servers.map((s) => s.close())); },
  };
}

export function removeDir(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
