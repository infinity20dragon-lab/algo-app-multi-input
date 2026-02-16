import { app, BrowserWindow, shell, systemPreferences } from 'electron';
import path from 'path';
import fs from 'fs';
import { startNextServer, stopNextServer } from './server';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

// Log to file for debugging
const logFile = path.join(app.getPath('userData'), 'electron.log');
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (err) {
    console.error('Failed to write log:', err);
  }
}

log('Electron app starting...');
log('isDev: ' + isDev);
log('App path: ' + app.getAppPath());
log('Resources path: ' + process.resourcesPath);

// Daily terminal console clear for long-running 24/7 operation
let lastTerminalClear: string | null = null;

function setupDailyTerminalClear(): void {
  const checkTerminalClear = () => {
    try {
      const now = new Date();
      // Convert to PST
      const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      const currentHour = pstTime.getHours();
      const currentMinute = pstTime.getMinutes();
      const currentDate = pstTime.toDateString();

      // Clear terminal at midnight PST (00:00) if not already cleared today
      if (currentHour === 0 && currentMinute === 0 && lastTerminalClear !== currentDate) {
        console.log('🧹 [Electron] Performing daily terminal clear to free memory...');
        console.log(`📅 Last clear: ${lastTerminalClear || 'Never'}`);
        console.log(`📊 Clearing terminal for 24/7 operation maintenance`);

        lastTerminalClear = currentDate;

        // Clear terminal using ANSI escape codes
        setTimeout(() => {
          // Method 1: Standard console.clear (works in most Node.js environments)
          console.clear();

          // Method 2: ANSI escape code for terminals (fallback)
          process.stdout.write('\x1Bc');

          console.log('✅ [Electron] Terminal cleared at midnight PST - logs reset for new day');
          console.log(`📅 Date: ${currentDate}`);
          log(`Terminal cleared at midnight PST - ${currentDate}`);
        }, 1000);
      }
    } catch (err) {
      log('Error in terminal clear: ' + err);
    }
  };

  // Check immediately on startup
  checkTerminalClear();

  // Check every minute (to catch midnight precisely)
  setInterval(checkTerminalClear, 60 * 1000);

  log('Daily terminal clear scheduler started (midnight PST)');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
    title: 'AlgoSound - Fire Station Alert System',
  });

  // Load the Next.js app
  const url = 'http://localhost:3000';
  console.log('[Electron] Loading URL:', url);

  mainWindow.loadURL(url).catch((err) => {
    console.error('[Electron] Failed to load URL:', err);
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Electron] Page failed to load:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  try {
    log('App ready event fired');

    // Request microphone permissions on macOS
    if (process.platform === 'darwin') {
      try {
        await systemPreferences.askForMediaAccess('microphone');
      } catch (err) {
        log('Failed to request microphone access: ' + err);
      }
    }

    // Start Next.js server
    log('Starting Next.js server...');
    await startNextServer();
    log('Next.js server started successfully');

    createWindow();
    log('Window created');

    // Setup daily terminal console clear at 3 AM PST
    setupDailyTerminalClear();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (err) {
    log('FATAL ERROR in whenReady: ' + err);
    log('Stack: ' + (err instanceof Error ? err.stack : 'no stack'));
  }
}).catch((err) => {
  log('FATAL ERROR in whenReady promise: ' + err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopNextServer();
});
