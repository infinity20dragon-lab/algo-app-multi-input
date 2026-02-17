import { app, BrowserWindow, shell, systemPreferences, ipcMain } from 'electron';
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

// --- Native Audio (naudiodon) ---
let naudiodon: typeof import('naudiodon2') | null = null;
// Active captures: deviceId → AudioIO instance
const activeCaptures = new Map<number, any>();
// Per-channel accumulation buffers for 20ms batching
const channelBuffers = new Map<string, Float32Array[]>();
const BATCH_INTERVAL_MS = 20;

function loadNaudiodon(): boolean {
  if (naudiodon) return true;
  try {
    naudiodon = require('naudiodon2');
    log('[NativeAudio] naudiodon loaded successfully');
    return true;
  } catch (err) {
    log('[NativeAudio] naudiodon not available: ' + err);
    return false;
  }
}

function setupNativeAudioIPC(): void {
  ipcMain.handle('native-audio:is-available', () => {
    return loadNaudiodon();
  });

  ipcMain.handle('native-audio:list-devices', () => {
    if (!loadNaudiodon()) return [];
    try {
      const devices = naudiodon!.getDevices();
      return devices
        .filter((d: any) => d.maxInputChannels > 0)
        .map((d: any) => ({
          id: d.id,
          name: d.name,
          maxInputChannels: d.maxInputChannels,
          maxOutputChannels: d.maxOutputChannels,
          defaultSampleRate: d.defaultSampleRate,
          hostAPIName: d.hostAPIName,
        }));
    } catch (err) {
      log('[NativeAudio] Failed to list devices: ' + err);
      return [];
    }
  });

  ipcMain.handle('native-audio:start-capture', (_event, config: {
    deviceId: number;
    channelCount: number;
    sampleRate?: number;
  }) => {
    if (!loadNaudiodon()) return false;
    if (activeCaptures.has(config.deviceId)) {
      log(`[NativeAudio] Device ${config.deviceId} already capturing`);
      return true;
    }

    const sampleRate = config.sampleRate || 48000;
    const channelCount = config.channelCount;

    try {
      const ai = naudiodon!.AudioIO({
        inOptions: {
          channelCount,
          sampleFormat: naudiodon!.SampleFormatFloat32,
          sampleRate,
          deviceId: config.deviceId,
          closeOnError: false,
        },
      });

      // Samples per channel for ~20ms at this sample rate
      const samplesPerBatch = Math.ceil(sampleRate * BATCH_INTERVAL_MS / 1000);

      // Initialize per-channel buffers
      for (let ch = 0; ch < channelCount; ch++) {
        const key = `${config.deviceId}:${ch}`;
        channelBuffers.set(key, []);
      }

      // Track accumulated sample count per channel
      const accumulatedSamples = new Array(channelCount).fill(0);

      ai.on('data', (buffer: Buffer) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;

        // buffer is interleaved Float32 PCM: [ch0, ch1, ch2, ch3, ch0, ch1, ...]
        const float32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
        const framesInChunk = Math.floor(float32.length / channelCount);

        // Deinterleave into per-channel arrays
        for (let ch = 0; ch < channelCount; ch++) {
          const channelData = new Float32Array(framesInChunk);
          for (let i = 0; i < framesInChunk; i++) {
            channelData[i] = float32[i * channelCount + ch];
          }

          const key = `${config.deviceId}:${ch}`;
          const chunks = channelBuffers.get(key);
          if (chunks) {
            chunks.push(channelData);
            accumulatedSamples[ch] += framesInChunk;
          }

          // Flush when we've accumulated enough for ~20ms
          if (accumulatedSamples[ch] >= samplesPerBatch) {
            const allChunks = channelBuffers.get(key);
            if (allChunks && allChunks.length > 0) {
              // Merge chunks into single buffer
              const totalLen = allChunks.reduce((sum, c) => sum + c.length, 0);
              const merged = new Float32Array(totalLen);
              let offset = 0;
              for (const chunk of allChunks) {
                merged.set(chunk, offset);
                offset += chunk.length;
              }

              // Send to renderer
              mainWindow.webContents.send('native-audio:pcm', {
                deviceId: config.deviceId,
                channel: ch,
                samples: merged.buffer, // Transfer as ArrayBuffer
                sampleRate,
              });

              // Reset
              channelBuffers.set(key, []);
              accumulatedSamples[ch] = 0;
            }
          }
        }
      });

      ai.on('error', (err: Error) => {
        log(`[NativeAudio] Device ${config.deviceId} error: ${err.message}`);
      });

      ai.start();
      activeCaptures.set(config.deviceId, ai);
      log(`[NativeAudio] Started capture: device=${config.deviceId}, channels=${channelCount}, rate=${sampleRate}`);
      return true;
    } catch (err) {
      log(`[NativeAudio] Failed to start capture on device ${config.deviceId}: ${err}`);
      return false;
    }
  });

  ipcMain.handle('native-audio:stop-capture', (_event, deviceId: number) => {
    stopCapture(deviceId);
  });

  ipcMain.handle('native-audio:stop-all', () => {
    stopAllCaptures();
  });
}

function stopCapture(deviceId: number): void {
  const ai = activeCaptures.get(deviceId);
  if (ai) {
    try {
      ai.quit(() => {
        log(`[NativeAudio] Stopped capture: device=${deviceId}`);
      });
    } catch (err) {
      log(`[NativeAudio] Error stopping device ${deviceId}: ${err}`);
    }
    activeCaptures.delete(deviceId);
  }
  // Clean up channel buffers for this device
  for (const key of channelBuffers.keys()) {
    if (key.startsWith(`${deviceId}:`)) {
      channelBuffers.delete(key);
    }
  }
}

function stopAllCaptures(): void {
  for (const deviceId of activeCaptures.keys()) {
    stopCapture(deviceId);
  }
  log('[NativeAudio] All captures stopped');
}

// --- End Native Audio ---

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
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

    // Setup native audio IPC handlers
    setupNativeAudioIPC();

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
  stopAllCaptures();
  stopNextServer();
});
