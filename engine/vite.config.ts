import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    fs: {
      allow: ['..'] // Allow serving the parent /assets directory
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
});
