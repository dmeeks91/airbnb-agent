import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { renderProductionIndexHtml } from './src/server/config/clientConfig.ts';
import { createApiRouter } from './src/server/routes/index.ts';

async function startServer(): Promise<void> {
  const app = express();
  const port = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));
  app.use('/api', createApiRouter());

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const renderedIndexHtml = renderProductionIndexHtml(distPath);
    app.use(
      express.static(distPath, {
        index: false,
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (base === 'manifest.json' || base === 'firebase-messaging-sw.js') {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(renderedIndexHtml);
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Guest Co-Host server running on http://localhost:${port}`);
  });
}

void startServer();
