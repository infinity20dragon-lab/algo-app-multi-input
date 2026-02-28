/**
 * SimpleRecorder - Live audio monitoring and playback
 *
 * Three independent pipelines:
 * 1. Recording - MediaRecorder batches, session boundaries via silence timeout
 * 2. Playback - PCM ring buffer → ScriptProcessorNode, hardware lifecycle
 * 3. Saving - frozen session snapshots, async upload with retry
 *
 * INVARIANTS (NEVER VIOLATE):
 * - Recording NEVER waits for playback
 * - Playback NEVER decides what gets recorded
 * - Hardware delays ONLY block playback, NEVER recording
 * - Batch queue is append-only, FIFO, never cleared except after playback
 * - Session metadata created at FIRST AUDIO DETECTION (not playback time)
 */

import { RingBuffer } from './ring-buffer';

// ============================================================================
// Types
// ============================================================================

interface AudioBatch {
  id: string;
  blob: Blob; // For playback (init segment + chunks)
  chunks: Blob[]; // Raw chunks (for saving without init segment duplication)
  duration: number;
  timestamp: number; // When batch was sealed
  sessionId: string; // Reference to session metadata
}

interface SessionMetadata {
  sessionId: string;
  firstDetectedAt: string; // ISO 8601 in PST
  timezone: string;
  firstBatchId: string;
  batches: AudioBatch[];
  playbackStartTime?: number;
  playbackEndTime?: number;
}

interface SaveQueueItem {
  session: SessionMetadata;
  retryCount: number;
  lastAttempt?: number;
}

// Multi-input channel types
type InputChannelType = 'medical' | 'fire' | 'allCall';

// One item in the per-channel FIFO playback queue
interface PlaybackQueueItem {
  sessionId: string;
  channel: InputChannelType;
  drainTarget: number;   // Samples remaining to play (set when recording stops)
  isComplete: boolean;   // true = recording stopped (silence timeout reached)
  playbackStarted: boolean; // true = delay period satisfied, actively draining
}

interface SimpleRecorderConfig {
  // Multi-Input Mode (NEW)
  multiInputMode?: boolean; // Enable three-input mode (medical, fire, allCall)

  // Audio settings
  batchDuration?: number; // Default: 5000ms
  silenceTimeout?: number; // CONFIGURABLE: 0-30000ms (when to stop batching after silence)
                          // 0ms = stop immediately (new session per pause)
                          // Higher = more forgiving pauses in same session
  audioThreshold?: number; // Audio level threshold (0-100) to trigger voice detection (default: 5)
  sustainDuration?: number; // How long audio must stay above threshold (ms) before triggering (default: 500)

  // Hardware settings
  linkedSpeakers: any[]; // Algo speakers to control (all zones, fallback when zoning disabled)
  pagingDevice: any; // Paging device
  playbackDelay?: number; // Delay before playback starts (for speaker stabilization)
  hardwareGracePeriod?: number; // How long to keep speakers active after session ends before deactivating (default: 5000ms)

  // Zone-aware playback (multi-input mode)
  // When enabled, activates only speakers for the channel's zone instead of all speakers.
  zonedPlayback?: boolean;
  speakersByChannel?: {
    medical: any[];   // Speakers that should activate for medical calls
    fire: any[];      // Speakers that should activate for fire calls
    allCall: any[];   // Speakers that should activate for all-call
  };

  // Playback Volume Ramping (Web Audio API - non-blocking)
  playbackVolume?: number; // Static playback volume (0.0 - 2.0) when NOT ramping
  playbackRampEnabled?: boolean; // Enable volume ramping per session
  playbackRampStartVolume?: number; // Starting volume (0.0 - 2.0)
  playbackRampTargetVolume?: number; // Target volume (0.0 - 2.0)
  playbackRampDuration?: number; // Ramp duration in ms
  playbackRampScheduleEnabled?: boolean; // Enable time-based ramping schedule
  playbackRampStartHour?: number; // Start hour for ramping (0-23.5, supports half hours)
  playbackRampEndHour?: number; // End hour for ramping (0-23.5, supports half hours)

  // Emulation Mode (for testing without physical devices)
  emulationMode?: boolean; // Skip actual network calls
  emulationNetworkDelay?: number; // Simulate network delay in ms

  // Saving
  saveRecording?: boolean;
  uploadCallback?: (blob: Blob, filename: string, sessionId: string) => Promise<string>;

  // Callbacks
  onLog?: (message: string, type: 'info' | 'error' | 'warning') => void;
  onError?: (error: Error) => void;
  onAudioLevel?: (level: number) => void;
  onPlaybackLevel?: (level: number) => void;

  // Multi-Input Callbacks (only used when multiInputMode = true)
  onMedicalAudioLevel?: (level: number) => void;
  onFireAudioLevel?: (level: number) => void;
  onAllCallAudioLevel?: (level: number) => void;

  // Hardware Control Callbacks
  setSpeakerZoneIP?: (speakers: any[], zoneIP: string) => Promise<void>; // Set mcast.zone1 IP:port
  setSpeakerVolume?: (speakerId: string, volumePercent: number) => Promise<void>;
  controlPoEDevices?: (enable: boolean) => Promise<void>; // Enable/disable PoE devices (lights, etc.)
}

// Internal config type with required properties
type InternalConfig = Required<Pick<SimpleRecorderConfig, 'batchDuration' | 'silenceTimeout' | 'playbackDelay' | 'saveRecording' | 'emulationMode' | 'emulationNetworkDelay'>> &
  Omit<SimpleRecorderConfig, 'batchDuration' | 'silenceTimeout' | 'playbackDelay' | 'saveRecording' | 'emulationMode' | 'emulationNetworkDelay'>;

// ============================================================================
// Hardware State Management
// ============================================================================

/**
 * Speaker Lifecycle State Machine
 *
 * OFF  → ACTIVATING → WAKING  → STABLE  → PLAYING  → DRAINING → OFF
 *
 * IDLE/OFF:       Speakers off, no white noise. Default state.
 * ACTIVATING:     API call in flight to set zone IP.
 * WAKING:         Zone set, speakers powered on. White noise expected. Playback MUTED.
 * STABLE:         Warmup timer elapsed, noise settled. Safe to unmute. Waiting for buffer.
 * PLAYING:        Buffer threshold met. PCM flowing. Speakers hearing audio.
 * DRAINING:       No new audio. Buffer draining. Idle timer running before shutdown.
 */
enum HardwareState {
  IDLE = 'IDLE',
  ACTIVATING = 'ACTIVATING',
  WAKING = 'WAKING',       // Speakers powered on, warmup period (white noise)
  STABLE = 'STABLE',       // Warmup done, safe to unmute, waiting for buffer
  PLAYING = 'PLAYING',     // Audio flowing to speakers
  DRAINING = 'DRAINING',   // Buffer draining, idle timer running
  DEACTIVATING = 'DEACTIVATING'
}

// ============================================================================
// SimpleRecorder Class
// ============================================================================

export class SimpleRecorder {
  // Configuration
  private config: InternalConfig;

  // Audio Input (recording) - Single input mode
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private audioLevelInterval: number | null = null;

  // Multi-Input Mode - Three independent recording pipelines
  private streams: Map<InputChannelType, MediaStream> = new Map();
  private mediaRecorders: Map<InputChannelType, MediaRecorder> = new Map();
  private analyserNodes: Map<InputChannelType, AnalyserNode> = new Map();
  private sourceNodes: Map<InputChannelType, MediaStreamAudioSourceNode> = new Map();
  private audioLevelIntervals: Map<InputChannelType, number> = new Map();
  private currentChannelSessions: Map<InputChannelType, string | null> = new Map(); // Track active session per channel
  private pcmWorkletNodes: Map<InputChannelType, AudioWorkletNode> = new Map(); // One worklet per input (multi-input mode)

  // PCM Capture (for live playback - bypasses encoding) - Single input mode
  private pcmWorkletNode: AudioWorkletNode | null = null;
  private pcmRingBuffer: RingBuffer | null = null; // Single-input mode ring buffer
  private pcmPlaybackNode: ScriptProcessorNode | null = null; // Continuous audio callback
  private pcmPlaybackEnabled: boolean = false;
  private pcmPlaybackStarted: boolean = false; // Track if delay period has passed (single-input mode)
  private pcmSessionRamped: boolean = false; // Track if this session has been ramped (only ramp once per session)
  private hasReceivedRealAudio: boolean = false; // Track if worklet has received non-zero audio samples

  // Multi-Input PCM playback (per-channel ring buffers + FIFO queue)
  private isMultiInputMode: boolean = false;
  private channelRingBuffers: Map<InputChannelType, RingBuffer> = new Map(); // One ring buffer per channel
  private playbackQueue: PlaybackQueueItem[] = []; // FIFO queue of sessions to play
  private currentPlaybackItem: PlaybackQueueItem | null = null; // Currently draining item
  private lastPlaybackChannel: InputChannelType | null = null; // For zone-switch optimization
  private emptyBufferCallbackCount: number = 0; // Safety: counts consecutive empty-buffer pulls for stuck detection

  // Audio Output (playback monitoring)
  private playbackAnalyserNode: AnalyserNode | null = null;
  private playbackGainNode: GainNode | null = null;
  private playbackLevelInterval: number | null = null;
  private desiredPlaybackVolume: number = 1.0; // Track desired volume even when GainNode doesn't exist
  // Recording Loop State
  private isMonitoring: boolean = false;
  private isBatching: boolean = false; // Are we currently creating batches?
  private currentBatch: AudioBatch | null = null;
  private currentChunks: Blob[] = [];
  private batchStartTime: number = 0;
  private lastAudioTime: number = 0;

  // WebM Initialization Segment (200ms silent pre-roll for ALL batches)
  private initSegment: Blob | null = null;

  // Session Metadata
  private currentSessionId: string | null = null; // Current active session ID
  private currentSessionMeta: SessionMetadata | null = null;
  private sessionMetaStore: Map<string, SessionMetadata> = new Map();

  // Hardware State
  private hardwareState: HardwareState = HardwareState.IDLE;
  private hardwareTransitionAbort: (() => void) | null = null; // To cancel deactivation if needed
  private sessionDrainTarget: number = 0; // Samples remaining to play before session is fully drained (silence keeps buffer filled, so we track session end explicitly)
  private activeBatchingChannels: number = 0; // Count of currently recording channels (multi-input mode)

  // Save Queue (max 100 sessions)
  private saveQueue: SaveQueueItem[] = [];
  private readonly MAX_SAVE_SESSIONS = 100;
  private isSaving: boolean = false;

  // Silence detection
  private silenceCheckInterval: number | null = null;

  // Batch duration monitoring (manual flush at clean Opus boundaries)
  private batchDurationMonitorInterval: number | null = null;

  // Hardware idle timer (deactivate speakers after grace period)
  private hardwareIdleTimer: number | null = null;

  // Audio threshold and sustain detection
  private audioAboveThresholdStart: number | null = null; // When audio first went above threshold
  private isAudioSustained: boolean = false; // Has audio been sustained long enough?

  // Status logging
  private statusLogInterval: number | null = null;
  private lastLoggedAudioLevel: number = 0;

  constructor(config: SimpleRecorderConfig) {
    this.config = {
      batchDuration: 5000,
      silenceTimeout: 8000,
      playbackDelay: 4000,
      audioThreshold: 0, // 0 = capture everything (no threshold)
      sustainDuration: 0, // User controls this via settings
      saveRecording: true,
      emulationMode: false,
      emulationNetworkDelay: 0,
      ...config,
    };

    // Initialize desired playback volume from config (defaults to 1.0 if not provided)
    this.desiredPlaybackVolume = this.config.playbackVolume ?? 1.0;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  async start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    this.isMonitoring = true;

    this.log('SimpleRecorder started - monitoring active');

    // Close any existing AudioContext before creating a new one (prevents duplicate playback nodes)
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.log('⚠️ Closing stale AudioContext before creating new one...');
      try {
        await this.audioContext.close();
      } catch (error) {
        this.log(`⚠️ Error closing stale AudioContext: ${error}`, 'warning');
      }
      this.audioContext = null;
    }

