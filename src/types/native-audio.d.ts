/**
 * Native Audio API exposed via Electron preload contextBridge.
 * Available as window.nativeAudio when running inside Electron.
 */

interface NativeAudioDevice {
  id: number;
  name: string;
  maxInputChannels: number;
  maxOutputChannels: number;
  defaultSampleRate: number;
  hostAPIName: string;
}

interface NativeAudioCaptureConfig {
  deviceId: number;
  channelCount: number;
  sampleRate?: number; // defaults to 48000
}

interface NativeAudioPCMData {
  deviceId: number;
  channel: number;
  samples: Float32Array;
  sampleRate: number;
}

interface NativeAudioAPI {
  isAvailable: () => Promise<boolean>;
  listDevices: () => Promise<NativeAudioDevice[]>;
  startCapture: (config: NativeAudioCaptureConfig) => Promise<boolean>;
  stopCapture: (deviceId: number) => Promise<void>;
  stopAllCaptures: () => Promise<void>;
  onPCM: (callback: (data: NativeAudioPCMData) => void) => () => void;
}

declare global {
  interface Window {
    nativeAudio?: NativeAudioAPI;
  }
}

export {};
