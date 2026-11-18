import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';

/**
 * Content-Security-Policy for production builds (the dev server needs inline
 * scripts for hot reload, so it is not applied there).
 *
 * - No third-party scripts, ever: an API key may live in this origin's storage.
 * - 'wasm-unsafe-eval' is required by the on-device face-tracking engine.
 * - connect-src stays open to https because people choose their own AI provider,
 *   and to localhost for models running on the same machine.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'vbw-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta name="color-scheme"',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />\n    <meta name="color-scheme"`,
      );
    },
  };
}

// `base: './'` keeps every asset URL relative, so the build can be served from
// a domain root, a sub-path, or behind a reverse-proxy rewrite without changes.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    contentSecurityPolicy(),
    VitePWA({
      // An AAC device must never reload mid-sentence. A new version waits until
      // the app is next opened (or the user presses "Update now" in Settings).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Voice Before Words',
        short_name: 'Voice',
        description:
          'A free AAC communication board. Choose symbols, pick the sentence that says what you mean, and speak it aloud.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f4ef',
        theme_color: '#3b3bd6',
        categories: ['accessibility', 'education', 'medical', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The board (code, fonts, every bundled symbol) is precached so talking
        // works with no connection. The face-tracking engine is large, so it is
        // cached the first time a camera input method is switched on instead.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
        globIgnores: ['mediapipe/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/mediapipe/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'face-tracking-v1',
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: ['es2020', 'safari14', 'chrome90', 'firefox90'],
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    restoreMocks: true,
  },
});
