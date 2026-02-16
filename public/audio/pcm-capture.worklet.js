/**
 * PCM Capture Worklet for Live V2
 *
 * Runs in audio thread - captures raw Float32 PCM samples.
 * No encoding, no batching, no artifacts - just pure audio.
 */

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleCount = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (input && input.length > 0) {
      const channel = input[0]; // Mono (channel 0)

      if (channel && channel.length > 0) {
        // Send raw PCM samples to main thread
        // Copy to avoid shared memory issues
        this.port.postMessage({
          samples: channel.slice(),
          sampleCount: this.sampleCount,
          timestamp: currentTime
        });

        this.sampleCount += channel.length;
      }
    }

    // Keep processor alive
    return true;
  }
}

registerProcessor('pcm-capture', PCMCaptureProcessor);
