/**
 * Call Coordinator - State Machine for Live Emergency Paging
 *
 * Handles the complete lifecycle of an emergency call:
 * 1. Recording audio from microphone
 * 2. Validating audio (threshold + sustain)
 * 3. Activating paging device (optional)
 * 4. Buffering for playback delay
 * 5. Live playback via MediaSource API
 * 6. Silence detection with resettable timer
 * 7. Clean shutdown and save to Firebase
 */

export enum CallState {
  Idle = 'Idle',
  Recording = 'Recording',              // Recording started, accumulating chunks
  Validating = 'Validating',            // Checking threshold + sustain
  PagingActivating = 'PagingActivating', // Setting paging zone 1 (if device exists)
  BufferingForDelay = 'BufferingForDelay', // Waiting for playbackDelay worth of buffer
  Playing = 'Playing',                   // MediaSource playing, recording continues
  SilenceWait = 'SilenceWait',          // Silent, counting down disableDelay
  Draining = 'Draining',                // Recording stopped, playback catching up
  Saving = 'Saving'                     // Upload to Firebase
}

export interface CallConfig {
  // Audio validation
  audioThreshold: number;      // 0-100
  sustainDuration: number;     // milliseconds

  // Playback
  playbackEnabled: boolean;    // Enable live playback
  playbackDelay: number;       // milliseconds - buffer before playing
  disableDelay: number;        // milliseconds - silence before stopping

  // Paging (optional) - pass null if no paging device
  pagingDevice: { id: string; name: string; ip: string } | null;
  setPagingZone?: (zone: number) => Promise<void>;
  waitForPagingZoneReady?: (zone: number) => Promise<boolean>;

  // Speaker volume control (linked to paging device)
  linkedSpeakers?: { id: string; name: string; ip: string; maxVolume: number }[];
  setSpeakerVolume?: (speakerId: string, volume: number) => Promise<void>;

  // Volume ramping settings
  rampEnabled?: boolean;
  dayNightMode?: boolean;
  dayStartHour?: number;  // 0-23.5 (e.g., 7.5 = 7:30 AM)
  dayEndHour?: number;    // 0-23.5
  nightRampDuration?: number; // seconds
  targetVolume?: number;   // 0-100 (operating volume)

  // PoE device control
  poeDevices?: { id: string; name: string; mode: string }[];
  controlPoEDevices?: (enable: boolean) => Promise<void>;

  // Callbacks
  onStateChange?: (state: CallState) => void;
  onError?: (error: Error) => void;
  onLog?: (entry: { type: any; message: string; audioLevel?: number }) => void;
  onUpload?: (blob: Blob, mimeType: string, firstAudioTimestamp: number, isPlayback?: boolean) => Promise<string>; // Returns download URL
}

export interface CallMetrics {
  recordingStartTime: number;
  audioDetectedTime?: number;
  playbackStartTime?: number;
  recordingEndTime?: number;
  totalDuration: number;
  bufferedDuration: number;
  chunksRecorded: number;
  chunksDiscarded: number;
}

/**
 * Main Call Coordinator
 * Orchestrates the entire call lifecycle with clean state transitions
 */
export class CallCoordinator {
  private state: CallState = CallState.Idle;
  private config: Required<CallConfig>;
  private metrics: CallMetrics;

  // Recording
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private recordingStartIndex: number = 0;

  // MediaSource playback
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private audio: HTMLAudioElement | null = null;
  private mediaSourceUrl: string | null = null;
  private chunkQueue: Blob[] = [];
  private isAppending: boolean = false;
  private lastAppendStartTime: number = 0; // Track when append started
  private mediaSourceReady: Promise<void> | null = null;
  private chunkProcessWatchdog: NodeJS.Timeout | null = null; // Watchdog to unstick chunk processing

  // Timing
  private silenceDeadline: number = 0;
  private sustainStartTime: number = 0;
  private lastAudioTime: number = 0;

  // State
  private aborted: boolean = false;
  private isInZone1: boolean = false; // Track if paging device is already in Zone 1
  private isPlaybackActive: boolean = false; // Track if audio.play() has actually started
  private mediaSourceCrashed: boolean = false; // Track if MediaSource permanently failed
  private recoveryAttempts: number = 0; // Track recovery attempts to prevent infinite loops

  constructor(config: CallConfig) {
    this.config = {
      audioThreshold: config.audioThreshold,
      sustainDuration: config.sustainDuration,
      playbackEnabled: config.playbackEnabled,
      playbackDelay: config.playbackDelay,
      disableDelay: config.disableDelay,
      pagingDevice: config.pagingDevice ?? null,
      setPagingZone: config.setPagingZone ?? (async () => {}),
      waitForPagingZoneReady: config.waitForPagingZoneReady ?? (async () => true),
      linkedSpeakers: config.linkedSpeakers ?? [],
      setSpeakerVolume: config.setSpeakerVolume ?? (async () => {}),
      rampEnabled: config.rampEnabled ?? false,
      dayNightMode: config.dayNightMode ?? false,
      dayStartHour: config.dayStartHour ?? 7,
      dayEndHour: config.dayEndHour ?? 19,
      nightRampDuration: config.nightRampDuration ?? 5,
      targetVolume: config.targetVolume ?? 50,
      poeDevices: config.poeDevices ?? [],
      controlPoEDevices: config.controlPoEDevices ?? (async () => {}),
      onStateChange: config.onStateChange ?? (() => {}),
      onError: config.onError ?? ((err) => console.error(err)),
      onLog: config.onLog ?? (() => {}),
      onUpload: config.onUpload ?? (async () => '')
    };

    this.metrics = {
      recordingStartTime: 0,
      totalDuration: 0,
      bufferedDuration: 0,
      chunksRecorded: 0,
      chunksDiscarded: 0
    };
  }

