/**
 * MP3 Encoder Web Worker
 * Uses lamejs to convert PCM audio data to MP3
 */
(function () {
  'use strict';

  // Import the lamejs library
  importScripts('/lame.min.js');

  console.log('[MP3 Worker] Worker initialized');

  /**
   * Message handler
   * Expected message format:
   * {
   *   cmd: 'encode',
   *   audioData: Float32Array[] (array of channel data),
   *   sampleRate: number,
   *   bitRate: number (optional, default 128)
   * }
   */
  self.onmessage = function (e) {
    const { cmd, audioData, sampleRate, bitRate = 128 } = e.data;

    if (cmd !== 'encode') {
      self.postMessage({ error: 'Unknown command: ' + cmd });
      return;
    }

    try {
      console.log('[MP3 Worker] Starting encode - channels:', audioData.length, 'sampleRate:', sampleRate, 'bitRate:', bitRate);

      const numberOfChannels = audioData.length;
      const samples = audioData[0].length;

      // Convert Float32Array to Int16Array (required by lamejs)
      function convertToInt16(float32Array) {
        const int16Array = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
          const s = Math.max(-1, Math.min(1, float32Array[i]));
          int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16Array;
      }

      const leftInt16 = convertToInt16(audioData[0]);
      const rightInt16 = numberOfChannels > 1 ? convertToInt16(audioData[1]) : null;

      // Create MP3 encoder
      const mp3Encoder = new lamejs.Mp3Encoder(numberOfChannels, sampleRate, bitRate);
      const mp3Data = [];

      // Encode in chunks
      const chunkSize = 1152;
      for (let i = 0; i < samples; i += chunkSize) {
        const leftChunk = leftInt16.subarray(i, i + chunkSize);
        let mp3buf;

        if (numberOfChannels === 1) {
          mp3buf = mp3Encoder.encodeBuffer(leftChunk);
        } else {
          const rightChunk = rightInt16.subarray(i, i + chunkSize);
          mp3buf = mp3Encoder.encodeBuffer(leftChunk, rightChunk);
        }

        if (mp3buf.length > 0) {
          mp3Data.push(new Int8Array(mp3buf));
        }

        // Send progress updates for long files
        if (i % (chunkSize * 100) === 0) {
          self.postMessage({ progress: i / samples });
        }
      }

      // Flush the encoder
      const mp3End = mp3Encoder.flush();
      if (mp3End.length > 0) {
        mp3Data.push(new Int8Array(mp3End));
      }

      // Combine all chunks into a single Uint8Array
      const totalLength = mp3Data.reduce((acc, chunk) => acc + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of mp3Data) {
        result.set(new Uint8Array(chunk.buffer), offset);
        offset += chunk.length;
      }

      console.log('[MP3 Worker] Encoding complete - output size:', result.length, 'bytes');

      // Send the result back
      self.postMessage({
        success: true,
        mp3Data: result.buffer
      }, [result.buffer]); // Transfer the buffer for efficiency

    } catch (error) {
      console.error('[MP3 Worker] Encoding error:', error);
      self.postMessage({
        error: error.message || 'MP3 encoding failed'
      });
    }
  };
})();
