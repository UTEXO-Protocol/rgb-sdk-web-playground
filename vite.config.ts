import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  return {
  resolve: {
    alias: {
      '@utexo/rgb-sdk-core': path.resolve(__dirname, '../rgb-sdk-core/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      plugins: [
        {
          name: 'resolve-polyfill-shims',
          resolveId(id: string) {
            if (id.startsWith('vite-plugin-node-polyfills/shims/')) {
              try { return require.resolve(id); } catch {}
            }
          },
        },
      ],
    },
  },
  plugins: [
    nodePolyfills({ globals: { Buffer: true, process: true } }), // must be first
    wasm(),
    topLevelAwait(),
    react(),
  ],
  server: {
    port: 5173,
    proxy: {
      // bitcoind RPC (regtest mine/fund) — the compose.wasm.yaml esplora
      // container's bitcoind, host-mapped on 18444 (see start-lsp-web.sh).
      '/bitcoind': {
        target: 'http://localhost:18444',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bitcoind/, ''),
      },
      // VSS server (root compose --profile vss, started by VSS=1
      // start-lsp-web.sh). Same-origin: vss-server has no CORS support, so the
      // browser must reach it through this proxy. No rewrite — the server
      // serves under /vss (e.g. /vss/putObject).
      '/vss': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
      // RGB proxy server
      '/proxy': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy/, ''),
      },
      // Esplora block explorer API (local regtest)
      '/esplora': {
        target: 'http://localhost:8094',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/esplora/, ''),
      },
      // utexo-lsp HTTP API (LSP/APay flows) — same-origin to avoid CORS.
      // VITE_LSP_BASE_URL="/lsp" (written by scripts/start-lsp-web.sh).
      '/lsp': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lsp/, ''),
      },
      // Hosted signet utexo-lsp (APay UTEXO flow) — same-origin to avoid CORS.
      '/lsp-signet': {
        target: env.VITE_SIGNET_LSP_TARGET || 'https://lsp-signet.utexo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lsp-signet/, ''),
      },
      // Signet faucet RLN-node REST (funds BTC, plays the external RGB sender
      // in the APay UTEXO flow) — set VITE_SIGNET_FAUCET_URL in .env.local.
      '/faucet-signet': {
        target: env.VITE_SIGNET_FAUCET_URL || 'http://127.0.0.1:9', // unset → fails fast
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/faucet-signet/, ''),
      },
    },
    fs: {
      // Allow serving WASM files from sibling local packages
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '../rgb-sdk-web'),
        path.resolve(__dirname, '../rgb-sdk-core'),
        path.resolve(__dirname, '../../utexo/rgb-lightning-node/bindings/wasm-sdk/pkg'),
      ],
    },
  },
  optimizeDeps: {
    // Don't pre-bundle — these contain WASM / local file: symlinks
    exclude: ['@utexo/rgb-sdk-web', '@utexo/rln-wasm'],
    // Force pre-bundle CJS deps pulled in by excluded packages so named exports work
    include: ['bitcoinjs-lib'],
  },
  };
});
