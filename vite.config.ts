import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
      // bitcoind RPC (regtest mine/fund)
      '/bitcoind': {
        target: 'http://localhost:18443',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bitcoind/, ''),
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
    },
    fs: {
      // Allow serving WASM files from sibling local packages
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, '../rgb-sdk-web'),
        path.resolve(__dirname, '../rgb-lib-wasm'),
        path.resolve(__dirname, '../rgb-sdk-core'),
        '/Users/yuriibandrivskyi/Desktop/utexo/rgb-lib-wasm/bindings/wasm/pkg',
      ],
    },
  },
  optimizeDeps: {
    // Don't pre-bundle — these contain WASM / local file: symlinks
    exclude: ['@utexo/rgb-sdk-web', '@utexo/rgb-lib-wasm'],
    // Force pre-bundle CJS deps pulled in by excluded packages so named exports work
    include: ['bitcoinjs-lib'],
  },
});
