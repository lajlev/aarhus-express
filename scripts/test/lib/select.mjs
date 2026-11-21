// Pick suites: --all, --only, --tag, --changed (git diff vs HEAD + untracked; read-only git).
import { execFileSync } from 'node:child_process';
import { matchesAny } from './glob.mjs';
import { INFRA_GLOBS } from '../suites.mjs';

export function changedFiles(root) {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').map((s) => s.trim()).filter(Boolean);
  try {
    const set = new Set([...run(['diff', '--name-only', 'HEAD']), ...run(['ls-files', '--others', '--exclude-standard'])]);
    return [...set].filter((f) => !/^(screenshots|test-results|dist|node_modules)\//.test(f)).sort();
  } catch {
    return null; // not a git repo / git missing
  }
}

export function selectSuites(suites, opts, root) {
  const log = [];
  if (opts.only?.length) {
    const unknown = opts.only.filter((n) => !suites.some((s) => s.name === n));
    if (unknown.length) throw new Error(`unknown suite(s): ${unknown.join(', ')} (see --list)`);
    return { picked: suites.filter((s) => opts.only.includes(s.name)), log };
  }
  if (opts.all) return { picked: suites.filter((s) => s.tags.includes('full')), log };
  if (opts.tag) return { picked: suites.filter((s) => opts.tag.some((t) => s.tags.includes(t))), log };
  if (opts.changed) {
    const files = changedFiles(root);
    const quick = suites.filter((s) => s.always);
    if (!files) { log.push('git unavailable: running every full suite'); return { picked: suites.filter((s) => s.tags.includes('full')), log }; }
    log.push(files.length ? `changed files (${files.length}): ${files.slice(0, 12).join(', ')}${files.length > 12 ? ', ...' : ''}` : 'no changed files');
    const infra = files.some((f) => matchesAny(f, INFRA_GLOBS));
    const hit = new Set(quick.map((s) => s.name));
    for (const s of suites) {
      if (hit.has(s.name)) continue;
      if (infra && s.tags.includes('quick')) { hit.add(s.name); continue; }
      if (files.some((f) => f === s.file || matchesAny(f, s.covers))) hit.add(s.name);
    }
    return { picked: suites.filter((s) => hit.has(s.name)), log };
  }
  return { picked: suites.filter((s) => s.tags.includes('quick')), log }; // default: the quick check
}
