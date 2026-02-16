/**
 * Lock-Free Ring Buffer for Audio PCM Samples
 *
 * Designed for real-time audio streaming:
 * - Write from AudioWorklet thread
 * - Read from playback thread
 * - No locks, no blocking, no gaps
 *
 * Used for gapless emergency paging audio.
 */

export class RingBuffer {
  private buffer: Float32Array;
  private capacity: number;
  private writeIndex: number = 0;
  private readIndex: number = 0;
  private availableSamples: number = 0;

  /**
   * @param capacity - Buffer size in samples (e.g., 48000 * 10 = 10 seconds at 48kHz)
   */
  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity);
  }

  /**
   * Write samples to the buffer (from AudioWorklet)
   * @returns Number of samples actually written
   */
  push(samples: Float32Array): number {
    const samplesToWrite = Math.min(samples.length, this.capacity - this.availableSamples);

    for (let i = 0; i < samplesToWrite; i++) {
      this.buffer[this.writeIndex] = samples[i];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
    }

    this.availableSamples += samplesToWrite;

    // Drop samples silently if buffer is full (this is normal during continuous streaming)
    // if (samplesToWrite < samples.length) {
    //   console.warn(`[RingBuffer] Buffer full - dropped ${samples.length - samplesToWrite} samples`);
    // }

    return samplesToWrite;
  }

  /**
   * Read samples from the buffer (for playback)
   * @returns Float32Array of requested length (zero-filled if not enough data)
   */
  pull(count: number): Float32Array {
    const output = new Float32Array(count);
    const samplesToRead = Math.min(count, this.availableSamples);

    for (let i = 0; i < samplesToRead; i++) {
      output[i] = this.buffer[this.readIndex];
      this.readIndex = (this.readIndex + 1) % this.capacity;
    }

    this.availableSamples -= samplesToRead;

    // If we couldn't read enough, the rest is already zero-filled
    if (samplesToRead < count) {
      // This is normal during startup or silence
    }

    return output;
  }

  /**
   * Peek at buffer state without consuming samples
   */
  getAvailable(): number {
    return this.availableSamples;
  }

  /**
   * Get buffer fill percentage
   */
  getFillPercentage(): number {
    return (this.availableSamples / this.capacity) * 100;
  }

  /**
   * Clear the buffer (e.g., when stopping)
   */
  clear(): void {
    this.writeIndex = 0;
    this.readIndex = 0;
    this.availableSamples = 0;
    this.buffer.fill(0);
  }

  /**
   * Get duration of buffered audio in seconds
   * @param sampleRate - Audio context sample rate (e.g., 48000)
   */
  getBufferedDuration(sampleRate: number): number {
    return this.availableSamples / sampleRate;
  }
}
