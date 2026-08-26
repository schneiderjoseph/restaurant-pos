'use strict';

/**
 * Start isolated Loyverse UI demo — never touches ASI :5173 / :3142.
 *
 *   node loyverse-sync/scripts/start-demo-ui.js
 *
 * Opens: http://localhost:5174/  → gateway :3143 → Surreal loyverse/loyverse
 * ASI:   http://localhost:5173/  → gateway :3142 → Surreal posr/posr (untouched)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..', '..');
const gatewayDir = path.join(root, 'gateway');

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const loyverseGw = parseEnvFile(path.join(gatewayDir, '.env.loyverse'));

const gwEnv = {
  ...process.env,
  ...loyverseGw,
  GATEWAY_PORT: '3143',
  SURREAL_NS: 'loyverse',
  SURREAL_DB: 'loyverse',
  GATEWAY_ALLOWED_ORIGINS: 'http://localhost:5174,http://127.0.0.1:5174',
};

const viteEnv = {
  ...process.env,
  POSR_DEV_PORT: '5174',
  POSR_GATEWAY_PORT: '3143',
};

console.log('Loyverse demo UI — ASI :5173/:3142 left alone');
console.log('  gateway :3143 → loyverse/loyverse');
console.log('  vite    :5174 → http://localhost:5174/');

const gw = spawn('node', ['server.js'], {
  cwd: gatewayDir,
  env: gwEnv,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

setTimeout(() => {
  const vite = spawn('bun', ['x', 'vite', '--mode', 'loyverse', '--port', '5174', '--strictPort'], {
    cwd: root,
    env: viteEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  vite.on('exit', (code) => {
    console.error('Vite exited', code);
    gw.kill();
    process.exit(code || 0);
  });
}, 1200);

gw.on('exit', (code) => {
  console.error('Loyverse gateway exited', code);
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  gw.kill();
  process.exit(0);
});