    // Initialize AudioContext for playback AND audio level monitoring
    this.audioContext = new AudioContext();
    this.log(`🎧 AudioContext: ${this.audioContext.sampleRate}Hz sample rate`);
    this.log(`🎧 AudioContext state: ${this.audioContext.state}`);

    // Resume AudioContext if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      this.log('⚠️  AudioContext suspended - attempting resume...');
      this.audioContext.resume().then(() => {
        this.log(`✓ AudioContext resumed - state: ${this.audioContext!.state}`);
      }).catch((error) => {
        this.log(`❌ Failed to resume AudioContext: ${error}`, 'error');
      });
    }

    // 🎯 Load AudioWorklet for PCM capture (bypass encoding)
    try {
      await this.audioContext.audioWorklet.addModule('/audio/pcm-capture.worklet.js');
      this.log('✓ PCM AudioWorklet loaded');
    } catch (error) {
      this.log(`⚠️ Failed to load PCM worklet: ${error}`, 'warning');
    }

    // Set up INPUT audio level monitoring (for recording)
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.sourceNode.connect(this.analyserNode);

    // 🔥 Set up PCM capture (TAP ONLY - no playback yet)
    try {
      this.pcmWorkletNode = new AudioWorkletNode(this.audioContext, 'pcm-capture');

      // Create TRUE ring buffer (60 seconds for worst-case hardware delays + network issues)
      // 60s @ 48kHz mono Float32 = 11.52 MB (acceptable for emergency paging)
      const bufferDuration = 60; // seconds (absolute maximum for valid audio)
      const bufferSize = Math.floor(this.audioContext.sampleRate * bufferDuration);
      this.pcmRingBuffer = new RingBuffer(bufferSize);
      this.log(`✓ PCM ring buffer created: ${bufferDuration}s (${bufferSize} samples = ${(bufferSize * 4 / 1024 / 1024).toFixed(2)} MB)`);

      // 🔥 CRITICAL: Connect analyser → worklet (not source → worklet!)
      // Audio must flow THROUGH the graph for worklet to receive samples
      this.analyserNode.connect(this.pcmWorkletNode);

      // Handle PCM samples - push to TRUE ring buffer
      let messageCount = 0;
      let lastNonZeroPeak = 0;
      let lastNonZeroTime = 0;

      this.pcmWorkletNode.port.onmessage = (event) => {
        messageCount++;

        if (this.pcmRingBuffer) {
          const samples = event.data.samples as Float32Array;
          const peak = Math.max(...Array.from(samples).map(Math.abs));

          // Track non-zero peaks
          if (peak > 0.0001) {
            lastNonZeroPeak = peak;
            lastNonZeroTime = Date.now();

            // Flag that we've received real audio (not just silence/zeros)
            if (!this.hasReceivedRealAudio) {
              this.hasReceivedRealAudio = true;
              this.log(`🎤 First real audio detected in worklet! (peak: ${peak.toFixed(4)})`);
            }
          }

          // Log first message only (reduced spam)
          if (messageCount === 1) {
            this.log(`🎤 PCM Worklet: First message received (${samples?.length} samples, peak: ${peak.toFixed(4)})`);
          }
          // Removed: every 100th message logging (too spammy)

          // Push samples to ring buffer (logging removed to reduce spam)
          this.pcmRingBuffer.push(samples);
        } else {
          if (messageCount === 1) {
            this.log(`⚠️ PCM Worklet: Ring buffer is null!`);
          }
        }
      };

      this.log('✓ PCM capture pipeline initialized');
    } catch (error) {
      this.log(`⚠️ PCM capture failed: ${error}`, 'warning');
    }

    // Log input device info
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      const track = audioTracks[0];
      const settings = track.getSettings();
      this.log(`🎤 Input Device: ${track.label}`);
      this.log(`   Sample Rate: ${settings.sampleRate}Hz`);
      this.log(`   Channels: ${settings.channelCount}`);
    }

    // Set up OUTPUT audio level monitoring (for playback)
    this.playbackAnalyserNode = this.audioContext.createAnalyser();
    this.playbackAnalyserNode.fftSize = 256;

    // Set up GainNode for volume control
    this.playbackGainNode = this.audioContext.createGain();
    this.playbackGainNode.gain.value = this.desiredPlaybackVolume; // Use saved volume from slider

    // 🔥 CRITICAL: Connect playback chain - GainNode → Analyser → Destination
    // PCM sources will connect → GainNode, so we need this chain ready
    this.playbackGainNode.connect(this.playbackAnalyserNode);
    this.playbackAnalyserNode.connect(this.audioContext.destination);
    this.log(`🔊 Playback chain connected: GainNode (${(this.desiredPlaybackVolume * 100).toFixed(0)}%) → Analyser → Speakers`);

    // 🔥 Start ScriptProcessor ONCE at init. It outputs silence until hardware is
    // ready and ring buffer fills past the delay threshold. Never auto-stops.
    this.startPCMPlayback();

    // 🔥 Capture 200ms silent pre-roll for init segment (LIKE BATCH COORDINATOR)
    // IMPORTANT: Start monitoring when quiet (no "eh" sounds)!
    // This 200ms of SILENCE becomes the init segment for ALL batches
    await this.captureSilentPreRoll();

    // Start audio level monitoring loops
    this.startAudioLevelMonitoring();
    this.startPlaybackLevelMonitoring();

    // Start status logging (DISABLED - causes spam and memory leak)
    // this.startStatusLogging();

    // Start monitoring loop (always on)
    this.startMonitoringLoop();

    // Start save worker (if enabled)
    if (this.config.saveRecording) {
      this.startSaveWorker();
    }
  }

  /**
   * Start multi-input monitoring (three independent inputs: medical, fire, allCall)
   * All three inputs share the same PCM ring buffer and playback system
   * Streams can be null for disabled inputs
   */
  async startMultiInput(
    medicalStream: MediaStream | null,
    fireStream: MediaStream | null,
    allCallStream: MediaStream | null
  ): Promise<void> {
    this.isMonitoring = true;
    this.log('🎯 ═══════════════════════════════════════');
    this.log('🎯 MULTI-INPUT MODE STARTING');
    this.log('🎯 Three inputs: MEDICAL, FIRE, ALL-CALL');
    this.log('🎯 ═══════════════════════════════════════');

    // Store streams (only non-null)
    if (medicalStream) this.streams.set('medical', medicalStream);
    if (fireStream) this.streams.set('fire', fireStream);
    if (allCallStream) this.streams.set('allCall', allCallStream);

    // Log enabled inputs
    const enabledInputs = [];
    if (medicalStream) enabledInputs.push('MEDICAL');
    if (fireStream) enabledInputs.push('FIRE');
    if (allCallStream) enabledInputs.push('ALL-CALL');
    this.log(`🎯 Enabled inputs: ${enabledInputs.join(', ')}`);

    if (enabledInputs.length === 0) {
      throw new Error('At least one input must be enabled');
    }

    // Close any existing AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.log('⚠️ Closing stale AudioContext...');
      try {
        await this.audioContext.close();
      } catch (error) {
        this.log(`⚠️ Error closing AudioContext: ${error}`, 'warning');
      }
      this.audioContext = null;
    }

    // Create shared AudioContext
    this.audioContext = new AudioContext();
    this.log(`🎧 Shared AudioContext: ${this.audioContext.sampleRate}Hz`);

    // Resume if suspended
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
      this.log(`✓ AudioContext resumed`);
    }

    // Load PCM worklet
    try {
      await this.audioContext.audioWorklet.addModule('/audio/pcm-capture.worklet.js');
      this.log('✓ PCM AudioWorklet loaded');
    } catch (error) {
      this.log(`⚠️ Failed to load PCM worklet: ${error}`, 'warning');
    }

    // Create PER-CHANNEL ring buffers (each input has its own buffer for FIFO playback queue)
    this.isMultiInputMode = true;
    const bufferDuration = 60; // seconds per channel
    const bufferSize = Math.floor(this.audioContext.sampleRate * bufferDuration);
    const channels: InputChannelType[] = ['medical', 'fire', 'allCall'];
    for (const ch of channels) {
      this.channelRingBuffers.set(ch, new RingBuffer(bufferSize));
    }
    this.log(`✓ Per-channel PCM ring buffers: ${bufferDuration}s each (${(bufferSize * 4 / 1024 / 1024).toFixed(2)} MB × 3)`);

    // Set up recording pipelines (only for enabled inputs)
    if (medicalStream) await this.setupInputPipeline('medical', medicalStream);
    if (fireStream) await this.setupInputPipeline('fire', fireStream);
    if (allCallStream) await this.setupInputPipeline('allCall', allCallStream);

    // Set up SHARED playback output pipeline
    this.playbackGainNode = this.audioContext.createGain();
    this.playbackGainNode.gain.value = this.desiredPlaybackVolume;

    this.playbackAnalyserNode = this.audioContext.createAnalyser();
    this.playbackAnalyserNode.fftSize = 256;

    this.playbackGainNode.connect(this.playbackAnalyserNode);
    this.playbackAnalyserNode.connect(this.audioContext.destination);

    // Start SHARED PCM playback (drains from shared ring buffer)
    this.startPCMPlayback();

    // NOTE: Skip captureSilentPreRoll in multi-input mode
    // Each MediaRecorder will create its own init segment when it starts

    // Start monitoring loops for each input
    this.startMultiInputAudioLevelMonitoring();
    this.startPlaybackLevelMonitoring();
    this.startMultiInputMonitoringLoop();

    // Start save worker
    if (this.config.saveRecording) {
      this.startSaveWorker();
    }

    this.log('✅ Multi-input monitoring started');
  }

  async stop(): Promise<void> {
    this.log('🛑 ═══════════════════════════════════════');
    this.log('🛑 FORCE STOPPING SimpleRecorder');
    this.log('🛑 TOTAL SHUTDOWN - NO WAITING');
    this.log('🛑 ═══════════════════════════════════════');
    this.isMonitoring = false;

    // Stop all intervals immediately
    if (this.statusLogInterval) {
      clearInterval(this.statusLogInterval);
      this.statusLogInterval = null;
      this.log('✓ Status logging stopped');
    }

    if (this.audioLevelInterval) {
      clearInterval(this.audioLevelInterval);
      this.audioLevelInterval = null;
      this.log('✓ Audio level monitoring stopped');
    }

    if (this.playbackLevelInterval) {
      clearInterval(this.playbackLevelInterval);
      this.playbackLevelInterval = null;
      this.log('✓ Playback level monitoring stopped');
    }

    if (this.silenceCheckInterval) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
      this.log('✓ Silence detection stopped');
    }

    if (this.batchDurationMonitorInterval) {
      clearInterval(this.batchDurationMonitorInterval);
      this.batchDurationMonitorInterval = null;
      this.log('✓ Batch duration monitor stopped');
    }

    if (this.hardwareIdleTimer) {
      clearTimeout(this.hardwareIdleTimer);
      this.hardwareIdleTimer = null;
      this.log('✓ Hardware idle timer cleared');
    }

    // FORCE STOP batching (no sealing, no waiting)
    if (this.isBatching) {
      this.isBatching = false;
      this.log('🛑 FORCE stopped batching');
    }

    // FORCE STOP MediaRecorder
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.log('🛑 FORCE stopping MediaRecorder...');
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    }

    // FORCE STOP PCM playback
    this.stopPCMPlayback();

    // FORCE CLEAR save queue (NO WAITING)
    if (this.saveQueue.length > 0) {
      this.log(`🗑️  FORCE clearing save queue (${this.saveQueue.length} sessions dropped)`);
      this.saveQueue = [];
    }

    // Clear current batch
    this.currentBatch = null;
    this.currentChunks = [];

    // FORCE deactivate hardware (set to idle Zone 2 / .50022)
    this.log('🛑 FORCE deactivating hardware...');
    await this.deactivateHardware();

    // Cleanup audio nodes
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }

    if (this.pcmWorkletNode) {
      this.pcmWorkletNode.disconnect();
      this.pcmWorkletNode = null;
    }

    if (this.playbackGainNode) {
      this.playbackGainNode.disconnect();
      this.playbackGainNode = null;
    }

    if (this.playbackAnalyserNode) {
      this.playbackAnalyserNode.disconnect();
      this.playbackAnalyserNode = null;
    }

    // Cleanup AudioContext
    if (this.audioContext) {
      this.log('🔇 Closing AudioContext...');
      await this.audioContext.close();
      this.audioContext = null;
    }

    // Clear session metadata
    this.currentSessionMeta = null;
    this.sessionMetaStore.clear();

    // Clear init segment (monitoring stopped completely)
    this.initSegment = null;
    this.log('🗑️  Cleared silent pre-roll init segment');

    this.log('✅ TOTAL SHUTDOWN COMPLETE');
    this.log('✅ All queues cleared, hardware idle');
  }

  // Called by audio monitoring when audio level changes
  onAudioDetected(level: number): void {
    this.lastAudioTime = Date.now();

    // If not batching, start batching (for storage) + trigger hardware activation.
    // PCM playback ScriptProcessor is already running (started in start()) — it
    // outputs silence until hardware reaches STABLE and ring buffer fills.
    if (!this.isBatching && this.isMonitoring) {
      this.log(`🎯 Starting batching (audio detected at level ${level})`);
      this.startBatching();

      // Activate hardware asynchronously
      this.ensureHardwareActive().then(() => {
        this.log('✓ Hardware activation complete');
      }).catch((error) => {
        this.log(`❌ Hardware activation failed: ${error}`, 'error');
      });
    }
  }

  // Set zoned playback at runtime (no restart needed)
  // Called automatically when day/night schedule crosses the boundary
  setZonedPlayback(enabled: boolean): void {
    this.config.zonedPlayback = enabled;
    // Reset lastPlaybackChannel so next activation re-evaluates which speakers to use
    this.lastPlaybackChannel = null;
    this.log(`🗺️ Zoned playback ${enabled ? 'ENABLED — night mode (channel-specific zones)' : 'DISABLED — day mode (all speakers)'}`);
  }

  // Set playback volume (0.0 = mute, 1.0 = 100%, 2.0 = 200%)
  setPlaybackVolume(volume: number): void {
    // Save desired volume
    this.desiredPlaybackVolume = volume;

    // Apply immediately if GainNode exists
    if (this.playbackGainNode) {
      this.playbackGainNode.gain.value = volume;
      this.log(`🔊 Playback volume updated: ${(volume * 100).toFixed(0)}%`);
    } else {
      this.log(`🔊 Playback volume saved: ${(volume * 100).toFixed(0)}% (will apply when monitoring starts)`);
    }
  }

  // Check if current time is within the ramp time window (PST timezone)
  private isWithinRampWindow(): boolean {
    // If schedule not enabled, always allow ramping (if playbackRampEnabled is true)
    if (!this.config.playbackRampScheduleEnabled) {
      return true;
    }

    // Get current PST time
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const currentTime = hour + (minute / 60); // Convert to decimal hours (e.g., 18.5 = 6:30 PM)

    const startHour = this.config.playbackRampStartHour ?? 18; // Default 6:00 PM
    const endHour = this.config.playbackRampEndHour ?? 6; // Default 6:00 AM

    // Check if we're within the window (handles overnight ranges like 18:00 - 6:00)
    if (startHour < endHour) {
      // Same day range (e.g., 8:00 AM - 5:00 PM)
      return currentTime >= startHour && currentTime < endHour;
    } else {
      // Overnight range (e.g., 6:00 PM - 6:00 AM)
      return currentTime >= startHour || currentTime < endHour;
    }
  }

  // Initialize hardware to idle state with configured volume
  async initializeHardware(): Promise<void> {
    this.log('🎛️ ═══════════════════════════════════════');
    this.log('🎛️ HARDWARE INITIALIZATION START');
    this.log('🎛️ ═══════════════════════════════════════');

    const linkedSpeakers = this.config.linkedSpeakers || [];

    if (linkedSpeakers.length === 0) {
      this.log('⚠️  No linked speakers configured - skipping initialization');
      this.log('🎛️ ═══════════════════════════════════════');
      return;
    }

    this.log(`📢 Paging Device: ${this.config.pagingDevice?.name || 'N/A'} (NEVER CONTROLLED)`);
    this.log(`🔊 Linked Speakers: ${linkedSpeakers.length}`);
    this.log(`🌐 Zone IP: 224.0.2.60:50022 (IDLE - paging not sending here)`);
    this.log('');

    try {
      // Set all speakers' mcast.zone1 to idle IP (in parallel)
      this.log(`Setting ${linkedSpeakers.length} speakers' mcast.zone1 to 224.0.2.60:50022 (in parallel)...`);
      if (this.config.setSpeakerZoneIP) {
        await this.config.setSpeakerZoneIP(linkedSpeakers, '224.0.2.60:50022');
      }
      this.log(`✓ All speakers' zone IP set to 224.0.2.60:50022`);
      this.log('');

      // Set volume for each speaker using its maxVolume from /live-v2 page (in parallel)
      this.log(`Setting individual volumes for ${linkedSpeakers.length} speakers (in parallel)...`);
      if (this.config.setSpeakerVolume) {
        await Promise.all(
          linkedSpeakers.map(speaker => {
            const maxVolume = speaker.maxVolume ?? 100; // Use speaker's maxVolume from /live-v2
            return this.config.setSpeakerVolume!(speaker.id, maxVolume);
          })
        );
      }
      this.log(`✓ All speakers' volumes set to their configured levels`);
      this.log('');

      // Show each speaker's maxVolume and corresponding level
      linkedSpeakers.forEach(speaker => {
        const maxVolume = speaker.maxVolume ?? 100;
        const level = Math.round((maxVolume / 100) * 10);
        const dB = (level - 10) * 3;
        const dbString = dB === 0 ? "0dB" : `${dB}dB`;
        this.log(`   ${speaker.name}: ${maxVolume}% (Level ${level} = ${dbString})`);
      });
      this.log('');

      this.log('✅ All speakers initialized successfully');
      this.log(`   • ${linkedSpeakers.length} speaker${linkedSpeakers.length !== 1 ? 's' : ''} zone set to IDLE`);
      this.log(`   • Volumes: Individual per speaker`);
      this.log(`   • mcast.zone1: 224.0.2.60:50022 (idle)`);
      this.log('🎛️ ═══════════════════════════════════════');
      this.log('🎛️ HARDWARE INITIALIZATION COMPLETE');
      this.log('🎛️ ═══════════════════════════════════════');
    } catch (error) {
      this.log(`❌ Hardware initialization failed: ${error}`, 'error');
      this.log('🎛️ ═══════════════════════════════════════');
      throw error;
    }
  }

  // ============================================================================
  // Silent Pre-Roll Init Segment (EXACTLY LIKE BATCH COORDINATOR)
  // ============================================================================

  /**
   * Capture a silent pre-roll to use as clean init segment
   * Records 200ms of silence when monitoring starts
   * This init segment is reused for ALL batches in ALL sessions
   * Eliminates ghost audio from header contamination
   */
  private async captureSilentPreRoll(): Promise<void> {
    this.log('📼 ═══════════════════════════════════════');
    this.log('📼 CAPTURING SILENT PRE-ROLL (200ms)');
    this.log('📼 ═══════════════════════════════════════');

    return new Promise((resolve, reject) => {
      const mimeType = this.getBestMimeType();
      const preRollRecorder = new MediaRecorder(this.stream!, {
        mimeType,
        audioBitsPerSecond: 128000, // 128kbps for high quality
      });
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

        const sizeKB = (this.initSegment.size / 1024).toFixed(2);
        this.log(`✅ Silent pre-roll captured: ${sizeKB} KB (${chunks.length} chunks)`);
        this.log('📼 This init segment will be prepended to ALL batches');
        this.log('📼 ═══════════════════════════════════════');
        resolve();
      };

      preRollRecorder.onerror = (error) => {
        this.log(`❌ Silent pre-roll capture failed: ${error}`, 'error');
        reject(error);
      };

      // Record for 200ms (100ms chunks)
      preRollRecorder.start(100);

      setTimeout(() => {
        if (preRollRecorder.state !== 'inactive') {
          preRollRecorder.stop();
        }
      }, 200); // 200ms total
    });
  }


  // ============================================================================
  // Audio Level Monitoring
  // ============================================================================

  private startAudioLevelMonitoring(): void {
    this.log('🎧 Audio level monitoring started');

    this.audioLevelInterval = window.setInterval(() => {
      if (!this.analyserNode || !this.isMonitoring) return;

      const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.analyserNode.getByteFrequencyData(dataArray);

      // Calculate average level
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const level = Math.round((average / 255) * 100);

      const threshold = this.config.audioThreshold ?? 0;
      const sustainDuration = this.config.sustainDuration ?? 0;

      // Check if audio is above threshold
      const isAboveThreshold = level > threshold;

      // Track sustain duration
      const now = Date.now();
      if (isAboveThreshold) {
        if (!this.audioAboveThresholdStart) {
          // Audio just went above threshold — clear accumulated idle silence now,
          // before any real audio enters the buffer during the sustain window
          if (this.hardwareState === HardwareState.IDLE && this.pcmRingBuffer) {
            this.pcmRingBuffer.clear();
            this.log('🧹 Ring buffer cleared (accumulated silence from idle period)');
          }
          this.audioAboveThresholdStart = now;

          // If sustain duration is 0ms, trigger immediately
          if (sustainDuration === 0) {
            this.isAudioSustained = true;
          } else {
            this.isAudioSustained = false;
          }
        } else if (!this.isAudioSustained && sustainDuration > 0) {
          // Check if sustained long enough
          const duration = now - this.audioAboveThresholdStart;
          if (duration >= sustainDuration) {
            this.isAudioSustained = true;
            this.log(`🎤 Audio sustained for ${duration}ms - VOICE DETECTED (threshold: ${threshold}%, sustain: ${sustainDuration}ms)`);
          }
        }
      } else {
        // Audio dropped below threshold - reset
        this.audioAboveThresholdStart = null;
        this.isAudioSustained = false;
      }

      // Audio level logging removed to reduce spam
      // (UI still gets updates via onAudioLevel callback)

      // Notify audio level callback for UI
      if (this.config.onAudioLevel) {
        this.config.onAudioLevel(level);
      }

      // Auto-trigger onAudioDetected for batching if sustained
      if (this.isAudioSustained) {
        this.onAudioDetected(level);
      }
    }, 50); // Check every 50ms
  }

  // ============================================================================
  // Status Logging (Real-time State Visibility)
  // ============================================================================

  private startStatusLogging(): void {
    this.statusLogInterval = window.setInterval(() => {
      if (!this.isMonitoring) return;

      const status = [
        `📊 STATUS:`,
        `Monitoring=${this.isMonitoring}`,
        `Batching=${this.isBatching}`,
        `SaveQueue=${this.saveQueue.length}/${this.MAX_SAVE_SESSIONS}`,
        `Hardware=${this.hardwareState}`,
      ];

      if (this.currentBatch) {
        const elapsed = Date.now() - this.batchStartTime;
        status.push(`CurrentBatch=${elapsed}ms/${this.config.batchDuration}ms`);
      }

      this.log(status.join(' | '));
    }, 2000); // Log every 2 seconds
  }

  private startPlaybackLevelMonitoring(): void {
    this.playbackLevelInterval = window.setInterval(() => {
      if (!this.playbackAnalyserNode) return;

      const dataArray = new Uint8Array(this.playbackAnalyserNode.frequencyBinCount);
      this.playbackAnalyserNode.getByteFrequencyData(dataArray);

      // Calculate average level
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      const level = Math.round((average / 255) * 100);

      // Notify playback level callback for UI
      if (this.config.onPlaybackLevel) {
        this.config.onPlaybackLevel(level);
      }
    }, 50); // Check every 50ms
  }

  // ============================================================================
  // Recording Pipeline
  // ============================================================================

  private startMonitoringLoop(): void {
    this.log('🎙️ Monitoring loop started (always on)');

    // Start silence detection
    this.silenceCheckInterval = window.setInterval(() => {
      if (!this.isBatching) return;

      const silenceElapsed = Date.now() - this.lastAudioTime;

      if (silenceElapsed >= this.config.silenceTimeout) {
        this.log(`⏱️ Silence timeout reached (${this.config.silenceTimeout}ms) - stopping batching`);
        this.stopBatching();
      }
    }, 100);
  }

  private startBatching(): void {
    if (this.isBatching) return;

    // Cancel any pending hardware idle check (new audio detected)
    this.cancelHardwareIdleCheck();

    // Reset session drain state (new session overrides any pending drain from previous)
    this.sessionDrainTarget = 0;
    this.pcmSessionRamped = false;
    this.pcmPlaybackStarted = false;  // Re-arm delay for new session

    this.isBatching = true;
    console.clear();
    this.log('📦 ═══════════════════════════════════════');
    this.log('📦 BATCHING MODE STARTED');
    this.log('📦 ═══════════════════════════════════════');

    // 🔥 Create NEW sessionID (RECORDING IS THE AUTHORITY)
    this.currentSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create session metadata (timestamp = NOW in PST)
    const now = new Date();
    const pstTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now);

    this.currentSessionMeta = {
      sessionId: this.currentSessionId,
      firstDetectedAt: now.toISOString(),
      timezone: 'America/Los_Angeles',
      firstBatchId: '',
      batches: [],
    };

    this.sessionMetaStore.set(this.currentSessionId, this.currentSessionMeta);

    this.log(`📋 NEW SESSION CREATED (Recording Authority)`);
    this.log(`   ├─ SessionID: ${this.currentSessionId}`);
    this.log(`   ├─ Time: ${pstTime} PST`);
    this.log(`   └─ Timezone: ${this.currentSessionMeta.timezone}`);

    // Start MediaRecorder with high-quality audio
    const mimeType = this.getBestMimeType();
    this.mediaRecorder = new MediaRecorder(this.stream!, {
      mimeType,
      audioBitsPerSecond: 128000, // 128kbps for clear audio (was default ~96kbps)
    });

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.onChunkRecorded(event.data);
      }
    };

    // Session finalization: onstop fires AFTER the final ondataavailable,
    // so the last batch is already sealed when this runs.
    this.mediaRecorder.onstop = () => {
      this.finalizeAndSaveSession();
    };

    // 🔥 NO TIMESLICE: Let Opus create natural frame boundaries
    // We'll manually flush when batches are ready (prevents mid-syllable cuts)
    this.mediaRecorder.start();
    this.log(`🎤 MediaRecorder ACTIVE (${mimeType}, 128kbps, continuous recording - manual flush)`);

    // Start first batch
    this.startNewBatch();

    // Start batch duration monitor (checks every 100ms, flushes at 5s)
    this.startBatchDurationMonitor();
  }

  private stopBatching(): void {
    if (!this.isBatching) return;

    this.isBatching = false;

    // Snapshot buffer for session drain: silence timeout = session boundary, NOT buffer empty.
    // The worklet keeps pushing silence, so buffer never empties. We count down from here.
    this.sessionDrainTarget = this.pcmRingBuffer?.getAvailable() ?? 0;
    this.log(`📊 Session drain target set: ${this.sessionDrainTarget} samples (${(this.sessionDrainTarget / (this.audioContext?.sampleRate || 48000)).toFixed(1)}s of audio to play)`);

    this.log('📦 ═══════════════════════════════════════');
    this.log('📦 BATCHING MODE STOPPED (8s Silence Timeout)');
    this.log('📦 ═══════════════════════════════════════');

    // Stop batch duration monitor
    this.stopBatchDurationMonitor();

    // Stop MediaRecorder (automatically flushes remaining data → triggers final ondataavailable)
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.log('⏹️ Stopping MediaRecorder (final flush will seal last batch)...');
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    }

    // ✅ DON'T stop PCM playback here - let it drain the buffer naturally
    // PCM will stop when:
    // 1. User manually stops monitoring (stop() method)
    // 2. Ring buffer is empty (future enhancement)
    // this.log('✓ Recording stopped - PCM playback will continue draining buffer');

    // 🔥 CLOSE SESSION (Recording Authority decides session is done)
    if (this.currentSessionId) {
      this.log(`🔒 SESSION CLOSED: ${this.currentSessionId}`);
      this.log(`   └─ Reason: 8s silence timeout reached`);

      // Reset PCM session ramp flag (ready for next session)
      this.pcmSessionRamped = false;
      this.log(`🎚️ Session ramp flag reset (ready for next session)`);

      // Session finalization happens via MediaRecorder.onstop
    }

    // NOTE: We keep initSegment for reuse across sessions (like BatchCoordinator)
    // Only cleared when monitoring stops completely (in stop() method)

    this.log('✓ Batching stopped');

    // 🔥 Schedule hardware idle check (deactivate after grace period if no new audio)
    this.scheduleHardwareIdleCheck();
  }

  private finalizeAndSaveSession(): void {
    if (!this.currentSessionId) return;
    const sessionMeta = this.sessionMetaStore.get(this.currentSessionId);
    if (!sessionMeta || sessionMeta.batches.length === 0) {
      this.log(`⚠️ Session ${this.currentSessionId} has no batches - not saving`);
      return;
    }
    sessionMeta.playbackEndTime = Date.now();
    this.log(`💾 Session sealed: ${this.currentSessionId} (${sessionMeta.batches.length} batches)`);
    // Copy to Saving Bucket (Blobs are immutable, shallow array copy is safe)
    if (this.config.saveRecording) {
      this.enqueueSaveSession({
        ...sessionMeta,
        batches: [...sessionMeta.batches]  // frozen snapshot
      });
    }
  }

  private startNewBatch(): void {
    // Safety check: ensure session exists
    if (!this.currentSessionId || !this.currentSessionMeta) {
      this.log('⚠️ Cannot start new batch - no active session', 'warning');
      return;
    }

    const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // 🔥 ATTACH CURRENT SESSION ID TO BATCH (Batch knows its session)
    this.currentBatch = {
      id: batchId,
      blob: new Blob(), // Will be set when sealed
      chunks: [], // Will be set when sealed
      duration: 0,
      timestamp: Date.now(),
      sessionId: this.currentSessionId, // ← Session identity attached here
    };

    this.currentChunks = [];
    this.batchStartTime = Date.now();

    // Set first batch ID if this is first batch
    if (!this.currentSessionMeta.firstBatchId) {
      this.currentSessionMeta.firstBatchId = batchId;
    }
  }

  private startBatchDurationMonitor(): void {
    // Clear any existing monitor
    this.stopBatchDurationMonitor();

    // Check batch duration every 100ms
    this.batchDurationMonitorInterval = window.setInterval(() => {
      if (!this.currentBatch || !this.isBatching) return;

      const elapsed = Date.now() - this.batchStartTime;

      // 🎯 CRITICAL: Only flush during SILENCE, never mid-word
      // This prevents cutting syllables ("ni...ne", "e...ight")
      const MIN_DURATION = 4500; // Don't flush before 4.5s
      const TARGET_DURATION = this.config.batchDuration; // 5000ms
      const MAX_DURATION = 6500; // Force flush if continuous speech

      if (elapsed < MIN_DURATION) return; // Too early

      // Ideal case: flush at ~5s during silence (word boundary)
      if (elapsed >= TARGET_DURATION && !this.isAudioSustained) {
        this.log(`⏱️ Batch duration reached (${elapsed}ms) + silence detected - flushing at word boundary`);

        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.requestData();
        }
      }
      // Safety valve: force flush if continuous speech exceeds 6.5s
      else if (elapsed >= MAX_DURATION) {
        this.log(`⚠️ Max duration exceeded (${elapsed}ms) - force flushing (continuous speech)`);

        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.requestData();
        }
      }
      // Waiting for silence...
      else if (elapsed >= TARGET_DURATION && this.isAudioSustained) {
        // Voice still active, waiting for silence (logging removed to reduce spam)
      }
    }, 100);
  }

  private stopBatchDurationMonitor(): void {
    if (this.batchDurationMonitorInterval !== null) {
      clearInterval(this.batchDurationMonitorInterval);
      this.batchDurationMonitorInterval = null;
    }
  }

  private onChunkRecorded(chunk: Blob): void {
    if (!this.currentBatch) return;

    // With manual flushing, each chunk is ~5 seconds of clean Opus audio
    this.currentChunks.push(chunk);
    this.currentBatch.duration = Date.now() - this.batchStartTime;

    // Seal batch when we receive flushed data
    this.sealCurrentBatch();

    // Continue with next batch (DON'T restart MediaRecorder)
    if (this.isBatching) {
      this.startNewBatch();
    }
  }

  private sealCurrentBatch(): void {
    if (!this.currentBatch) return;

    // ⚠️ NEVER seal empty batches (causes silence gaps!)
    if (this.currentChunks.length === 0) {
      this.log(`⚠️ Skipping empty batch (no chunks recorded)`);
      this.currentBatch = null;
      return;
    }

    const mimeType = this.mediaRecorder?.mimeType || 'audio/webm;codecs=opus';
    const batchNumber = (this.currentSessionMeta?.batches.length ?? 0) + 1;

    // 🔥 Store PURE AUDIO ONLY (no init segment in stored blob!)
    // Init segment will be prepended temporarily during decode, not stored
    this.currentBatch.blob = new Blob(this.currentChunks, { type: mimeType });
    this.log(`📦 Batch ${batchNumber}: Raw audio (${(this.currentBatch.blob.size / 1024).toFixed(2)} KB) - pure continuity`);

    // Store raw chunks for saving (without init segment duplication)
    this.currentBatch.chunks = [...this.currentChunks];

    const sizeKB = (this.currentBatch.blob.size / 1024).toFixed(2);

    this.log(`📦 Batch SEALED: ${this.currentBatch.id}`);
    this.log(`   ├─ Batch #${batchNumber}`);
    this.log(`   ├─ Duration: ${this.currentBatch.duration}ms`);
    this.log(`   ├─ Size: ${sizeKB} KB (raw audio only)`);
    this.log(`   ├─ Chunks: ${this.currentChunks.length}`);
    this.log(`   └─ Batch #${batchNumber} of session`);

    // Append directly to session (Recording Bucket is authoritative)
    if (this.currentSessionMeta) {
      this.currentSessionMeta.batches.push(this.currentBatch);
      this.log(`📦 Session updated: ${this.currentSessionMeta.batches.length} batches`);
    }

    this.currentBatch = null;
    this.currentChunks = [];
  }

  // ============================================================================
  // Multi-Input Mode Helper Methods
  // ============================================================================

  /**
   * Set up recording pipeline for one input channel
   */
  private async setupInputPipeline(channel: InputChannelType, stream: MediaStream): Promise<void> {
    if (!this.audioContext) {
      throw new Error('AudioContext not initialized');
    }
    if (!this.channelRingBuffers.get(channel)) {
      throw new Error(`Ring buffer not initialized for channel: ${channel}`);
    }

    this.log(`🎤 Setting up ${channel.toUpperCase()} input pipeline`);

    // Create source and analyser for audio level monitoring
    const source = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    this.sourceNodes.set(channel, source);
    this.analyserNodes.set(channel, analyser);

    // Create PCM worklet for this input
    const worklet = new AudioWorkletNode(this.audioContext, 'pcm-capture');

    // Connect analyser → worklet
    analyser.connect(worklet);

    // Handle PCM samples - write to THIS CHANNEL'S ring buffer
    let messageCount = 0;
    worklet.port.onmessage = (event) => {
      messageCount++;

      const channelBuffer = this.channelRingBuffers.get(channel);
      if (channelBuffer) {
        const samples = event.data.samples as Float32Array;
        const peak = Math.max(...Array.from(samples).map(Math.abs));

        // 🔥 CRITICAL: Flag that we've received real audio (not just zeros)
        if (peak > 0.0001 && !this.hasReceivedRealAudio) {
          this.hasReceivedRealAudio = true;
          this.log(`🎤 First real audio detected from ${channel.toUpperCase()}! (peak: ${peak.toFixed(4)})`);
        }

        // Log first few messages and non-zero peaks
        if (messageCount <= 5 || (peak > 0.01 && messageCount % 100 === 0)) {
          this.log(`🎤 [${channel.toUpperCase()}] PCM Worklet: msg #${messageCount}, samples=${samples.length}, peak=${peak.toFixed(4)}`);
        }

        // Write to this channel's own ring buffer (FIFO queue: each channel is independent)
        channelBuffer.push(samples);
      }
    };

    this.pcmWorkletNodes.set(channel, worklet);
    this.currentChannelSessions.set(channel, null); // No active session yet

    this.log(`✓ ${channel.toUpperCase()} pipeline ready`);
  }

  /**
   * Start audio level monitoring for all three inputs
   */
  private startMultiInputAudioLevelMonitoring(): void {
    const channels: InputChannelType[] = ['medical', 'fire', 'allCall'];

    for (const channel of channels) {
      const analyser = this.analyserNodes.get(channel);
      if (!analyser) continue;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const interval = window.setInterval(() => {
        if (!this.isMonitoring) {
          window.clearInterval(interval);
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / dataArray.length;
        const level = (average / 255) * 100;

        // Call respective callback
        if (channel === 'medical' && this.config.onMedicalAudioLevel) {
          this.config.onMedicalAudioLevel(level);
        } else if (channel === 'fire' && this.config.onFireAudioLevel) {
          this.config.onFireAudioLevel(level);
        } else if (channel === 'allCall' && this.config.onAllCallAudioLevel) {
          this.config.onAllCallAudioLevel(level);
        }
      }, 100);

      this.audioLevelIntervals.set(channel, interval);
    }
  }

  /**
   * Start monitoring loop for all three inputs (voice activity detection)
   */
  private startMultiInputMonitoringLoop(): void {
    const channels: InputChannelType[] = ['medical', 'fire', 'allCall'];

    for (const channel of channels) {
      const analyser = this.analyserNodes.get(channel);
      const stream = this.streams.get(channel);
      if (!analyser || !stream) continue;

      // Per-channel state
      let isChannelBatching = false;
      let lastChannelAudioTime = 0;
      let audioAboveThresholdStart: number | null = null;
      let isAudioSustained = false;
      let channelMediaRecorder: MediaRecorder | null = null;
      let channelSessionId: string | null = null;
      let currentQueueItem: PlaybackQueueItem | null = null; // Direct reference — no search needed
      let currentChannelBatches: AudioBatch[] = [];
      let currentChannelChunks: Blob[] = [];

      // Silence detection for this channel
      const silenceCheckInterval = window.setInterval(() => {
        if (!isChannelBatching) return;

        const silenceElapsed = Date.now() - lastChannelAudioTime;
        if (silenceElapsed >= this.config.silenceTimeout) {
          this.log(`⏱️ [${channel.toUpperCase()}] Silence timeout - stopping recording`);

          // Mark the queue item as complete + snapshot drain target for this channel's buffer.
          // Uses direct object reference (currentQueueItem) instead of searching by sessionId.
          if (currentQueueItem && !currentQueueItem.isComplete) {
            const channelBufAvailable = this.channelRingBuffers.get(channel)?.getAvailable() ?? 0;
            currentQueueItem.drainTarget = channelBufAvailable;
            currentQueueItem.isComplete = true;
            this.log(`📊 [${channel.toUpperCase()}] Session complete: ${channelBufAvailable} samples to drain (${(channelBufAvailable / (this.audioContext?.sampleRate || 48000)).toFixed(1)}s)`);
          } else {
            this.log(`⚠️ [${channel.toUpperCase()}] Silence timeout but no active queue item (session: ${channelSessionId})`, 'warning');
          }

          // Stop MediaRecorder
          if (channelMediaRecorder && channelMediaRecorder.state !== 'inactive') {
            channelMediaRecorder.stop();
          }

          isChannelBatching = false;
          this.activeBatchingChannels = Math.max(0, this.activeBatchingChannels - 1);
          if (this.activeBatchingChannels === 0) {
            this.isBatching = false; // All channels stopped — clear global flag
          }
          audioAboveThresholdStart = null;
          isAudioSustained = false;
          this.currentChannelSessions.set(channel, null);

          // Schedule hardware idle check — mirrors single-input stopBatching().
          // checkHardwareIdle retries every 3s until all queued audio drains, then deactivates.
          this.scheduleHardwareIdleCheck();
        }
      }, 100);

      // Voice activity detection for this channel
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const monitorInterval = window.setInterval(() => {
        if (!this.isMonitoring) {
          window.clearInterval(silenceCheckInterval);
          window.clearInterval(monitorInterval);
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / dataArray.length;
        const level = (average / 255) * 100;

        // Voice activity detection
        if (level > this.config.audioThreshold!) {
          lastChannelAudioTime = Date.now();

          // Sustain duration check
          if (audioAboveThresholdStart === null) {
            audioAboveThresholdStart = Date.now();
          }

          const sustainElapsed = Date.now() - audioAboveThresholdStart;
          if (sustainElapsed >= (this.config.sustainDuration || 0) && !isAudioSustained) {
            isAudioSustained = true;

            // Start recording for this channel
            if (!isChannelBatching) {
              isChannelBatching = true;
              this.activeBatchingChannels++;
              this.isBatching = true; // Set global flag (used by playback drain logic)
              currentChannelBatches = [];
              currentChannelChunks = [];

              // Create session ID with channel prefix
              channelSessionId = `${channel}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              this.currentChannelSessions.set(channel, channelSessionId);

              this.log(`📋 [${channel.toUpperCase()}] NEW SESSION: ${channelSessionId}`);

              // 🔥 FLUSH stale samples from THIS CHANNEL'S ring buffer only.
              // Each channel has its own buffer, so flushing one never affects others.
              const channelBuf = this.channelRingBuffers.get(channel);
              if (channelBuf) {
                const staleCount = channelBuf.getAvailable();
                channelBuf.clear();
                if (staleCount > 0) {
                  this.log(`🧹 [${channel.toUpperCase()}] Flushed ${staleCount} stale samples (starting fresh)`);
                }
              }

              // Add this session to the FIFO playback queue
              const queueItem: PlaybackQueueItem = {
                sessionId: channelSessionId,
                channel,
                drainTarget: 0,
                isComplete: false,
                playbackStarted: false,
              };
              currentQueueItem = queueItem; // Keep direct reference for silence timeout
              this.playbackQueue.push(queueItem);
              this.log(`📥 [${channel.toUpperCase()}] Queued for playback (queue length: ${this.playbackQueue.length})`);

              // Cancel any pending hardware idle check (new audio coming)
              this.cancelHardwareIdleCheck();

              // Activate hardware (zone-aware)
              this.ensureHardwareActive();

              // Start MediaRecorder for this channel
              const mimeType = this.getBestMimeType();
              channelMediaRecorder = new MediaRecorder(stream, {
                mimeType,
                audioBitsPerSecond: 128000,
              });

              channelMediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                  currentChannelChunks.push(event.data);
                }
              };

              channelMediaRecorder.onstop = async () => {
                // Session complete - save to Firebase
                if (currentChannelChunks.length > 0 && channelSessionId) {
                  const audioBlob = new Blob(currentChannelChunks, { type: mimeType });
                  const filename = `${channel}-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;

                  this.log(`💾 [${channel.toUpperCase()}] Saving session: ${filename}`);

                  if (this.config.uploadCallback) {
                    try {
                      await this.config.uploadCallback(audioBlob, filename, channelSessionId);
                      this.log(`✅ [${channel.toUpperCase()}] Session saved`);
                    } catch (error) {
                      this.log(`❌ [${channel.toUpperCase()}] Save failed: ${error}`, 'error');
                    }
                  }
                }

                // Reset
                channelMediaRecorder = null;
                channelSessionId = null;
                currentChannelBatches = [];
                currentChannelChunks = [];
              };

              channelMediaRecorder.start();
              this.mediaRecorders.set(channel, channelMediaRecorder);

              this.log(`🔴 [${channel.toUpperCase()}] Recording started`);
            }
          }
        } else {
          // Audio below threshold - reset sustain
          if (audioAboveThresholdStart !== null && !isAudioSustained) {
            audioAboveThresholdStart = null;
          }
        }
      }, 100);
    }
  }

  // ============================================================================
  // PCM Playback (Live Streaming - No Encoding)
  // ============================================================================

  /**
   * Start PCM playback (replaces batch-based playback)
   * - Pulls samples from ring buffer
   * - Schedules continuously
   * - No decoding, no gaps, no artifacts
   */
  private startPCMPlayback(): void {
    if (this.pcmPlaybackEnabled) return;
    if (!this.audioContext) return;
    // Single-input mode requires pcmRingBuffer; multi-input uses channelRingBuffers
    if (!this.isMultiInputMode && !this.pcmRingBuffer) return;

    this.log('🎧 ═══════════════════════════════════════');
    this.log('🎧 STARTING PCM LIVE PLAYBACK');
    this.log('🎧 ═══════════════════════════════════════');
    this.log('🎧 Mode: ScriptProcessorNode (continuous callback)');
    this.log('🎧 Buffer size: 4096 samples (~85ms at 48kHz)');

    // Create ScriptProcessor for continuous playback (like test page)
    // Buffer size: 4096 samples = ~85ms at 48kHz (low latency)
    this.pcmPlaybackNode = this.audioContext.createScriptProcessor(4096, 0, 1);

    let callbackCount = 0;

    this.pcmPlaybackNode.onaudioprocess = (event) => {
      callbackCount++;

      // Debug: Log first 10 callbacks to see what's blocking
      if (callbackCount <= 10) {
        this.log(`🎵 PCM CALLBACK #${callbackCount}: enabled=${this.pcmPlaybackEnabled}, hardwareState=${HardwareState[this.hardwareState]}, hasAudio=${this.hasReceivedRealAudio}`);
      }

      if (!this.audioContext || !this.pcmPlaybackEnabled) {
        if (callbackCount <= 10) this.log(`   └─ BLOCKED: Basic checks failed`);
        return;
      }

      // Single-input mode requires pcmRingBuffer
      if (!this.isMultiInputMode && !this.pcmRingBuffer) {
        if (callbackCount <= 10) this.log(`   └─ BLOCKED: No ring buffer`);
        return;
      }

      const output = event.outputBuffer.getChannelData(0);

      // 🔥 WAIT FOR HARDWARE: Gate on STABLE/PLAYING/DRAINING (warmup complete).
      if (this.hardwareState !== HardwareState.STABLE && this.hardwareState !== HardwareState.PLAYING && this.hardwareState !== HardwareState.DRAINING) {
        if (callbackCount <= 10) this.log(`   └─ BLOCKED: Hardware not ready (state=${HardwareState[this.hardwareState]})`);
        output.fill(0);
        return;
      }

      // ═══════════════════════════════════════════════════════════
      // MULTI-INPUT MODE: Per-channel FIFO playback queue
      // ═══════════════════════════════════════════════════════════
      if (this.isMultiInputMode) {
        // Try to get a current playback item
        if (!this.currentPlaybackItem) {
          if (this.playbackQueue.length === 0) {
            // Nothing queued — output silence
            output.fill(0);
            if (this.hardwareState === HardwareState.PLAYING) {
              this.hardwareState = HardwareState.DRAINING;
              this.log('🔊 Hardware state: PLAYING → DRAINING (queue empty)');
              this.scheduleHardwareIdleCheck();
            }
            return;
          }

          // Check if the next queued item has enough buffer to start
          const nextItem = this.playbackQueue[0];
          const requiredSamples = this.config.playbackDelay * (this.audioContext!.sampleRate / 1000);
          const channelBuf = this.channelRingBuffers.get(nextItem.channel)!;
          const available = channelBuf.getAvailable();

          if (available >= requiredSamples && this.hasReceivedRealAudio) {
            // Dequeue and set as active
            this.currentPlaybackItem = this.playbackQueue.shift()!;
            this.currentPlaybackItem.playbackStarted = true;
            this.log(`🔊 [${this.currentPlaybackItem.channel.toUpperCase()}] Playback starting (${available} samples = ${(available / this.audioContext!.sampleRate).toFixed(2)}s buffered)`);

            // Zone switch — only when zoned playback is enabled
            // When disabled: all linked speakers stay active for all channels, no re-routing
            if (this.config.zonedPlayback && this.lastPlaybackChannel !== this.currentPlaybackItem.channel) {
              this.switchHardwareForChannel(this.currentPlaybackItem.channel, this.lastPlaybackChannel)
                .catch(err => this.log(`❌ Zone switch failed: ${err}`, 'error'));
            }
            this.lastPlaybackChannel = this.currentPlaybackItem.channel;

            // STABLE → PLAYING
            if (this.hardwareState === HardwareState.STABLE) {
              this.hardwareState = HardwareState.PLAYING;
              this.log(`🔊 Hardware state: STABLE → PLAYING (${this.currentPlaybackItem.channel.toUpperCase()}, gain=${this.playbackGainNode?.gain.value.toFixed(2)})`);
            } else if (this.hardwareState === HardwareState.DRAINING) {
              this.hardwareState = HardwareState.PLAYING;
              this.cancelHardwareIdleCheck();
              this.log(`🔊 Hardware state: DRAINING → PLAYING (next session: ${this.currentPlaybackItem.channel.toUpperCase()})`);
            }
          } else {
            // Buffer not ready yet — wait
            if (callbackCount <= 10) this.log(`   └─ BLOCKED: Waiting for buffer (${available}/${requiredSamples} samples for ${nextItem.channel.toUpperCase()})`);
            output.fill(0);
            return;
          }
        }

        // Pull from the current item's channel buffer
        const item = this.currentPlaybackItem!;
        const channelBuf = this.channelRingBuffers.get(item.channel)!;
        const samples = channelBuf.pull(output.length);

        // Count down drain target
        if (item.drainTarget > 0) {
          item.drainTarget -= samples.length;
        }

        // Safety: detect stuck playback item (buffer empty + isComplete never set)
        // At 48kHz with 128-sample frames, 3750 callbacks ≈ 10 seconds of empty buffer.
        // If a session has been pulling silence for 10s with no isComplete, something went wrong.
        if (channelBuf.getAvailable() === 0 && !item.isComplete) {
          this.emptyBufferCallbackCount++;
          // ~10 seconds of silence = definitely stuck (normal silence timeout is ~2-5s)
          if (this.emptyBufferCallbackCount > 3750) {
            this.log(`⚠️ [${item.channel.toUpperCase()}] Safety: force-completing stuck session ${item.sessionId} (buffer empty for ~10s, isComplete never set)`, 'warning');
            item.isComplete = true;
            item.drainTarget = 0;
            this.emptyBufferCallbackCount = 0;
          }
        } else {
          this.emptyBufferCallbackCount = 0;
        }

        // Write samples to output
        for (let i = 0; i < samples.length; i++) {
          output[i] = Math.max(-1, Math.min(1, samples[i]));
        }
        for (let i = samples.length; i < output.length; i++) {
          output[i] = 0;
        }

        // Session complete when recording ended AND all queued samples drained
        if (item.isComplete && item.drainTarget <= 0) {
          this.log(`✅ [${item.channel.toUpperCase()}] Session drained: ${item.sessionId}`);
          this.currentPlaybackItem = null;
          this.emptyBufferCallbackCount = 0;
          // Next callback will either dequeue next item or go DRAINING
        }

        // If queue is empty and current item is done → DRAINING
        if (!this.currentPlaybackItem && this.playbackQueue.length === 0 && !this.isBatching) {
          if (this.hardwareState === HardwareState.PLAYING) {
            this.hardwareState = HardwareState.DRAINING;
            this.log('🔊 Hardware state: PLAYING → DRAINING (all sessions played)');
            this.scheduleHardwareIdleCheck();
          }
        }

        return; // Done with multi-input processing
      }

      // ═══════════════════════════════════════════════════════════
      // SINGLE-INPUT MODE: Original per-session ring buffer logic
      // ═══════════════════════════════════════════════════════════

      // Check if we've accumulated enough samples to start playback (delay period)
      if (!this.pcmPlaybackStarted) {
        const requiredSamples = this.config.playbackDelay * (this.audioContext!.sampleRate / 1000);
        const availableSamples = this.pcmRingBuffer!.getAvailable();

        if (availableSamples >= requiredSamples && this.hasReceivedRealAudio) {
          this.pcmPlaybackStarted = true;
          this.log(`🔊 Playback delay complete (${availableSamples} samples = ${(availableSamples / this.audioContext!.sampleRate).toFixed(2)}s available, real audio received)`);

          // 🎚️ APPLY SESSION VOLUME RAMP (first audio of session)
          if (!this.pcmSessionRamped && this.config.playbackRampEnabled && this.isWithinRampWindow() && this.playbackGainNode) {
            const startVol = this.config.playbackRampStartVolume ?? 0;
            const targetVol = this.config.playbackRampTargetVolume ?? 1.0;
            const rampDuration = (this.config.playbackRampDuration ?? 2000) / 1000;
            this.playbackGainNode.gain.setValueAtTime(startVol, this.audioContext.currentTime);
            this.playbackGainNode.gain.linearRampToValueAtTime(targetVol, this.audioContext.currentTime + rampDuration);
            this.pcmSessionRamped = true;
            this.log(`🎚️ PCM SESSION RAMP: ${(startVol * 100).toFixed(0)}% → ${(targetVol * 100).toFixed(0)}% over ${rampDuration.toFixed(1)}s`);
          } else if (!this.pcmSessionRamped && this.config.playbackRampEnabled && !this.isWithinRampWindow()) {
            this.log(`🕐 Outside ramp window - using static volume`);
          }

          if (this.hardwareState === HardwareState.STABLE) {
            this.hardwareState = HardwareState.PLAYING;
            const currentGain = this.playbackGainNode?.gain.value ?? 0;
            const ctxState = this.audioContext?.state ?? 'unknown';
            this.log(`🔊 Hardware state: STABLE → PLAYING (gain=${currentGain.toFixed(2)}, ctxState=${ctxState})`);
          }
        } else {
          if (callbackCount <= 10) this.log(`   └─ BLOCKED: Delay not satisfied (${availableSamples}/${requiredSamples} samples, hasAudio=${this.hasReceivedRealAudio})`);
          output.fill(0);
          return;
        }
      }

      // Pull samples from ring buffer
      const samples = this.pcmRingBuffer!.pull(output.length);

      if (this.sessionDrainTarget > 0) {
        this.sessionDrainTarget -= samples.length;
      }

      let peakLevel = 0;
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        output[i] = Math.max(-1, Math.min(1, sample));
        peakLevel = Math.max(peakLevel, Math.abs(sample));
      }
      for (let i = samples.length; i < output.length; i++) {
        output[i] = 0;
      }

      if (callbackCount % 100 === 0) {
        const gainValue = this.playbackGainNode?.gain.value ?? 0;
        const ctxState = this.audioContext?.state ?? 'unknown';
        this.log(`🔍 AUDIO OUTPUT: callback=${callbackCount}, samples=${samples.length}, peak=${peakLevel.toFixed(4)}, gain=${gainValue.toFixed(2)}, ctxState=${ctxState}`);
      }

      if (!this.isBatching && this.sessionDrainTarget <= 0) {
        if (this.hardwareState === HardwareState.PLAYING) {
          this.hardwareState = HardwareState.DRAINING;
          this.log('🔊 Hardware state: PLAYING → DRAINING (session audio fully played)');
          this.scheduleHardwareIdleCheck();
        }
      } else {
        if (this.hardwareState === HardwareState.DRAINING) {
          this.hardwareState = HardwareState.PLAYING;
          this.log('🔊 Hardware state: DRAINING → PLAYING (new audio arrived)');
          this.cancelHardwareIdleCheck();
        }
      }

      if (!this.isBatching && this.sessionDrainTarget <= 0 && this.pcmSessionRamped) {
        this.pcmSessionRamped = false;
        if (this.config.playbackRampEnabled && this.isWithinRampWindow() && this.playbackGainNode && this.audioContext) {
          const startVol = this.config.playbackRampStartVolume ?? 0;
          this.playbackGainNode.gain.setValueAtTime(startVol, this.audioContext.currentTime);
          this.log(`🎚️ Session ended - volume reset to ${(startVol * 100).toFixed(0)}% (ready for next session)`);
        }
      }

    };

    // Connect ScriptProcessor → GainNode → Analyser → Destination
    this.pcmPlaybackNode.connect(this.playbackGainNode!);
    this.pcmPlaybackEnabled = true;

    this.log(`✓ PCM playback started - continuous audio stream`);
    this.log(`🔗 Audio chain: ScriptProcessor → GainNode(${this.playbackGainNode!.gain.value.toFixed(2)}) → Analyser → Destination`);
    this.log(`🎧 AudioContext state: ${this.audioContext!.state}`);
    this.log('🎧 ═══════════════════════════════════════');
  }

  /**
   * Stop PCM playback
   */
  private stopPCMPlayback(): void {
    if (!this.pcmPlaybackEnabled) return;

    this.log('🛑 Stopping PCM playback');

    this.pcmPlaybackEnabled = false;
    this.pcmPlaybackStarted = false;
    this.pcmSessionRamped = false; // Reset session ramp flag
    this.hasReceivedRealAudio = false; // Reset audio detection

    if (this.pcmPlaybackNode) {
      // Clear the audio process handler before disconnecting
      this.pcmPlaybackNode.onaudioprocess = null;
      this.pcmPlaybackNode.disconnect();
      this.pcmPlaybackNode = null;
    }

    if (this.pcmRingBuffer) {
      this.pcmRingBuffer.clear();
    }

    // 🔥 STOP PCM CAPTURE (worklet + analyser) to prevent endless background noise
    // Only stop if recording has also stopped (if still batching, need to continue capturing)
    if (!this.isBatching) {
      this.log('🛑 Stopping PCM capture (worklet + analyser)');

      if (this.pcmWorkletNode) {
        this.pcmWorkletNode.disconnect();
        this.pcmWorkletNode.port.onmessage = null;
        this.pcmWorkletNode = null;
      }

      // Note: We keep analyserNode connected for audio detection to work for next session
      // Only disconnect if we're truly stopping monitoring
    }

    this.log('✓ PCM playback stopped');
  }

  // ============================================================================
  // Playback Pipeline
  // ============================================================================

  /**
   * Get the speakers to activate for a given channel.
   * If zonedPlayback is enabled and speakersByChannel is configured, returns
   * only the speakers for that channel's zone. Otherwise falls back to all linkedSpeakers.
   */
  private getSpeakersForChannel(channel: InputChannelType): any[] {
    if (this.config.zonedPlayback && this.config.speakersByChannel) {
      const zoneSpeakers = this.config.speakersByChannel[channel];
      if (zoneSpeakers && zoneSpeakers.length > 0) {
        return zoneSpeakers;
      }
      this.log(`⚠️ Zoned playback enabled but no speakers configured for ${channel.toUpperCase()} - falling back to all speakers`);
    }
    return this.config.linkedSpeakers || [];
  }

  /**
   * Switch hardware zone when moving from one channel's playback to another.
   * Always resets ALL speakers to 50022 first, then activates only the new channel's speakers.
   * Skipped if channel is the same (no zone change needed).
   */
  private async switchHardwareForChannel(
    newChannel: InputChannelType,
    lastChannel: InputChannelType | null
  ): Promise<void> {
    if (lastChannel === newChannel) {
      // Same zone — hardware already set up correctly, just keep playing
      this.log(`✓ [${newChannel.toUpperCase()}] Same zone as previous session — no hardware switch needed`);
      return;
    }

    if (lastChannel !== null) {
      // Different zone: reset ALL speakers to idle first, then activate new zone
      this.log(`🔄 Zone switch: ${lastChannel.toUpperCase()} → ${newChannel.toUpperCase()}`);
      this.log(`   Step 1: Setting ALL speakers to idle (50022)...`);
      const allSpeakers = this.config.linkedSpeakers || [];
      if (this.config.setSpeakerZoneIP && allSpeakers.length > 0) {
        await this.config.setSpeakerZoneIP(allSpeakers, '224.0.2.60:50022');
      }
    }

    // Activate speakers for the new channel's zone
    this.log(`   Step 2: Activating ${newChannel.toUpperCase()} zone speakers (50002)...`);
    const zoneSpeakers = this.getSpeakersForChannel(newChannel);
    if (this.config.setSpeakerZoneIP && zoneSpeakers.length > 0) {
      await this.config.setSpeakerZoneIP(zoneSpeakers, '224.0.2.60:50002');
    }
    this.log(`✅ Zone switch complete → ${newChannel.toUpperCase()} (${zoneSpeakers.length} speakers)`);
  }

  private async ensureHardwareActive(): Promise<void> {
    // 🔥 STATE MACHINE: Handle all possible states
    if (this.hardwareState === HardwareState.STABLE || this.hardwareState === HardwareState.PLAYING || this.hardwareState === HardwareState.DRAINING) {
      const speakerCount = (this.config.linkedSpeakers || []).length;
      this.log(`✓ Speakers already active (${speakerCount} speaker${speakerCount !== 1 ? 's' : ''} @ 224.0.2.60:50002, state=${HardwareState[this.hardwareState]})`);
      // If DRAINING, cancel idle check — new audio is coming
      if (this.hardwareState === HardwareState.DRAINING) {
        this.hardwareState = HardwareState.PLAYING;
        this.cancelHardwareIdleCheck();
        this.log('🔊 Hardware state: DRAINING → PLAYING (new session starting)');
      }
      return;
    }

    if (this.hardwareState === HardwareState.ACTIVATING) {
      this.log('✓ Hardware activation already in progress - waiting...');
      return;
    }

    if (this.hardwareState === HardwareState.DEACTIVATING) {
      this.log('🔄 Hardware deactivation in progress - CANCELING and reactivating');
      // Cancel deactivation
      if (this.hardwareTransitionAbort) {
        this.hardwareTransitionAbort();
        this.hardwareTransitionAbort = null;
      }
      // Wait a bit for deactivation to abort
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Check if any hardware is configured
    const hasLinkedSpeakers = (this.config.linkedSpeakers || []).length > 0;
    const hasPagingDevice = !!this.config.pagingDevice;

    if (!hasLinkedSpeakers && !hasPagingDevice) {
      this.log('⚠️  No hardware configured - skipping activation');
      this.hardwareState = HardwareState.STABLE; // No hardware = no warmup needed
      return;
    }

    this.hardwareState = HardwareState.ACTIVATING;

    this.log('🎛️ ═══════════════════════════════════════');
    this.log('🎛️ HARDWARE ACTIVATION START');
    this.log('🎛️ ═══════════════════════════════════════');
    this.log('🌐 Target: 224.0.2.60:50002 (ACTIVE - Playback Mode)');
    this.log('⚠️  Note: Paging device stays unchanged');

    // 🧪 EMULATION MODE: Skip actual network calls
    if (this.config.emulationMode) {
      this.log('🧪 EMULATION MODE: Simulating speaker activation');

      // Show individual speaker operations
      const linkedSpeakers = this.config.linkedSpeakers || [];
      if (linkedSpeakers.length > 0) {
        this.log(`Setting ${linkedSpeakers.length} virtual speaker(s) to active IP...`);

        for (const speaker of linkedSpeakers) {
          this.log(`  → ${speaker.name} (${speaker.ipAddress}): Setting to 224.0.2.60:50002`);
          await new Promise(resolve => setTimeout(resolve, 50)); // Small delay per speaker
          this.log(`  ✓ ${speaker.name}: Ready`);
        }
      }

      // Paging device info
      if (this.config.pagingDevice) {
        this.log(`📢 Paging device: ${this.config.pagingDevice.name} (${this.config.pagingDevice.ipAddress})`);
      }

      // Overall network delay simulation
      if (this.config.emulationNetworkDelay > 0) {
        this.log(`🧪 Simulating ${this.config.emulationNetworkDelay}ms network delay...`);
        await new Promise(resolve => setTimeout(resolve, this.config.emulationNetworkDelay));
      }

      // WAKING: Speakers powered on, white noise expected. Wait for warmup.
      this.hardwareState = HardwareState.WAKING;
      this.log('🔊 EMULATION: Speakers waking up - waiting for warmup...');
      await new Promise(resolve => setTimeout(resolve, this.config.playbackDelay));

      this.hardwareState = HardwareState.STABLE;
      this.log(`✅ EMULATION: Speaker warmup complete (${this.config.playbackDelay}ms) - safe to unmute`);

      // PoE devices (lights, etc.)
      if (this.config.controlPoEDevices) {
        this.log('💡 EMULATION: Simulating PoE device activation');
      }

      this.log('🎛️ ═══ HARDWARE ACTIVATION COMPLETE ═══');
      return;
    }

    // REAL MODE: Actual hardware control (SPEAKERS ONLY, NEVER PAGING DEVICE)
    const linkedSpeakers = this.config.linkedSpeakers || [];
    this.log(`🔊 Activating ${linkedSpeakers.length} speaker${linkedSpeakers.length !== 1 ? 's' : ''}...`);
    this.log('');

    // Enable PoE devices (lights, etc.) IMMEDIATELY — fire and forget, don't block speakers
    if (this.config.controlPoEDevices) {
      this.log('💡 Enabling PoE devices (background, before speaker warmup)...');
      this.config.controlPoEDevices(true).catch(poeError => {
        this.log(`⚠️ PoE activation error (non-fatal): ${poeError}`, 'warning');
      });
    }

    try {
      // Set linked speakers' mcast.zone1 to active IP (in parallel)
      if (linkedSpeakers.length > 0) {
        this.log(`Setting ${linkedSpeakers.length} speakers' mcast.zone1 to 224.0.2.60:50002 (in parallel)...`);
        if (this.config.setSpeakerZoneIP) {
          await this.config.setSpeakerZoneIP(linkedSpeakers, '224.0.2.60:50002');
        }
        this.log(`✓ All speakers' zone IP set to 224.0.2.60:50002`);
        this.log('');
      } else {
        this.log('⚠️  No linked speakers to activate');
        this.log('');
      }

      // WAKING: Zone IP set, speakers powered on. White noise expected.
      this.hardwareState = HardwareState.WAKING;
      this.log('🔊 Speakers waking up - waiting for warmup...');
      this.log(`   • ${linkedSpeakers.length} speaker${linkedSpeakers.length !== 1 ? 's' : ''} zone set to ACTIVE`);
      this.log(`   • mcast.zone1: 224.0.2.60:50002 (receiving from paging)`);
      this.log(`   • Paging device: ${this.config.pagingDevice?.name || 'N/A'} (NEVER CONTROLLED)`);

      // Wait for speaker warmup (hides white noise)
      await new Promise(resolve => setTimeout(resolve, this.config.playbackDelay));

      this.hardwareState = HardwareState.STABLE;
      this.log(`✅ Speaker warmup complete (${this.config.playbackDelay}ms) - safe to unmute`);
      this.log('🎛️ ═══════════════════════════════════════');
      this.log('🎛️ HARDWARE ACTIVATION COMPLETE');
      this.log('🎛️ ═══════════════════════════════════════');
    } catch (error) {
      this.log(`❌ Speaker activation failed: ${error}`, 'error');
      throw error;
    }
  }

  private async deactivateHardware(): Promise<void> {
    // 🔥 STATE MACHINE: Handle all possible states
    if (this.hardwareState === HardwareState.IDLE) {
      this.log('✓ Speakers already idle (IP: 224.0.2.60:50022)');
      return;
    }

    if (this.hardwareState === HardwareState.DEACTIVATING) {
      this.log('✓ Hardware deactivation already in progress');
      return;
    }

    if (this.hardwareState === HardwareState.ACTIVATING) {
      this.log('⚠️ Cannot deactivate - activation in progress');
      return;
    }

    // Check if any hardware is configured
    const hasLinkedSpeakers = (this.config.linkedSpeakers || []).length > 0;
    const hasPagingDevice = !!this.config.pagingDevice;

    if (!hasLinkedSpeakers && !hasPagingDevice) {
      this.log('⚠️  No hardware configured - skipping deactivation');
      this.hardwareState = HardwareState.IDLE;
      return;
    }

    this.hardwareState = HardwareState.DEACTIVATING;

    // Set up abort mechanism
    let aborted = false;
    this.hardwareTransitionAbort = () => {
      aborted = true;
      this.log('🚫 Hardware deactivation ABORTED - new session detected');
    };

    this.log('🎛️ ═══════════════════════════════════════');
    this.log('🎛️ HARDWARE DEACTIVATION START');
    this.log('🎛️ ═══════════════════════════════════════');
    this.log('🌐 Target: 224.0.2.60:50022 (IDLE - Standby Mode)');
    this.log('⚠️  Note: Paging device stays unchanged');

    // 🧪 EMULATION MODE: Skip actual network calls
    if (this.config.emulationMode) {
      this.log('🧪 EMULATION MODE: Simulating speaker deactivation');

      // Show individual speaker operations
      const linkedSpeakers = this.config.linkedSpeakers || [];
      if (linkedSpeakers.length > 0) {
        this.log(`Setting ${linkedSpeakers.length} virtual speaker(s) to idle IP...`);

        for (const speaker of linkedSpeakers) {
          this.log(`  → ${speaker.name} (${speaker.ipAddress}): Setting to 224.0.2.60:50022`);
          await new Promise(resolve => setTimeout(resolve, 50)); // Small delay per speaker
          this.log(`  ✓ ${speaker.name}: Idle`);
        }
      }

      // Paging device info
      if (this.config.pagingDevice) {
        this.log(`📢 Paging device: ${this.config.pagingDevice.name} (unchanged - stays in sending mode)`);
      }

      // Overall network delay simulation
      if (this.config.emulationNetworkDelay > 0) {
        this.log(`🧪 Simulating ${this.config.emulationNetworkDelay}ms network delay...`);
        await new Promise(resolve => setTimeout(resolve, this.config.emulationNetworkDelay));
      }

      // Check if aborted during delay
      if (aborted) {
        this.log('🚫 Deactivation aborted during emulation delay');
        this.hardwareTransitionAbort = null;
        return;
      }

      // PoE devices (lights, etc.)
      if (this.config.controlPoEDevices) {
        this.log('💡 EMULATION: Simulating PoE device deactivation');
      }

      this.hardwareState = HardwareState.IDLE;
      this.hardwareTransitionAbort = null;
      this.log('✅ EMULATION: Speaker deactivation complete');
      this.log('🎛️ ═══ HARDWARE DEACTIVATION COMPLETE ═══');
      return;
    }

    // REAL MODE: Actual hardware control (SPEAKERS ONLY, NEVER PAGING DEVICE)
    const linkedSpeakers = this.config.linkedSpeakers || [];
    this.log(`🔊 Deactivating ${linkedSpeakers.length} speaker${linkedSpeakers.length !== 1 ? 's' : ''}...`);
    this.log('');

    try {
      // Set linked speakers' mcast.zone1 to idle IP (in parallel)
      if (linkedSpeakers.length > 0) {
        this.log(`Setting ${linkedSpeakers.length} speakers' mcast.zone1 to 224.0.2.60:50022 (in parallel)...`);
        if (this.config.setSpeakerZoneIP) {
          await this.config.setSpeakerZoneIP(linkedSpeakers, '224.0.2.60:50022');
        }

        // Check if aborted during network call
        if (aborted) {
          this.log('🚫 Deactivation aborted during network call');
          this.hardwareTransitionAbort = null;
          return;
        }

        this.log(`✓ All speakers' zone IP set to 224.0.2.60:50022`);
        this.log('');
      } else {
        this.log('⚠️  No linked speakers to deactivate');
        this.log('');
      }

      // Disable PoE devices (lights, etc.) — fire and forget, don't block shutdown
      if (this.config.controlPoEDevices) {
        this.log('💡 Disabling PoE devices (background)...');
        this.config.controlPoEDevices(false).catch(poeError => {
          this.log(`⚠️ PoE deactivation error (non-fatal): ${poeError}`, 'warning');
        });
      }

      this.hardwareState = HardwareState.IDLE;
      this.hardwareTransitionAbort = null;
      this.lastPlaybackChannel = null; // Reset so next activation forces fresh zone setup
      this.log('✅ All speakers deactivated successfully');
      this.log(`   • ${linkedSpeakers.length} speaker${linkedSpeakers.length !== 1 ? 's' : ''} zone set to IDLE`);
      this.log(`   • mcast.zone1: 224.0.2.60:50022 (idle)`);
      this.log(`   • Paging device: ${this.config.pagingDevice?.name || 'N/A'} (NEVER CONTROLLED)`);
      this.log('🎛️ ═══════════════════════════════════════');
      this.log('🎛️ HARDWARE DEACTIVATION COMPLETE');
      this.log('🎛️ ═══════════════════════════════════════');
    } catch (error) {
      this.log(`⚠️ Speaker deactivation error (non-fatal): ${error}`, 'warning');
      // Continue anyway - don't block shutdown
      this.hardwareState = HardwareState.IDLE;
      this.hardwareTransitionAbort = null;
    }
  }

  // ============================================================================
  // Hardware Idle Detection (Prevents speakers staying active indefinitely)
  // ============================================================================

  /**
   * Schedule a hardware idle check after a grace period
   * This ensures hardware deactivates even when sessions overlap
   */
  private scheduleHardwareIdleCheck(): void {
    // Clear any existing timer
    if (this.hardwareIdleTimer !== null) {
      clearTimeout(this.hardwareIdleTimer);
      this.hardwareIdleTimer = null;
    }

    const gracePeriod = this.config.hardwareGracePeriod ?? 5000;
    this.log(`⏲️ Hardware idle check scheduled (${gracePeriod / 1000}s grace period)`);

    this.hardwareIdleTimer = window.setTimeout(() => {
      this.checkHardwareIdle();
    }, gracePeriod);
  }

  /**
   * Check if hardware should be deactivated (all conditions met)
   */
  private async checkHardwareIdle(): Promise<void> {
    this.hardwareIdleTimer = null;

    this.log('🔍 ═══════════════════════════════════════');
    this.log('🔍 HARDWARE IDLE CHECK');
    this.log('🔍 ═══════════════════════════════════════');

    // Condition 1: Recording stopped
    const notBatching = !this.isBatching;

    // Condition 2: Session audio fully played
    // Multi-input: queue empty AND nothing currently playing
    // Single-input: sessionDrainTarget <= 0
    const playbackDone = this.isMultiInputMode
      ? (!this.currentPlaybackItem && this.playbackQueue.length === 0)
      : (this.sessionDrainTarget <= 0);

    const drainInfo = this.isMultiInputMode
      ? `queue=${this.playbackQueue.length}, currentItem=${this.currentPlaybackItem?.sessionId ?? 'none'}`
      : `${Math.max(0, this.sessionDrainTarget)} samples remaining`;

    this.log(`   ├─ Recording stopped: ${notBatching ? '✓' : '✗'}`);
    this.log(`   ├─ Session drained: ${playbackDone ? '✓' : '✗'} (${drainInfo})`);
    this.log(`   └─ Hardware state: ${HardwareState[this.hardwareState]}`);

    // Only deactivate if ALL conditions are met
    if (notBatching && playbackDone) {
      this.log('✅ All idle conditions met - deactivating hardware');
      await this.deactivateHardware();
    } else if (notBatching) {
      // Recording stopped, waiting for playback to finish
      this.log('⏳ Waiting for playback to finish - checking again in 3s');
      this.hardwareIdleTimer = window.setTimeout(() => {
        this.checkHardwareIdle();
      }, 3000);
    } else {
      this.log('⏳ Idle conditions not met - will check after next session ends');
    }

    this.log('🔍 ═══════════════════════════════════════');
  }

  /**
   * Cancel any pending hardware idle checks (new audio detected)
   */
  private cancelHardwareIdleCheck(): void {
    if (this.hardwareIdleTimer !== null) {
      clearTimeout(this.hardwareIdleTimer);
      this.hardwareIdleTimer = null;
      this.log('⏲️ Hardware idle check cancelled (new audio detected)');
    }
  }

  // ============================================================================
  // Save Worker (Async, Non-blocking)
  // ============================================================================

  private async startSaveWorker(): Promise<void> {
    this.log('💾 Save worker started');

    while (this.isMonitoring) {
      if (this.saveQueue.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      const item = this.saveQueue[0];

      try {
        await this.saveSession(item.session);

        // Remove from queue after success
        this.saveQueue.shift();
        this.log(`✓ Session saved: ${item.session.sessionId}`);
      } catch (error) {
        this.log(`⚠️ Save failed: ${error}`, 'error');

        // Increment retry count
        item.retryCount++;
        item.lastAttempt = Date.now();

        // Move to back of queue
        this.saveQueue.shift();
        this.saveQueue.push(item);

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    this.log('💾 Save worker stopped');
  }

  private enqueueSaveSession(session: SessionMetadata): void {
    // Check if queue is full
    if (this.saveQueue.length >= this.MAX_SAVE_SESSIONS) {
      const dropped = this.saveQueue.shift();
      this.log(`⚠️ SAVE QUEUE OVERFLOW - Dropped session: ${dropped?.session.sessionId}`, 'warning');
    }

    this.saveQueue.push({
      session,
      retryCount: 0,
    });

    this.log(`💾 Session enqueued for saving: ${session.sessionId} (queue: ${this.saveQueue.length}/${this.MAX_SAVE_SESSIONS})`);
  }

  private async saveSession(session: SessionMetadata): Promise<void> {
    this.log(`💾 ═══ SAVE SESSION START ═══`);
    this.log(`📋 Session: ${session.sessionId}`);
    this.log(`   ├─ First detected: ${session.firstDetectedAt}`);
    this.log(`   ├─ Batches: ${session.batches.length}`);
    this.log(`   └─ Timezone: ${session.timezone}`);

    // Combine all batches from the session
    // Use chunks (not blobs) to avoid duplicating init segment
    let combinedBlob: Blob;

    if (session.batches.length === 1) {
      // Single batch - use blob directly (includes init segment)
      combinedBlob = session.batches[0].blob;
      this.log(`📦 Single batch: ${(combinedBlob.size / 1024).toFixed(2)} KB`);
    } else {
      // Multiple batches - combine chunks with single init segment
      const allChunks: Blob[] = [];

      // Add init segment once at the beginning
      if (this.initSegment) {
        allChunks.push(this.initSegment);
        this.log(`📦 Adding init segment: ${(this.initSegment.size / 1024).toFixed(2)} KB`);
      }

      // Add all chunks from all batches
      for (const batch of session.batches) {
        allChunks.push(...batch.chunks);
      }

      combinedBlob = new Blob(allChunks, { type: this.getBestMimeType() });
      this.log(`📦 Multi-batch session: ${session.batches.length} batches combined`);
      this.log(`   Total chunks: ${allChunks.length}, Total size: ${(combinedBlob.size / 1024).toFixed(2)} KB`);
    }

    const totalSizeMB = (combinedBlob.size / 1024 / 1024).toFixed(2);
    this.log(`📦 Final blob: ${totalSizeMB} MB`);

    // Generate filename using first detection time
    const timestamp = new Date(session.firstDetectedAt);
    const filename = this.generateFilename(timestamp);

    this.log(`📤 Uploading: ${filename}`);

    // Upload (include sessionId for deterministic Firestore document ID)
    if (this.config.uploadCallback) {
      await this.config.uploadCallback(combinedBlob, filename, session.sessionId);
    }

    this.log(`✅ SAVE COMPLETE`);
    this.log(`💾 ═══ SAVE SESSION END ═══`);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private getBestMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }

    return '';
  }

  private generateFilename(timestamp: Date): string {
    // Convert to PST timezone using Intl.DateTimeFormat
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    const parts = formatter.formatToParts(timestamp);
    const year = parts.find(p => p.type === 'year')?.value || '';
    const month = parts.find(p => p.type === 'month')?.value || '';
    const day = parts.find(p => p.type === 'day')?.value || '';
    const hour = parts.find(p => p.type === 'hour')?.value || '';
    const minute = parts.find(p => p.type === 'minute')?.value || '';
    const second = parts.find(p => p.type === 'second')?.value || '';
    const dayPeriod = parts.find(p => p.type === 'dayPeriod')?.value || '';

    // Format: recording-YYYY-MM-DD_HH-MM-SS-AM/PM.webm
    return `recording-${year}-${month}-${day}_${hour}-${minute}-${second}-${dayPeriod}.webm`;
  }

  private log(message: string, type: 'info' | 'error' | 'warning' = 'info'): void {
    // 🎨 Color-coded logs for different system events
    let color = '#888'; // Default gray
    let bgColor = 'transparent';
    let fontWeight = 'normal';

    // Determine color based on message content
    if (message.includes('🎙️') || message.includes('📦') || message.includes('BATCHING') || message.includes('MediaRecorder')) {
      color = '#00ff88'; // Bright green - Recording
      fontWeight = 'bold';
    } else if (message.includes('🔊') || message.includes('PLAYBACK') || message.includes('Playing') || message.includes('▶️')) {
      color = '#ff00ff'; // Magenta - Playback
      fontWeight = 'bold';
    } else if (message.includes('💾') || message.includes('SAVE') || message.includes('Uploading')) {
      color = '#00aaff'; // Cyan - Saving
      fontWeight = 'bold';
    } else if (message.includes('📋') || message.includes('SESSION') || message.includes('🔒') || message.includes('🎬') || message.includes('🔄')) {
      color = '#ffaa00'; // Orange - Session lifecycle
      fontWeight = 'bold';
      bgColor = 'rgba(255, 170, 0, 0.1)';
    } else if (message.includes('🎛️') || message.includes('HARDWARE') || message.includes('Speakers')) {
      color = '#ff6600'; // Dark orange - Hardware
    } else if (message.includes('📼') || message.includes('SILENT PRE-ROLL')) {
      color = '#aa00ff'; // Purple - Init segment
    } else if (type === 'error' || message.includes('❌') || message.includes('FAILED')) {
      color = '#ff0000'; // Red - Errors
      fontWeight = 'bold';
      bgColor = 'rgba(255, 0, 0, 0.1)';
    } else if (type === 'warning' || message.includes('⚠️')) {
      color = '#ffff00'; // Yellow - Warnings
    } else if (message.includes('✅') || message.includes('COMPLETE')) {
      color = '#00ff00'; // Bright green - Success
      fontWeight = 'bold';
    }

    // Log with styling
    console.log(
      `%c[SimpleRecorder] ${message}`,
      `color: ${color}; background: ${bgColor}; font-weight: ${fontWeight}; padding: 2px 4px;`
    );

    if (this.config.onLog) {
      this.config.onLog(message, type);
    }
  }
}
