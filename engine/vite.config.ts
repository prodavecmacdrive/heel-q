import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// MIME types for static asset serving
const ASSET_MIME: Record<string, string> = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3':  'audio/mpeg',
  '.ogg':  'audio/ogg',
  '.wav':  'audio/wav',
  '.json': 'application/json',
};

export default defineConfig({
  server: {
    port: 3000,
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  plugins: [
    {
      name: 'serve-shared-assets',
      configureServer(server) {
        // Serve workspace-root /assets/ directory at /assets/ URLs
        server.middlewares.use('/assets', (req: any, res: any, next: any) => {
          const relative = (req.url as string || '').replace(/^\/?/, '');
          const filePath = path.resolve(__dirname, '../assets', relative);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            res.setHeader('Content-Type', ASSET_MIME[ext] || 'application/octet-stream');
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });
      },
    },
  ],
});