  // ==================== Public API ====================

  /**
   * Start a new call
   */
  async start(stream: MediaStream): Promise<void> {
    if (this.state !== CallState.Idle) {
      throw new Error(`Cannot start call in state: ${this.state}`);
    }

    this.stream = stream;
    this.aborted = false;
    this.metrics.recordingStartTime = Date.now();
    this.log('Starting new call');

    // Start recording immediately
    await this.startRecording(stream);
    this.transitionTo(CallState.Recording);
  }

  /**
   * Notify coordinator of audio detection
   * This is called from the audio monitoring loop
   */
  onAudioDetected(level: number): void {
    if (this.aborted) return;

    const now = Date.now();
    this.lastAudioTime = now;

    // If idle, start a new call
    if (this.state === CallState.Idle) {
      // Check if this is a subsequent call (already in Zone 1) or first call
      if (this.isInZone1) {
        this.log('🔄 SUBSEQUENT CALL: Audio detected while in Zone 1 (hardware already ready)');
      } else {
        this.log('🎙️ FIRST CALL: Audio detected, will initialize hardware');
      }

      // Reset state for new call
      this.aborted = false;
      this.metrics.recordingStartTime = now;
      this.recordedChunks = []; // Clear any leftover chunks

      // Restart MediaRecorder if we have a stream
      if (this.stream) {
        this.startRecording(this.stream).then(() => {
          this.transitionTo(CallState.Recording);
          this.transitionTo(CallState.Validating);
          this.sustainStartTime = now;
        }).catch((error) => {
          this.config.onError(error);
        });
      } else {
        // No stream available - this shouldn't happen
        this.config.onError(new Error('No stream available for auto-restart'));
      }
      return;
    }

    // Reset silence timer if we're in SilenceWait
    // Stay in SilenceWait state - don't transition back to Playing on every audio spike
    if (this.state === CallState.SilenceWait) {
      const delaySeconds = (this.config.disableDelay / 1000).toFixed(1);
      this.log(`🎤 Audio detected during silence wait - ${delaySeconds}s countdown RESET`);
      this.log(`   → Call continues as one recording (user still talking)`);
      this.silenceDeadline = now + this.config.disableDelay;
      return;
    }

    // Reset silence deadline in ANY state (even during buffering)
    // This way if user talks again, we cancel the abort countdown
    if (this.silenceDeadline > 0) {
      const delaySeconds = (this.config.disableDelay / 1000).toFixed(1);
      this.log(`🎤 Audio resumed - ${delaySeconds}s silence countdown CANCELED and RESET`);
      this.silenceDeadline = 0; // Clear the silence deadline
    }

    // Validate if in Recording/Validating state
    if (this.state === CallState.Recording || this.state === CallState.Validating) {
      this.validateAudio(level);
    }
  }

  /**
   * Notify coordinator of silence
   */
  onSilence(): void {
    if (this.aborted) return;

    const now = Date.now();

    // Start silence countdown IMMEDIATELY in any active state
    // This ensures we record for the full silence duration (e.g., 8s) from when user stops talking
    if (this.state === CallState.Recording ||
        this.state === CallState.Validating ||
        this.state === CallState.PagingActivating ||
        this.state === CallState.BufferingForDelay) {

      // Set silence deadline but DON'T transition yet (we might still be buffering/activating)
      if (this.silenceDeadline === 0) {
        this.silenceDeadline = now + this.config.disableDelay;
        this.log(`🔇 Silence detected during ${this.state}, starting ${(this.config.disableDelay / 1000).toFixed(1)}s countdown`);
        this.log('   → Recording will continue for full silence duration before stopping');
      }
      return;
    }

    // If we're playing AND playback has actually started, transition to SilenceWait state
    if (this.state === CallState.Playing && this.isPlaybackActive) {
      this.silenceDeadline = now + this.config.disableDelay;
      this.transitionTo(CallState.SilenceWait);
      this.log(`Silence detected, starting ${(this.config.disableDelay / 1000).toFixed(1)}s countdown`);

      // Start checking if silence persists
      this.checkSilenceTimeout();
    }
  }

  /**
   * Append a new recorded chunk
   */
  onChunkRecorded(chunk: Blob): void {
    if (this.aborted) return;

    this.recordedChunks.push(chunk);
    this.metrics.chunksRecorded++;

    // If we're past validation and ready to stream, queue for MediaSource
    if (this.state === CallState.BufferingForDelay ||
        this.state === CallState.Playing ||
        this.state === CallState.SilenceWait) {
      // Log every 20th chunk
      if (this.metrics.chunksRecorded % 20 === 0) {
        this.log(`📥 Chunk ${this.metrics.chunksRecorded} enqueued (queue now: ${this.chunkQueue.length + 1})`);
      }
      this.enqueueChunk(chunk);
    }
  }

  /**
   * Abort the call (cleanup without saving)
   */
  async abort(): Promise<void> {
    this.log('Call aborted');
    this.aborted = true;
    await this.cleanup(false);
  }

  /**
   * Get current state
   */
  getState(): CallState {
    return this.state;
  }

  /**
   * Get metrics
   */
  getMetrics(): CallMetrics {
    return { ...this.metrics };
  }

  // ==================== Private State Machine ====================

  private transitionTo(newState: CallState): void {
    if (this.state === newState) return;

    const oldState = this.state;
    this.state = newState;
    this.log(`State transition: ${oldState} → ${newState}`);
    this.config.onStateChange(newState);

    // Clear console after call completes (clean slate for next call)
    if (oldState === CallState.Saving && newState === CallState.Idle) {
      setTimeout(() => {
        console.clear();
        this.log('🆕 Ready for next call (console cleared)');
      }, 100); // Small delay so logs above are visible briefly
    }

    // Handle state entry logic
    this.onStateEnter(newState);
  }

