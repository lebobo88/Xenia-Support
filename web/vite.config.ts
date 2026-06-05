/**
 * web/vite.config.ts — Xenia Support Observatory dev server.
 *
 * Ports (campaign xenia-observability-ui, P0):
 *   dev    : 5197  (override XENIA_OBS_DEV_PORT; strictPort=false rolls forward)
 *   bridge : 8791  (override XENIA_OBS_BRIDGE_PORT; the bridge writes the
 *            actual bound port to .xenia-bridge-port — read here for the proxy)
 *
 * Loopback only (127.0.0.1) — support-constitution Art IV; NB-6 constraint:
 * ticket-derived data never leaves the local machine.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function bridgePort(): number {
  if (process.env['XENIA_OBS_BRIDGE_PORT']) {
    return Number(process.env['XENIA_OBS_BRIDGE_PORT']);
  }
  try {
    const portFile = fileURLToPath(new URL('./.xenia-bridge-port', import.meta.url));
    const n = Number(readFileSync(portFile, 'utf8').trim());
    if (Number.isInteger(n) && n > 0) return n;
  } catch {
    /* bridge not started yet — fall through to default */
  }
  return 8791;
}

const DEV_PORT = Number(process.env['XENIA_OBS_DEV_PORT'] ?? 5197);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: DEV_PORT,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${bridgePort()}`,
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env['XENIA_OBS_PREVIEW_PORT'] ?? DEV_PORT),
    strictPort: false,
  },
});
