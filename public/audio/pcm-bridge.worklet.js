/**
 * PCM Bridge Worklet for Native Audio
 *
 * Inverse of pcm-capture.worklet.js: INJECTS PCM into Web Audio graph.
 * Receives Float32Array via port.onmessage from IPC bridge,
 * buffers internally, outputs 128 samples per process() call.
 * Outputs silence on underrun (no glitch).
 */

class PCMBridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Ring buffer: 1 second at 48kHz
    this.bufferSize = 48000;
    this.buffer = new Float32Array(this.bufferSize);
    this.writePos = 0;
    this.readPos = 0;
    this.available = 0;

    this.port.onmessage = (event) => {
      const samples = event.data.samples;
      if (!samples || samples.length === 0) return;

      const len = samples.length;

      // Write samples into ring buffer
      for (let i = 0; i < len; i++) {
        this.buffer[this.writePos] = samples[i];
        this.writePos = (this.writePos + 1) % this.bufferSize;
      }

      this.available += len;

      // Prevent overflow: cap available at buffer size
      if (this.available > this.bufferSize) {
        // Drop oldest samples by advancing read position
        const overflow = this.available - this.bufferSize;
        this.readPos = (this.readPos + overflow) % this.bufferSize;
        this.available = this.bufferSize;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channel = output[0];
    const frameSize = channel.length; // 128 samples

    if (this.available >= frameSize) {
      // Read from ring buffer
      for (let i = 0; i < frameSize; i++) {
        channel[i] = this.buffer[this.readPos];
        this.readPos = (this.readPos + 1) % this.bufferSize;
      }
      this.available -= frameSize;
    } else {
      // Underrun: output silence
      for (let i = 0; i < frameSize; i++) {
        channel[i] = 0;
      }
    }

    // Copy to all output channels (mono source → all outputs)
    for (let ch = 1; ch < output.length; ch++) {
      output[ch].set(channel);
    }

    return true;
  }
}

registerProcessor('pcm-bridge', PCMBridgeProcessor);
