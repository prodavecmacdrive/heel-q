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
    port: 3001,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  plugins: [
    {
      name: 'save-world-plugin',
      configureServer(server) {
        // Serve workspace-root /assets/ directory at /assets/ URLs
        server.middlewares.use('/assets', (req: any, res: any, next: any) => {
          const relative = (req.url as string || '').replace(/^\/?/, '');
          const filePath = path.resolve(__dirname, '../../assets', relative);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            res.setHeader('Content-Type', ASSET_MIME[ext] || 'application/octet-stream');
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });

        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/save-world' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
              try {
                // Save directly to the engine's data directory!
                const destPath = path.resolve(__dirname, '../../engine/src/data/world.json');
                fs.mkdirSync(path.dirname(destPath), { recursive: true });
                fs.writeFileSync(destPath, body, 'utf-8');
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true }));
              } catch (err) {
                console.error('Failed to save world:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
              }
            });
            return;
          }
          
          if (req.url === '/api/assets' && req.method === 'GET') {
            try {
              const assetsDir = path.resolve(__dirname, '../../assets');
              
              const readDirSafe = (subDir: string) => {
                const fullPath = path.join(assetsDir, subDir);
                if (!fs.existsSync(fullPath)) return [];
                return fs.readdirSync(fullPath).filter(f => !f.startsWith('.'));
              };

              const data = {
                sprites: readDirSafe('sprites'),
                textures: readDirSafe('textures'),
                audio: readDirSafe('audio')
              };
              
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
            } catch(e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(e) }));
            }
            return;
          }
          next();
        });
      }
    }
  ]
});
