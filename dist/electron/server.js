"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startNextServer = startNextServer;
exports.stopNextServer = stopNextServer;
const next_1 = __importDefault(require("next"));
const url_1 = require("url");
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const port = 3000;
let server = null;
async function startNextServer() {
    console.log('[Server] Starting Next.js...');
    // Detect if we're in production (packaged app) or development
    const isPackaged = electron_1.app.isPackaged;
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
        : path_1.default.join(process.resourcesPath, 'app');
    console.log('[Server] App path:', appPath);
    console.log('[Server] Resources path:', process.resourcesPath);
    try {
        const app = (0, next_1.default)({ dev, dir: appPath });
        const handle = app.getRequestHandler();
        console.log('[Server] Preparing Next.js app...');
        await app.prepare();
        console.log('[Server] Next.js app prepared');
        server = http_1.default.createServer((req, res) => {
            const parsedUrl = (0, url_1.parse)(req.url, true);
            handle(req, res, parsedUrl);
        });
        return new Promise((resolve, reject) => {
            server.on('error', (err) => {
                console.error('[Server] HTTP server error:', err);
                reject(err);
            });
            server.listen(port, () => {
                console.log(`[Server] Ready on http://localhost:${port}`);
                resolve();
            });
        });
    }
    catch (err) {
        console.error('[Server] Failed to start Next.js:', err);
        throw err;
    }
}
function stopNextServer() {
    if (server) {
        server.close();
    }
}
