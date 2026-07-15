#!/usr/bin/env node
import { watch } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ignored = /^(?:\.git|node_modules|rules\/target|\.loanos-data)(?:\/|$)|^(?:docs\/dashboard\.html|docs\/dashboard-data\.json|test_output\.log)$/;
const watchedExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.png', '.rs', '.sql', '.toml', '.yml', '.yaml']);
let timer = null;
let child = null;
let pending = false;

function relevant(filename) {
  if (!filename) return true;
  const normalized = String(filename).split(sep).join('/');
  return !ignored.test(normalized) && watchedExtensions.has(extname(normalized));
}

function schedule(filename = 'initial run') {
  if (!relevant(filename)) return;
  if (child) { pending = true; return; }
  clearTimeout(timer);
  timer = setTimeout(run, filename === 'initial run' ? 0 : 750);
}

function run() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log(`\n[dashboard] regenerating at ${new Date().toISOString()}`);
  child = spawn(npm, ['run', 'dashboard'], { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    console.log(`[dashboard] ${code === 0 ? 'ready' : `failed (${signal || code})`}; watching for changes`);
    child = null;
    if (pending) { pending = false; schedule('pending change.js'); }
  });
}

const watcher = watch(ROOT, { recursive: true }, (_event, filename) => schedule(filename));
watcher.on('error', (error) => { console.error(`[dashboard] watcher failed: ${error.message}`); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearTimeout(timer);
  watcher.close();
  if (child) child.kill(signal);
  process.exit();
});

console.log(`[dashboard] watching ${relative(process.cwd(), ROOT) || '.'}; press Ctrl+C to stop`);
schedule();
