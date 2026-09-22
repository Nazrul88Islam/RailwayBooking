/// <reference types="vitest" />
import { defineConfig, build } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';


function buildStandaloneScriptsPlugin() {
  return {
    name: 'build-standalone-scripts-plugin',
    async closeBundle() {
      // 1. Build content script as standalone IIFE file
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

      // 2. Build service worker as standalone IIFE file
      await build({
        configFile: false,
        build: {
          outDir: 'dist/background',
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, 'src/background/serviceWorker.ts'),
            name: 'RailwayServiceWorker',
            formats: ['iife'],
            fileName: () => 'serviceWorker.js'
          }
        }
      });
      console.log('✔ serviceWorker.js bundled as standalone IIFE script');

      if (!existsSync('dist')) {
        mkdirSync('dist', { recursive: true });
      }
      copyFileSync('manifest.json', 'dist/manifest.json');
      console.log('✔ manifest.json copied to dist/');
    }
  };
}

export default defineConfig({
  plugins: [react(), buildStandaloneScriptsPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'index.html')
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
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

