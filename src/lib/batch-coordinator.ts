/**
 * BatchCoordinator - Micro-Batch Recording & Playback System
 *
 * Manages audio recording in discrete batches (3-5 seconds each) with simple blob-based
 * playback. Replaces complex MediaSource streaming with reliable, queue-based architecture.
 *
 * Key Features:
 * - Records in configurable batch durations (default 5s)
 * - Plays complete, self-contained audio blobs
 * - Sequential playback queue for multiple batches
 * - Hardware control integration (paging, speakers, PoE)
 * - Simple error recovery (retry blob playback)
 *
 * State Machine per Batch:
 * Recording → Ready → Queued → Playing → Complete
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔒 THE NO-LOST-SYLLABLES INVARIANT (Purist Mode)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Once audio energy crosses the detection threshold, there MUST exist an active
 * capture buffer until the system has definitively decided whether that audio
 * belongs to a session.
 *
 * ENFORCEMENT:
 * - MediaRecorder starts when monitoring begins
 * - MediaRecorder NEVER stops until monitoring ends (abort() only)
 * - No gaps during: playback, upload, hardware transitions, session finishing
 * - Capture first, decide later - NEVER the reverse
 *
 * This guarantees zero lost syllables in emergency situations (e.g., "HELP!")
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ============================================================================
// Types & Interfaces
// ============================================================================

export enum BatchState {
  Recording = 'Recording',
  Ready = 'Ready',
  Queued = 'Queued',
  Playing = 'Playing',
  Complete = 'Complete',
  Failed = 'Failed'
}

export enum SystemState {
  IDLE = 'IDLE',                     // No activity, paging Zone 2
  ARMED = 'ARMED',                   // Audio detected, validating
  RECORDING = 'RECORDING',           // Active session, paging Zone 1
  PLAYING = 'PLAYING',               // Playback in progress
  TAILGUARD = 'TAILGUARD',           // 3s grace after silence
  GRACE = 'GRACE',                   // Post-playback grace window
  DEACTIVATING = 'DEACTIVATING'      // Shutting down hardware
}

export interface AudioBatch {
  id: string;                              // Unique identifier
  chunks: Blob[];                          // MediaRecorder chunks
  blob: Blob | null;                       // Combined blob for playback
  duration: number;                        // Recorded duration in ms
  state: BatchState;                       // Current state
  audioElement: HTMLAudioElement | null;   // Deprecated: Not used with Web Audio API
  blobUrl: string | null;                  // Deprecated: Not used with Web Audio API
  startTime: number;                       // Recording start timestamp
  endTime: number | null;                  // Recording end timestamp
  playbackStartTime: number | null;        // When playback began
  error: Error | null;                     // Any errors encountered
}

export interface CompletedSession {
  id: string;
  sessionNumber: number;
  blob: Blob; // Input recording (raw microphone)
  mimeType: string;
  timestamp: number;
  uploaded: boolean;
  uploadUrl?: string;
  playbackBlob?: Blob; // Playback recording (what actually played through speakers)
  playbackUploaded?: boolean;
  playbackUploadUrl?: string;
}

export interface BatchCoordinatorConfig {
  // Audio validation
  audioThreshold: number;                  // Threshold level for audio detection
  sustainDuration: number;                 // Duration audio must be sustained (ms)

  // Batch settings
  batchDuration: number;                   // Target duration per batch (ms)
  minBatchDuration?: number;               // Min duration before completing batch (ms)
  maxBatchDuration?: number;               // Max duration before force-completing batch (ms)

  // Timing
  playbackEnabled: boolean;                // Enable/disable live playback
  playbackDelay: number;                   // Hardware stabilization delay (ms)
  disableDelay: number;                    // Silence timeout before stopping (ms)
  tailGuardDuration?: number;              // TailGuard window duration (ms, default: 3000)
  postPlaybackGraceDuration?: number;      // Post-playback grace window (ms, default: 750)

  // Playback volume ramp
  playbackRampDuration?: number;           // Ramp duration in ms (default: 2000)
  playbackStartVolume?: number;            // Start volume 0-2.0 (default: 0 = silent)
  playbackMaxVolume?: number;              // Max volume 0-2.0 (default: 1.0 = 100%)
  playbackVolume?: number;                 // Volume when ramp is disabled 0-2.0 (default: 0.6 = 60%)

  // Hardware control
  pagingDevice?: {
    id: string;
    name: string;
    ipAddress: string;
    password: string;
    authMethod: string;
  } | null;
  setPagingMulticastIP?: (active: boolean) => Promise<void>; // Set multicast IP (active=224.0.2.60:5002, idle=224.0.2.60:50022)

  // Speaker control
  linkedSpeakers: Array<{
    id: string;
    name: string;
    ipAddress: string;
    volume: number;
  }>;
  setSpeakerVolume?: (speakerId: string, volume: number) => Promise<void>;
  rampEnabled: boolean;
  dayNightMode: boolean;
  dayStartHour: number;
  dayEndHour: number;
  nightRampDuration: number;
  targetVolume: number;

  // PoE control
  poeDevices: Array<{
    id: string;
    name: string;
    mode: string;
    linkedPagingDevices: string[];
  }>;
  controlPoEDevices?: (deviceIds: string[], action: 'on' | 'off') => Promise<void>;

  // Callbacks
  onLog: (entry: { type: string; message: string; audioLevel?: number }) => void;
  onUpload: (blob: Blob, mimeType: string, timestamp: number, isPlayback?: boolean) => Promise<string>;
  onError?: (error: Error) => void;
  onStateChange?: (state: string) => void;
  onPlaybackLevelUpdate?: (level: number) => void;  // Playback audio level monitoring
}

// ============================================================================
// BatchCoordinator Class
// ============================================================================

export class BatchCoordinator {
  // Configuration
  private config: BatchCoordinatorConfig;
  private batchDuration: number;
  private minBatchDuration: number;
  private maxBatchDuration: number;
  private sustainDuration: number;
  private silenceTimeout: number;

  // State
  private stream: MediaStream | null = null;
  private batches: AudioBatch[] = [];
  private currentBatch: AudioBatch | null = null;
  private playbackQueue: AudioBatch[] = [];
  private isPlaying: boolean = false;
  private mediaRecorder: MediaRecorder | null = null;
  private lastAudioTime: number = 0;
  private silenceCheckInterval: number | null = null;
  private sessionStartTime: number = 0;
  private firstAudioDetectionTime: number = 0; // PST timestamp when audio first detected
  private initSegment: Blob | null = null; // First chunk with headers for playback

  // Web Audio API for playback
  private audioContext: AudioContext | null = null;
  private nextPlaybackTime: number = 0; // Timeline position for scheduling
  private playbackAnalyser: AnalyserNode | null = null;
  private playbackMonitoringInterval: number | null = null;
  private currentPlaybackSource: AudioBufferSourceNode | null = null;
  private playbackGainNode: GainNode | null = null; // For volume ramping (no network requests!)

  // Playback output recording (captures what speakers actually play)
  private playbackDestination: MediaStreamAudioDestinationNode | null = null;
  private playbackRecorder: MediaRecorder | null = null;
  private playbackRecordedChunks: Blob[] = [];
  private playbackRecordingActive: boolean = false;

  // Hardware state
  private pagingActive: boolean = false;      // Zone 1 active
  private hardwareReady: boolean = false;     // Speakers ramped, PoE enabled
  private isInZone1: boolean = false;         // Track zone for subsequent calls
  private speakerVolumesInitialized: boolean = false; // Volumes set once at monitoring start

  // Validation
  private audioValidated: boolean = false;
  private validationStartTime: number = 0;
  private isPreBuffering: boolean = false; // Recording during validation

  // Session ID gate (prevents late playback after session invalidation)
  private sessionId: number = 0;

  // Playback generation counter (prevents race conditions between sessions)
  private playbackGeneration: number = 0;

  // Session completion guard (prevents double finish)
  private isFinishing: boolean = false;

  // Deferred start (audio detected during finish phase) - DEPRECATED, replaced by TailGuard
  private pendingStart: boolean = false;
  private finishingSessionBatches: AudioBatch[] = []; // Saved batches from session being finished

  // TailGuard: Always-on buffer after last batch queued
  private tailGuardActive: boolean = false;
  private tailGuardDuration: number; // Configured duration (default: 3000ms)
  private tailGuardStartTime: number = 0;

  // Background upload queue (non-blocking)
  private completedSessions: CompletedSession[] = [];
  private uploadInProgress: boolean = false;

  // System state machine (for debugging and race condition prevention)
  private systemState: SystemState = SystemState.IDLE;

  // Idle memory cap (rolling ring buffer)
  private idleBufferMaxDuration: number = 3000; // 3 seconds max for idle batch

  // Post-playback grace window (catch "hello" right after playback)
  private postPlaybackGraceDuration: number; // Configured duration (default: 750ms)
  private postPlaybackGraceActive: boolean = false;
  private postPlaybackGraceTimeout: number | null = null;
  private postPlaybackGraceResolve: (() => void) | null = null; // Resolve function to cancel grace

  // Playback volume ramp settings
  private playbackRampDuration: number; // Ramp duration in ms
  private playbackStartVolume: number; // Start volume (0-2.0)
  private playbackMaxVolume: number; // Max volume (0-2.0)
  private playbackVolume: number; // Volume when ramp disabled (0-2.0)

  // Hardware thrash protection (prevent infinite reactivation loops)
  // 🔥 REMOVED: No limit on hardware re-activations for PA/VOX systems
  // Life-safety priority: If someone speaks, hardware MUST activate - no exceptions
  // PA systems are VOX-based, people naturally stop talking (won't loop forever)
  // Even worst-case 1hr continuous speech is fine - just keep recording/playing batches

  constructor(config: BatchCoordinatorConfig) {
    this.config = config;
    this.batchDuration = config.batchDuration || 5000;
    this.minBatchDuration = config.minBatchDuration || 1000;
    this.maxBatchDuration = config.maxBatchDuration || 10000;
    this.sustainDuration = config.sustainDuration || 500;
    this.silenceTimeout = config.disableDelay; // Respect user setting, no fallback
    this.tailGuardDuration = config.tailGuardDuration ?? 3000; // Default: 3s
    this.postPlaybackGraceDuration = config.postPlaybackGraceDuration ?? 750; // Default: 750ms
    this.playbackRampDuration = config.playbackRampDuration ?? 2000; // Default: 2s
    this.playbackStartVolume = config.playbackStartVolume ?? 0; // Default: silent start
    this.playbackMaxVolume = config.playbackMaxVolume ?? 1.0; // Default: 100% volume
    this.playbackVolume = config.playbackVolume ?? 0.6; // Default: 60% when ramp disabled
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Start recording from the provided media stream
   */
  async start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    this.sessionStartTime = Date.now();
    this.lastAudioTime = Date.now();
    this.audioValidated = false;
    this.validationStartTime = 0;
    this.sessionId++; // 🔥 New session, increment ID
    this.playbackGeneration++; // New session, increment generation
    this.isFinishing = false; // Reset finish guard
    this.pendingStart = false; // Reset deferred start flag (deprecated, replaced by TailGuard)
    this.finishingSessionBatches = []; // Reset finishing session batches
    this.tailGuardActive = false; // Reset TailGuard state
    this.tailGuardStartTime = 0;

    this.log(`BatchCoordinator started (session ${this.sessionId})`);

    // 🔥 Initialize Web Audio API for playback
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
      this.nextPlaybackTime = 0;
      this.log(`🎵 Web Audio API initialized (sample rate: ${this.audioContext.sampleRate}Hz)`);

      // Create gain node for volume ramping (fast, no network requests!)
      this.playbackGainNode = this.audioContext.createGain();
      this.playbackGainNode.gain.value = this.playbackStartVolume; // Start at configured volume
      this.log(`🎵 Playback gain node created (start: ${this.playbackStartVolume.toFixed(2)}, max: ${this.playbackMaxVolume.toFixed(2)})`);

      // Create analyser for playback monitoring
      this.playbackAnalyser = this.audioContext.createAnalyser();
      this.playbackAnalyser.fftSize = 256;

      // Create MediaStreamDestination for recording playback output
      this.playbackDestination = this.audioContext.createMediaStreamDestination();

      // Connect: GainNode → Analyser → [Destination (speakers) + MediaStreamDestination (recording)]
      this.playbackGainNode.connect(this.playbackAnalyser);
      this.playbackAnalyser.connect(this.audioContext.destination);
      this.playbackAnalyser.connect(this.playbackDestination); // Also route to recording destination
      this.log('🎵 Audio chain: Source → Gain (ramp) → Analyser (monitor) → [Speakers + Recorder]');

      // Start playback level monitoring
      this.startPlaybackMonitoring();

      // 🔥 Setup page visibility listener to resume AudioContext when page becomes visible
      this.setupVisibilityListener();
    } else {
      // Reset timeline for new session
      this.nextPlaybackTime = this.audioContext.currentTime;
      this.log('Web Audio timeline reset for new session');

      // Resume if suspended
      this.resumeAudioContextIfNeeded();
    }

    // 🔥 Capture silent pre-roll for init segment (if not already captured)
    // IMPORTANT: Make sure monitoring is started when quiet (no "eh" sounds)!
    // This 200ms of silence becomes the init segment for ALL batches
    if (!this.initSegment) {
      await this.captureSilentPreRoll();
    } else {
      this.log('Using existing silent pre-roll from previous session');
    }

    // 🔊 Initialize speaker volumes ONCE at monitoring start
    // After this, we NEVER touch speaker volumes again - only change multicast IP!
    if (!this.speakerVolumesInitialized && this.config.linkedSpeakers.length > 0 && this.config.playbackEnabled) {
      this.log('🔊 Initializing speaker volumes (one-time setup)...');
      await this.setSpeakersToTargetVolume();
      this.speakerVolumesInitialized = true;
      this.log('  ✓ Speaker volumes initialized - will not change during sessions');
    }

    // Don't start recording yet - wait for audio validation
    // Recording will start when onAudioDetected validates sustained audio
  }

  /**
   * Handle audio detection event
   */
  onAudioDetected(level: number): void {
    this.lastAudioTime = Date.now();

    // 🔍 DEBUG: Log ALL audio detection calls
    if (this.isFinishing || this.postPlaybackGraceActive || this.tailGuardActive) {
      this.log(`🔍 DEBUG: onAudioDetected called - level: ${(level * 100).toFixed(0)}%, isFinishing: ${this.isFinishing}, grace: ${this.postPlaybackGraceActive}, tailGuard: ${this.tailGuardActive}, validated: ${this.audioValidated}`);
    }

    // 🔒 POST-PLAYBACK GRACE: Audio detected right after playback!
    // This is the "hello" we were waiting for - promote standby batch
    if (this.postPlaybackGraceActive) {
      // 🚨🚨🚨 LIFE-SAFETY MODE: ZERO TOLERANCE 🚨🚨🚨
      // Any audio during grace = immediate hot restart, no validation delay
      // Grace period is for capturing urgent responses like "HELP!" or "FIRE!"
      // Can't afford to miss even 50ms bursts - lives are at stake
      if (!this.audioValidated) {
        this.audioValidated = true; // Immediate validation

        const elapsed = this.validationStartTime ? Date.now() - this.validationStartTime : 0;
        this.log(`🔒 Grace: Emergency audio detected (${(level * 100).toFixed(0)}%) - IMMEDIATE HOT RESTART`);
        this.log(`   🚨 LIFE-SAFETY: Zero validation delay (${elapsed}ms detection) - ANY audio = emergency`);

        // Cancel grace timer
        this.cancelPostPlaybackGrace();

        // 🔥 HOT RESTART: Finish previous session, start fresh new session
        this.log(`🔒 Grace: Step 1 - Finishing previous session (queuing for upload)`);

        // Save batches from previous session
        const previousSessionBatches = [...this.batches];

        // Enqueue previous session for upload (non-blocking)
        if (previousSessionBatches.length > 0) {
          this.finishingSessionBatches = previousSessionBatches;
          this.enqueueSessionUpload();
        }

        // 🔥 START FRESH SESSION
        this.sessionId++; // New session ID
        // 🔥 CRITICAL: Do NOT increment playbackGeneration - let current playback complete!
        // Incrementing it would abort all queued batches from the previous session
        // this.playbackGeneration++; // ← REMOVED - causes batches to be discarded
        this.batches = []; // Clear batches for new session
        // 🔥 CRITICAL: Do NOT clear playback queue - let previous session's batches finish playing!
        // The new grace batch will be queued AFTER the existing batches complete
        // this.playbackQueue = []; // ← REMOVED - causes loss of user's audio
        // this.isPlaying = false; // ← REMOVED - playback is already happening
        this.isFinishing = false;
        this.firstAudioDetectionTime = Date.now(); // New timestamp for this session

        this.log(`🔒 Grace: Step 2 - New session started (session ${this.sessionId}), playback queue preserved (${this.playbackQueue.length} batches)`);

        // Start new batch for the new session (standby batch becomes first batch)
        if (this.currentBatch && this.currentBatch.state === BatchState.Recording) {
          this.log(`🔒 Grace: Converting standby batch to first batch of new session`);
          this.batches.push(this.currentBatch);
        }

        // 🔥 STEP 3: FORCE HARDWARE RESET - Set ALL speakers to Zone 1 (224.0.2.60:50002)
        // Don't care about current state - just force everything active and poll to verify
        this.log(`🔒 Grace: Step 3 - Forcing ALL speakers to mcast.zone1 = 224.0.2.60:50002 (active state)`);
        this.hardwareReady = false; // Reset hardware state

        // Trigger hardware activation (will set speakers, poll, then enable playback)
        // This is non-blocking - recording continues while hardware resets
        this.activateHardware().then(() => {
          this.log(`🔒 Grace: Step 4 - Hardware reset complete, ready for playback`);
          // Playback will start after playback delay (handled in activateHardware)
        }).catch((error) => {
          this.log(`🔒 Grace: Hardware reset failed: ${error}`);
          if (this.config.onError) {
            this.config.onError(error);
          }
        });

        // 🔥 CRITICAL: Restart silence monitoring for new session
        if (this.silenceCheckInterval) {
          clearInterval(this.silenceCheckInterval);
          this.silenceCheckInterval = null;
        }
        this.onSilence(); // Start fresh silence monitoring

        this.log(`🔒 Grace: Recording continues while hardware resets (non-blocking)`);

        // 🔥 CRITICAL: Clear grace flag so subsequent audio goes to normal handling
        // Without this, all subsequent detections return early and audio is lost!
        this.postPlaybackGraceActive = false;
        this.log('🔒 Grace: Flag cleared - subsequent audio will use normal validation path');

        return; // Hot restart complete, grace handled this audio
      } else {
        // 🚨 BUG FIX: Audio detected during grace but already validated
        // This happens when user keeps speaking after hot restart triggered
        // Clear grace flag and let it fall through to normal handling (TailGuard, etc.)
        this.log(`🔒 Grace: Audio detected but already validated - clearing grace and passing to normal handlers`);
        this.postPlaybackGraceActive = false;
        // Don't return - fall through to TailGuard/normal validation
      }
    }

    // 🚨 OLD BLOCKING CODE REMOVED - Prevented LIFE-SAFETY mode from working!
    // Previously blocked audio during finish phase, now LIFE-SAFETY handles it below

    // 🛡️ TAILGUARD PROMOTION: If TailGuard is active, promote to new session
    if (this.tailGuardActive) {
      // Validate sustained audio during TailGuard
      if (!this.audioValidated && !this.validationStartTime) {
        this.validationStartTime = Date.now();
        this.log(`🛡️ TailGuard: Emergency audio detected (${(level * 100).toFixed(0)}%), validating...`);
      }

      if (!this.audioValidated && this.validationStartTime) {
        const elapsed = Date.now() - this.validationStartTime;
        if (elapsed >= this.sustainDuration) {
          this.audioValidated = true;
          this.log(`🛡️ TailGuard: Audio validated (${elapsed}ms) - PROMOTING to new session`);

          // Deactivate TailGuard - it's now a full session
          this.tailGuardActive = false;
          this.tailGuardStartTime = 0;

          // 🔥 CRITICAL: Restart silence monitoring for the promoted session
          // This ensures the promoted session has a fresh 8s silence countdown
          if (this.silenceCheckInterval) {
            clearInterval(this.silenceCheckInterval);
            this.silenceCheckInterval = null;
          }
          this.onSilence(); // Start fresh silence monitoring with updated lastAudioTime

          // Start new batch for the promoted session
          // MediaRecorder is already running, just continue batching
          this.log(`🛡️ TailGuard promoted - MediaRecorder continues seamlessly`);

          // Trigger hardware activation if not already active
          if (!this.pagingActive && !this.hardwareReady) {
            this.activateHardware().catch((error) => {
              this.log(`Hardware activation failed: ${error}`);
              if (this.config.onError) {
                this.config.onError(error);
              }
            });
          }
        }
      }

      return; // TailGuard is handling this audio
    }

    // 🚨 LIFE-SAFETY MODE: Audio during finish phase
    // MediaRecorder is already running into standby batch
    if (this.isFinishing) {
      // 🚨🚨🚨 ZERO TOLERANCE FOR AUDIO LOSS 🚨🚨🚨
      // During active emergency sessions, ANY audio detection = IMMEDIATE promotion
      // No validation threshold - this is a life-safety system, false positives are acceptable
      if (!this.audioValidated) {
        this.audioValidated = true; // Immediate validation, no waiting
        this.log(`🚨🚨🚨 LIFE-SAFETY: Audio detected during finish phase (${(level * 100).toFixed(0)}%)`);
        this.log('   🚨 ZERO-TOLERANCE MODE: Immediate promotion (no validation delay)');
        this.log('   MediaRecorder already capturing - no restart needed (purist mode)');
      }

      return; // Let cleanup() handle promotion
    }

    // Validate sustained audio
    if (!this.audioValidated) {
      if (!this.validationStartTime) {
        this.validationStartTime = Date.now();
        this.log(`Audio detected (${(level * 100).toFixed(0)}%), validating...`);

        // 🎙️ Start recording IMMEDIATELY (pre-buffer mode)
        // Discard idle standby batch (if exists) and start fresh
        // Idle batch may have corrupted audio (no valid init segment)
        this.isPreBuffering = true;
        if (this.currentBatch) {
          this.log('🎯 Discarding idle batch (may have corrupted audio), starting fresh pre-buffer');
          this.currentBatch = null;
          this.batches = [];
        }
        this.startBatchRecording();
        this.log('📼 Pre-buffering started (capturing audio during validation)');
      }

      const elapsed = Date.now() - this.validationStartTime;
      if (elapsed >= this.sustainDuration) {
        this.audioValidated = true;
        this.isPreBuffering = false;

        // Capture first audio detection time (PST) - only set once per session
        if (this.firstAudioDetectionTime === 0) {
          this.firstAudioDetectionTime = Date.now();
        }

        this.log(`✓ Audio validated (${elapsed}ms above threshold) - pre-buffer committed`);

        // Trigger hardware activation
        if (!this.pagingActive && !this.hardwareReady) {
          this.activateHardware().catch((error) => {
            this.log(`Hardware activation failed: ${error}`);
            if (this.config.onError) {
              this.config.onError(error);
            }
          });
        }
      }
      return;
    }

    // Reset silence check if audio continues
    if (this.silenceCheckInterval) {
      // Audio detected during silence wait - continue recording
      const remainingTime = (this.silenceTimeout / 1000).toFixed(1);
      this.log(`Audio continues - ${remainingTime}s silence countdown reset`);
    }
  }

  /**
   * Handle silence event
   */
  onSilence(): void {
    // If in pre-buffer mode and silence detected, validation failed
    if (this.isPreBuffering && !this.audioValidated) {
      this.log('⚠️ Validation failed (silence during validation) - discarding pre-buffer');

      // 🎯 PURIST MODE: Don't stop MediaRecorder - keep it running
      // Just discard the pre-buffer batch and start a new standby batch
      this.log('🎯 MediaRecorder continues running (purist mode - always listening)');

      // Discard the batch
      this.currentBatch = null;
      this.batches = [];
      this.isPreBuffering = false;
      this.validationStartTime = 0;

      // If this was a finish-phase prebuffer, clear the pending start flag
      if (this.pendingStart) {
        this.pendingStart = false;
        this.log('⚠️ Finish-phase prebuffer validation failed - clearing pending start');
      }

      // 🎯 CRITICAL: Start new standby batch immediately
      // MediaRecorder is still firing ondataavailable events - chunks need a home!
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.startBatchRecording();
        this.log('🎯 Standby batch started after validation failure (MediaRecorder chunks continue flowing)');
      }

      return;
    }

    // 🛡️ If TailGuard is validating and silence detected, validation failed
    if (this.tailGuardActive && this.validationStartTime > 0 && !this.audioValidated) {
      this.log('🛡️ TailGuard validation failed (silence during validation) - continuing TailGuard');

      // Reset validation attempt
      this.validationStartTime = 0;

      // TailGuard continues - will expire on its own timer
      // Don't stop MediaRecorder, let TailGuard expiration handle it
      return;
    }

    // Only start silence check if audio has been validated
    if (!this.audioValidated) {
      this.validationStartTime = 0; // Reset validation
      return;
    }

    // Start silence countdown if not already started
    if (!this.silenceCheckInterval) {
      this.log(`Silence detected, starting ${this.silenceTimeout / 1000}s countdown`);

      this.silenceCheckInterval = window.setInterval(() => {
        const silenceElapsed = Date.now() - this.lastAudioTime;

        // 🎯 Check if we should activate TailGuard or expire it
        if (silenceElapsed >= this.silenceTimeout && !this.tailGuardActive) {
          // ============================================================
          // SILENCE TIMEOUT REACHED → ACTIVATE TAILGUARD
          // ============================================================
          this.log(`Silence timeout (${this.silenceTimeout}ms) reached`);

          // Complete current batch if recording (but not during finish phase)
          if (this.currentBatch && this.currentBatch.state === BatchState.Recording && !this.isFinishing) {
            this.log('Completing final batch');
            this.completeBatch();
          } else if (this.isFinishing) {
            this.log('🎯 During finish phase - letting standby batch continue (will be promoted if validated)');
          }

          // 🛡️ ACTIVATE TAILGUARD: Keep MediaRecorder running for emergency audio
          this.tailGuardActive = true;
          this.tailGuardStartTime = Date.now();

          // 🔥 CRITICAL: Reset validation state so TailGuard can validate audio
          // Without this, audioValidated=true from previous session prevents TailGuard validation!
          this.audioValidated = false;
          this.validationStartTime = 0;

          this.log(`🛡️ TailGuard ACTIVATED (${this.tailGuardDuration}ms window)`);
          this.log('   MediaRecorder stays active - listening for emergency audio');
          this.log(`   🎯 Validation state reset (audioValidated=${this.audioValidated}) - ready to detect emergency audio`);

          // Start TailGuard batch to capture any emergency audio (but not during finish phase)
          // This will be discarded if no audio detected, or promoted if audio validated
          if (!this.isFinishing) {
            this.startBatchRecording();
            this.log('🛡️ TailGuard batch started (will discard if no audio, promote if validated)');
          } else {
            this.log('🛡️ TailGuard activated during finish phase - standby batch continues');
          }

          // Don't clear interval - keep checking for TailGuard expiration
          // Don't finish session yet - TailGuard is active

        } else if (this.tailGuardActive) {
          // ============================================================
          // TAILGUARD ACTIVE → CHECK FOR EXPIRATION
          // ============================================================
          const tailGuardElapsed = Date.now() - this.tailGuardStartTime;

          if (tailGuardElapsed >= this.tailGuardDuration) {
            this.log(`🛡️ TailGuard expired (${tailGuardElapsed}ms) - no emergency audio detected`);

            // 🎯 PURIST APPROACH: Don't stop MediaRecorder - keep it running
            // Complete the TailGuard batch and start a new standby batch immediately
            // This ensures chunks always have somewhere to go
            this.log('🎯 MediaRecorder continues running (purist mode - always listening)');

            // Complete TailGuard batch (no longer needed) - but not during finish phase
            if (this.currentBatch && this.currentBatch.state === BatchState.Recording && !this.isFinishing) {
              this.log('🎯 Completing TailGuard batch (no emergency audio)');
              this.completeBatch();
            } else if (this.isFinishing) {
              this.log('🎯 During finish phase - letting standby batch continue (will be promoted if validated)');
            }

            // 🎯 CRITICAL: Start new standby batch immediately (but not during finish phase)
            // MediaRecorder is still firing ondataavailable events - chunks need a home!
            if (!this.isFinishing) {
              this.startBatchRecording();
              this.log('🎯 Standby batch started (MediaRecorder chunks continue flowing)');
            } else {
              this.log('🎯 During finish phase - standby batch continues (no new batch needed)');
            }

            // Clear interval
            clearInterval(this.silenceCheckInterval!);
            this.silenceCheckInterval = null;

            // Reset TailGuard (but MediaRecorder keeps running!)
            this.tailGuardActive = false;
            this.tailGuardStartTime = 0;

            // 🎯 CRITICAL FIX: Always finish session after TailGuard expires
            // finishSession() will wait for playback to complete internally
            this.log('TailGuard expired, finishing session');
            this.finishSession();
          }
        }
      }, 100); // Check every 100ms
    }
  }

  /**
   * Manually stop the current session (but keep monitoring active)
   * MediaRecorder continues running in purist mode
   */
  async stop(): Promise<void> {
    this.log('Stopping current session (monitoring continues in purist mode)');

    // Complete current batch if recording
    if (this.currentBatch && this.currentBatch.state === BatchState.Recording) {
      this.completeBatch();
    }

    // 🎯 PURIST MODE: Don't stop MediaRecorder - keep monitoring active
    // MediaRecorder will continue into standby batch, ready for next session
    this.log('🎯 MediaRecorder continues running (ready for next session)');

    // Clear silence check
    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }

    // Wait for all batches to complete playback
    await this.waitForPlaybackComplete();

    // Finish session (this will invalidate sessionId)
    await this.finishSession();
  }

  /**
   * Abort without saving - ONLY place MediaRecorder stops
   * This enforces the No-Lost-Syllables Invariant
   */
  async abort(): Promise<void> {
    this.log('Aborting batch coordinator (monitoring stopping completely)');

    // 🔥 CRITICAL: Invalidate session IMMEDIATELY to prevent ANY new playback
    this.sessionId++;
    this.log(`Session invalidated (now ${this.sessionId}) - no more playback allowed`);

    // 🔒 INVARIANT: This is the ONLY place MediaRecorder stops
    // MediaRecorder runs continuously from start() → abort() with zero gaps
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.log('🎯 Stopping MediaRecorder (monitoring ending - invariant preserved)');
      this.mediaRecorder.stop();
    }

    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
    }

    // Stop playback monitoring
    this.stopPlaybackMonitoring();

    // Stop playback - close AudioContext (monitoring is stopping)
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
        this.log('AudioContext closed');
      } catch (error) {
        this.log(`AudioContext close error: ${error}`);
      }
      this.audioContext = null;
      this.nextPlaybackTime = 0;
    }

    // Clear init segment (monitoring is stopping completely)
    this.initSegment = null;
    this.log('Cleared silent pre-roll init segment');

    // Reset TailGuard state
    this.tailGuardActive = false;
    this.tailGuardStartTime = 0;

    // Cleanup without uploading
    await this.cleanup(false);
  }

  /**
   * Get current batches
   */
  getBatches(): AudioBatch[] {
    return this.batches;
  }

  /**
   * Get current state summary
   */
  getState(): string {
    if (!this.audioValidated) return 'Validating';
    if (this.currentBatch?.state === BatchState.Recording) return 'Recording';
    if (this.isPlaying) return 'Playing';
    if (this.playbackQueue.length > 0) return 'Queued';
    return 'Idle';
  }

  // ============================================================================
  // Batch Recording
  // ============================================================================

  private startBatchRecording(): void {
    const batch: AudioBatch = {
      id: `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      chunks: [],
      blob: null,
      duration: 0,
      state: BatchState.Recording,
      audioElement: null,
      blobUrl: null,
      startTime: Date.now(),
      endTime: null,
      playbackStartTime: null,
      error: null
    };

    this.currentBatch = batch;
    this.batches.push(batch);

    this.log(`Started recording batch ${this.batches.length}`);

    // Create MediaRecorder if not exists
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      const mimeType = this.getBestMimeType();
      this.mediaRecorder = new MediaRecorder(this.stream!, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.onChunkRecorded(event.data);
        }
      };

      this.mediaRecorder.onerror = (error) => {
        this.log(`MediaRecorder error: ${error}`);
        if (this.config.onError) {
          this.config.onError(new Error(`MediaRecorder error: ${error}`));
        }
      };

      this.mediaRecorder.start(100); // 100ms chunks
      this.log(`MediaRecorder started (${mimeType})`);
    }
  }

  private onChunkRecorded(chunk: Blob): void {
    // 🔥 CRITICAL: Guard against zombie chunks from old sessions
    // MediaRecorder.stop() fires final ondataavailable AFTER cleanup
    if (!this.currentBatch) {
      this.log('⚠️ Chunk received but no active batch (likely final chunk after stop)');
      return;
    }

    // NOTE: We no longer capture init segment from first chunk
    // Instead, we'll extract it from batch 1's completed blob

    this.currentBatch.chunks.push(chunk);
    this.currentBatch.duration += 100; // Approximate (100ms per chunk)

    // 🎯 PURIST MODE: During finish phase, let standby batch grow unbounded
    // It will be promoted/discarded in cleanup()
    if (this.isFinishing) {
      return; // Don't complete batch during finish - let it accumulate
    }

    // 🎯 PURIST MODE: During idle standby, let idle batch grow unbounded
    // It will become pre-buffer when audio is detected, or be discarded/reused
    if (!this.audioValidated && !this.isPreBuffering) {
      return; // Don't complete batch during idle - let it accumulate
    }

    // Check if batch duration reached
    if (this.currentBatch.duration >= this.batchDuration) {
      this.log(`Batch ${this.batches.length} reached target duration (${this.currentBatch.duration}ms)`);
      this.completeBatch();
    }

    // Safety: Force complete if max duration exceeded (but not during idle standby)
    if (this.currentBatch && this.currentBatch.duration >= this.maxBatchDuration) {
      if (!this.audioValidated && !this.isPreBuffering && !this.isFinishing) {
        // Idle batch getting too large - discard and start fresh to prevent memory issues
        this.log(`⚠️ Idle batch exceeded max duration (${this.currentBatch.duration}ms), discarding and restarting`);
        this.currentBatch = null;
        this.batches = [];
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.startBatchRecording();
          this.log('🎯 New idle standby batch started (old one was too large)');
        }
      } else {
        this.log(`Batch ${this.batches.length} exceeded max duration, force completing`);
        this.completeBatch();
      }
    }
  }

  private completeBatch(): void {
    if (!this.currentBatch) return;

    // 🎯 PURIST MODE: This should never be called during finish
    // (onChunkRecorded + silence timeout + TailGuard all skip completeBatch during finish phase)
    if (this.isFinishing) {
      this.log('⚠️ BUG: completeBatch called during session finish (this should never happen!)');
      this.log('   Please report this if you see it - batches should continue during finish, not complete');
      return;
    }

    const batch = this.currentBatch;

    // Check minimum duration
    if (batch.duration < this.minBatchDuration && this.mediaRecorder?.state === 'recording') {
      this.log(`Batch ${this.batches.length} too short (${batch.duration}ms), continuing...`);
      return; // Don't complete yet
    }

    batch.endTime = Date.now();
    batch.state = BatchState.Ready;

    // Create blob from chunks
    const mimeType = this.mediaRecorder?.mimeType || 'audio/webm;codecs=opus';
    const batchIndex = this.batches.indexOf(batch) + 1;

    // 🔥 ALWAYS prepend init segment for ALL batches (including batch 1)
    // This ensures every batch can play standalone, even if idle batches were discarded
    if (this.initSegment) {
      batch.blob = new Blob([this.initSegment, ...batch.chunks], { type: mimeType });
      this.log(`Batch ${batchIndex}: Added silent pre-roll (${this.initSegment.size} bytes) for standalone playback`);
    } else {
      // Fallback: No init segment available (shouldn't happen)
      batch.blob = new Blob(batch.chunks, { type: mimeType });
      this.log(`⚠️ Batch ${batchIndex}: No init segment available, using chunks only`);
    }

    this.log(`Batch ${this.batches.length} complete: ${batch.duration}ms, ${batch.blob.size} bytes`);

    // Enqueue for playback if enabled
    if (this.config.playbackEnabled) {
      this.playbackQueue.push(batch);
      batch.state = BatchState.Queued;
      this.log(`Batch ${this.batches.length} queued for playback`);

      // Start playback if not already playing
      if (!this.isPlaying) {
        this.playNextBatch();
      }
    }

    // Clear reference to completed batch before starting new one
    this.currentBatch = null;

    // 🎯 PURIST MODE: ALWAYS start a new standby batch
    // MediaRecorder is always running - chunks need somewhere to go!
    if (this.mediaRecorder?.state === 'recording') {
      const silenceElapsed = Date.now() - this.lastAudioTime;
      if (silenceElapsed < this.silenceTimeout) {
        this.log('More audio expected, starting next batch');
      } else {
        this.log('🎯 Starting standby batch (purist mode - always listening)');
      }
      this.startBatchRecording(); // This will set this.currentBatch to new batch
    }
  }

  // ============================================================================
  // Batch Playback
  // ============================================================================

  /**
   * Play next batch using Web Audio API
   * Decodes blob to AudioBuffer and schedules on timeline for gap-free playback
   */
  private async playNextBatch(): Promise<void> {
    if (this.playbackQueue.length === 0) {
      this.isPlaying = false;
      this.log('Playback queue empty');

      // Check if session is complete
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        if (!this.silenceCheckInterval) {
          // Session complete, wrap up
          this.log('No more batches, finishing session');
          await this.finishSession();
        }
      }
      return;
    }

    const batch = this.playbackQueue.shift()!;
    batch.state = BatchState.Playing;
    batch.playbackStartTime = Date.now();
    this.isPlaying = true;

    const batchIndex = this.batches.indexOf(batch) + 1;
    this.log(`Playing batch ${batchIndex} of ${this.batches.length}`);

    // 🔥 Capture playback generation to guard against race conditions
    // Use playbackGeneration (not sessionId) because sessionId gets invalidated
    // during finishSession, but we still want current playback to complete
    const myGeneration = this.playbackGeneration;

    try {
      // Ensure hardware is active before first playback
      if (!this.hardwareReady) {
        await this.activateHardware();
      }

      // 🔥 Gate: Check playback generation is still valid before proceeding
      if (myGeneration !== this.playbackGeneration) {
        this.log(`Playback aborted: generation ${myGeneration} invalidated (now ${this.playbackGeneration})`);
        return;
      }

      if (!this.audioContext) {
        throw new Error('AudioContext not initialized');
      }

      // 🔥 Resume AudioContext if suspended (e.g., after navigating away and back)
      await this.resumeAudioContextIfNeeded();

      // 🎵 Step 1: Decode blob to AudioBuffer
      const arrayBuffer = await batch.blob!.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

      this.log(`Decoded batch ${batchIndex}: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.numberOfChannels}ch`);

      // 🔍 DEBUG: Check AudioContext state
      this.log(`🔍 AudioContext state: ${this.audioContext.state}`);
      if (this.audioContext.state === 'suspended') {
        this.log(`⚠️ WARNING: AudioContext is SUSPENDED - audio will not play!`);
      }

      // 🔍 DEBUG: Check if audio buffer contains actual sound (not silence)
      const channelData = audioBuffer.getChannelData(0);
      let sumSquares = 0;
      const sampleCount = Math.min(channelData.length, 48000); // Check first 1 second
      for (let i = 0; i < sampleCount; i++) {
        sumSquares += channelData[i] * channelData[i];
      }
      const rms = Math.sqrt(sumSquares / sampleCount);
      const dbFS = 20 * Math.log10(rms);
      this.log(`🔍 Audio content RMS: ${rms.toFixed(6)} (${dbFS.toFixed(1)} dBFS) ${rms < 0.0001 ? '🔇 SILENCE!' : '✓ has sound'}`);

      // 🔥 Gate: Check playback generation STILL valid after async decode
      if (myGeneration !== this.playbackGeneration) {
        this.log(`Playback aborted after decode: generation ${myGeneration} invalidated`);
        return;
      }

      // 🎵 Step 2: Create AudioBufferSourceNode
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      this.currentPlaybackSource = source;

      // Connect to gain node (for volume ramping)
      if (this.playbackGainNode) {
        source.connect(this.playbackGainNode);

        // 🔍 DEBUG: Check gain level during playback
        const currentGain = this.playbackGainNode.gain.value;
        this.log(`🔊 Batch ${batchIndex} playback gain: ${currentGain.toFixed(2)} (${currentGain === 0 ? '🔇 MUTED!' : '✓ audible'})`);
      } else {
        // Fallback: direct connection if gain node not available
        source.connect(this.audioContext.destination);
        this.log(`🔊 Batch ${batchIndex} connected directly to destination (no gain node)`);
      }

      // 🎵 Step 3: Calculate playback time (sample-accurate scheduling)
      const now = this.audioContext.currentTime;
      const playTime = Math.max(this.nextPlaybackTime, now);

      // 🎵 Step 4: Set up completion handler
      let hasCompleted = false; // Guard against multiple callbacks
      let safetyTimeoutId: ReturnType<typeof setTimeout> | null = null;

      const completePlayback = (reason: string) => {
        if (hasCompleted) return; // Already handled
        hasCompleted = true;

        // Clear safety timeout
        if (safetyTimeoutId !== null) {
          clearTimeout(safetyTimeoutId);
          safetyTimeoutId = null;
        }

        // 🔥 Guard: Only proceed if this is still the current playback generation
        if (myGeneration !== this.playbackGeneration) {
          this.log(`Batch ${batchIndex} ${reason} from old generation, ignoring`);
          return;
        }

        this.log(`Batch ${batchIndex} playback complete (${reason})`);
        batch.state = BatchState.Complete;

        // No cleanup needed - Web Audio handles everything
        // Play next batch
        this.playNextBatch();
      };

      source.onended = () => completePlayback('onended');

      // 🎵 Step 4b: Add error handler (critical for reliability!)
      // Without this, playback errors cause queue to stall forever
      // @ts-ignore - onended exists but TypeScript doesn't know about onerror on AudioScheduledSourceNode
      source.onerror = (error: Event) => {
        this.log(`⚠️ Batch ${batchIndex} playback error: ${error}`);
        completePlayback('onerror');
      };

      // 🎵 Step 4c: Safety timeout - force completion after duration + 5s buffer
      // Ensures we never get stuck waiting for onended that never fires
      safetyTimeoutId = setTimeout(() => {
        if (!hasCompleted) {
          this.log(`⚠️ Batch ${batchIndex} safety timeout triggered (onended didn't fire)`);
          completePlayback('timeout');
        }
      }, (audioBuffer.duration + 5) * 1000);

      // 🎵 Step 5: Start playback at scheduled time
      source.start(playTime);

      // 🎵 Step 6: Update timeline for next batch
      this.nextPlaybackTime = playTime + audioBuffer.duration;

      const delay = playTime - now;
      if (delay > 0) {
        this.log(`✓ Batch ${batchIndex} scheduled in ${(delay * 1000).toFixed(0)}ms`);
      } else {
        this.log(`✓ Batch ${batchIndex} playing immediately`);
      }

    } catch (error) {
      this.log(`Failed to play batch ${batchIndex}: ${error}`);
      batch.state = BatchState.Failed;
      batch.error = error as Error;

      if (this.config.onError) {
        this.config.onError(error as Error);
      }

      // Try next batch
      this.playNextBatch();
    }
  }

  private async waitForPlaybackComplete(): Promise<void> {
    if (!this.config.playbackEnabled) return;

    return new Promise((resolve) => {
      if (this.playbackQueue.length === 0 && !this.isPlaying) {
        resolve();
        return;
      }

      // 🎵 Calculate expected playback time based on queued batches
      // This prevents false timeouts when you have multiple long batches
      let estimatedDuration = 0;

      // Add duration of all queued batches
      for (const batch of this.playbackQueue) {
        if (batch.blob) {
          // Rough estimate: ~20ms per kilobyte for opus audio
          estimatedDuration += (batch.blob.size / 1024) * 20;
        } else {
          // Fallback: use batch.duration if blob not ready yet
          estimatedDuration += batch.duration;
        }
      }

      // If currently playing, estimate remaining time
      // (We don't know exact position, so add max batch duration as buffer)
      if (this.isPlaying) {
        estimatedDuration += this.batchDuration;
      }

      // Add generous buffer for:
      // - Decoding: ~1-2s per batch
      // - Hardware activation: up to 25s (21s network delay + 4s stabilization)
      // - Scheduling delays: ~1-2s
      // Total buffer: 30s + estimated duration
      const hardwareBuffer = 30000; // Covers worst-case hardware activation
      const timeoutDuration = estimatedDuration + hardwareBuffer;

      this.log(`Waiting for playback to complete... (est. ${(estimatedDuration / 1000).toFixed(1)}s, timeout in ${(timeoutDuration / 1000).toFixed(1)}s)`);

      const checkInterval = setInterval(() => {
        // 🔥 LIFE-SAFETY: Exit early if audio validated during finish phase
        // This allows immediate transition to grace period without waiting
        if (this.audioValidated && this.isFinishing) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          this.log('🚨 Playback wait cancelled - LIFE-SAFETY audio validated during finish phase');
          resolve();
          return;
        }

        if (this.playbackQueue.length === 0 && !this.isPlaying) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId); // 🔥 Cancel timeout when playback completes
          this.log('✓ Playback complete');
          resolve();
        }
      }, 100);

      // Dynamic timeout based on queue length
      const timeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        this.log(`⚠️ Playback completion timeout (waited ${(timeoutDuration / 1000).toFixed(1)}s)`);
        resolve();
      }, timeoutDuration);
    });
  }

  /**
   * 🔒 POST-PLAYBACK GRACE: Wait 750ms after playback for "hello" responses
   * This catches firefighters responding immediately after hearing the page
   * If audio validated during grace → cancelPostPlaybackGrace() resolves early
   */
  private async waitForPostPlaybackGrace(): Promise<void> {
    return new Promise((resolve) => {
      // Store resolve function so cancelPostPlaybackGrace() can call it
      this.postPlaybackGraceResolve = resolve;

      this.postPlaybackGraceTimeout = window.setTimeout(() => {
        this.postPlaybackGraceTimeout = null;
        this.postPlaybackGraceResolve = null;
        resolve();
      }, this.postPlaybackGraceDuration);
    });
  }

  /**
   * Cancel post-playback grace (called when audio validates during grace)
   * Immediately resolves the waitForPostPlaybackGrace() promise
   */
  private cancelPostPlaybackGrace(): void {
    if (this.postPlaybackGraceTimeout) {
      clearTimeout(this.postPlaybackGraceTimeout);
      this.postPlaybackGraceTimeout = null;
      this.log('🚨 Post-playback grace cancelled (emergency audio validated)');
    }

    // Immediately resolve the promise so finishSession() can check audioValidated and return early
    if (this.postPlaybackGraceResolve) {
      this.postPlaybackGraceResolve();
      this.postPlaybackGraceResolve = null;
    }
  }

  // ============================================================================
  // Hardware Control
  // ============================================================================

  private async activateHardware(): Promise<void> {
    if (this.hardwareReady) return;

    this.log('🎛️  HARDWARE ACTIVATION:');

    try {
      // Step 1: Set speakers' multicast IP to active (224.0.2.60:50002)
      // DON'T touch paging device (it freezes) - change speakers instead!
      if (this.config.pagingDevice && this.config.setPagingMulticastIP) {
        if (this.isInZone1) {
          this.log('Step 1: Speakers already in active mode');
        } else {
          this.log('Step 1: Switching speakers to active mode (224.0.2.60:50002)...');
          await this.config.setPagingMulticastIP(true);
          this.log('  ✓ Multicast IP change sent to speakers (includes reload + polling)');
          this.isInZone1 = true;
        }
        this.pagingActive = true;
      }

      // Step 2: Speaker volumes - SKIP! (already set at monitoring start)
      // We NEVER touch speaker volumes during sessions - only at initialization
      // This prevents network thrashing and ensures smooth operation

      // Step 2.5: Ramp playback gain node (fast, smooth, no network!)
      if (this.config.playbackEnabled && this.config.rampEnabled) {
        // Check day/night mode: if enabled, only ramp during night hours
        const shouldRamp = !this.config.dayNightMode || this.shouldUseNightRamp();

        if (shouldRamp) {
          this.log(`Step 2.5: Ramping playback gain (${this.playbackStartVolume.toFixed(2)} → ${this.playbackMaxVolume.toFixed(2)} over ${this.playbackRampDuration}ms)...`);
          this.rampPlaybackGain(this.playbackMaxVolume, this.playbackRampDuration); // Non-blocking, starts immediately
          this.log('  ✓ Playback gain ramping started');
        } else {
          // Day mode with day/night enabled: instant (no ramp)
          if (this.playbackGainNode) {
            this.playbackGainNode.gain.value = this.playbackMaxVolume;
            this.log('Step 2.5: Day mode - instant volume (no ramp)');
          }
        }
      } else {
        // Ramp disabled, use playbackVolume setting (not max!)
        if (this.playbackGainNode) {
          this.playbackGainNode.gain.value = this.playbackVolume;
          this.log(`Step 2.5: Ramp disabled - using playback volume (${this.playbackVolume.toFixed(2)})`);
        }
      }

      // Step 3: Enable PoE devices in auto mode
      const autoPoEDevices = this.config.poeDevices.filter(d => d.mode === 'auto');
      if (autoPoEDevices.length > 0 && this.config.controlPoEDevices) {
        this.log('Step 3: Enabling PoE devices...');
        await this.config.controlPoEDevices(autoPoEDevices.map(d => d.id), 'on');
        this.log(`  ✓ Enabled ${autoPoEDevices.length} PoE device(s)`);
      }

      // Step 4: Start recording playback output (what actually plays through speakers)
      if (this.config.playbackEnabled && this.playbackDestination) {
        this.startPlaybackRecording();
      }

      this.hardwareReady = true;
      this.log('✓ Hardware activation complete');

    } catch (error) {
      this.log(`Hardware activation failed: ${error}`);
      throw error;
    }
  }

  private async deactivateHardware(): Promise<void> {
    if (!this.hardwareReady) return;

    this.log('🎛️  HARDWARE DEACTIVATION:');

    try {
      // Step 1: Ramp down playback gain (fast, no network requests!)
      if (this.config.playbackEnabled && this.config.rampEnabled && this.playbackGainNode) {
        this.log('Step 1: Ramping playback gain down...');
        await this.rampPlaybackGain(this.playbackStartVolume, 1000); // Quick fade down (1s)
        this.log('  ✓ Playback gain ramped down');
      }

      // Step 1.5: Stop recording playback output
      if (this.playbackRecordingActive) {
        this.stopPlaybackRecording();
      }

      // Step 2: Disable PoE devices in auto mode
      const autoPoEDevices = this.config.poeDevices.filter(d => d.mode === 'auto');
      if (autoPoEDevices.length > 0 && this.config.controlPoEDevices) {
        this.log('Step 2: Disabling PoE devices...');
        await this.config.controlPoEDevices(autoPoEDevices.map(d => d.id), 'off');
        this.log(`  ✓ Disabled ${autoPoEDevices.length} PoE device(s)`);
      }

      // Step 3: Set speakers' multicast IP to idle (224.0.2.60:50022)
      // Different port = speakers don't receive audio from paging
      if (this.config.pagingDevice && this.config.setPagingMulticastIP) {
        if (this.isInZone1) {
          this.log('Step 3: Switching speakers to idle mode (224.0.2.60:50022)...');
          await this.config.setPagingMulticastIP(false);
          this.log('  ✓ Multicast IP change sent to speakers (includes reload + polling)');
          this.pagingActive = false;
          this.isInZone1 = false;
        } else {
          this.log('Step 3: Speakers already in idle mode');
          this.pagingActive = false;
        }
      }

      this.hardwareReady = false;
      this.log('✓ Hardware deactivation complete');

    } catch (error) {
      this.log(`Hardware deactivation error: ${error}`);
      // Continue anyway - best effort
    }
  }

  /**
   * Start recording playback output (what actually plays through speakers)
   * Non-blocking - runs in parallel with playback
   */
  private startPlaybackRecording(): void {
    if (!this.playbackDestination || this.playbackRecordingActive) {
      return;
    }

    try {
      const stream = this.playbackDestination.stream;
      const mimeType = this.getBestMimeType();

      this.playbackRecorder = new MediaRecorder(stream, { mimeType });
      this.playbackRecordedChunks = [];

      this.playbackRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.playbackRecordedChunks.push(event.data);
        }
      };

      this.playbackRecorder.onerror = (error) => {
        this.log(`📼 Playback recorder error: ${error}`);
      };

      this.playbackRecorder.start(100); // 100ms chunks
      this.playbackRecordingActive = true;

      this.log('📼 Started recording playback output (capturing what speakers play)');
    } catch (error) {
      this.log(`📼 Failed to start playback recording: ${error}`);
    }
  }

  /**
   * Stop recording playback output
   * Non-blocking - chunks are saved for upload
   */
  private stopPlaybackRecording(): void {
    if (!this.playbackRecorder || !this.playbackRecordingActive) {
      return;
    }

    try {
      if (this.playbackRecorder.state !== 'inactive') {
        this.playbackRecorder.stop();
      }

      this.playbackRecordingActive = false;

      this.log(`📼 Stopped playback recording (${this.playbackRecordedChunks.length} chunks captured)`);
    } catch (error) {
      this.log(`📼 Error stopping playback recording: ${error}`);
    }
  }

  /**
   * Ramp playback gain node (fast, no network requests!)
   * Applies volume ramp to playback audio in real-time
   */
  private async rampPlaybackGain(targetGain: number, duration: number): Promise<void> {
    if (!this.playbackGainNode || !this.audioContext) {
      return;
    }

    const currentTime = this.audioContext.currentTime;
    const currentGain = this.playbackGainNode.gain.value;

    this.log(`🎚️  Ramping playback gain: ${currentGain.toFixed(2)} → ${targetGain.toFixed(2)} over ${duration}ms`);

    // Cancel any previous ramps
    this.playbackGainNode.gain.cancelScheduledValues(currentTime);

    // Set current value (in case it was ramping)
    this.playbackGainNode.gain.setValueAtTime(currentGain, currentTime);

    // Ramp to target value
    this.playbackGainNode.gain.linearRampToValueAtTime(
      targetGain,
      currentTime + (duration / 1000)
    );

    // Wait for ramp to complete
    await new Promise(resolve => setTimeout(resolve, duration));
  }

  /**
   * Set speakers to target volume instantly (no ramping, just set once)
   */
  private async setSpeakersToTargetVolume(): Promise<void> {
    if (this.config.linkedSpeakers.length === 0 || !this.config.setSpeakerVolume) {
      return;
    }

    const targetVolume = this.config.targetVolume;
    this.log(`🔊 Setting ${this.config.linkedSpeakers.length} speakers to ${targetVolume}% (instant, no ramp)`);

    await Promise.all(
      this.config.linkedSpeakers.map(async (speaker) => {
        try {
          await this.config.setSpeakerVolume!(speaker.id, targetVolume);
        } catch (error) {
          this.log(`Failed to set ${speaker.name} volume: ${error}`);
        }
      })
    );
  }

  /**
   * Start monitoring playback audio levels
   */
  private startPlaybackMonitoring(): void {
    if (this.playbackMonitoringInterval) return; // Already monitoring

    this.playbackMonitoringInterval = window.setInterval(() => {
      if (!this.playbackAnalyser || !this.isPlaying) {
        // No playback active, reset level to 0
        if (this.config.onPlaybackLevelUpdate) {
          this.config.onPlaybackLevelUpdate(0);
        }
        return;
      }

      const analyser = this.playbackAnalyser;

      // Get frequency data
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freqData);

      // Get time domain data
      const timeData = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(timeData);

      // Calculate average from frequency data
      const freqAverage = freqData.reduce((a, b) => a + b, 0) / freqData.length;
      const freqLevel = Math.round((freqAverage / 255) * 100);

      // Calculate RMS from time domain data
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) {
        const normalized = (timeData[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / timeData.length);
      const timeLevel = Math.round(rms * 100);

      // Use the higher of the two
      const level = Math.max(freqLevel, timeLevel);

      // Report level to callback
      if (this.config.onPlaybackLevelUpdate) {
        this.config.onPlaybackLevelUpdate(level);
      }
    }, 50); // Update every 50ms for smooth visualization
  }

  /**
   * Stop monitoring playback audio levels
   */
  private stopPlaybackMonitoring(): void {
    if (this.playbackMonitoringInterval) {
      clearInterval(this.playbackMonitoringInterval);
      this.playbackMonitoringInterval = null;
    }

    // Reset level to 0
    if (this.config.onPlaybackLevelUpdate) {
      this.config.onPlaybackLevelUpdate(0);
    }
  }

  private async rampSpeakerVolumes(targetVolume: number): Promise<void> {
    if (!this.config.setSpeakerVolume) return;

    // Determine if we should ramp based on time of day
    const shouldRamp = this.shouldRampVolume();

    if (!shouldRamp) {
      // Day mode: Set volumes immediately
      for (const speaker of this.config.linkedSpeakers) {
        const volume = Math.min(speaker.volume, targetVolume) / 100;
        await this.config.setSpeakerVolume(speaker.id, volume);
      }
      return;
    }

    // Night mode: Ramp volumes gradually
    const steps = 10;
    const stepDelay = this.config.nightRampDuration / steps;

    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      for (const speaker of this.config.linkedSpeakers) {
        const maxVolume = Math.min(speaker.volume, targetVolume);
        const volume = (maxVolume * progress) / 100;
        await this.config.setSpeakerVolume(speaker.id, volume);
      }

      if (i < steps) {
        await new Promise(resolve => setTimeout(resolve, stepDelay));
      }
    }
  }

  private shouldRampVolume(): boolean {
    if (!this.config.rampEnabled || !this.config.dayNightMode) {
      return false;
    }

    const now = new Date();
    const hour = now.getHours();

    return hour < this.config.dayStartHour || hour >= this.config.dayEndHour;
  }

  /**
   * Check if current time is within "night" hours
   * Used for playback volume ramping
   */
  private shouldUseNightRamp(): boolean {
    const now = new Date();
    const hour = now.getHours();

    // Night time is before dayStartHour OR after/equal to dayEndHour
    return hour < this.config.dayStartHour || hour >= this.config.dayEndHour;
  }

  // ============================================================================
  // Session Completion & Upload
  // ============================================================================

  private async finishSession(): Promise<void> {
    // 🔥 Guard: Prevent double finish
    if (this.isFinishing) {
      this.log('⚠️ finishSession already in progress, skipping duplicate call');
      return;
    }
    this.isFinishing = true;

    this.log('💾 FINISHING SESSION:');

    // 🔥 CRITICAL: Reset validation state for finish phase
    // This ensures only NEW audio detected DURING finish phase causes promotion
    // The old session's audioValidated=true should not carry over
    this.audioValidated = false;
    this.validationStartTime = 0;
    this.log('🎯 Validation state reset - standby batch will only promote if NEW audio validated during finish');

    // 🛡️ HARDWARE THRASH PROTECTION: Counter persists across finish cycles
    // Only reset when we successfully reach idle (see cleanup)
    // This prevents rapid oscillation: finish→detect→activate→finish→detect→activate...

    // 🔥 CRITICAL: Invalidate session IMMEDIATELY to prevent ANY new playback
    this.sessionId++;
    this.log(`Session invalidated (now ${this.sessionId}) - no more playback allowed`);

    // Wait for playback to complete if enabled
    await this.waitForPlaybackComplete();

    // 🔒 POST-PLAYBACK GRACE: Give 750ms window for "hello" right after playback
    // This catches firefighters responding immediately after hearing the page
    this.postPlaybackGraceActive = true;
    this.log(`⏳ Post-playback grace started (${this.postPlaybackGraceDuration}ms window for emergency audio)`);

    await this.waitForPostPlaybackGrace();

    // Check if audio validated during grace window
    if (this.audioValidated) {
      this.postPlaybackGraceActive = false;
      this.log('🚨 Grace period audio validated - session promoted, hardware stays active');

      // 🔥 CRITICAL: Complete and queue the standby batch that contains the validated audio!
      if (this.currentBatch && this.currentBatch.state === BatchState.Recording) {
        const standbyBatch = this.currentBatch;
        standbyBatch.endTime = Date.now();
        standbyBatch.state = BatchState.Ready;

        // Create blob from chunks
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm;codecs=opus';
        if (this.initSegment) {
          standbyBatch.blob = new Blob([this.initSegment, ...standbyBatch.chunks], { type: mimeType });
          this.log(`🎯 Promoted batch: Added silent pre-roll (${this.initSegment.size} bytes) for standalone playback`);
        } else {
          standbyBatch.blob = new Blob(standbyBatch.chunks, { type: mimeType });
          this.log(`⚠️ Promoted batch: No init segment available, using chunks only`);
        }

        this.log(`🎯 Promoted batch complete: ${standbyBatch.duration}ms, ${standbyBatch.blob.size} bytes`);

        // Queue for playback
        if (this.config.playbackEnabled) {
          this.playbackQueue.push(standbyBatch);
          standbyBatch.state = BatchState.Queued;
          this.log(`🎯 Promoted batch queued for playback`);

          // Start playback if not already playing
          if (!this.isPlaying) {
            this.playNextBatch();
          }
        }

        // Start new batch for the promoted session
        this.startBatchRecording();
        this.log('🎯 Started new batch for promoted session');
      }

      // 🔥 LIFE-SAFETY: DO NOT reset audio validation for grace period promotion!
      // We already detected emergency audio (that's why we're promoting)
      // The promoted standby batch might be mostly empty - user's audio is in the NEXT batch
      // If we reset validation, next batch will require fresh validation → lost audio
      // Keep audioValidated=true so next batch is immediately queued when complete
      // this.audioValidated = false;  // ❌ DISABLED for grace period promotion
      // this.validationStartTime = 0;
      this.log('🔥 LIFE-SAFETY: Keeping audioValidated=true for grace period promotion');
      this.log(`   audioValidated=${this.audioValidated}, validationStartTime=${this.validationStartTime}`);

      // Don't finish - audio promoted standby batch to new session
      this.isFinishing = false;
      return;
    }

    this.log('✓ Post-playback grace window complete (no emergency audio detected)');

    // 🔒 EXTENDED GRACE: Keep grace active DURING hardware deactivation
    // This catches audio spoken during the deactivation process (ramp down, PoE off, zone switch)
    this.log('🔒 Extended grace: Monitoring during hardware deactivation...');

    // Deactivate hardware (but grace stays active!)
    await this.deactivateHardware();

    // Check again after deactivation - audio might have been detected during deactivation
    if (this.audioValidated) {
      this.postPlaybackGraceActive = false;

      // 🔥 LIFE-SAFETY: Always re-activate hardware when audio is detected
      // No limits - this is a PA/VOX system, if someone speaks, they MUST be heard
      this.log(`🚨 Audio detected during hardware deactivation - RE-ACTIVATING`);

      // 🚀 CRITICAL: Enqueue old session for upload BEFORE re-activating
      // The old session is complete - save it to upload queue (non-blocking)
      this.log('📦 Enqueueing completed session before re-activation');
      this.enqueueSessionUpload();

      // Hardware was just deactivated, need to re-activate
      await this.activateHardware();

      // 🔊 PHYSICAL DELAY: Wait for speakers to physically stabilize
      // Even though IP is changed, reloaded, and polled - speakers need time to warm up!
      this.log(`🔊 Waiting ${this.config.playbackDelay}ms for speakers to physically stabilize...`);
      await new Promise(resolve => setTimeout(resolve, this.config.playbackDelay));
      this.log('🔊 Speakers ready - proceeding with playback');

      // 🔥 CRITICAL: Restart silence monitoring for the re-activated session
      // This ensures the re-activated session has a fresh 8s silence countdown
      if (this.silenceCheckInterval) {
        clearInterval(this.silenceCheckInterval);
        this.silenceCheckInterval = null;
      }
      this.onSilence(); // Start fresh silence monitoring with updated lastAudioTime

      // 🎯 Prepare for new session: Complete and queue standby batch
      if (this.currentBatch && this.currentBatch.state === BatchState.Recording) {
        const standbyBatch = this.currentBatch;
        standbyBatch.endTime = Date.now();
        standbyBatch.state = BatchState.Ready;

        // Create blob from chunks
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm;codecs=opus';
        if (this.initSegment) {
          standbyBatch.blob = new Blob([this.initSegment, ...standbyBatch.chunks], { type: mimeType });
          this.log(`🎯 Promoted batch: Added silent pre-roll (${this.initSegment.size} bytes) for standalone playback`);
        } else {
          standbyBatch.blob = new Blob(standbyBatch.chunks, { type: mimeType });
          this.log(`⚠️ Promoted batch: No init segment available, using chunks only`);
        }

        this.log(`🎯 Promoted batch complete: ${standbyBatch.duration}ms, ${standbyBatch.blob.size} bytes`);

        // Keep standby batch for new session
        this.batches = [standbyBatch];

        // Queue for playback
        this.playbackQueue = [];
        if (this.config.playbackEnabled) {
          this.playbackQueue.push(standbyBatch);
          standbyBatch.state = BatchState.Queued;
          this.log(`🎯 Promoted batch queued for playback`);

          // Start playback if not already playing
          if (!this.isPlaying) {
            this.playNextBatch();
          }
        }

        // Start new batch for the promoted session
        this.startBatchRecording();
        this.log('🎯 Started new batch for promoted session');
      } else {
        this.batches = [];
        this.playbackQueue = [];
      }

      this.isPlaying = false;
      this.finishingSessionBatches = [];

      // 🔥 LIFE-SAFETY: DO NOT reset audio validation after extended grace hot restart!
      // We already detected emergency audio (that's why we're restarting)
      // The promoted standby batch is mostly empty - user's audio is in the NEW batch
      // If we reset validation, batch 2 will require fresh validation → cascade of new sessions
      // Keep audioValidated=true so batch 2 is immediately queued when complete
      // this.audioValidated = false;  // ❌ DISABLED for extended grace hot restart
      // this.validationStartTime = 0;
      this.log('🔥 LIFE-SAFETY: Keeping audioValidated=true for extended grace hot restart');
      this.log(`   audioValidated=${this.audioValidated}, validationStartTime=${this.validationStartTime}`);

      // Don't finish - audio promoted standby batch to new session
      this.isFinishing = false;
      return;
    }

    // All clear - no audio during grace or deactivation
    this.postPlaybackGraceActive = false;
    this.log('✓ Extended grace complete - no emergency audio during deactivation');

    // 🚀 NON-BLOCKING UPLOAD: Enqueue for background processing
    // This allows immediate return to idle standby without waiting for Firebase
    this.enqueueSessionUpload();

    // Cleanup (no longer blocked by upload!)
    await this.cleanup(true);

    this.log('✓ Session complete (upload queued for background processing)');

    // Clear console after session complete for clean slate
    console.clear();

    // Also clear the terminal where dev server is running
    try {
      await fetch('/api/clear-terminal', { method: 'POST' });
    } catch (error) {
      // Silently fail if API not available (production builds)
    }
  }

  /**
   * 🚀 BACKGROUND UPLOAD: Enqueue session for non-blocking upload
   * This saves the blob to memory and starts background upload worker
   * Returns immediately without waiting for Firebase
   */
  private enqueueSessionUpload(): void {
    // 🔄 Use finishingSessionBatches if finish-phase prebuffer was started
    // Otherwise use current batches
    const batchesToUpload = this.finishingSessionBatches.length > 0
      ? this.finishingSessionBatches
      : this.batches;

    if (batchesToUpload.length === 0) {
      this.log('No batches to upload');
      return;
    }

    // Combine all batches into single blob (fast, in-memory operation)
    // For upload, we want: silent init segment + all audio chunks (no duplicate inits)
    const mimeType = this.mediaRecorder?.mimeType || 'audio/webm;codecs=opus';

    let combinedBlob: Blob;

    if (batchesToUpload.length === 1) {
      // Single batch: use blob directly (already has silent init segment prepended)
      combinedBlob = batchesToUpload[0].blob || new Blob(batchesToUpload[0].chunks, { type: mimeType });
    } else {
      // Multiple batches: use silent init segment once + all raw chunks
      // This avoids duplicate init segments in the final recording
      const allChunks = batchesToUpload.flatMap(b => b.chunks);
      combinedBlob = this.initSegment
        ? new Blob([this.initSegment, ...allChunks], { type: mimeType })
        : new Blob(allChunks, { type: mimeType });
    }

    // Create playback recording blob if chunks exist
    let playbackBlob: Blob | undefined = undefined;
    if (this.playbackRecordedChunks.length > 0) {
      playbackBlob = new Blob(this.playbackRecordedChunks, { type: mimeType });
      this.log(`📼 Playback recording: ${playbackBlob.size} bytes (${this.playbackRecordedChunks.length} chunks)`);
    }

    // Create completed session record
    const session: CompletedSession = {
      id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      sessionNumber: this.sessionId,
      blob: combinedBlob, // Input recording (raw microphone)
      mimeType: mimeType,
      timestamp: this.firstAudioDetectionTime || Date.now(), // Use first audio detection time (PST)
      uploaded: false,
      playbackBlob, // Playback recording (what actually played)
      playbackUploaded: false,
    };

    // Add to queue
    this.completedSessions.push(session);

    this.log(`📦 Input recording queued: ${combinedBlob.size} bytes (${batchesToUpload.length} batches)`);
    if (playbackBlob) {
      this.log(`📦 Playback recording queued: ${playbackBlob.size} bytes`);
    }
    this.log(`   Queue size: ${this.completedSessions.length} session(s)`);

    // Clear finishingSessionBatches and playback chunks
    this.finishingSessionBatches = [];
    this.playbackRecordedChunks = [];

    // Start background upload worker if not already running
    if (!this.uploadInProgress) {
      this.processUploadQueue().catch(error => {
        this.log(`⚠️ Upload worker error: ${error}`);
      });
    }
  }

  /**
   * 🔄 BACKGROUND WORKER: Process upload queue asynchronously
   * Runs continuously until queue is empty
   * New calls can start while this is running!
   */
  private async processUploadQueue(): Promise<void> {
    if (this.uploadInProgress) {
      this.log('Upload worker already running');
      return;
    }

    this.uploadInProgress = true;
    this.log('🚀 Background upload worker started');

    while (true) {
      // Find next unuploaded session
      const session = this.completedSessions.find(s => !s.uploaded);

      if (!session) {
        // Queue empty
        this.log('✓ Upload queue empty, worker stopping');
        break;
      }

      // Upload input recording (raw microphone)
      if (!session.uploaded) {
        this.log(`⬆️ Uploading INPUT recording ${session.id} (${session.blob.size} bytes)...`);

        try {
          const url = await this.config.onUpload(session.blob, session.mimeType, session.timestamp);

          session.uploaded = true;
          session.uploadUrl = url;

          this.log(`✓ Input recording uploaded: ${url}`);

          this.config.onLog({
            type: 'volume_change',
            message: `🎙️ Input recording saved: ${url}`
          });

        } catch (error) {
          this.log(`⚠️ Input recording upload failed: ${error}`);

          if (this.config.onError) {
            this.config.onError(error as Error);
          }

          // Don't remove from queue - will retry on next worker start
          break;
        }
      }

      // Upload playback recording (what actually played through speakers)
      if (session.playbackBlob && !session.playbackUploaded) {
        this.log(`⬆️ Uploading PLAYBACK recording ${session.id} (${session.playbackBlob.size} bytes)...`);

        try {
          // Use same timestamp but pass isPlayback=true to append "-playback" suffix
          const url = await this.config.onUpload(session.playbackBlob, session.mimeType, session.timestamp, true);

          session.playbackUploaded = true;
          session.playbackUploadUrl = url;

          this.log(`✓ Playback recording uploaded: ${url}`);

          this.config.onLog({
            type: 'volume_change',
            message: `🔊 Playback recording saved: ${url}`
          });

        } catch (error) {
          this.log(`⚠️ Playback recording upload failed: ${error}`);

          if (this.config.onError) {
            this.config.onError(error as Error);
          }

          // Continue - don't block if playback upload fails
        }
      }
    }

    this.uploadInProgress = false;
    this.log('Upload worker stopped');
  }

  private async cleanup(success: boolean): Promise<void> {
    this.log(`Cleanup (success: ${success})`);

    // 🎯 PURIST APPROACH: Check if we have a standby batch (audio during finish phase)
    const hasStandbyBatch = this.currentBatch && this.currentBatch.state === BatchState.Recording;

    // 🎯 INVARIANT ENFORCEMENT:
    // MediaRecorder NEVER stops in cleanup - only in abort() when monitoring stops
    // This ensures zero gaps and always-listening behavior
    if (this.mediaRecorder) {
      this.log('🎯 MediaRecorder stays active (purist mode - always listening)');
    }

    // NOTE: We keep AudioContext alive for reuse across recording sessions
    // Only closed in abort() when monitoring stops completely
    // Reset timeline for next recording session
    if (this.audioContext) {
      this.nextPlaybackTime = this.audioContext.currentTime;
    }

    // 🎯 Handle standby batch (audio detected during finish phase)
    if (hasStandbyBatch && this.audioValidated) {
      // Audio was validated during finish phase → promote to new session
      this.log(`🎯 Standby batch promoted to new session (emergency audio validated)`);

      // 🔥 CRITICAL: Complete the standby batch and queue it for playback!
      // The standby batch has accumulated chunks during finish phase but hasn't been completed yet
      const standbyBatch = this.currentBatch!;
      standbyBatch.endTime = Date.now();
      standbyBatch.state = BatchState.Ready;

      // Create blob from chunks
      const mimeType = this.mediaRecorder?.mimeType || 'audio/webm;codecs=opus';
      if (this.initSegment) {
        standbyBatch.blob = new Blob([this.initSegment, ...standbyBatch.chunks], { type: mimeType });
        this.log(`🎯 Promoted batch: Added silent pre-roll (${this.initSegment.size} bytes) for standalone playback`);
      } else {
        standbyBatch.blob = new Blob(standbyBatch.chunks, { type: mimeType });
        this.log(`⚠️ Promoted batch: No init segment available, using chunks only`);
      }

      this.log(`🎯 Promoted batch complete: ${standbyBatch.duration}ms, ${standbyBatch.blob.size} bytes`);

      // Keep current batch as the promoted session
      this.batches = [standbyBatch];

      // 🔥 CRITICAL: Queue the promoted batch for playback!
      if (this.config.playbackEnabled) {
        this.playbackQueue.push(standbyBatch);
        standbyBatch.state = BatchState.Queued;
        this.log(`🎯 Promoted batch queued for playback`);
      }

      // Increment session ID for new session
      this.sessionId++;
      this.playbackGeneration++;
      this.log(`🎯 New session started (session ${this.sessionId}) - MediaRecorder continues seamlessly`);

    } else if (hasStandbyBatch && !this.audioValidated) {
      // Standby batch exists but no validated audio → discard it
      this.log(`🎯 Discarding standby batch (no validated emergency audio)`);
      this.currentBatch = null;
      this.batches = [];

    } else {
      // No standby batch
      this.batches = [];
      this.currentBatch = null;
    }

    // Clear playback state (but keep promoted batch if queued!)
    if (!hasStandbyBatch || !this.audioValidated) {
      this.playbackQueue = [];
    } else {
      this.log(`🎯 Playback queue preserved for promoted batch (${this.playbackQueue.length} batch(es))`);
    }
    this.isPlaying = false;
    this.hardwareReady = false;
    this.pagingActive = false;
    this.isFinishing = false; // Reset finish guard
    this.finishingSessionBatches = []; // Clear saved batches

    // 🛡️ Reset TailGuard state
    this.tailGuardActive = false;
    this.tailGuardStartTime = 0;

    // 🎯 Reset validation state for next session
    this.audioValidated = false;
    this.validationStartTime = 0;
    this.isPreBuffering = false;

    // NOTE: We keep this.initSegment for reuse across sessions
    // Only cleared on abort() when monitoring stops completely

    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }

    // 🎯 If standby batch was promoted, trigger hardware activation
    if (hasStandbyBatch && this.audioValidated && !this.hardwareReady) {
      await this.activateHardware().catch((error) => {
        this.log(`Hardware activation failed: ${error}`);
        if (this.config.onError) {
          this.config.onError(error);
        }
      });
    }

    // 🎯 PURIST MODE IDLE STATE:
    // Start an idle standby batch to capture ongoing chunks
    // This prevents "chunk received but no active batch" warnings
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording' && !this.currentBatch) {
      this.startBatchRecording();
      this.log('🎯 Idle standby batch started (capturing chunks silently)');
    }

    this.log('🎯 System in idle standby state (ready for next session)');
  }

  // ============================================================================
  // Silent Pre-roll Init Segment
  // ============================================================================

  /**
   * Capture a silent pre-roll to use as clean init segment
   * Records 200ms of silence when monitoring starts
   * This init segment is reused for ALL batches in ALL sessions
   * Eliminates ghost audio from header contamination
   */
  private async captureSilentPreRoll(): Promise<void> {
    this.log('📼 Capturing silent pre-roll for init segment...');

    return new Promise((resolve, reject) => {
      const mimeType = this.getBestMimeType();
      const preRollRecorder = new MediaRecorder(this.stream!, { mimeType });
      const chunks: Blob[] = [];

      preRollRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      preRollRecorder.onstop = () => {
        // Create blob from silent recording
        const silentBlob = new Blob(chunks, { type: mimeType });

        // Use this entire silent blob as the init segment
        this.initSegment = silentBlob;

        this.log(`✓ Silent pre-roll captured: ${this.initSegment.size} bytes (${chunks.length} chunks)`);
        resolve();
      };

      preRollRecorder.onerror = (error) => {
        this.log(`⚠️ Silent pre-roll capture failed: ${error}`);
        reject(error);
      };

      // Record for 200ms
      preRollRecorder.start(100); // 100ms chunks

      setTimeout(() => {
        if (preRollRecorder.state !== 'inactive') {
          preRollRecorder.stop();
        }
      }, 200); // 200ms total
    });
  }

  // ============================================================================
  // Utilities
  // ============================================================================

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

  /**
   * Setup page visibility listener to resume AudioContext when page becomes visible
   * This fixes playback issues when navigating away and back
   */
  private setupVisibilityListener(): void {
    if (typeof document === 'undefined') return; // Server-side guard

    const handleVisibilityChange = () => {
      if (!document.hidden && this.audioContext) {
        this.resumeAudioContextIfNeeded();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup on abort
    const originalAbort = this.abort.bind(this);
    this.abort = async () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      await originalAbort();
    };

    this.log('🎵 Page visibility listener setup (auto-resume when returning to page)');
  }

  /**
   * Resume AudioContext if suspended
   * Fixes playback issues when navigating between pages
   */
  private async resumeAudioContextIfNeeded(): Promise<void> {
    if (!this.audioContext) return;

    if (this.audioContext.state === 'suspended') {
      this.log('⚠️ AudioContext suspended, resuming...');
      try {
        await this.audioContext.resume();
        this.log('✓ AudioContext resumed successfully');
      } catch (error) {
        this.log(`⚠️ Failed to resume AudioContext: ${error}`);
      }
    } else if (this.audioContext.state === 'running') {
      // Already running, no action needed
    } else {
      this.log(`⚠️ AudioContext state: ${this.audioContext.state}`);
    }
  }

  private log(message: string): void {
    // 🎨 Color-coded logs for different system states

    // 🎵 Playback Events: Magenta (easy to spot when playback starts/ends)
    if (message.includes('Playing batch') ||
        message.includes('Playback complete') ||
        message.includes('playback complete')) {
      console.log(`%c[BatchCoordinator] ${message}`, 'color: #ff00ff; font-weight: bold; font-size: 14px');
    }
    // 🔥 Hot Restart / Hardware Reset: Red (critical system events)
    else if (message.includes('HOT RESTART') ||
             message.includes('Hardware reset') ||
             message.includes('Forcing ALL speakers') ||
             message.includes('Step 1') ||
             message.includes('Step 2') ||
             message.includes('Step 3') ||
             message.includes('Step 4')) {
      console.log(`%c[BatchCoordinator] ${message}`, 'color: #ff0000; font-weight: bold; font-size: 14px');
    }
    // 📼 Recording Status: Yellow (shows recording is active)
    else if (message.includes('Recording continues') ||
             message.includes('Batch') && message.includes('complete:') ||
             message.includes('Started recording')) {
      console.log(`%c[BatchCoordinator] ${message}`, 'color: #ffff00; font-weight: bold');
    }
    // 🛡️ TailGuard: Orange (watching for emergency audio after silence)
    else if (message.includes('TailGuard') || message.includes('🛡️')) {
      console.log(`%c[BatchCoordinator] ${message}`, 'color: #ff9500; font-weight: bold');
    }
    // 🔒 Grace Period: Cyan (post-playback window for "hello" responses)
    else if (message.includes('Grace') || message.includes('grace') || message.includes('🔒')) {
      console.log(`%c[BatchCoordinator] ${message}`, 'color: #00d4ff; font-weight: bold; font-size: 13px');
    }
    // 🟢 Idle Standby: Green (system ready, listening)
    else if (message.includes('System in idle standby state') ||
        message.includes('Idle standby batch started') ||
        message.includes('Session complete')) {
      console.log(`%c[BatchCoordinator] ${message}`, 'color: #00ff00; font-weight: bold');
    }
    // 📦 Upload Events: Blue (background uploads)
    else if (message.includes('queued for upload') ||
             message.includes('Upload') ||
             message.includes('upload')) {
      console.log(`%c[BatchCoordinator] ${message}`, 'color: #0099ff; font-weight: bold');
    }
    // Default: White
    else {
      console.log(`[BatchCoordinator] ${message}`);
    }
  }
}
