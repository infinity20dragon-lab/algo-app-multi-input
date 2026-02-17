"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('nativeAudio', {
    isAvailable: () => electron_1.ipcRenderer.invoke('native-audio:is-available'),
    listDevices: () => electron_1.ipcRenderer.invoke('native-audio:list-devices'),
    startCapture: (config) => electron_1.ipcRenderer.invoke('native-audio:start-capture', config),
    stopCapture: (deviceId) => electron_1.ipcRenderer.invoke('native-audio:stop-capture', deviceId),
    stopAllCaptures: () => electron_1.ipcRenderer.invoke('native-audio:stop-all'),
    onPCM: (callback) => {
        const handler = (_event, data) => {
            // Reconstruct Float32Array from transferred ArrayBuffer
            const samples = new Float32Array(data.samples);
            callback({
                deviceId: data.deviceId,
                channel: data.channel,
                samples,
                sampleRate: data.sampleRate,
            });
        };
        electron_1.ipcRenderer.on('native-audio:pcm', handler);
        // Return unsubscribe function
        return () => {
            electron_1.ipcRenderer.removeListener('native-audio:pcm', handler);
        };
    },
});
