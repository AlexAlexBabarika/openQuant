import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, './src/lib'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/trial': 'http://127.0.0.1:8000',
      '/backtests': 'http://127.0.0.1:8000',
      '/symbols': 'http://127.0.0.1:8000',
      '/scripts': 'http://127.0.0.1:8000',
      '/strategies': 'http://127.0.0.1:8000',
      '/sweeps': 'http://127.0.0.1:8000',
      '/portfolio-backtests': 'http://127.0.0.1:8000',
      '/auth': 'http://127.0.0.1:8000',
      '/user': 'http://127.0.0.1:8000',
      '/data': 'http://127.0.0.1:8000',
      '/ws': {
        target: 'http://127.0.0.1:8000',
        ws: true,
      },
      '/health': 'http://127.0.0.1:8000',
    },
  },
});
