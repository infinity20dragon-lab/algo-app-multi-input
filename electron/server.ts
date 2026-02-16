import next from 'next';
import { parse } from 'url';
import http from 'http';
import path from 'path';
import { app as electronApp } from 'electron';

const port = 3000;

let server: http.Server | null = null;

export async function startNextServer(): Promise<void> {
  console.log('[Server] Starting Next.js...');

  // Detect if we're in production (packaged app) or development
  const isPackaged = electronApp.isPackaged;
  const dev = !isPackaged;

  console.log('[Server] Is packaged:', isPackaged);
  console.log('[Server] Dev mode:', dev);

  // In dev mode (npm run electron:dev), Next.js is already running via concurrently
  // So we just skip starting the server - Electron will connect to the existing dev server
  if (dev && process.env.NODE_ENV === 'development') {
    console.log('[Server] Dev mode detected - using existing Next.js dev server');
    return Promise.resolve();
  }

  // In production, app files are in resources/app (no asar)
  const appPath = dev
    ? process.cwd()
    : path.join(process.resourcesPath, 'app');

  console.log('[Server] App path:', appPath);
  console.log('[Server] Resources path:', process.resourcesPath);

  try {
    const app = next({ dev, dir: appPath });
    const handle = app.getRequestHandler();

    console.log('[Server] Preparing Next.js app...');
    await app.prepare();
    console.log('[Server] Next.js app prepared');

    server = http.createServer((req, res) => {
      const parsedUrl = parse(req.url!, true);
      handle(req, res, parsedUrl);
    });

    return new Promise((resolve, reject) => {
      server!.on('error', (err) => {
        console.error('[Server] HTTP server error:', err);
        reject(err);
      });

      server!.listen(port, () => {
        console.log(`[Server] Ready on http://localhost:${port}`);
        resolve();
      });
    });
  } catch (err) {
    console.error('[Server] Failed to start Next.js:', err);
    throw err;
  }
}

export function stopNextServer(): void {
  if (server) {
    server.close();
  }
}