  private async onStateEnter(state: CallState): Promise<void> {
    switch (state) {
      case CallState.Validating:
        // Start sustain timer
        this.sustainStartTime = Date.now();
        this.log(`⏱️  Validating sustained audio (need ${this.config.sustainDuration}ms above threshold)`);
        break;

      case CallState.PagingActivating:
        this.log('🎛️  PAGING ACTIVATION PHASE:');
        await this.activatePaging();
        break;

      case CallState.BufferingForDelay:
        this.log('⏳ BUFFERING PHASE:');
        await this.waitForBuffering();
        break;

      case CallState.Playing:
        this.log('▶️  PLAYBACK PHASE:');
        await this.startPlayback();
        break;

      case CallState.SilenceWait:
        // Timer already set in onSilence
        this.log(`🔇 SILENCE DETECTION: Waiting ${(this.config.disableDelay / 1000).toFixed(1)}s for confirmation...`);
        break;

      case CallState.Draining:
        this.log('💧 DRAINING: Completing playback buffer...');
        await this.drainPlayback();
        break;

      case CallState.Saving:
        this.log('💾 SAVING: Uploading recording to Firebase...');
        await this.saveRecording();
        break;
    }
  }

  // ==================== Recording ====================

  private async startRecording(stream: MediaStream): Promise<void> {
    const mimeType = this.getBestMimeType();
    this.log(`Starting MediaRecorder with ${mimeType}`);

    this.mediaRecorder = new MediaRecorder(stream, { mimeType });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.onChunkRecorded(event.data);
      }
    };

    this.mediaRecorder.onerror = (error) => {
      this.config.onError(new Error(`MediaRecorder error: ${error}`));
    };

    this.mediaRecorder.start(100); // 100ms chunks
  }

  private async stopRecording(): Promise<void> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      return;
    }

    return new Promise((resolve) => {
      this.mediaRecorder!.onstop = () => resolve();
      this.mediaRecorder!.stop();
    });
  }

  private getBestMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus'
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return 'audio/webm'; // Fallback
  }

  // ==================== Audio Validation ====================

  private validateAudio(level: number): void {
    // Check threshold
    if (level < this.config.audioThreshold) {
      // Below threshold - discard accumulated chunks
      const chunksToDiscard = this.recordedChunks.length - this.recordingStartIndex;
      if (chunksToDiscard > 0) {
        this.metrics.chunksDiscarded += chunksToDiscard;
        this.recordedChunks.splice(this.recordingStartIndex, chunksToDiscard);
        this.log(`Discarded ${chunksToDiscard} chunks (below threshold)`);
      }

      // Mark new start point for next audio
      this.recordingStartIndex = this.recordedChunks.length;
      this.transitionTo(CallState.Recording);
      return;
    }

    // Check sustain duration
    if (this.state === CallState.Recording) {
      this.transitionTo(CallState.Validating);
      this.sustainStartTime = Date.now();
      return;
    }

    const sustainTime = Date.now() - this.sustainStartTime;
    if (sustainTime >= this.config.sustainDuration) {
      // Audio validated! Move to paging or buffering
      this.metrics.audioDetectedTime = Date.now();
      this.log(`Audio validated: ${level}% for ${sustainTime}ms`);

      if (this.config.pagingDevice) {
        // Have paging device - activate it first
        this.transitionTo(CallState.PagingActivating);
      } else if (this.config.playbackEnabled) {
        // No paging device but playback enabled - go to buffering
        this.initializeMediaSource();
        this.transitionTo(CallState.BufferingForDelay);
      } else {
        // No paging, no playback - go straight to silence wait
        this.transitionTo(CallState.SilenceWait);
      }
    }
  }

  // ==================== Paging Control ====================

  private async activatePaging(): Promise<void> {
    if (!this.config.pagingDevice) {
      // No paging device
      this.log('No paging device configured, skipping paging control');

      if (this.config.playbackEnabled) {
        // Initialize MediaSource for playback
        this.initializeMediaSource();
        this.transitionTo(CallState.BufferingForDelay);
      } else {
        // No playback, go straight to silence wait
        this.transitionTo(CallState.SilenceWait);
      }
      return;
    }

    try {
      this.log({
        type: 'audio_detected',
        message: `🚨 AUDIO DETECTED - Paging: ${this.config.pagingDevice.name}`
      });

      // Step 1: Set paging to Zone 1 (active)
      this.log('Step 1: Switching paging to Zone 1 (active)...');
      if (this.config.setPagingZone) {
        await this.config.setPagingZone(1);
      }

      // Wait for zone change confirmation
      if (this.config.waitForPagingZoneReady) {
        const confirmed = await this.config.waitForPagingZoneReady(1);

        if (confirmed) {
          this.log('  ✓ Paging switched to Zone 1');
          this.isInZone1 = true; // Mark that we're now in Zone 1
        } else {
          this.log({
            type: 'speakers_disabled',
            message: '  ⚠️ Paging Zone 1 not confirmed, but continuing...'
          });
          this.isInZone1 = true; // Assume we're in Zone 1 anyway
        }
      } else {
        // No confirmation callback, assume success
        this.isInZone1 = true;
      }

      // Step 2: Speaker volume control (only if linked speakers exist)
      const linkedSpeakers = this.config.linkedSpeakers ?? [];
      if (linkedSpeakers.length > 0) {
        this.log(`Step 2: Controlling ${linkedSpeakers.length} linked speaker(s)...`);

        if (this.shouldRampVolume()) {
          // Night mode or ramp enabled: Ramp up from idle to operating volume
          this.log(`  Night mode: Ramping from 0% to ${this.config.targetVolume}% over ${this.config.nightRampDuration}s`);
          await this.rampSpeakerVolumes(this.config.targetVolume!, this.config.nightRampDuration!);
        } else {
          // Day mode: Set to operating volume immediately
          this.log(`  Day mode: Setting to ${this.config.targetVolume}% immediately`);
          await this.setSpeakerVolumes(this.config.targetVolume!);
        }
      } else {
        this.log('Step 2: No linked speakers found for this paging device');
      }

      // Step 3: PoE device control
      const autoPoE = this.config.poeDevices?.filter(d => d.mode === 'auto') ?? [];
      if (autoPoE.length > 0) {
        this.log(`Step 3: Enabling ${autoPoE.length} PoE device(s) in auto mode...`);
        if (this.config.controlPoEDevices) {
          await this.config.controlPoEDevices(true);
        }
        this.log(`  ✓ Enabled ${autoPoE.length} PoE device(s)`);
      } else {
        this.log('Step 3: No PoE devices in auto mode');
      }

      // Step 4: Move to next phase based on playback setting
      this.log('Step 4: Moving to next phase...');
      if (this.config.playbackEnabled) {
        this.initializeMediaSource();
        this.transitionTo(CallState.BufferingForDelay);
      } else {
        // No playback, go straight to silence wait
        this.transitionTo(CallState.SilenceWait);
      }

    } catch (error) {
      this.config.onError(error as Error);
      // Paging failed - abort call
      await this.abort();
    }
  }


  // ==================== MediaSource Playback ====================

  private initializeMediaSource(): void {
    this.log('Initializing MediaSource');

    // Cleanup any existing MediaSource first
    if (this.mediaSourceUrl) {
      URL.revokeObjectURL(this.mediaSourceUrl);
      this.mediaSourceUrl = null;
    }
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.mediaSourceReady = null;
    this.chunkQueue = [];
    this.isAppending = false;
    this.lastAppendStartTime = 0;
    this.mediaSourceCrashed = false; // Reset for fresh MediaSource
    // Don't reset recoveryAttempts here - we're recovering, not starting a new call

    // Create fresh MediaSource
    this.mediaSource = new MediaSource();
    this.audio = new Audio();
    this.mediaSourceUrl = URL.createObjectURL(this.mediaSource);
    this.audio.src = this.mediaSourceUrl;

    // Create a promise that resolves when MediaSource is ready
    this.mediaSourceReady = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('MediaSource initialization timeout'));
      }, 5000);

      this.mediaSource!.addEventListener('sourceopen', () => {
        clearTimeout(timeout);
        try {
          const mimeType = this.getBestMimeType();
          this.sourceBuffer = this.mediaSource!.addSourceBuffer(mimeType);
          this.sourceBuffer.mode = 'sequence'; // Gapless playback

          this.sourceBuffer.addEventListener('updateend', () => {
            this.isAppending = false;
            this.lastAppendStartTime = 0;
            this.processChunkQueue();
          });

          this.sourceBuffer.addEventListener('error', (e) => {
            this.log(`⚠️ SourceBuffer error: ${e}`);
            this.log(`   MediaSource readyState: ${this.mediaSource?.readyState}`);
            this.log(`   SourceBuffer updating: ${this.sourceBuffer?.updating}`);
            this.log(`   Recorded chunks: ${this.recordedChunks.length}`);
            this.log(`   Recording start index: ${this.recordingStartIndex}`);
            this.log(`   → Attempting MediaSource recovery...`);

            this.isAppending = false;
            this.lastAppendStartTime = 0;
            this.chunkQueue = []; // Clear corrupted chunks

            // Try to recover by reinitializing MediaSource (fire and forget)
            this.recoverMediaSource().catch((err) => {
              this.log(`   → Recovery failed catastrophically: ${err}`);
            });
          });

          this.sourceBuffer.addEventListener('abort', () => {
            this.log('⚠️ SourceBuffer aborted');
            this.isAppending = false;
            this.lastAppendStartTime = 0;
            this.chunkQueue = [];
          });

          this.log(`MediaSource ready (readyState: ${this.mediaSource!.readyState})`);

          // Queue all existing chunks from validated recording (like it was before!)
          const chunksToQueue = this.recordedChunks.length - this.recordingStartIndex;
          this.log(`Queueing ${chunksToQueue} chunks for playback`);
          for (let i = this.recordingStartIndex; i < this.recordedChunks.length; i++) {
            this.enqueueChunk(this.recordedChunks[i]);
          }

          // CRITICAL: Trigger processing of any chunks that arrived during initialization
          // These chunks were enqueued but paused waiting for SourceBuffer
          this.processChunkQueue();

          // Start watchdog to prevent stuck chunk processing
          try {
            this.startChunkProcessWatchdog();
          } catch (error) {
            this.log(`⚠️ Failed to start watchdog: ${error}`);
          }

          resolve();
        } catch (error) {
          clearTimeout(timeout);
          this.config.onError(error as Error);
          reject(error);
        }
      });

      this.mediaSource!.addEventListener('error', () => {
        clearTimeout(timeout);
        const error = new Error('MediaSource error');
        this.config.onError(error);
        reject(error);
      });
    });
  }

  private enqueueChunk(chunk: Blob): void {
    this.chunkQueue.push(chunk);
    this.processChunkQueue();
  }

  /**
   * Start a watchdog that periodically checks for stuck chunk processing
   * This prevents isAppending from getting permanently stuck
   */
  private startChunkProcessWatchdog(): void {
    // Clear any existing watchdog
    if (this.chunkProcessWatchdog) {
      clearInterval(this.chunkProcessWatchdog);
    }

    this.log('🐕 Watchdog started');
    let tickCount = 0;

    // Check every 500ms for stuck state
    this.chunkProcessWatchdog = setInterval(() => {
      tickCount++;

      // Log every 10 ticks to confirm watchdog is running
      if (tickCount % 10 === 0) {
        this.log(`🐕 Watchdog alive (tick ${tickCount}, queue: ${this.chunkQueue.length}, isAppending: ${this.isAppending})`);
      }

      // Check if isAppending is stuck (been true for > 1 second)
      if (this.isAppending && this.lastAppendStartTime > 0) {
        const stuckDuration = Date.now() - this.lastAppendStartTime;
        if (stuckDuration > 1000) {
          this.log(`⚠️ WATCHDOG: isAppending stuck for ${stuckDuration}ms, forcing reset`);
          this.log(`   SourceBuffer updating: ${this.sourceBuffer?.updating}`);
          this.log(`   MediaSource state: ${this.mediaSource?.readyState}`);
          this.log(`   Chunks in queue: ${this.chunkQueue.length}`);
          this.log(`   Recorded chunks: ${this.recordedChunks.length}`);

          this.isAppending = false;
          this.lastAppendStartTime = 0;

          // Trigger processing to restart the flow
          this.processChunkQueue();
        }
      }

      // Also trigger processing if we have queued chunks but nothing is appending
      if (!this.isAppending && this.chunkQueue.length > 0 && this.sourceBuffer && this.mediaSource?.readyState === 'open') {
        this.processChunkQueue();
      }
    }, 500);
  }

  /**
   * Stop the chunk processing watchdog
   */
  private stopChunkProcessWatchdog(): void {
    if (this.chunkProcessWatchdog) {
      clearInterval(this.chunkProcessWatchdog);
      this.chunkProcessWatchdog = null;
    }
  }

  /**
   * Recover from MediaSource crash by reinitializing
   */
  private async recoverMediaSource(): Promise<void> {
    // Prevent infinite recovery loops (max 2 attempts)
    if (this.recoveryAttempts >= 2) {
      this.log('   → Max recovery attempts reached, giving up on playback');
      this.mediaSourceCrashed = true;
      this.stopChunkProcessWatchdog();
      return;
    }

    this.recoveryAttempts++;
    this.log(`   → Cleaning up crashed MediaSource (attempt ${this.recoveryAttempts}/2)`);

    // Stop watchdog
    this.stopChunkProcessWatchdog();

    // Revoke old URL
    if (this.mediaSourceUrl) {
      URL.revokeObjectURL(this.mediaSourceUrl);
      this.mediaSourceUrl = null;
    }

    // Clear references
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.mediaSourceReady = null;
    this.isAppending = false;
    this.lastAppendStartTime = 0;
    this.mediaSourceCrashed = false;

    // Create fresh MediaSource
    this.log('   → Reinitializing MediaSource for recovery');
    this.initializeMediaSource();

    // Wait for new MediaSource to be ready
    if (this.mediaSourceReady) {
      try {
        await this.mediaSourceReady;
        this.log('   → MediaSource recovered successfully');

        // If we're already in Playing or SilenceWait state, try to resume playback
        if (this.state === CallState.Playing || this.state === CallState.SilenceWait) {
          this.log('   → Resuming playback after recovery');
          await this.startPlayback();
        }
      } catch (error) {
        this.log(`   → Recovery failed: ${error}`);
        this.log(`   → Playback disabled, recording continues`);
        this.mediaSourceCrashed = true; // Mark as permanently failed
        this.stopChunkProcessWatchdog(); // Stop trying
      }
    }
  }

  private processChunkQueue(): void {
    if (this.isAppending || this.chunkQueue.length === 0) {
      return;
    }

    // If MediaSource crashed, silently discard chunks (already logged the error)
    if (this.mediaSourceCrashed) {
      return;
    }

    if (!this.sourceBuffer) {
      // Warn if chunks are piling up
      if (this.chunkQueue.length > 20) {
        this.log(`⚠️ No SourceBuffer! ${this.chunkQueue.length} chunks waiting`);
      }
      return;
    }

    if (this.mediaSource?.readyState !== 'open') {
      // CRITICAL: Only clear queue if MediaSource is 'ended' (permanently closed)
      // If it's 'closed', it might just be initializing - keep chunks queued!
      if (this.mediaSource?.readyState === 'ended' && this.chunkQueue.length > 0) {
        this.log(`⚠️ MediaSource ended, clearing ${this.chunkQueue.length} queued chunks`);
        this.chunkQueue = [];
      } else if (this.chunkQueue.length > 20) {
        // Warn if chunks are piling up while MediaSource is closed
        this.log(`⚠️ MediaSource state=${this.mediaSource?.readyState}, ${this.chunkQueue.length} chunks waiting`);
      }
      return;
    }

    if (this.sourceBuffer.updating) {
      if (this.chunkQueue.length > 20) {
        this.log(`⚠️ SourceBuffer busy updating, ${this.chunkQueue.length} chunks waiting`);
      }
      return;
    }

    // Log processing every 20 chunks
    if (this.chunkQueue.length % 20 === 0 && this.chunkQueue.length > 0) {
      this.log(`📤 Processing chunk (${this.chunkQueue.length} in queue)`);
    }

    this.isAppending = true;
    this.lastAppendStartTime = Date.now(); // Track when append started
    const chunk = this.chunkQueue.shift()!;

    chunk.arrayBuffer().then((buffer) => {
      if (!this.sourceBuffer || this.mediaSource?.readyState !== 'open') {
        this.isAppending = false;
        this.lastAppendStartTime = 0;
        // Only clear queue if MediaSource is permanently ended, not just closed
        if (this.mediaSource?.readyState === 'ended' && this.chunkQueue.length > 0) {
          this.log(`⚠️ MediaSource ended, clearing ${this.chunkQueue.length} queued chunks`);
          this.chunkQueue = [];
        }
        return;
      }

      try {
        this.sourceBuffer.appendBuffer(buffer);
        // Success - chunk is being appended, updateend will fire
      } catch (error) {
        this.log(`⚠️ SourceBuffer.appendBuffer() error: ${error}`);
        this.log(`   MediaSource state: ${this.mediaSource?.readyState}`);
        this.log(`   SourceBuffer updating: ${this.sourceBuffer.updating}`);
        this.log(`   Buffer size: ${buffer.byteLength} bytes`);
        this.isAppending = false;
        this.lastAppendStartTime = 0;
        // Clear queue on error
        this.chunkQueue = [];
      }
    }).catch((error) => {
      this.log(`⚠️ Chunk arrayBuffer() conversion failed: ${error}`);
      this.isAppending = false;
      this.lastAppendStartTime = 0;
      this.chunkQueue = [];
    });
  }

  private async waitForBuffering(): Promise<void> {
    // Wait for MediaSource to be ready before we do anything else
    if (this.mediaSourceReady) {
      this.log('⏳ Waiting for MediaSource to initialize...');
      try {
        await this.mediaSourceReady;
        this.log('✓ MediaSource initialized and ready');
      } catch (error) {
        this.log(`⚠️ MediaSource initialization failed: ${error}`);
        this.config.onError(error as Error);
        // Try to continue without playback
        this.transitionTo(CallState.SilenceWait);
        return;
      }
    }

    // This delay is for HARDWARE readiness (paging device + speakers switching zones)
    // OPTIMIZATION: Skip delay if we're already in Zone 1 (subsequent calls)
    if (this.isInZone1) {
      this.log('⚡ FAST START: Already in Zone 1, skipping hardware delay (subsequent call)');
      this.log('   → Speakers are already listening to Zone 1 from previous call');
    } else {
      // First call - need to wait for hardware to switch and stabilize
      const delaySeconds = (this.config.playbackDelay / 1000).toFixed(1);
      this.log(`⏳ HARDWARE DELAY: Waiting ${delaySeconds}s for physical equipment...`);
      this.log('   → Paging device switching zones (relay activation)');
      this.log('   → Speakers reconfiguring to listen to Zone 1');

      // Simple time-based delay - wait for hardware to stabilize
      await new Promise(resolve => setTimeout(resolve, this.config.playbackDelay));

      this.log('   ✓ Hardware stabilized and ready');
    }

    // Check if we should go directly to SilenceWait (user stopped talking during buffering)
    if (this.silenceDeadline > 0) {
      const silenceSoFar = Date.now() - (this.silenceDeadline - this.config.disableDelay);
      this.log(`🔇 User stopped talking during buffering (${(silenceSoFar / 1000).toFixed(1)}s silence so far)`);
      this.log('   → Will start playback, then continue silence countdown');
      // Keep the deadline - will transition to SilenceWait after playback starts
    }

    this.transitionTo(CallState.Playing);
  }

  private async startPlayback(): Promise<void> {
    if (!this.audio) {
      this.log('⚠️ No audio element for playback');
      return;
    }

    // Double-check MediaSource is ready
    if (!this.sourceBuffer || this.mediaSource?.readyState !== 'open') {
      this.log('⚠️ MediaSource not ready for playback');
      this.log(`   MediaSource state: ${this.mediaSource?.readyState || 'null'}`);
      this.log(`   SourceBuffer: ${this.sourceBuffer ? 'exists' : 'null'}`);
      this.log('   → Skipping playback, continuing to silence detection');

      // DON'T call onError - just skip playback and continue recording
      // This prevents the whole call from failing if playback has issues
      this.isPlaybackActive = true; // Mark as "active" to allow state transitions

      // If there's a silence countdown, continue it
      if (this.silenceDeadline > 0) {
        const remainingSilence = Math.max(0, this.silenceDeadline - Date.now());
        this.log(`   → Continuing silence countdown (${(remainingSilence / 1000).toFixed(1)}s remaining)`);
        this.transitionTo(CallState.SilenceWait);
        this.checkSilenceTimeout();
      } else {
        // No silence yet, go to SilenceWait and wait for it
        this.transitionTo(CallState.SilenceWait);
      }
      return;
    }

    // CRITICAL: Wait for SourceBuffer to have ANY buffered data before playing
    // MediaSource is designed for streaming - it will continue loading while playing
    // We just need SOME audio to start, then it streams the rest
    const maxWaitMs = 3000; // Wait up to 3 seconds for any buffer
    const startWait = Date.now();
    let buffered = 0;

    while (Date.now() - startWait < maxWaitMs) {
      try {
        if (this.sourceBuffer!.buffered.length > 0) {
          buffered = this.sourceBuffer!.buffered.end(0) - this.sourceBuffer!.buffered.start(0);
          if (buffered > 0) {
            this.log(`✓ Buffer ready: ${buffered.toFixed(2)}s buffered, starting playback`);
            break;
          }
        }
      } catch (e) {
        // Ignore buffered range errors
      }
      await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
    }

    // Log if we timed out
    if (buffered === 0) {
      this.log(`⚠️ No buffered audio after ${Date.now() - startWait}ms`);
      this.log(`   Chunks in queue: ${this.chunkQueue.length}`);
      this.log(`   Recorded chunks: ${this.recordedChunks.length}`);
      this.log(`   Is appending: ${this.isAppending}`);
      this.log(`   SourceBuffer updating: ${this.sourceBuffer!.updating}`);
      this.log(`   → MediaSource may be stuck, will attempt play anyway`);
    }

    try {
      // CRITICAL: Add timeout to prevent audio.play() from hanging indefinitely
      // Give it 5 seconds since MediaSource might still be appending first chunk
      const playPromise = this.audio.play();
      const timeoutPromise = new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('audio.play() timeout - MediaSource may be stuck')), 5000)
      );

      await Promise.race([playPromise, timeoutPromise]);
      this.metrics.playbackStartTime = Date.now();
      this.log('✓ Playback started');

      // CRITICAL: Wait 200ms to ensure audio is actually audible before any state transitions
      // This prevents the "hit or miss" playback issue where audio.play() resolves
      // before the browser has decoded and played any audible audio
      await new Promise(resolve => setTimeout(resolve, 200));

      // Mark playback as active - now onSilence() can transition to SilenceWait
      this.isPlaybackActive = true;

      // If user stopped talking during buffering, transition to SilenceWait
      if (this.silenceDeadline > 0) {
        const remainingSilence = Math.max(0, this.silenceDeadline - Date.now());
        this.log(`   → Continuing silence countdown (${(remainingSilence / 1000).toFixed(1)}s remaining)`);
        this.transitionTo(CallState.SilenceWait);
        this.checkSilenceTimeout();
      }
    } catch (error) {
      this.log(`⚠️ Playback failed: ${error}`);
      this.log('   → Skipping playback, recording continues normally');

      // Mark as "active" so we can transition to SilenceWait
      this.isPlaybackActive = true;

      // Continue to SilenceWait even if playback failed
      if (this.silenceDeadline > 0) {
        const remainingSilence = Math.max(0, this.silenceDeadline - Date.now());
        this.log(`   → Continuing silence countdown (${(remainingSilence / 1000).toFixed(1)}s remaining)`);
        this.transitionTo(CallState.SilenceWait);
        this.checkSilenceTimeout();
      }
    }
  }

  private async checkSilenceTimeout(): Promise<void> {
    // Check every 100ms if silence has persisted
    while (this.state === CallState.SilenceWait && !this.aborted) {
      await new Promise(resolve => setTimeout(resolve, 100));

      if (Date.now() >= this.silenceDeadline) {
        // Silence persisted - stop recording and drain
        this.log('Silence timeout reached, stopping recording');
        await this.stopRecording();
        this.metrics.recordingEndTime = Date.now();
        this.transitionTo(CallState.Draining);
        return;
      }
    }
  }

  private async drainPlayback(): Promise<void> {
    this.log('Draining remaining playback buffer...');

    // Signal end of stream
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      if (this.sourceBuffer && !this.sourceBuffer.updating) {
        this.mediaSource.endOfStream();
      }
    }

    // Wait for playback to complete or timeout
    const maxWait = 30000; // 30 seconds
    const start = Date.now();

    while (Date.now() - start < maxWait && this.audio && !this.audio.ended) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.log('Playback drained');

    // Deactivate paging if needed
    if (this.config.pagingDevice) {
      await this.deactivatePaging();
    }

    this.transitionTo(CallState.Saving);
  }

  // ==================== Helper Methods ====================

  private isNightTime(): boolean {
    const now = new Date();
    const currentHour = now.getHours() + now.getMinutes() / 60; // e.g., 7:30 = 7.5

    const { dayStartHour, dayEndHour } = this.config;

    // If day hours wrap around midnight
    if (dayStartHour! > dayEndHour!) {
      return currentHour >= dayEndHour! && currentHour < dayStartHour!;
    }

    // Normal case: day is between start and end
    return currentHour < dayStartHour! || currentHour >= dayEndHour!;
  }

  private shouldRampVolume(): boolean {
    // Ramp disabled globally
    if (!this.config.rampEnabled) {
      this.log('Volume ramp disabled globally');
      return false;
    }

    // Day/night mode disabled - always ramp
    if (!this.config.dayNightMode) {
      this.log('Day/night mode disabled - ramping enabled');
      return true;
    }

    // Day/night mode enabled - only ramp at night
    const isNight = this.isNightTime();
    this.log(isNight ? 'Night time - ramping enabled' : 'Day time - ramping disabled');
    return isNight;
  }

  private async rampSpeakerVolumes(targetVolume: number, duration: number): Promise<void> {
    const speakers = this.config.linkedSpeakers ?? [];
    if (speakers.length === 0) {
      this.log('No linked speakers to ramp');
      return;
    }

    this.log(`Ramping ${speakers.length} speaker(s) to ${targetVolume}% over ${duration}s`);

    // Ramp each speaker individually (respecting their maxVolume)
    await Promise.all(
      speakers.map(async (speaker) => {
        const actualVolume = Math.round((targetVolume / 100) * speaker.maxVolume);
        this.log(`  - ${speaker.name}: ${actualVolume}% (max: ${speaker.maxVolume}%)`);

        if (this.config.setSpeakerVolume) {
          try {
            await this.config.setSpeakerVolume(speaker.id, actualVolume);
          } catch (error) {
            this.log(`  - Error setting volume for ${speaker.name}: ${error}`);
          }
        }
      })
    );

    this.log({
      type: 'volume_change',
      message: `✓ Ramped ${speakers.length} speaker(s) to ${targetVolume}%`
    });
  }

  private async setSpeakerVolumes(targetVolume: number): Promise<void> {
    const speakers = this.config.linkedSpeakers ?? [];
    if (speakers.length === 0) {
      this.log('No linked speakers to control');
      return;
    }

    this.log(`Setting ${speakers.length} speaker(s) to ${targetVolume}%`);

    await Promise.all(
      speakers.map(async (speaker) => {
        const actualVolume = Math.round((targetVolume / 100) * speaker.maxVolume);
        this.log(`  - ${speaker.name}: ${actualVolume}% (max: ${speaker.maxVolume}%)`);

        if (this.config.setSpeakerVolume) {
          try {
            await this.config.setSpeakerVolume(speaker.id, actualVolume);
          } catch (error) {
            this.log(`  - Error setting volume for ${speaker.name}: ${error}`);
          }
        }
      })
    );

    this.log({
      type: 'volume_change',
      message: `✓ Set ${speakers.length} speaker(s) to ${targetVolume}%`
    });
  }

  private async deactivatePaging(): Promise<void> {
    if (!this.config.pagingDevice) return;

    try {
      // Step 1: Ramp down speaker volumes (if ramping enabled)
      if (this.shouldRampVolume()) {
        this.log('Ramping speaker volumes down to idle (0%)...');
        await this.rampSpeakerVolumes(0, this.config.nightRampDuration!);
      } else {
        this.log('Keeping speakers at operating volume (day mode or ramp disabled)');
      }

      // Step 2: Disable PoE devices
      const autoPoE = this.config.poeDevices?.filter(d => d.mode === 'auto') ?? [];
      if (autoPoE.length > 0) {
        this.log(`Disabling ${autoPoE.length} PoE device(s) in auto mode...`);
        if (this.config.controlPoEDevices) {
          await this.config.controlPoEDevices(false);
        }
        this.log(`✓ Disabled ${autoPoE.length} PoE device(s)`);
      } else {
        this.log('No PoE devices in auto mode');
      }

      // Step 3: Switch paging to Zone 2 (idle)
      this.log({
        type: 'volume_change',
        message: 'AUDIO ENDED - Switching paging to Zone 2 (idle)'
      });

      if (this.config.setPagingZone) {
        await this.config.setPagingZone(2);
      }

      // Wait for zone change confirmation
      if (this.config.waitForPagingZoneReady) {
        const confirmed = await this.config.waitForPagingZoneReady(2);
        if (confirmed) {
          this.log('✓ Paging switched to Zone 2');
          this.isInZone1 = false; // Mark that we're back in Zone 2
        } else {
          this.log('⚠️ Paging Zone 2 not confirmed');
          this.isInZone1 = false; // Assume we're in Zone 2 anyway
        }
      } else {
        // No confirmation callback, assume success
        this.isInZone1 = false;
      }

    } catch (error) {
      this.log({
        type: 'error',
        message: `Paging deactivation error (non-fatal): ${error}`
      });
      // Continue anyway - don't block save
    }
  }

  // ==================== Save & Cleanup ====================

  private async saveRecording(): Promise<void> {
    const mimeType = this.mediaRecorder?.mimeType || 'audio/webm;codecs=opus';
    const blob = new Blob(this.recordedChunks, { type: mimeType });

    this.log(`Saving ${blob.size} bytes to Firebase`);

    try {
      // Upload to Firebase via callback
      if (this.config.onUpload) {
        const firstAudioTime = this.metrics.audioDetectedTime || this.metrics.recordingStartTime;
        const url = await this.config.onUpload(blob, mimeType, firstAudioTime, this.config.playbackEnabled);

        this.log({
          type: 'volume_change',
          message: `🎙️ Recording saved: ${url}`
        });
      }

      await this.cleanup(true);
    } catch (error) {
      this.log(`❌ Upload failed: ${error}`);
      await this.cleanup(false);
    }
  }

  private async cleanup(success: boolean): Promise<void> {
    this.log(`🧹 Cleanup (${success ? 'upload successful' : 'upload failed'})`);

    // Stop audio and revoke object URL
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }

    // CRITICAL: Revoke object URL to prevent memory leaks
    if (this.mediaSourceUrl) {
      URL.revokeObjectURL(this.mediaSourceUrl);
      this.mediaSourceUrl = null;
    }

    // Clean MediaSource
    if (this.mediaSource) {
      if (this.mediaSource.readyState === 'open') {
        try {
          this.mediaSource.endOfStream();
        } catch (e) {
          // Ignore
        }
      }
      this.mediaSource = null;
    }

    this.sourceBuffer = null;
    this.chunkQueue = [];
    this.mediaSourceReady = null; // Reset promise for next call
    this.isAppending = false;
    this.lastAppendStartTime = 0;
    this.isPlaybackActive = false; // Reset playback state for next call
    this.mediaSourceCrashed = false; // Reset crash flag for next call
    this.recoveryAttempts = 0; // Reset recovery attempts for next call

    // Stop chunk processing watchdog
    this.stopChunkProcessWatchdog();

    // Clean recording - ALWAYS clear chunks after upload (success or failure)
    // The blob has already been created and uploaded, we don't need the chunks anymore
    this.recordedChunks = [];
    this.recordingStartIndex = 0; // CRITICAL: Reset for next call

    this.mediaRecorder = null;

    // Calculate final metrics
    this.metrics.totalDuration = (Date.now() - this.metrics.recordingStartTime) / 1000;

    // Explain state transition
    this.log('');
    this.log('═══════════════════════════════════════════════════════');
    if (this.isInZone1) {
      this.log('📍 READY FOR SUBSEQUENT CALLS:');
      this.log('   ✓ Staying in Zone 1 (speakers still listening)');
      this.log('   ✓ Next call skips 4s hardware delay');
      this.log('   ✓ Instant playback on next audio detection');
      this.log('   → Monitoring continues... waiting for audio');
    } else {
      this.log('📍 MONITORING IN ZONE 2:');
      this.log('   → Paging device in idle mode');
      this.log('   → Speakers in standby');
      this.log('   → Next call needs full initialization (4s delay)');
      this.log('   → Monitoring continues... waiting for audio');
    }
    this.log('═══════════════════════════════════════════════════════');
    this.log('');

    this.transitionTo(CallState.Idle);
  }

  // ==================== Utilities ====================

  private log(messageOrEntry: string | { type: string; message: string; audioLevel?: number }): void {
    if (typeof messageOrEntry === 'string') {
      // Simple console log for internal debugging
      console.log(`[CallCoordinator] ${messageOrEntry}`);
    } else {
      // Structured log entry for UI
      this.config.onLog(messageOrEntry);
    }
  }
}
