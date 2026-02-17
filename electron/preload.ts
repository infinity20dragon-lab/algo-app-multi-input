import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('nativeAudio', {
  isAvailable: () => ipcRenderer.invoke('native-audio:is-available'),

  listDevices: () => ipcRenderer.invoke('native-audio:list-devices'),

  startCapture: (config: { deviceId: number; channelCount: number; sampleRate?: number }) =>
    ipcRenderer.invoke('native-audio:start-capture', config),

  stopCapture: (deviceId: number) =>
    ipcRenderer.invoke('native-audio:stop-capture', deviceId),

  stopAllCaptures: () =>
    ipcRenderer.invoke('native-audio:stop-all'),

  onPCM: (callback: (data: { deviceId: number; channel: number; samples: Float32Array; sampleRate: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => {
      // Reconstruct Float32Array from transferred ArrayBuffer
      const samples = new Float32Array(data.samples);
      callback({
        deviceId: data.deviceId,
        channel: data.channel,
        samples,
        sampleRate: data.sampleRate,
      });
    };

    ipcRenderer.on('native-audio:pcm', handler);

    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('native-audio:pcm', handler);
    };
  },
});
