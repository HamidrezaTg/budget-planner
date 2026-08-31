import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri v2 Brownfield pattern: the React bundle is bundled as static assets
// that src-tauri ships inside the binary. The dev script imports a stub
// `tauri-plugin` so Vite can resolve `@tauri-apps/api/core` from the host.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5183,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2021',
    minify: 'esbuild',
    sourcemap: true,
  },
});
