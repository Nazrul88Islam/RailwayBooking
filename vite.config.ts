import { defineConfig, build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

function buildContentScriptPlugin() {
  return {
    name: 'build-content-script-plugin',
    async closeBundle() {
      // Build content script as standalone IIFE file without module import dependencies
      await build({
        configFile: false,
        build: {
          outDir: 'dist/content',
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, 'src/content/content.ts'),
            name: 'RailwayContentScript',
            formats: ['iife'],
            fileName: () => 'content.js'
          }
        }
      });
      console.log('✔ content.js bundled as standalone IIFE script');

      if (!existsSync('dist')) {
        mkdirSync('dist', { recursive: true });
      }
      copyFileSync('manifest.json', 'dist/manifest.json');
      console.log('✔ manifest.json copied to dist/');
    }
  };
}

export default defineConfig({
  plugins: [react(), buildContentScriptPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html'),
        serviceWorker: resolve(__dirname, 'src/background/serviceWorker.ts')
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'serviceWorker') {
            return 'background/serviceWorker.js';
          }
          return 'assets/[name]-[hash].js';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  test: {
    globals: true,
    environment: 'node'
  }
});
