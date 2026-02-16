/**
 * PCM Capture Worklet
 *
 * Captures raw Float32 PCM samples from microphone.
 * Runs in audio thread (high priority, real-time).
 *
 * Used for gapless, continuous audio streaming without encoding artifacts.
 */

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frameCount = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (input && input.length > 0) {
      const channel = input[0]; // Mono (channel 0)

      if (channel && channel.length > 0) {
        // Send raw PCM samples to main thread
        // Use Float32Array for efficient transfer
        this.port.postMessage({
          samples: channel.slice(), // Copy to avoid shared memory issues
          timestamp: currentTime,
          frameCount: this.frameCount++
        });
      }
    }

    // Return true to keep processor alive
    return true;
  }
}

registerProcessor('pcm-capture', PCMCaptureProcessor);
