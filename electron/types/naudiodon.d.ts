/**
 * Type declarations for naudiodon (PortAudio bindings for Node.js)
 */

declare module 'naudiodon2' {
  interface DeviceInfo {
    id: number;
    name: string;
    maxInputChannels: number;
    maxOutputChannels: number;
    defaultSampleRate: number;
    hostAPIName: string;
  }

  interface AudioOptions {
    channelCount: number;
    sampleFormat: number;
    sampleRate: number;
    deviceId: number;
    closeOnError?: boolean;
  }

  interface AudioIO {
    on(event: 'data', callback: (buffer: Buffer) => void): void;
    on(event: 'error', callback: (error: Error) => void): void;
    on(event: 'close', callback: () => void): void;
    start(): void;
    quit(callback?: () => void): void;
    read?(size?: number): Buffer | null;
    pipe?(destination: NodeJS.WritableStream): NodeJS.WritableStream;
  }

  export function getDevices(): DeviceInfo[];

  export function AudioIO(options: {
    inOptions: AudioOptions;
  }): AudioIO;

  export const SampleFormat16Bit: number;
  export const SampleFormat24Bit: number;
  export const SampleFormat32Bit: number;
  export const SampleFormatFloat32: number;
}
