"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import type { AlgoDevice, PoEDevice } from "@/lib/algo/types";
import { storage } from "@/lib/firebase/config";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/contexts/auth-context";
import { getIdleVolumeString, getAlwaysKeepPagingOn } from "@/lib/settings";
import { CallCoordinator, CallState } from "@/lib/call-coordinator";
import { BatchCoordinator, type BatchCoordinatorConfig } from "@/lib/batch-coordinator";
import { addRecording, addActivityLog } from "@/lib/firebase/firestore";

// Debug mode - set to false for production to reduce console noise
const DEBUG_MODE = process.env.NODE_ENV === 'development';

// 🚀 FEATURE FLAG: New CallCoordinator System
// Set to true to use the new state machine architecture
// Set to false to use the legacy implementation
const USE_NEW_CALL_SYSTEM = true; // ✅ ENABLED - Using new state machine!

// 🎯 FEATURE FLAG: Micro-Batch System
// Set to true to use simplified batch recording/playback (replaces MediaSource streaming)
// Set to false to use CallCoordinator with MediaSource (legacy streaming)
const USE_BATCH_SYSTEM = true; // ✅ ENABLED - Using micro-batch architecture!

// Debug logging helper - only logs in development
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const debugLog = (...args: any[]) => {
  if (DEBUG_MODE) {
    console.log(...args);
  }
};

// Helper function to get current time in PST (Pacific Standard Time)
// Returns both ISO string and formatted date for organizing logs
const getPSTTime = () => {
  const now = new Date();

  // Get time in PST using Intl.DateTimeFormat
  const pstFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = pstFormatter.formatToParts(now);
  const partsObj: any = {};
  parts.forEach(part => {
    partsObj[part.type] = part.value;
  });

  // Create ISO-like timestamp in PST
  const timestamp = `${partsObj.year}-${partsObj.month}-${partsObj.day}T${partsObj.hour}:${partsObj.minute}:${partsObj.second}-08:00`;

  // Format date as YYYY-MM-DD for organizing logs by day
  const dateKey = `${partsObj.year}-${partsObj.month}-${partsObj.day}`;

  return { timestamp, dateKey };
};

// Web Worker for MP3 encoding
let mp3Worker: Worker | null = null;

export interface AudioLogEntry {
  timestamp: string;
  type: "audio_detected" | "audio_silent" | "speakers_enabled" | "speakers_disabled" | "volume_change" | "system";
  audioLevel?: number;
  audioThreshold?: number;
  speakersEnabled?: boolean;
  volume?: number;
  message: string;
  recordingUrl?: string; // URL to recorded audio clip
}

// Speaker connectivity status
export interface SpeakerStatus {
  speakerId: string;
  speakerName: string;
  ipAddress: string;
  isOnline: boolean;
  lastChecked: Date;
  errorMessage?: string;
}

interface AudioMonitoringContextType {
  // Audio capture state
  isCapturing: boolean;
  audioLevel: number;
  playbackAudioLevel: number; // Audio level of live playback output
  selectedInputDevice: string;
  volume: number;
  targetVolume: number;
  audioThreshold: number;

  // Speaker state
  audioDetected: boolean;
  speakersEnabled: boolean;

  // Ramp settings
  rampEnabled: boolean;
  rampDuration: number;
  dayNightMode: boolean;
  dayStartHour: number;
  dayEndHour: number;
  nightRampDuration: number;
  sustainDuration: number;
  disableDelay: number;
  setRampEnabled: (enabled: boolean) => void;
  setRampDuration: (duration: number) => void;
  setDayNightMode: (enabled: boolean) => void;
  setDayStartHour: (hour: number) => void;
  setDayEndHour: (hour: number) => void;
  setNightRampDuration: (duration: number) => void;
  setSustainDuration: (duration: number) => void;
  setDisableDelay: (delay: number) => void;

  // Device selection
  selectedDevices: string[];
  setSelectedDevices: (devices: string[]) => void;

  // Actions
  startMonitoring: (inputDevice?: string) => void;
  stopMonitoring: () => void;
  setInputDevice: (deviceId: string) => void;
  setVolume: (volume: number) => void;
  setTargetVolume: (volume: number) => void;
  setAudioThreshold: (threshold: number) => void;

  // For controlling speakers
  devices: AlgoDevice[];
  setDevices: (devices: AlgoDevice[]) => void;

  // For controlling PoE devices (lights, etc.)
  poeDevices: PoEDevice[];
  setPoeDevices: (devices: PoEDevice[]) => void;

  // Logging
  logs: AudioLogEntry[];
  clearLogs: () => void;
  exportLogs: () => string;
  loggingEnabled: boolean;
  setLoggingEnabled: (enabled: boolean) => void;

  // Recording
  recordingEnabled: boolean;
  setRecordingEnabled: (enabled: boolean) => void;

  // Playback
  playbackEnabled: boolean;
  setPlaybackEnabled: (enabled: boolean) => void;
  playbackDelay: number;
  setPlaybackDelay: (delay: number) => void;
  playbackDisableDelay: number;
  setPlaybackDisableDelay: (delay: number) => void;

  // Grace period settings
  tailGuardDuration: number;
  setTailGuardDuration: (duration: number) => void;
  postPlaybackGraceDuration: number;
  setPostPlaybackGraceDuration: (duration: number) => void;

  // Playback volume ramp settings
  playbackRampDuration: number;
  setPlaybackRampDuration: (duration: number) => void;
  playbackStartVolume: number;
  setPlaybackStartVolume: (volume: number) => void;
  playbackMaxVolume: number;
  setPlaybackMaxVolume: (volume: number) => void;
  playbackVolume: number; // Used when ramp is disabled
  setPlaybackVolume: (volume: number) => void;

  // Emergency Controls
  emergencyKillAll: () => Promise<void>;
  emergencyEnableAll: () => Promise<void>;
  controlSingleSpeaker: (speakerId: string, enable: boolean) => Promise<void>;

  // Speaker Status Tracking
  speakerStatuses: SpeakerStatus[];
  checkSpeakerConnectivity: () => Promise<void>;

  // Emulation Mode (for testing without physical devices)
  emulationMode: boolean;
  setEmulationMode: (enabled: boolean) => void;
  emulationNetworkDelay: number; // Network delay in ms (simulates slow polling)
  setEmulationNetworkDelay: (delay: number) => void;
  triggerTestCall: (durationSeconds?: number) => void;
}

const AudioMonitoringContext = createContext<AudioMonitoringContextType | null>(null);

// Helper function to convert audio blob to MP3 using Web Worker
async function convertToMp3(audioBlob: Blob): Promise<Blob> {
  console.log('[MP3 Convert] Starting conversion, blob size:', audioBlob.size, 'type:', audioBlob.type);

  // Decode the audio blob to an AudioBuffer
  const arrayBuffer = await audioBlob.arrayBuffer();
  console.log('[MP3 Convert] ArrayBuffer size:', arrayBuffer.byteLength);

  const audioContext = new AudioContext();
  console.log('[MP3 Convert] AudioContext created, decoding...');

  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  console.log('[MP3 Convert] Decoded - channels:', audioBuffer.numberOfChannels, 'sampleRate:', audioBuffer.sampleRate, 'duration:', audioBuffer.duration);

  // Get audio data as Float32Arrays
  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;

  const audioData: Float32Array[] = [];
  for (let i = 0; i < numberOfChannels; i++) {
    audioData.push(audioBuffer.getChannelData(i));
  }

  // Close the audio context
  await audioContext.close();

  // Initialize Web Worker if not already done
  if (!mp3Worker) {
    console.log('[MP3 Convert] Creating Web Worker...');
    mp3Worker = new Worker('/mp3-encoder-worker.js');
  }

  // Encode using Web Worker
  return new Promise((resolve, reject) => {
    if (!mp3Worker) {
      reject(new Error('Web Worker not available'));
      return;
    }

    const timeoutId = setTimeout(() => {
      reject(new Error('MP3 encoding timeout'));
    }, 30000); // 30 second timeout

    mp3Worker.onmessage = (e) => {
      clearTimeout(timeoutId);

      if (e.data.error) {
        console.error('[MP3 Convert] Worker error:', e.data.error);
        reject(new Error(e.data.error));
        return;
      }

      if (e.data.progress !== undefined) {
        // Progress update - ignore for now
        return;
      }

      if (e.data.success && e.data.mp3Data) {
        console.log('[MP3 Convert] Worker success, output size:', e.data.mp3Data.byteLength);
        const mp3Blob = new Blob([e.data.mp3Data], { type: 'audio/mp3' });
        resolve(mp3Blob);
      }
    };

    mp3Worker.onerror = (error) => {
      clearTimeout(timeoutId);
      console.error('[MP3 Convert] Worker error:', error);
      reject(new Error('MP3 Worker error: ' + error.message));
    };

    // Send audio data to worker
    console.log('[MP3 Convert] Sending to worker...');
    mp3Worker.postMessage({
      cmd: 'encode',
      audioData: audioData,
      sampleRate: sampleRate,
      bitRate: 128
    });
  });
}

// LocalStorage keys
const STORAGE_KEYS = {
  IS_MONITORING: 'algo_live_is_monitoring',
  SELECTED_DEVICES: 'algo_live_selected_devices',
  SELECTED_INPUT: 'algo_live_selected_input',
  TARGET_VOLUME: 'algo_live_target_volume',
  INPUT_GAIN: 'algo_live_input_gain',
  AUDIO_THRESHOLD: 'algo_live_audio_threshold',
  RAMP_ENABLED: 'algo_live_ramp_enabled',
  RAMP_DURATION: 'algo_live_ramp_duration',
  DAY_NIGHT_MODE: 'algo_live_day_night_mode',
  DAY_START_HOUR: 'algo_live_day_start_hour',
  DAY_END_HOUR: 'algo_live_day_end_hour',
  NIGHT_RAMP_DURATION: 'algo_live_night_ramp_duration',
  SUSTAIN_DURATION: 'algo_live_sustain_duration',
  DISABLE_DELAY: 'algo_live_disable_delay',
  LOGGING_ENABLED: 'algo_live_logging_enabled',
  RECORDING_ENABLED: 'algo_live_recording_enabled',
  PLAYBACK_ENABLED: 'algo_live_playback_enabled',
  PLAYBACK_DELAY: 'algo_live_playback_delay',
  PLAYBACK_DISABLE_DELAY: 'algo_live_playback_disable_delay',
  TAIL_GUARD_DURATION: 'algo_live_tail_guard_duration',
  POST_PLAYBACK_GRACE_DURATION: 'algo_live_post_playback_grace_duration',
  PLAYBACK_RAMP_DURATION: 'algo_live_playback_ramp_duration',
  PLAYBACK_START_VOLUME: 'algo_live_playback_start_volume',
  PLAYBACK_MAX_VOLUME: 'algo_live_playback_max_volume',
  PLAYBACK_VOLUME: 'algo_live_playback_volume',
  LAST_CONSOLE_CLEAR: 'algo_live_last_console_clear',
};

export function AudioMonitoringProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [selectedInputDevice, setSelectedInputDeviceState] = useState<string>("");
  const [volume, setVolumeState] = useState(50);
  const [targetVolume, setTargetVolumeState] = useState(100);
  const [audioThreshold, setAudioThresholdState] = useState(5); // 5% default
  const [selectedDevices, setSelectedDevicesState] = useState<string[]>([]);
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [poeDevices, setPoeDevices] = useState<PoEDevice[]>([]);
  const [audioDetected, setAudioDetected] = useState(false);
  const [speakersEnabled, setSpeakersEnabled] = useState(false);

  // Logging
  const [logs, setLogs] = useState<AudioLogEntry[]>([]);
  const [loggingEnabled, setLoggingEnabledState] = useState(true); // enabled by default
  const [recordingEnabled, setRecordingEnabledState] = useState(false); // disabled by default to save storage
  const [playbackEnabled, setPlaybackEnabledState] = useState(false); // disabled by default
  const [playbackDelay, setPlaybackDelayState] = useState(500); // 500ms default (wait after paging ready before playback)
  const [playbackDisableDelay, setPlaybackDisableDelayState] = useState(5000); // 5s default (wait after playback finishes before shutdown)

  // Grace period settings (in milliseconds)
  const [tailGuardDuration, setTailGuardDuration] = useState(3000); // 3s default (window after silence timeout)
  const [postPlaybackGraceDuration, setPostPlaybackGraceDuration] = useState(750); // 750ms default (window after playback ends)

  // Playback volume ramp settings
  const [playbackRampDuration, setPlaybackRampDuration] = useState(2000); // 2s default (was nightRampDuration in ms)
  const [playbackStartVolume, setPlaybackStartVolume] = useState(0); // 0 = silent start
  const [playbackMaxVolume, setPlaybackMaxVolume] = useState(1.0); // 1.0 = 100% volume
  const [playbackVolume, setPlaybackVolume] = useState(0.6); // Used when ramp is disabled (0.6 = 60%)

  // Speaker status tracking
  const [speakerStatuses, setSpeakerStatuses] = useState<SpeakerStatus[]>([]);

  // Ramp settings
  const [rampEnabled, setRampEnabledState] = useState(true);
  const [rampDuration, setRampDurationState] = useState(15); // 15 seconds default
  const [dayNightMode, setDayNightModeState] = useState(false);
  const [dayStartHour, setDayStartHourState] = useState(6); // 6 AM
  const [dayEndHour, setDayEndHourState] = useState(18); // 6 PM
  const [nightRampDuration, setNightRampDurationState] = useState(10); // 10 seconds for night
  const [sustainDuration, setSustainDurationState] = useState(50); // 50ms default for faster detection (in ms)
  const [disableDelay, setDisableDelayState] = useState(3000); // 3 seconds default (in ms)

  // Emulation mode state
  const [emulationMode, setEmulationModeState] = useState(false);
  const [emulationNetworkDelay, setEmulationNetworkDelay] = useState(0); // Network delay in ms (0 = instant)
  const testCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const testCallOscillatorRef = useRef<OscillatorNode | null>(null);
  const testCallContextRef = useRef<AudioContext | null>(null);

  const audioDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const controllingSpakersRef = useRef<boolean>(false);
  const volumeRampIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentVolumeRef = useRef<number>(0);
  const hasRestoredStateRef = useRef<boolean>(false);
  const isInitializedRef = useRef<boolean>(false);
  const previousDayModeRef = useRef<boolean | null>(null);
  const dayNightCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Sustained audio tracking
  const sustainedAudioStartRef = useRef<number | null>(null);
  const continuousRecordingRef = useRef<boolean>(false); // Track if continuous recording is active
  const validRecordingStartIndexRef = useRef<number>(0); // Track where valid recording starts in chunks array
  const sustainCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const speakersEnabledTimeRef = useRef<number | null>(null);
  const pagingWasEnabledRef = useRef<boolean>(false); // Track if we enabled paging during this session
  const shutdownInProgressRef = useRef<boolean>(false); // Track if shutdown is in progress (to prevent race conditions)

  // Recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<string | null>(null);

  // Playback
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingLiveRef = useRef<boolean>(false); // Track if live playback is active
  const playbackPositionRef = useRef<number>(0); // Track playback position in seconds
  const noChunksWarningShownRef = useRef<boolean>(false); // Track if we've shown "no chunks" warning
  const playbackErrorCountRef = useRef<number>(0); // Track consecutive playback errors
  const [playbackAudioLevel, setPlaybackAudioLevel] = useState<number>(0);
  const playbackAudioContextRef = useRef<AudioContext | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const playbackAnimationFrameRef = useRef<number | null>(null);

  // MediaSource playback infrastructure
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const mediaSourceUrlRef = useRef<string | null>(null);
  const pendingChunksQueueRef = useRef<Blob[]>([]); // Queue chunks while SourceBuffer updating
  const isAppendingRef = useRef<boolean>(false);
  const hasInitSegmentRef = useRef<boolean>(false);
  const mediaSourceReadyRef = useRef<boolean>(false);
  const streamingRecorderRef = useRef<MediaRecorder | null>(null); // Track which recorder started current playback

  // 🚀 NEW CALL COORDINATOR SYSTEM
  const callCoordinatorRef = useRef<CallCoordinator | null>(null);
  const batchCoordinatorRef = useRef<BatchCoordinator | null>(null);

  const {
    isCapturing,
    audioLevel,
    startCapture,
    stopCapture,
    setVolume: setGainVolume,
    mediaStream: monitoringStream,
  } = useAudioCapture();

  // Helper to add log entry
  const addLog = useCallback((entry: Omit<AudioLogEntry, "timestamp">) => {
    // Get PST timestamp
    const { timestamp, dateKey } = getPSTTime();

    const userEmail = user?.email || 'Unknown';
    const isAdmin = (user as any)?.role === 'admin';

    const logEntry: AudioLogEntry = {
      ...entry,
      timestamp,
      // Add user email prefix to message for attribution
      message: `[${userEmail}] ${entry.message}`,
    };

    // Always log to console for debugging
    debugLog(`[AudioLog] ${logEntry.message}`, logEntry);

    // Only add to logs if logging is enabled (admins included now!)
    if (!loggingEnabled) return;

    // Add to local state for backward compatibility
    setLogs(prev => {
      const newLogs = [...prev, logEntry];
      // Keep only last 500 entries to prevent memory issues
      if (newLogs.length > 500) {
        return newLogs.slice(-500);
      }
      return newLogs;
    });

    // Write to Firestore
    if (user) {
      addActivityLog({
        timestamp,
        dateKey,
        type: logEntry.type,
        message: logEntry.message,
        userId: user.uid,
        userEmail: userEmail,
        audioLevel: logEntry.audioLevel ?? null,
        audioThreshold: logEntry.audioThreshold ?? null,
        speakersEnabled: logEntry.speakersEnabled ?? null,
        volume: logEntry.volume ?? null,
        recordingUrl: logEntry.recordingUrl ?? null,
      }).catch(error => {
        console.error('[AudioLog] Failed to write log to Firestore:', error);
      });
    }
  }, [loggingEnabled, user]);

  // Get best supported audio mimeType
  const getBestAudioMimeType = useCallback(() => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];

    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('[Recording] Using mimeType:', type);
        return type;
      }
    }

    console.warn('[Recording] No preferred mimeType supported, using default');
    return '';
  }, []);

  // Start recording audio
  const startRecording = useCallback(async () => {
    try {
      // Recording is required if EITHER recording OR playback is enabled
      if (!recordingEnabled && !playbackEnabled) {
        debugLog('[Recording] Recording and playback both disabled, skipping');
        return;
      }

      if (!user) {
        console.warn('[Recording] No user authenticated, skipping recording');
        return;
      }

      // Log why we're recording
      if (playbackEnabled && !recordingEnabled) {
        debugLog('[Recording] Recording for playback only (not saving to Firebase)');
      } else if (recordingEnabled) {
        debugLog('[Recording] Recording to save to Firebase');
      }

      // REUSE the monitoring stream instead of creating a new one
      if (!monitoringStream) {
        console.warn('[Recording] No monitoring stream available, skipping recording');
        return;
      }

      // DEBUG: Log information about the monitoring stream
      const audioTracks = monitoringStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const track = audioTracks[0];
        console.log('[Recording] 🎙️ Recording from monitoring stream:');
        console.log('  - Device Label:', track.label);
        console.log('  - Device ID:', track.getSettings().deviceId);
        console.log('  - Sample Rate:', track.getSettings().sampleRate);
        console.log('  - Channel Count:', track.getSettings().channelCount);
      } else {
        console.warn('[Recording] ⚠️ No audio tracks in monitoring stream!');
      }

      // Get best supported mimeType
      const mimeType = getBestAudioMimeType();

      // Create media recorder with best supported format
      const options: MediaRecorderOptions = {};
      if (mimeType) {
        options.mimeType = mimeType;
      }

      const mediaRecorder = new MediaRecorder(monitoringStream, options);

      recordedChunksRef.current = [];

      // Generate PST timestamp with AM/PM format
      const now = new Date();
      const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      const year = pstTime.getFullYear();
      const month = String(pstTime.getMonth() + 1).padStart(2, '0');
      const day = String(pstTime.getDate()).padStart(2, '0');
      let hours = pstTime.getHours();
      const minutes = String(pstTime.getMinutes()).padStart(2, '0');
      const seconds = String(pstTime.getSeconds()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12; // Convert to 12-hour format
      const hoursStr = String(hours).padStart(2, '0');

      recordingStartTimeRef.current = `${year}-${month}-${day}-${hoursStr}-${minutes}-${seconds}-${ampm}`;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);

          // 🚀 NEW CALL COORDINATOR SYSTEM: Feed chunks to coordinator
          if (USE_NEW_CALL_SYSTEM && callCoordinatorRef.current) {
            callCoordinatorRef.current.onChunkRecorded(event.data);
          } else {
            // Legacy system: Append chunk to MediaSource if live playback is active AND this is the recorder that started playback
            if (playbackEnabled && isPlayingLiveRef.current && mediaSourceReadyRef.current && streamingRecorderRef.current === mediaRecorder) {
              appendChunkToSourceBuffer(event.data);
            }
          }
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
      mediaRecorderRef.current = mediaRecorder;

      debugLog('[Recording] Started recording audio from monitoring stream with mimeType:', mimeType || 'default');
    } catch (error) {
      console.error('[Recording] Failed to start recording:', error);
    }
  }, [recordingEnabled, playbackEnabled, user, monitoringStream, getBestAudioMimeType]);

  // Stop recording and upload to Firebase (unless playback is enabled - then it's temporary only)
  const stopRecordingAndUpload = useCallback(async (): Promise<string | null> => {
    return new Promise((resolve) => {
      try {
        const mediaRecorder = mediaRecorderRef.current;
        if (!mediaRecorder || !user || !recordingStartTimeRef.current) {
          resolve(null);
          return;
        }

        mediaRecorder.onstop = async () => {
          try {
            // Get the mimeType that was actually used
            const actualMimeType = mediaRecorder.mimeType || 'audio/webm';

            // Create blob from recorded chunks
            const audioBlob = new Blob(recordedChunksRef.current, { type: actualMimeType });

            if (audioBlob.size === 0) {
              console.warn('[Recording] No audio data recorded');
              resolve(null);
              return;
            }

            // Check if recording is enabled - if NOT, this was temporary for playback only
            if (!recordingEnabled) {
              console.log(`[Recording] Recording disabled - skipping Firebase upload (${audioBlob.size} bytes recorded for playback only)`);

              // Clean up temporary recording
              recordedChunksRef.current = [];
              recordingStartTimeRef.current = null;
              mediaRecorderRef.current = null;

              debugLog('[Recording] Temporary recording cleaned up (not saved to Firebase)');
              resolve(null);
              return;
            }

            // Determine file extension from mimeType
            let fileExtension = 'webm';
            if (actualMimeType.includes('opus')) {
              fileExtension = 'opus';
            } else if (actualMimeType.includes('ogg')) {
              fileExtension = 'ogg';
            } else if (actualMimeType.includes('mp4')) {
              fileExtension = 'm4a';
            }

            console.log(`[Recording] Saving ${audioBlob.size} bytes as ${fileExtension} (${actualMimeType})`);

            // Generate filename with PST timestamp (already formatted: YYYY-MM-DD-HH-MM-SS-AM/PM)
            const timestamp = recordingStartTimeRef.current!;
            const filename = `recording-${timestamp}.${fileExtension}`;

            // Create daily folder based on PST date (format: YYYY-MM-DD-pst-recordings)
            const now = new Date();
            const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
            const year = pstTime.getFullYear();
            const month = String(pstTime.getMonth() + 1).padStart(2, '0');
            const day = String(pstTime.getDate()).padStart(2, '0');
            const dailyFolder = `${year}-${month}-${day}-pst-recordings`;

            const filePath = `audio-recordings/${user.uid}/${dailyFolder}/${filename}`;

            // Upload to Firebase Storage
            debugLog(`[Recording] Uploading ${fileExtension.toUpperCase()} to ${filePath}`);
            const fileRef = storageRef(storage, filePath);
            await uploadBytes(fileRef, audioBlob);

            // Get download URL
            const downloadUrl = await getDownloadURL(fileRef);
            debugLog('[Recording] Upload successful:', downloadUrl);

            // Clean up
            recordedChunksRef.current = [];
            recordingStartTimeRef.current = null;
            mediaRecorderRef.current = null;

            // DON'T stop the stream tracks - we're reusing the monitoring stream!
            // The monitoring stream should only be stopped when stopMonitoring() is called

            resolve(downloadUrl);
          } catch (error) {
            console.error('[Recording] Upload failed:', error);
            resolve(null);
          }
        };

        mediaRecorder.stop();
      } catch (error) {
        console.error('[Recording] Stop failed:', error);
        resolve(null);
      }
    });
  }, [user, recordingEnabled]);

  // Setup AudioContext and Analyser (only once)
  const setupPlaybackAudioContext = useCallback(() => {
    if (playbackAudioContextRef.current && playbackAnalyserRef.current) {
      return; // Already setup
    }

    try {
      // Create AudioContext
      playbackAudioContextRef.current = new AudioContext();

      // Create analyser
      const analyser = playbackAudioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      playbackAnalyserRef.current = analyser;

      debugLog('[Playback] Created AudioContext and Analyser');

      // Start monitoring levels
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const updateLevel = () => {
        if (!playbackAnalyserRef.current || !isPlayingLiveRef.current) {
          setPlaybackAudioLevel(0);
          return;
        }

        playbackAnalyserRef.current.getByteFrequencyData(dataArray);

        // Calculate RMS level (similar to input audio level calculation)
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = dataArray[i] / 255;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const level = Math.min(100, rms * 200); // Scale to 0-100%

        setPlaybackAudioLevel(level);

        // Continue monitoring
        playbackAnimationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();
    } catch (error) {
      console.error('[Playback] Failed to setup AudioContext:', error);
    }
  }, []);

  // Connect audio element to analyser (called for EACH new audio element)
  const connectAudioElementToAnalyser = useCallback((audioElement: HTMLAudioElement) => {
    try {
      if (!playbackAudioContextRef.current || !playbackAnalyserRef.current) {
        console.warn('[Playback] AudioContext not ready, skipping connection');
        return;
      }

      // Resume AudioContext if suspended (browser autoplay policy)
      if (playbackAudioContextRef.current.state === 'suspended') {
        playbackAudioContextRef.current.resume().catch(err => {
          debugLog('[Playback] Could not resume AudioContext:', err);
        });
      }

      // Connect this audio element to the existing analyser
      // IMPORTANT: Must connect to destination or audio won't play!
      const source = playbackAudioContextRef.current.createMediaElementSource(audioElement);
      source.connect(playbackAnalyserRef.current);
      playbackAnalyserRef.current.connect(playbackAudioContextRef.current.destination);

      debugLog('[Playback] ✓ Connected new audio element to analyser');
    } catch (error) {
      // This can fail if the audio element is already connected or AudioContext is closed
      // Log but continue - audio will still play to system output
      debugLog('[Playback] Could not connect to analyser (audio will still play):', error);
    }
  }, []);

  // Stop playback level tracking
  const stopPlaybackLevelTracking = useCallback(() => {
    if (playbackAnimationFrameRef.current) {
      cancelAnimationFrame(playbackAnimationFrameRef.current);
      playbackAnimationFrameRef.current = null;
    }
    setPlaybackAudioLevel(0);
    debugLog('[Playback] Stopped audio level tracking');
  }, []);

  // Clean up MediaSource
  const cleanupMediaSource = useCallback(() => {
    debugLog('[MediaSource] Cleaning up');

    // CRITICAL: Disable MediaSource FIRST to prevent new chunks from trying to append
    mediaSourceReadyRef.current = false;
    hasInitSegmentRef.current = false;

    // Stop appending
    isAppendingRef.current = false;
    pendingChunksQueueRef.current = [];

    // Disconnect from the recorder (but don't stop it - it may still be recording)
    streamingRecorderRef.current = null;

    // End stream
    try {
      const mediaSource = mediaSourceRef.current;
      const sourceBuffer = sourceBufferRef.current;

      if (sourceBuffer && mediaSource && mediaSource.readyState === 'open') {
        if (!sourceBuffer.updating) {
          mediaSource.endOfStream();
        }
      }
    } catch (error) {
      debugLog('[MediaSource] Error during endOfStream:', error);
    }

    // Revoke object URL
    if (mediaSourceUrlRef.current) {
      URL.revokeObjectURL(mediaSourceUrlRef.current);
      mediaSourceUrlRef.current = null;
    }

    // Clear refs
    sourceBufferRef.current = null;
    mediaSourceRef.current = null;

    debugLog('[MediaSource] Cleanup complete');
  }, []);

  // Append chunk to SourceBuffer
  const appendChunkToSourceBuffer = useCallback(async (chunk: Blob): Promise<void> => {
    const processNextChunk = () => {
      if (pendingChunksQueueRef.current.length === 0) return;
      const nextChunk = pendingChunksQueueRef.current.shift();
      if (nextChunk) {
        appendChunkToSourceBuffer(nextChunk);
      }
    };

    try {
      const sourceBuffer = sourceBufferRef.current;
      const mediaSource = mediaSourceRef.current;

      if (!sourceBuffer || !mediaSource || mediaSource.readyState !== 'open') {
        // Queue chunk for later
        pendingChunksQueueRef.current.push(chunk);
        return;
      }

      // If SourceBuffer is updating, queue the chunk
      if (isAppendingRef.current || sourceBuffer.updating) {
        pendingChunksQueueRef.current.push(chunk);
        return;
      }

      isAppendingRef.current = true;

      // Convert Blob to ArrayBuffer
      const arrayBuffer = await chunk.arrayBuffer();

      // Track init segment
      if (!hasInitSegmentRef.current) {
        debugLog('[MediaSource] First chunk (initialization segment)');
        hasInitSegmentRef.current = true;
      }

      // CRITICAL: Re-check before append (MediaSource might have been cleaned up during arrayBuffer conversion)
      if (!sourceBufferRef.current || !mediaSourceRef.current || mediaSourceRef.current.readyState !== 'open') {
        debugLog('[MediaSource] SourceBuffer removed during append preparation, discarding chunk');
        isAppendingRef.current = false;
        return;
      }

      // Debug logging
      debugLog(`[MediaSource] Appending ${arrayBuffer.byteLength} bytes to SourceBuffer (MediaSource state: ${mediaSourceRef.current.readyState})`);

      // Append to SourceBuffer
      try {
        sourceBuffer.appendBuffer(arrayBuffer);
      } catch (appendError) {
        console.error('[MediaSource] appendBuffer threw error:', appendError);
        isAppendingRef.current = false;
        throw appendError;
      }

      // Wait for append to complete
      await new Promise<void>((resolve, reject) => {
        const onUpdateEnd = () => {
          sourceBuffer.removeEventListener('updateend', onUpdateEnd);
          sourceBuffer.removeEventListener('error', onError);
          isAppendingRef.current = false;
          resolve();

          // Process next queued chunk
          processNextChunk();
        };

        const onError = (e: Event) => {
          sourceBuffer.removeEventListener('updateend', onUpdateEnd);
          sourceBuffer.removeEventListener('error', onError);
          isAppendingRef.current = false;

          // Log detailed error information (safely, without accessing removed SourceBuffer)
          const mediaSource = mediaSourceRef.current;

          // If MediaSource is 'ended', this is expected (playback finished, queued chunks don't matter)
          if (mediaSource?.readyState === 'ended') {
            debugLog('[MediaSource] SourceBuffer append failed - MediaSource already ended (playback finished)');
            resolve(); // Resolve instead of reject - this is harmless
            return;
          }

          console.error('[MediaSource] SourceBuffer append error:', {
            error: e,
            mediaSourceReadyState: mediaSource?.readyState,
            arrayBufferSize: arrayBuffer.byteLength,
            chunkCount: hasInitSegmentRef.current ? 'has init' : 'first chunk',
          });

          reject(new Error('SourceBuffer append error'));
        };

        sourceBuffer.addEventListener('updateend', onUpdateEnd);
        sourceBuffer.addEventListener('error', onError);
      });
    } catch (error) {
      console.error('[MediaSource] Failed to append chunk:', error);
      isAppendingRef.current = false;
    }
  }, []);

  // Initialize MediaSource for streaming playback
  const initializeMediaSource = useCallback(async (): Promise<HTMLAudioElement | null> => {
    try {
      if (!playbackEnabled) return null;

      // Check MediaSource support
      if (!window.MediaSource) {
        console.error('[MediaSource] API not supported');
        return null;
      }

      // Use the SAME mimeType as MediaRecorder to ensure compatibility
      const mimeType = getBestAudioMimeType();
      debugLog(`[MediaSource] Using mimeType: ${mimeType}`);

      if (!MediaSource.isTypeSupported(mimeType)) {
        console.error('[MediaSource] Codec not supported:', mimeType);
        return null;
      }

      debugLog('[MediaSource] Creating MediaSource instance');
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;

      // Create object URL and audio element
      const url = URL.createObjectURL(mediaSource);
      mediaSourceUrlRef.current = url;

      const audio = new Audio();
      audio.src = url;
      playbackAudioRef.current = audio;

      // Setup audio level monitoring
      if (!playbackAudioContextRef.current) {
        setupPlaybackAudioContext();
      }
      connectAudioElementToAnalyser(audio);

      // Wait for MediaSource to open
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('MediaSource open timeout')), 5000);

        mediaSource.addEventListener('sourceopen', () => {
          clearTimeout(timeoutId);
          try {
            debugLog('[MediaSource] Opened, creating SourceBuffer');

            const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
            sourceBufferRef.current = sourceBuffer;

            // CRITICAL: Use 'sequence' mode for automatic gapless playback
            sourceBuffer.mode = 'sequence';

            debugLog('[MediaSource] SourceBuffer ready in sequence mode');
            mediaSourceReadyRef.current = true;
            resolve();
          } catch (error) {
            clearTimeout(timeoutId);
            reject(error);
          }
        });

        mediaSource.addEventListener('error', () => {
          clearTimeout(timeoutId);
          reject(new Error('MediaSource error'));
        });
      });

      return audio;
    } catch (error) {
      console.error('[MediaSource] Initialization failed:', error);
      cleanupMediaSource();
      return null;
    }
  }, [playbackEnabled, setupPlaybackAudioContext, connectAudioElementToAnalyser, cleanupMediaSource, getBestAudioMimeType]);

  // Start playback from recorded chunks using MediaSource API
  const startPlayback = useCallback(async () => {
    try {
      if (!playbackEnabled) {
        debugLog('[Playback] Playback disabled, skipping');
        return;
      }

      if (recordedChunksRef.current.length === 0) {
        console.warn('[Playback] No recorded chunks available yet');
        return;
      }

      console.log('[Playback] 🔴 Starting MediaSource LIVE STREAM playback');

      // Initialize MediaSource
      const audio = await initializeMediaSource();
      if (!audio) {
        console.error('[Playback] Failed to initialize MediaSource');
        return;
      }

      // Mark as playing
      isPlayingLiveRef.current = true;
      playbackPositionRef.current = 0;
      playbackErrorCountRef.current = 0;

      // Track which MediaRecorder started this playback session
      streamingRecorderRef.current = mediaRecorderRef.current;

      // Queue all existing chunks (they'll append automatically via the queue system)
      debugLog(`[Playback] Queuing ${recordedChunksRef.current.length} existing chunks`);
      for (const chunk of recordedChunksRef.current) {
        appendChunkToSourceBuffer(chunk); // Don't await - let them queue and process
      }

      // Wait until we have at least 1 second of audio buffered before playing
      // This prevents MediaSource from ending prematurely
      const startWait = Date.now();
      const maxWait = 5000; // 5 second timeout
      while (Date.now() - startWait < maxWait) {
        const sourceBuffer = sourceBufferRef.current;
        if (sourceBuffer && sourceBuffer.buffered.length > 0) {
          const bufferedDuration = sourceBuffer.buffered.end(0) - sourceBuffer.buffered.start(0);
          if (bufferedDuration >= 1.0) {
            debugLog(`[Playback] Buffered ${bufferedDuration.toFixed(2)}s of audio, ready to play`);
            break;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Start audio playback
      try {
        await audio.play();
        console.log('[Playback] ✓ MediaSource playback started successfully');

        addLog({
          type: "audio_detected",
          message: `Started MediaSource streaming (${recordedChunksRef.current.length} chunks from beginning)`,
        });
      } catch (playError) {
        if ((playError as Error).name !== 'AbortError') {
          console.error('[Playback] Audio.play() failed:', playError);
        }
      }

    } catch (error) {
      console.error('[Playback] Failed to start playback:', error);
      isPlayingLiveRef.current = false;
      cleanupMediaSource();
    }
  }, [playbackEnabled, addLog, initializeMediaSource, appendChunkToSourceBuffer, cleanupMediaSource]);

  // Stop playback
  const stopPlayback = useCallback(() => {
    console.log('[Playback] 🛑 Stopping live stream playback');

    // Disable live playback mode first
    isPlayingLiveRef.current = false;
    playbackPositionRef.current = 0;
    noChunksWarningShownRef.current = false; // Reset warning flag for next session

    // Stop audio level tracking
    stopPlaybackLevelTracking();

    // Stop current audio
    if (playbackAudioRef.current) {
      playbackAudioRef.current.pause();
      playbackAudioRef.current.src = ''; // Clear MediaSource URL
      playbackAudioRef.current = null;
    }

    // Clean up MediaSource
    cleanupMediaSource();

    // Clean up AudioContext
    if (playbackAudioContextRef.current) {
      playbackAudioContextRef.current.close();
      playbackAudioContextRef.current = null;
      playbackAnalyserRef.current = null;
      debugLog('[Playback] Cleaned up AudioContext');
    }

    addLog({
      type: "audio_silent",
      message: "Stopped live playback stream",
    });
  }, [addLog, stopPlaybackLevelTracking, cleanupMediaSource]);

  // Update gain when volume changes
  useEffect(() => {
    setGainVolume(volume);
  }, [volume, setGainVolume]);

  // Initialize and restore state from localStorage on mount
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    debugLog('[AudioMonitoring] Initializing and restoring state...');

    try {
      const savedDevices = localStorage.getItem(STORAGE_KEYS.SELECTED_DEVICES);
      const savedInput = localStorage.getItem(STORAGE_KEYS.SELECTED_INPUT);
      const savedTargetVolume = localStorage.getItem(STORAGE_KEYS.TARGET_VOLUME);
      const savedInputGain = localStorage.getItem(STORAGE_KEYS.INPUT_GAIN);
      const savedAudioThreshold = localStorage.getItem(STORAGE_KEYS.AUDIO_THRESHOLD);
      const savedRampEnabled = localStorage.getItem(STORAGE_KEYS.RAMP_ENABLED);
      const savedRampDuration = localStorage.getItem(STORAGE_KEYS.RAMP_DURATION);
      const savedDayNightMode = localStorage.getItem(STORAGE_KEYS.DAY_NIGHT_MODE);
      const savedDayStartHour = localStorage.getItem(STORAGE_KEYS.DAY_START_HOUR);
      const savedDayEndHour = localStorage.getItem(STORAGE_KEYS.DAY_END_HOUR);
      const savedNightRampDuration = localStorage.getItem(STORAGE_KEYS.NIGHT_RAMP_DURATION);
      const savedSustainDuration = localStorage.getItem(STORAGE_KEYS.SUSTAIN_DURATION);
      const savedDisableDelay = localStorage.getItem(STORAGE_KEYS.DISABLE_DELAY);
      const savedLoggingEnabled = localStorage.getItem(STORAGE_KEYS.LOGGING_ENABLED);
      const savedRecordingEnabled = localStorage.getItem(STORAGE_KEYS.RECORDING_ENABLED);
      const wasMonitoring = localStorage.getItem(STORAGE_KEYS.IS_MONITORING) === 'true';

      debugLog('[AudioMonitoring] Saved state:', {
        devices: savedDevices,
        input: savedInput,
        targetVolume: savedTargetVolume,
        inputGain: savedInputGain,
        audioThreshold: savedAudioThreshold,
        rampEnabled: savedRampEnabled,
        rampDuration: savedRampDuration,
        dayNightMode: savedDayNightMode,
        dayStartHour: savedDayStartHour,
        dayEndHour: savedDayEndHour,
        nightRampDuration: savedNightRampDuration,
        wasMonitoring,
      });

      if (savedDevices && savedDevices !== 'undefined') {
        try {
          const deviceIds = JSON.parse(savedDevices);
          debugLog('[AudioMonitoring] Restoring selected devices:', deviceIds);
          setSelectedDevicesState(deviceIds);
        } catch (error) {
          console.error('[AudioMonitoring] Failed to parse saved devices:', error);
          setSelectedDevicesState([]);
        }
      }
      if (savedInput) {
        debugLog('[AudioMonitoring] Restoring input device:', savedInput);
        setSelectedInputDeviceState(savedInput);
      }
      if (savedTargetVolume) {
        setTargetVolumeState(parseInt(savedTargetVolume));
      }
      if (savedInputGain) {
        setVolumeState(parseInt(savedInputGain));
      }
      if (savedAudioThreshold) {
        setAudioThresholdState(parseInt(savedAudioThreshold));
      }
      if (savedRampEnabled !== null) {
        setRampEnabledState(savedRampEnabled === 'true');
      }
      if (savedRampDuration) {
        setRampDurationState(parseInt(savedRampDuration));
      }
      if (savedDayNightMode !== null) {
        setDayNightModeState(savedDayNightMode === 'true');
      }
      if (savedDayStartHour) {
        setDayStartHourState(parseFloat(savedDayStartHour));
      }
      if (savedDayEndHour) {
        setDayEndHourState(parseFloat(savedDayEndHour));
      }
      if (savedNightRampDuration) {
        setNightRampDurationState(parseInt(savedNightRampDuration));
      }
      if (savedSustainDuration) {
        setSustainDurationState(parseInt(savedSustainDuration));
      }
      if (savedDisableDelay) {
        setDisableDelayState(parseInt(savedDisableDelay));
      }
      if (savedLoggingEnabled !== null) {
        setLoggingEnabledState(savedLoggingEnabled === 'true');
      }
      if (savedRecordingEnabled !== null) {
        setRecordingEnabledState(savedRecordingEnabled === 'true');
      }
      const savedPlaybackEnabled = localStorage.getItem(STORAGE_KEYS.PLAYBACK_ENABLED);
      if (savedPlaybackEnabled !== null) {
        setPlaybackEnabledState(savedPlaybackEnabled === 'true');
      }
      const savedPlaybackDelay = localStorage.getItem(STORAGE_KEYS.PLAYBACK_DELAY);
      if (savedPlaybackDelay !== null) {
        setPlaybackDelayState(parseInt(savedPlaybackDelay));
      }

      const savedPlaybackDisableDelay = localStorage.getItem(STORAGE_KEYS.PLAYBACK_DISABLE_DELAY);
      if (savedPlaybackDisableDelay !== null) {
        setPlaybackDisableDelayState(parseInt(savedPlaybackDisableDelay));
      }

      const savedTailGuardDuration = localStorage.getItem(STORAGE_KEYS.TAIL_GUARD_DURATION);
      if (savedTailGuardDuration !== null) {
        setTailGuardDuration(parseInt(savedTailGuardDuration));
      }

      const savedPostPlaybackGraceDuration = localStorage.getItem(STORAGE_KEYS.POST_PLAYBACK_GRACE_DURATION);
      if (savedPostPlaybackGraceDuration !== null) {
        setPostPlaybackGraceDuration(parseInt(savedPostPlaybackGraceDuration));
      }

      const savedPlaybackRampDuration = localStorage.getItem(STORAGE_KEYS.PLAYBACK_RAMP_DURATION);
      if (savedPlaybackRampDuration !== null) {
        setPlaybackRampDuration(parseInt(savedPlaybackRampDuration));
      }

      const savedPlaybackStartVolume = localStorage.getItem(STORAGE_KEYS.PLAYBACK_START_VOLUME);
      if (savedPlaybackStartVolume !== null) {
        setPlaybackStartVolume(parseFloat(savedPlaybackStartVolume));
      }

      const savedPlaybackMaxVolume = localStorage.getItem(STORAGE_KEYS.PLAYBACK_MAX_VOLUME);
      if (savedPlaybackMaxVolume !== null) {
        setPlaybackMaxVolume(parseFloat(savedPlaybackMaxVolume));
      }

      const savedPlaybackVolume = localStorage.getItem(STORAGE_KEYS.PLAYBACK_VOLUME);
      if (savedPlaybackVolume !== null) {
        setPlaybackVolume(parseFloat(savedPlaybackVolume));
      }

      // Mark as restored
      setTimeout(() => {
        hasRestoredStateRef.current = true;
        debugLog('[AudioMonitoring] State restoration complete');
      }, 100);

      // Auto-start monitoring if it was active before
      if (wasMonitoring) {
        debugLog('[AudioMonitoring] Auto-resuming monitoring from previous session');
        setTimeout(() => {
          startCapture(savedInput || undefined);
        }, 500);
      }
    } catch (error) {
      console.error('[AudioMonitoring] Failed to restore state:', error);
      hasRestoredStateRef.current = true;
    }
  }, [startCapture]);

  // Persist state changes to localStorage
  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving selected devices:', selectedDevices);
    localStorage.setItem(STORAGE_KEYS.SELECTED_DEVICES, JSON.stringify(selectedDevices));
  }, [selectedDevices]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving input device:', selectedInputDevice);
    localStorage.setItem(STORAGE_KEYS.SELECTED_INPUT, selectedInputDevice);
  }, [selectedInputDevice]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving target volume:', targetVolume);
    localStorage.setItem(STORAGE_KEYS.TARGET_VOLUME, targetVolume.toString());
  }, [targetVolume]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving input gain:', volume);
    localStorage.setItem(STORAGE_KEYS.INPUT_GAIN, volume.toString());
  }, [volume]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving monitoring state:', isCapturing);
    localStorage.setItem(STORAGE_KEYS.IS_MONITORING, isCapturing.toString());
  }, [isCapturing]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving audio threshold:', audioThreshold);
    localStorage.setItem(STORAGE_KEYS.AUDIO_THRESHOLD, audioThreshold.toString());
  }, [audioThreshold]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving ramp enabled:', rampEnabled);
    localStorage.setItem(STORAGE_KEYS.RAMP_ENABLED, rampEnabled.toString());
  }, [rampEnabled]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving ramp duration:', rampDuration);
    localStorage.setItem(STORAGE_KEYS.RAMP_DURATION, rampDuration.toString());
  }, [rampDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving day/night mode:', dayNightMode);
    localStorage.setItem(STORAGE_KEYS.DAY_NIGHT_MODE, dayNightMode.toString());
  }, [dayNightMode]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving day start hour:', dayStartHour);
    localStorage.setItem(STORAGE_KEYS.DAY_START_HOUR, dayStartHour.toString());
  }, [dayStartHour]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving day end hour:', dayEndHour);
    localStorage.setItem(STORAGE_KEYS.DAY_END_HOUR, dayEndHour.toString());
  }, [dayEndHour]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving night ramp duration:', nightRampDuration);
    localStorage.setItem(STORAGE_KEYS.NIGHT_RAMP_DURATION, nightRampDuration.toString());
  }, [nightRampDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving sustain duration:', sustainDuration);
    localStorage.setItem(STORAGE_KEYS.SUSTAIN_DURATION, sustainDuration.toString());
  }, [sustainDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving disable delay:', disableDelay);
    localStorage.setItem(STORAGE_KEYS.DISABLE_DELAY, disableDelay.toString());
  }, [disableDelay]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving logging enabled:', loggingEnabled);
    localStorage.setItem(STORAGE_KEYS.LOGGING_ENABLED, loggingEnabled.toString());
  }, [loggingEnabled]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving recording enabled:', recordingEnabled);
    localStorage.setItem(STORAGE_KEYS.RECORDING_ENABLED, recordingEnabled.toString());
  }, [recordingEnabled]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving playback enabled:', playbackEnabled);
    localStorage.setItem(STORAGE_KEYS.PLAYBACK_ENABLED, playbackEnabled.toString());
  }, [playbackEnabled]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving playback delay:', playbackDelay);
    localStorage.setItem(STORAGE_KEYS.PLAYBACK_DELAY, playbackDelay.toString());
  }, [playbackDelay]);

  // Persist playback disable delay to localStorage
  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving playback disable delay:', playbackDisableDelay);
    localStorage.setItem(STORAGE_KEYS.PLAYBACK_DISABLE_DELAY, playbackDisableDelay.toString());
  }, [playbackDisableDelay]);

  // Persist grace periods to localStorage
  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving TailGuard duration:', tailGuardDuration);
    localStorage.setItem(STORAGE_KEYS.TAIL_GUARD_DURATION, tailGuardDuration.toString());
  }, [tailGuardDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving post-playback grace duration:', postPlaybackGraceDuration);
    localStorage.setItem(STORAGE_KEYS.POST_PLAYBACK_GRACE_DURATION, postPlaybackGraceDuration.toString());
  }, [postPlaybackGraceDuration]);

  // Persist playback ramp settings to localStorage
  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving playback ramp duration:', playbackRampDuration);
    localStorage.setItem(STORAGE_KEYS.PLAYBACK_RAMP_DURATION, playbackRampDuration.toString());
  }, [playbackRampDuration]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving playback start volume:', playbackStartVolume);
    localStorage.setItem(STORAGE_KEYS.PLAYBACK_START_VOLUME, playbackStartVolume.toString());
  }, [playbackStartVolume]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving playback max volume:', playbackMaxVolume);
    localStorage.setItem(STORAGE_KEYS.PLAYBACK_MAX_VOLUME, playbackMaxVolume.toString());
  }, [playbackMaxVolume]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;
    debugLog('[AudioMonitoring] Saving playback volume (ramp disabled):', playbackVolume);
    localStorage.setItem(STORAGE_KEYS.PLAYBACK_VOLUME, playbackVolume.toString());
  }, [playbackVolume]);

  // Daily console clear for long-running sessions (clears at midnight PST)
  useEffect(() => {
    const checkConsoleClear = () => {
      const now = new Date();
      const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      const currentHour = pstTime.getHours();
      const currentMinute = pstTime.getMinutes();
      const pstDateString = pstTime.toDateString();

      // Get last clear date
      const lastClear = localStorage.getItem(STORAGE_KEYS.LAST_CONSOLE_CLEAR);

      // Clear console at midnight PST (00:00) if not already cleared today
      if (currentHour === 0 && currentMinute === 0 && lastClear !== pstDateString) {
        console.log('🧹 [System] Performing daily console clear to free memory...');
        console.log(`📅 Last clear: ${lastClear || 'Never'}`);
        console.log(`📊 Clearing console for 24/7 operation maintenance`);

        // Save clear date before clearing (so we can see it in logs afterward)
        localStorage.setItem(STORAGE_KEYS.LAST_CONSOLE_CLEAR, pstDateString);

        // Small delay to ensure logs are visible
        setTimeout(async () => {
          console.clear();
          console.log('✅ [System] Console cleared at midnight PST - logs reset for new day');
          console.log(`📅 Date: ${pstDateString}`);

          // Also clear the terminal where dev server is running
          try {
            await fetch('/api/clear-terminal', { method: 'POST' });
          } catch (error) {
            // Silently fail if API not available
          }
        }, 1000);
      }
    };

    // Check immediately on mount
    checkConsoleClear();

    // Check every minute (to catch midnight precisely)
    const interval = setInterval(checkConsoleClear, 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // Daily activity log refresh at midnight PST
  useEffect(() => {
    const checkLogRefresh = () => {
      const now = new Date();
      const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      const currentHour = pstTime.getHours();
      const currentMinute = pstTime.getMinutes();
      const pstDateString = pstTime.toDateString();

      // Get last log refresh date
      const lastLogRefresh = localStorage.getItem(STORAGE_KEYS.LAST_CONSOLE_CLEAR + '_logs');

      // Refresh logs at midnight PST (00:00) if not already refreshed today
      if (currentHour === 0 && currentMinute === 0 && lastLogRefresh !== pstDateString) {
        console.log('🔄 [System] Midnight PST - Refreshing activity logs for new day...');
        console.log(`📅 Previous log date: ${lastLogRefresh || 'First run'}`);
        console.log(`📅 New log date: ${pstDateString}`);

        // Save refresh date
        localStorage.setItem(STORAGE_KEYS.LAST_CONSOLE_CLEAR + '_logs', pstDateString);

        // Clear activity logs (they're already saved to Firebase)
        setLogs([]);

        // Add a system log for the new day
        setTimeout(() => {
          addLog({
            type: "system",
            message: `🌅 New day started - Activity logs refreshed for ${pstDateString} (PST)`,
          });
        }, 100);
      }
    };

    // Check immediately on mount
    checkLogRefresh();

    // Check every minute (to catch midnight precisely)
    const interval = setInterval(checkLogRefresh, 60 * 1000);

    return () => clearInterval(interval);
  }, [addLog]);

  // Watch for target volume changes - restart ramp if speakers are enabled
  useEffect(() => {
    if (!hasRestoredStateRef.current) return;

    // Only restart ramp if:
    // 1. Speakers are currently enabled
    // 2. Not currently controlling speakers
    // 3. Speakers were ALREADY enabled (don't trigger on initial enable)
    if (speakersEnabled && !controllingSpakersRef.current) {
      // Check if this is the initial enable (currentVolume should still be 0)
      const currentVolume = currentVolumeRef.current;

      // Don't start ramp on initial monitoring start - wait for audio detection
      // Only start ramp when targetVolume changes while already monitoring
      if (currentVolume > 0 || audioDetected) {
        debugLog(`[AudioMonitoring] Target volume changed, restarting ramp from ${currentVolume}% to ${targetVolume}%`);
        startVolumeRamp(currentVolume);
      } else {
        debugLog(`[AudioMonitoring] Speakers enabled but waiting for audio detection before ramping`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetVolume, speakersEnabled]);

  // Set volume on all linked speakers (8180s)
  // volumePercent is the "ramp percentage" (0-100)
  // Each speaker is scaled by its own maxVolume setting
  const setDevicesVolume = useCallback(async (volumePercent: number) => {
    const linkedSpeakerIds = new Set<string>();

    // Safety check: ensure selectedDevices is iterable
    const safeSelectedDevices = selectedDevices || [];

    for (const deviceId of safeSelectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      if (device.type === "8301" && device.linkedSpeakerIds) {
        device.linkedSpeakerIds.forEach(id => linkedSpeakerIds.add(id));
      }
    }

    // 🧪 EMULATION MODE: Skip actual network calls to speakers
    if (emulationMode) {
      debugLog(`[AudioMonitoring] 🧪 EMULATION: Simulated setting ${linkedSpeakerIds.size} speakers to ${volumePercent}%`);
      return;
    }

    debugLog(`[AudioMonitoring] setDevicesVolume(${volumePercent}%) - processing ${linkedSpeakerIds.size} speakers`);

    const volumePromises = Array.from(linkedSpeakerIds).map(async (speakerId) => {
      const speaker = devices.find(d => d.id === speakerId);
      if (!speaker) {
        debugLog(`[AudioMonitoring] Speaker ${speakerId} not found in devices array`);
        return;
      }

      // Skip speakers without proper credentials
      if (!speaker.ipAddress || !speaker.apiPassword) {
        console.warn(`[AudioMonitoring] Skipping ${speaker.name || speakerId}: missing IP or password`);
        return;
      }

      // Calculate actual volume: each speaker ramps to its own maxVolume
      // volumePercent represents the ramp progress (0-100%)
      // At 0%: speaker is at 0%, at 100%: speaker is at its maxVolume
      const speakerMaxVolume = speaker.maxVolume ?? 100;
      const actualVolume = (volumePercent / 100) * speakerMaxVolume;
      debugLog(`[AudioMonitoring] Setting ${speaker.name} to ${volumePercent.toFixed(0)}% of its max ${speakerMaxVolume}% = ${actualVolume.toFixed(0)}% (Level ${Math.round(actualVolume/10)})`);


      // Convert 0-100% to dB
      // SPECIAL CASE: 0% = idle volume (IDLE state - quietest before needing multicast control)
      // Normal range: Algo expects 1=-27dB, 2=-24dB, ... 10=0dB
      // Formula: dB = (level - 10) * 3
      let volumeDbString: string;
      if (actualVolume === 0) {
        volumeDbString = getIdleVolumeString(); // IDLE state - level -5 (quietest volume)
      } else {
        const volumeScale = Math.round((actualVolume / 100) * 10);
        const volumeDb = (volumeScale - 10) * 3;
        volumeDbString = volumeDb === 0 ? "0dB" : `${volumeDb}dB`;
      }

      debugLog(`[AudioMonitoring] ${speaker.name} final: ${actualVolume.toFixed(0)}% → ${volumeDbString}`);

      try {
        const response = await fetch("/api/algo/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod || "standard",
            settings: {
              "audio.page.vol": volumeDbString,
            },
          }),
        });

        if (!response.ok) {
          // Only log as warning (not error) - offline speakers are expected
          const errorText = await response.text().catch(() => 'Unknown error');
          debugLog(`[AudioMonitoring] ❌ Failed to set ${speaker.name} volume: ${errorText}`);
        } else {
          debugLog(`[AudioMonitoring] ✓ Successfully set ${speaker.name} to ${volumeDbString}`);
        }
      } catch (error) {
        // Network error - speaker might be offline, just skip silently
        debugLog(`[AudioMonitoring] ❌ Network error setting ${speaker.name} volume`);
      }
    });

    // Use allSettled to continue even if some speakers fail
    await Promise.allSettled(volumePromises);
    debugLog(`[AudioMonitoring] setDevicesVolume(${volumePercent}%) - completed`);
  }, [selectedDevices, devices, emulationMode, debugLog, getIdleVolumeString]);

  // Helper function to determine if it's currently daytime (supports half-hour intervals)
  const isDaytime = useCallback(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    // Convert to decimal hours (e.g., 6:30 = 6.5, 14:30 = 14.5)
    const currentTime = currentHour + (currentMinute >= 30 ? 0.5 : 0);
    return currentTime >= dayStartHour && currentTime < dayEndHour;
  }, [dayStartHour, dayEndHour]);

  // Helper to determine if ramping should be skipped (speakers stay at max)
  // Returns true if: ramp disabled OR (day/night mode enabled AND currently daytime)
  const shouldSkipRamping = useCallback(() => {
    if (!rampEnabled) {
      return true; // Ramp disabled - always skip
    }
    if (dayNightMode && isDaytime()) {
      return true; // Day/night mode enabled and it's daytime - skip ramping
    }
    return false; // Nighttime or day/night mode disabled - use ramping
  }, [rampEnabled, dayNightMode, isDaytime]);

  // Get the effective ramp duration based on settings
  const getEffectiveRampDuration = useCallback(() => {
    // If ramp is disabled, return 0 (instant)
    if (!rampEnabled) {
      debugLog('[AudioMonitoring] Ramp disabled - instant volume');
      return 0;
    }

    // If day/night mode is enabled, check time of day
    if (dayNightMode) {
      if (isDaytime()) {
        debugLog('[AudioMonitoring] Daytime detected - instant volume');
        return 0; // Instant during day
      } else {
        debugLog(`[AudioMonitoring] Nighttime detected - ${nightRampDuration}s ramp`);
        return nightRampDuration * 1000; // Night ramp duration in ms
      }
    }

    // Otherwise use the manual ramp duration setting
    debugLog(`[AudioMonitoring] Manual mode - ${rampDuration}s ramp`);
    return rampDuration * 1000;
  }, [rampEnabled, dayNightMode, isDaytime, rampDuration, nightRampDuration]);

  // Set all speakers to getIdleVolumeString() (idle state - quietest volume before needing multicast control)
  const setDevicesVolumeToIdle = useCallback(async () => {
    const linkedSpeakerIds = new Set<string>();

    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      if (device.type === "8301" && device.linkedSpeakerIds) {
        device.linkedSpeakerIds.forEach(id => linkedSpeakerIds.add(id));
      }
    }

    debugLog(`[AudioMonitoring] Setting ${linkedSpeakerIds.size} speakers to IDLE (${getIdleVolumeString()})`);

    const volumePromises = Array.from(linkedSpeakerIds).map(async (speakerId) => {
      const speaker = devices.find(d => d.id === speakerId);
      if (!speaker || !speaker.ipAddress || !speaker.apiPassword) return;

      try {
        await fetch("/api/algo/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod || "standard",
            settings: {
              "audio.page.vol": getIdleVolumeString(), // IDLE state - quietest volume (level -5)
            },
          }),
        });
        debugLog(`[AudioMonitoring] ✓ Set ${speaker.name} to IDLE (${getIdleVolumeString()})`);
      } catch (error) {
        debugLog(`[AudioMonitoring] ❌ Failed to set ${speaker.name} to idle`);
      }
    });

    await Promise.allSettled(volumePromises);
  }, [selectedDevices, devices]);

  // Ramp volume from startFrom to target
  // IMPORTANT: Ramp now starts at 10% (level 1), NOT 0%, to skip inaudible negative dB levels
  const startVolumeRamp = useCallback((startFrom: number = 0) => {
    if (volumeRampIntervalRef.current) {
      clearInterval(volumeRampIntervalRef.current);
    }

    const effectiveRampDuration = getEffectiveRampDuration();

    // Individual mode: Ramp to 100% (each speaker will scale to its maxVolume)
    const rampTarget = 100;

    // If ramp duration is 0 (instant), jump directly from idle volume to target volume
    if (effectiveRampDuration === 0) {
      debugLog(`[AudioMonitoring] Instant jump: ${getIdleVolumeString()} → each speaker to its max`);
      currentVolumeRef.current = rampTarget;
      setDevicesVolume(rampTarget);
      return;
    }

    // OPTIMIZATION: Start ramp at level 1 (10%), NOT 0%
    // This skips all the inaudible negative dB levels (getIdleVolumeString(), -30dB, -27dB, etc.)
    // Ramp: getIdleVolumeString() (static) → 10% (audible) → 20% → ... → target (much faster!)
    const rampStart = 10; // Level 1 (10%) = -27dB (first audible level)
    currentVolumeRef.current = rampStart;

    const stepInterval = 500;
    const steps = effectiveRampDuration / stepInterval;
    const volumeDiff = rampTarget - rampStart;
    const volumeIncrement = volumeDiff / steps;

    debugLog(`[AudioMonitoring] Optimized ramp: ${getIdleVolumeString()} → ${rampStart}% → 100% (each speaker to its max) over ${effectiveRampDuration/1000}s`);

    // Set initial volume to level 1 (10%) - skip inaudible levels!
    setDevicesVolume(rampStart);

    volumeRampIntervalRef.current = setInterval(() => {
      currentVolumeRef.current += volumeIncrement;

      if (volumeIncrement > 0 && currentVolumeRef.current >= rampTarget) {
        // Ramping up
        currentVolumeRef.current = rampTarget;
        setDevicesVolume(rampTarget);
        if (volumeRampIntervalRef.current) {
          clearInterval(volumeRampIntervalRef.current);
          volumeRampIntervalRef.current = null;
        }
        debugLog(`[AudioMonitoring] Volume ramp complete at ${rampTarget}%`);
      } else if (volumeIncrement < 0 && currentVolumeRef.current <= rampTarget) {
        // Ramping down
        currentVolumeRef.current = rampTarget;
        setDevicesVolume(rampTarget);
        if (volumeRampIntervalRef.current) {
          clearInterval(volumeRampIntervalRef.current);
          volumeRampIntervalRef.current = null;
        }
        debugLog(`[AudioMonitoring] Volume ramp complete at ${rampTarget}%`);
      } else {
        setDevicesVolume(currentVolumeRef.current);
      }
    }, stepInterval);
  }, [setDevicesVolume, getEffectiveRampDuration]);

  const stopVolumeRamp = useCallback(() => {
    if (volumeRampIntervalRef.current) {
      clearInterval(volumeRampIntervalRef.current);
      volumeRampIntervalRef.current = null;
    }
    currentVolumeRef.current = 0;
    // Set all speakers to getIdleVolumeString() (quietest volume - still has static at this level)
    setDevicesVolumeToIdle();
  }, []);

  // Auto-detect day/night mode changes while monitoring (24/7 operation)
  useEffect(() => {
    // Clear any existing interval first to prevent memory leaks
    if (dayNightCheckIntervalRef.current) {
      clearInterval(dayNightCheckIntervalRef.current);
      dayNightCheckIntervalRef.current = null;
    }

    // Only run if day/night mode is enabled
    if (!dayNightMode) {
      previousDayModeRef.current = null;
      return;
    }

    // Check every minute for day/night transitions
    dayNightCheckIntervalRef.current = setInterval(() => {
      // Calculate current day/night status directly to avoid function dependency
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      // Convert to decimal hours for comparison with half-hour intervals
      const currentTime = currentHour + (currentMinute >= 30 ? 0.5 : 0);
      const currentIsDaytime = currentTime >= dayStartHour && currentTime < dayEndHour;

      // Initialize on first run
      if (previousDayModeRef.current === null) {
        previousDayModeRef.current = currentIsDaytime;
        debugLog(`[AudioMonitoring] Day/night monitor initialized: ${currentIsDaytime ? 'DAY' : 'NIGHT'}`);
        return;
      }

      // Check if day/night mode changed
      if (previousDayModeRef.current !== currentIsDaytime) {
        debugLog(`[AudioMonitoring] ⏰ Day/night mode changed: ${previousDayModeRef.current ? 'DAY' : 'NIGHT'} → ${currentIsDaytime ? 'DAY' : 'NIGHT'}`);
        previousDayModeRef.current = currentIsDaytime;

        // If speakers are currently enabled, adjust volume based on new time period
        // Use refs to check current state without adding to dependencies
        if (speakersEnabled && !controllingSpakersRef.current) {
          if (currentIsDaytime) {
            // Transitioned to DAYTIME (e.g., 6:00 AM) - Set speakers to max immediately
            debugLog(`[AudioMonitoring] ⏰ DAYTIME started - Setting speakers to operating volume (max)`);
            setDevicesVolume(100); // Max volume for daytime
            addLog({
              type: "volume_change",
              volume: 100,
              message: "⏰ Daytime mode activated - Speakers set to operating volume (max)",
            });
          } else {
            // Transitioned to NIGHTTIME (e.g., 6:00 PM) - Set speakers to idle
            debugLog(`[AudioMonitoring] ⏰ NIGHTTIME started - Setting speakers to idle volume`);
            stopVolumeRamp(); // Stop any active ramp
            setDevicesVolume(0); // Idle volume for nighttime
            addLog({
              type: "volume_change",
              volume: 0,
              message: `⏰ Nighttime mode activated - Speakers set to idle (${getIdleVolumeString()})`,
            });
          }
        }
      }
    }, 60000); // Check every 60 seconds

    debugLog(`[AudioMonitoring] Day/night checker started (enabled: ${dayNightMode})`);

    return () => {
      if (dayNightCheckIntervalRef.current) {
        debugLog(`[AudioMonitoring] Day/night checker stopped (cleanup)`);
        clearInterval(dayNightCheckIntervalRef.current);
        dayNightCheckIntervalRef.current = null;
      }
    };
    // Only depend on stable values - not functions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayNightMode, dayStartHour, dayEndHour]);

  // Set paging device multicast mode (0=disabled, 1=transmitter, 2=receiver)
  // Smart: Checks current mode first to avoid redundant API calls
  const setPagingMulticast = useCallback(async (mode: 0 | 1 | 2) => {
    // CRITICAL: Only control SELECTED paging devices, not all paging devices!
    const pagingDevices = devices.filter(d =>
      d.type === "8301" && selectedDevices.includes(d.id)
    );

    if (pagingDevices.length === 0) {
      debugLog('[AudioMonitoring] No selected paging devices found');
      return;
    }

    debugLog(`[AudioMonitoring] Checking ${pagingDevices.length} selected paging device(s) before setting mode ${mode}...`);

    await Promise.allSettled(
      pagingDevices.map(async (paging) => {
        try {
          // First, check current mode (with error handling)
          let shouldProceed = true;

          try {
            const checkResponse = await fetch("/api/algo/settings/get", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ipAddress: paging.ipAddress,
                password: paging.apiPassword,
                authMethod: paging.authMethod,
                setting: "mcast.mode",
              }),
            });

            if (checkResponse.ok) {
              const checkData = await checkResponse.json();
              const currentMode = checkData.value;

              if (currentMode === mode.toString()) {
                debugLog(`[AudioMonitoring] ⏭️  ${paging.name} already at mode ${mode}, skipping`);
                addLog({
                  type: "speakers_enabled",
                  message: `Paging ${paging.name} already at mode ${mode}, skipped redundant call`,
                });
                return; // Already at target mode, skip
              }

              debugLog(`[AudioMonitoring] ${paging.name} is mode ${currentMode}, changing to ${mode}...`);
            } else {
              console.warn(`[AudioMonitoring] Failed to check ${paging.name} mode (HTTP ${checkResponse.status}), proceeding with mode change anyway`);
            }
          } catch (checkError) {
            console.warn(`[AudioMonitoring] Failed to check ${paging.name} mode:`, checkError);
            console.warn(`[AudioMonitoring] Proceeding with mode change anyway...`);
          }

          // Proceed with mode change (with retry logic for stuck devices)
          let retryCount = 0;
          const maxRetries = 3;
          let success = false;
          let lastError: any = null;

          while (retryCount < maxRetries && !success) {
            try {
              if (retryCount > 0) {
                console.warn(`[AudioMonitoring] Retry ${retryCount}/${maxRetries} for ${paging.name} mode change...`);
                // Wait 500ms between retries
                await new Promise(resolve => setTimeout(resolve, 500));
              }

              const response = await fetch("/api/algo/speakers/mcast", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  speakers: [{
                    ipAddress: paging.ipAddress,
                    password: paging.apiPassword,
                    authMethod: paging.authMethod,
                  }],
                  mode,
                }),
              });

              if (response.ok) {
                success = true;
                debugLog(`[AudioMonitoring] ✓ Set ${paging.name} to mode ${mode}${retryCount > 0 ? ` (after ${retryCount} retries)` : ''}`);
                addLog({
                  type: "speakers_enabled",
                  message: `Paging ${paging.name} mode ${mode} activated${retryCount > 0 ? ` (after ${retryCount} retries)` : ''}`,
                });
              } else {
                lastError = `HTTP ${response.status}`;
                console.error(`[AudioMonitoring] Failed to set ${paging.name} mode: HTTP ${response.status}`);
                retryCount++;
              }
            } catch (error) {
              lastError = error;
              console.error(`[AudioMonitoring] Error setting ${paging.name} mode:`, error);
              retryCount++;
            }
          }

          // If all retries failed, log warning
          if (!success) {
            console.error(`[AudioMonitoring] 🚨 FAILED to set ${paging.name} to mode ${mode} after ${maxRetries} attempts!`);
            addLog({
              type: "speakers_disabled",
              message: `⚠️ WARNING: Failed to change ${paging.name} mode - device may be stuck! Error: ${lastError}`,
            });
          }
        } catch (error) {
          console.error(`Failed to set ${paging.name} multicast mode:`, error);
        }
      })
    );
  }, [devices, selectedDevices, addLog]);

  // NEW: Set paging multicast IP for zone 1 - MUCH simpler than changing zones!
  // Active: 224.0.2.60:5002 (speakers listen here)
  // Idle: 224.0.2.60:50022 (different port, speakers don't receive)
  const setPagingMulticastIP = useCallback(async (active: boolean) => {
    const multicastIP = active ? "224.0.2.60:50002" : "224.0.2.60:50022";
    const mode = active ? "active" : "idle";

    // 🧪 EMULATION MODE: Skip actual API calls
    if (emulationMode) {
      debugLog(`[AudioMonitoring] 🧪 EMULATION: Simulating speaker IP change to ${mode} mode (${multicastIP})`);
      if (emulationNetworkDelay > 0) {
        debugLog(`[AudioMonitoring] 🧪 EMULATION: Simulating ${emulationNetworkDelay}ms network delay (polling)...`);
      }
      // Simulate network/polling delay
      await new Promise(resolve => setTimeout(resolve, emulationNetworkDelay || 100));
      debugLog(`[AudioMonitoring] 🧪 EMULATION: Speaker IP change complete`);
      return;
    }

    // DON'T touch paging devices - change speakers linked to selected paging devices!
    const selectedPagingDevices = devices.filter(d =>
      d.type === "8301" && selectedDevices.includes(d.id)
    );

    if (selectedPagingDevices.length === 0) {
      debugLog('[AudioMonitoring] No selected paging devices found');
      return;
    }

    // Get all linked speakers from all selected paging devices
    const allLinkedSpeakers: typeof devices = [];
    selectedPagingDevices.forEach(paging => {
      const linkedSpeakerIds = paging.linkedSpeakerIds || [];
      const linkedSpeakers = devices.filter(d => linkedSpeakerIds.includes(d.id));
      allLinkedSpeakers.push(...linkedSpeakers);
    });

    // Remove duplicates
    const speakerDevices = Array.from(new Set(allLinkedSpeakers.map(s => s.id)))
      .map(id => allLinkedSpeakers.find(s => s.id === id)!)
      .filter(Boolean);

    if (speakerDevices.length === 0) {
      debugLog('[AudioMonitoring] No linked speakers found for selected paging devices');
      return;
    }

    debugLog(`[AudioMonitoring] Setting ${speakerDevices.length} linked speaker(s) to ${mode} mode (${multicastIP})...`);

    // Change all speakers' mcast.zone1
    await Promise.allSettled(
      speakerDevices.map(async (speaker) => {
        try {
          // Change the multicast IP for zone 1
          const response = await fetch("/api/algo/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ipAddress: speaker.ipAddress,
              password: speaker.apiPassword,
              authMethod: speaker.authMethod,
              settings: {
                "mcast.zone1": multicastIP,
              },
            }),
          });

          if (response.ok) {
            debugLog(`[AudioMonitoring] ✓ Set ${speaker.name} multicast IP to ${multicastIP}`);

            // Reload device after zone change
            try {
              debugLog(`[AudioMonitoring] Reloading ${speaker.name}...`);
              const reloadResponse = await fetch("/api/algo/reload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ipAddress: speaker.ipAddress,
                  password: speaker.apiPassword,
                  authMethod: speaker.authMethod || "standard",
                }),
              });

              if (!reloadResponse.ok) {
                console.warn(`[AudioMonitoring] ⚠️ Failed to reload ${speaker.name}: HTTP ${reloadResponse.status}`);
              } else {
                debugLog(`[AudioMonitoring] ✓ Reload command sent to ${speaker.name}`);
              }
            } catch (reloadError) {
              console.warn(`[AudioMonitoring] ⚠️ Error reloading ${speaker.name}:`, reloadError);
            }
          } else {
            console.error(`[AudioMonitoring] Failed to set ${speaker.name} multicast IP: HTTP ${response.status}`);
          }
        } catch (error) {
          console.error(`Failed to set ${speaker.name} multicast IP:`, error);
        }
      })
    );

    // Poll ONLY the first speaker to verify (don't poll all of them)
    if (speakerDevices.length > 0) {
      const firstSpeaker = speakerDevices[0];
      debugLog(`[AudioMonitoring] Polling ${firstSpeaker.name} multicast IP status (verification speaker)...`);

      const maxPollAttempts = 20; // 20 attempts × 500ms = 10s max
      let pollAttempt = 0;
      let ipVerified = false;

      while (pollAttempt < maxPollAttempts && !ipVerified) {
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms between polls
        pollAttempt++;

        try {
          const pollResponse = await fetch("/api/algo/settings/get", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ipAddress: firstSpeaker.ipAddress,
              password: firstSpeaker.apiPassword,
              authMethod: firstSpeaker.authMethod,
              setting: "mcast.zone1",
            }),
          });

          if (pollResponse.ok) {
            const pollData = await pollResponse.json();
            const currentIP = pollData.value;

            if (currentIP === multicastIP) {
              ipVerified = true;
              debugLog(`[AudioMonitoring] ✓ ${firstSpeaker.name} multicast IP verified as ${multicastIP} (attempt ${pollAttempt})`);
              break;
            } else {
              debugLog(`[AudioMonitoring] Polling ${firstSpeaker.name}: IP is ${currentIP}, waiting for ${multicastIP}... (${pollAttempt}/${maxPollAttempts})`);
            }
          }
        } catch (pollError) {
          // Device might be reloading, continue polling
          debugLog(`[AudioMonitoring] Poll ${pollAttempt}: ${firstSpeaker.name} not responding (reloading...)`);
        }
      }

      if (!ipVerified) {
        console.warn(`[AudioMonitoring] ⚠️ Could not verify ${firstSpeaker.name} multicast IP change after ${maxPollAttempts} attempts`);
      }

      addLog({
        type: "speakers_enabled",
        message: `Speakers ${mode} mode activated (${multicastIP})${ipVerified ? ' (verified)' : ' (unverified)'}`,
      });
    }
  }, [devices, selectedDevices, addLog, emulationMode, emulationNetworkDelay]);

  // Wait for paging device to be ready by polling until mcast.mode = 1
  const waitForPagingReady = useCallback(async (): Promise<boolean> => {
    // CRITICAL: Only poll SELECTED paging devices, not all paging devices!
    const pagingDevices = devices.filter(d =>
      d.type === "8301" && selectedDevices.includes(d.id)
    );

    if (pagingDevices.length === 0) {
      console.warn('[AudioMonitoring] No selected paging devices to poll');
      return false;
    }

    const paging = pagingDevices[0]; // Use first paging device
    const maxAttempts = 2; // Try polling twice (with one retry if stuck)
    let attemptNum = 0;

    while (attemptNum < maxAttempts) {
      if (attemptNum > 0) {
        console.warn(`[AudioMonitoring] 🔄 Retry attempt ${attemptNum}/${maxAttempts - 1} - Re-sending mode change command...`);

        // Try to force the mode change again
        try {
          await fetch("/api/algo/speakers/mcast", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              speakers: [{
                ipAddress: paging.ipAddress,
                password: paging.apiPassword,
                authMethod: paging.authMethod,
              }],
              mode: 1,
            }),
          });
          debugLog('[AudioMonitoring] Re-sent mode change command');
        } catch (error) {
          console.error('[AudioMonitoring] Failed to re-send mode change:', error);
        }

        // Wait 1 second before polling again
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      const startTime = Date.now();
      const maxWaitMs = 5000; // Maximum 5 seconds per attempt
      const pollInterval = 200; // Check every 200ms

      debugLog(`[AudioMonitoring] 🔄 Polling ${paging.name} until mcast.mode = 1... (attempt ${attemptNum + 1}/${maxAttempts})`);

      while (Date.now() - startTime < maxWaitMs) {
        try {
          // Poll the mcast.mode setting
          const response = await fetch("/api/algo/settings/get", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ipAddress: paging.ipAddress,
              password: paging.apiPassword,
              authMethod: paging.authMethod,
              setting: "mcast.mode",
            }),
          });

          if (response.ok) {
            const data = await response.json();
            const currentMode = data.value;

            if (currentMode === "1") {
              const elapsed = Date.now() - startTime;
              debugLog(`[AudioMonitoring] ✅ Paging device ready! Mode = 1 after ${elapsed}ms${attemptNum > 0 ? ` (retry ${attemptNum} succeeded)` : ''}`);
              return true; // Device is ready!
            }

            debugLog(`[AudioMonitoring] ⏳ Mode = ${currentMode}, waiting... (${Date.now() - startTime}ms)`);
          }
        } catch (error) {
          debugLog(`[AudioMonitoring] Polling error: ${error}`);
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      // Timeout for this attempt
      attemptNum++;
      if (attemptNum >= maxAttempts) {
        // All attempts failed - device is stuck!
        console.error(`[AudioMonitoring] 🚨 PAGING DEVICE STUCK! Failed to reach mode 1 after ${maxAttempts} attempts (${maxWaitMs * maxAttempts / 1000}s total)`);
        addLog({
          type: "speakers_disabled",
          message: `⚠️ CRITICAL: Paging device ${paging.name} not responding after ${maxAttempts} attempts - device needs reboot!`,
        });
        return false;
      }

      console.warn(`[AudioMonitoring] ⚠️ Attempt ${attemptNum} timed out after ${maxWaitMs}ms, device may be stuck...`);
    }

    return false;
  }, [devices, selectedDevices, addLog]);

  // NEW: Wait for paging zone to change by polling mcast.tx.fixed
  const waitForPagingZoneReady = useCallback(async (targetZone: number): Promise<boolean> => {
    const pagingDevices = devices.filter(d =>
      d.type === "8301" && selectedDevices.includes(d.id)
    );

    if (pagingDevices.length === 0) {
      console.warn('[AudioMonitoring] No selected paging devices to poll');
      return false;
    }

    const paging = pagingDevices[0]; // Use first paging device
    const startTime = Date.now();
    const maxWaitMs = 3000; // Maximum 3 seconds (zones switch faster than mode changes)
    const pollInterval = 100; // Check every 100ms (faster polling for zones)

    debugLog(`[AudioMonitoring] 🔄 Polling ${paging.name} until zone = ${targetZone}...`);

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const pollAbort = new AbortController();
        const pollTimeout = setTimeout(() => pollAbort.abort(), 2000); // 2s timeout per poll

        const response = await fetch("/api/algo/settings/get", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: paging.ipAddress,
            password: paging.apiPassword,
            authMethod: paging.authMethod,
            setting: "mcast.tx.fixed",
          }),
          signal: pollAbort.signal,
        });

        clearTimeout(pollTimeout);

        if (response.ok) {
          const data = await response.json();
          const currentZone = parseInt(data.value);

          if (currentZone === targetZone) {
            const elapsed = Date.now() - startTime;
            debugLog(`[AudioMonitoring] ✅ Paging zone ready! Zone = ${targetZone} after ${elapsed}ms`);
            return true;
          }

          debugLog(`[AudioMonitoring] ⏳ Zone = ${currentZone}, waiting for ${targetZone}... (${Date.now() - startTime}ms)`);
        }
      } catch (error) {
        debugLog(`[AudioMonitoring] Polling error (timeout or fetch failed): ${error}`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout - zone didn't change
    console.warn(`[AudioMonitoring] ⚠️ Zone change timeout after ${maxWaitMs}ms (wanted zone ${targetZone})`);
    return false;
  }, [devices, selectedDevices]);

  // Wait for paging device to turn OFF by polling until mcast.mode = 0
  const waitForPagingOff = useCallback(async (): Promise<void> => {
    // CRITICAL: Only poll SELECTED paging devices, not all paging devices!
    const pagingDevices = devices.filter(d =>
      d.type === "8301" && selectedDevices.includes(d.id)
    );

    if (pagingDevices.length === 0) {
      console.warn('[AudioMonitoring] No selected paging devices to poll for OFF');
      return;
    }

    const paging = pagingDevices[0]; // Use first paging device
    const startTime = Date.now();
    const maxWaitMs = 10000; // Maximum 10 seconds for turning off (devices can be slow)
    const pollInterval = 200; // Check every 200ms

    debugLog(`[AudioMonitoring] 🔄 Polling ${paging.name} until mcast.mode = 0 (OFF)...`);

    while (Date.now() - startTime < maxWaitMs) {
      try {
        // Poll the mcast.mode setting
        const response = await fetch("/api/algo/settings/get", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: paging.ipAddress,
            password: paging.apiPassword,
            authMethod: paging.authMethod,
            setting: "mcast.mode",
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const currentMode = data.value;

          if (currentMode === "0") {
            const elapsed = Date.now() - startTime;
            debugLog(`[AudioMonitoring] ✅ Paging device OFF! Mode = 0 after ${elapsed}ms`);
            return; // Device is off!
          }

          debugLog(`[AudioMonitoring] ⏳ Mode = ${currentMode}, waiting for OFF... (${Date.now() - startTime}ms)`);
        }
      } catch (error) {
        debugLog(`[AudioMonitoring] Polling error: ${error}`);
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout - device might be stuck!
    console.error(`[AudioMonitoring] 🚨 PAGING DEVICE STUCK! Failed to reach mode 0 after ${maxWaitMs}ms`);
    addLog({
      type: "speakers_disabled",
      message: `⚠️ WARNING: Paging device ${paging.name} stuck ON - may need reboot!`,
    });
  }, [devices, selectedDevices, addLog]);

  // Set all speakers multicast mode (0=disabled, 1=transmitter, 2=receiver)
  const setSpeakersMulticast = useCallback(async (mode: 0 | 1 | 2) => {
    const linkedSpeakerIds = new Set<string>();

    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      if (device.type === "8301" && device.linkedSpeakerIds) {
        device.linkedSpeakerIds.forEach(id => linkedSpeakerIds.add(id));
      }
    }

    const speakers = Array.from(linkedSpeakerIds)
      .map(id => devices.find(d => d.id === id))
      .filter((s): s is AlgoDevice => !!s);

    if (speakers.length === 0) {
      debugLog('[AudioMonitoring] No speakers to control');
      return;
    }

    debugLog(`[AudioMonitoring] Setting ${speakers.length} speakers to multicast mode ${mode}`);

    await Promise.allSettled(
      speakers.map(async (speaker) => {
        try {
          await fetch("/api/algo/speakers/mcast", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              speakers: [{
                ipAddress: speaker.ipAddress,
                password: speaker.apiPassword,
                authMethod: speaker.authMethod,
              }],
              mode,
            }),
          });
          debugLog(`[AudioMonitoring] ✓ Set ${speaker.name} to mode ${mode}`);
        } catch (error) {
          console.error(`Failed to set ${speaker.name} multicast mode:`, error);
        }
      })
    );
  }, [selectedDevices, devices]);

  // Enable/disable speakers (LEGACY - kept for backward compatibility)
  const controlSpeakers = useCallback(async (enable: boolean) => {
    const allSpeakerPromises: Promise<void>[] = [];

    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      if (device.type === "8301" && device.linkedSpeakerIds && device.linkedSpeakerIds.length > 0) {
        const linkedSpeakers = devices.filter(d => device.linkedSpeakerIds?.includes(d.id));

        debugLog(`[AudioMonitoring] ${enable ? 'Enabling' : 'Disabling'} ${linkedSpeakers.length} speakers for ${device.name}`);

        // Control each speaker individually for better error resilience
        linkedSpeakers.forEach(speaker => {
          const promise = (async () => {
            try {
              const response = await fetch("/api/algo/speakers/mcast", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  speakers: [{
                    ipAddress: speaker.ipAddress,
                    password: speaker.apiPassword,
                    authMethod: speaker.authMethod,
                  }],
                  enable,
                }),
              });

              if (!response.ok) {
                console.error(`Failed to ${enable ? 'enable' : 'disable'} speaker ${speaker.name}: HTTP ${response.status}`);
              } else {
                debugLog(`[AudioMonitoring] Successfully ${enable ? 'enabled' : 'disabled'} ${speaker.name}`);
              }
            } catch (error) {
              console.error(`Failed to control speaker ${speaker.name}:`, error);
              // Continue with other speakers - don't throw
            }
          })();
          allSpeakerPromises.push(promise);
        });
      }
    }

    // Wait for all speakers to complete (parallel execution)
    // Individual failures won't crash the system
    await Promise.allSettled(allSpeakerPromises);
  }, [selectedDevices, devices]);

  // PoE Device Controls
  const controlPoEDevices = useCallback(async (enable: boolean) => {
    // 🧪 EMULATION MODE: Skip actual API calls
    if (emulationMode) {
      debugLog(`[PoE Control] 🧪 EMULATION: Simulated ${enable ? 'enabling' : 'disabling'} PoE devices`);
      await new Promise(resolve => setTimeout(resolve, 50));
      return;
    }

    debugLog(`[PoE Control] Total PoE devices: ${poeDevices.length}`);

    // Get PoE devices in auto mode
    const autoPoEDevices = poeDevices.filter(d => d.mode === "auto");

    debugLog(`[PoE Control] Auto mode PoE devices: ${autoPoEDevices.length}`);

    if (autoPoEDevices.length === 0) {
      debugLog('[PoE Control] No PoE devices in auto mode');
      return;
    }

    // Get active paging devices (8301) from selected devices
    const activePagingDeviceIds = selectedDevices.filter(deviceId => {
      const device = devices.find(d => d.id === deviceId);
      return device && device.type === "8301";
    });

    debugLog(`[PoE Control] Selected devices: ${selectedDevices.length}, Active paging devices (8301): ${activePagingDeviceIds.length}`, activePagingDeviceIds);

    // Filter PoE devices:
    // - Only control devices that are linked to at least one active paging device
    // - If device has no linkedPagingDeviceIds, DON'T auto-control (user manages it manually or it's always on)
    const eligiblePoEDevices = autoPoEDevices.filter(poeDevice => {
      // If no paging devices are linked, DON'T auto-control this device
      if (!poeDevice.linkedPagingDeviceIds || poeDevice.linkedPagingDeviceIds.length === 0) {
        debugLog(`[PoE Control] Device "${poeDevice.name}" has no linked paging devices - skipping`);
        return false;
      }

      // If paging devices are linked, check if any of them are active
      const hasActivePagingDevice = poeDevice.linkedPagingDeviceIds.some(
        linkedId => activePagingDeviceIds.includes(linkedId)
      );

      if (!hasActivePagingDevice) {
        debugLog(`[PoE Control] Device "${poeDevice.name}" linked paging devices not active - skipping. Linked: ${poeDevice.linkedPagingDeviceIds.join(',')}, Active: ${activePagingDeviceIds.join(',')}`);
      } else {
        debugLog(`[PoE Control] Device "${poeDevice.name}" is eligible (linked paging device is active)`);
      }

      return hasActivePagingDevice;
    });

    if (eligiblePoEDevices.length === 0) {
      debugLog(`[PoE Control] No eligible PoE devices to ${enable ? 'enable' : 'disable'} (no linked paging devices active)`);
      return;
    }

    debugLog(`[PoE Control] ${enable ? 'Enabling' : 'Disabling'} ${eligiblePoEDevices.length} PoE devices (${activePagingDeviceIds.length} paging devices active)`);

    // Log PoE control action
    addLog({
      type: enable ? "speakers_enabled" : "speakers_disabled",
      message: `PoE: ${enable ? 'ON' : 'OFF'} - ${eligiblePoEDevices.map(d => d.name).join(', ')}`,
    });

    const promises = eligiblePoEDevices.map(async (device) => {
      try {
        const response = await fetch("/api/poe/toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId: device.id,
            enabled: enable,
          }),
        });

        if (!response.ok) {
          console.error(`Failed to ${enable ? 'enable' : 'disable'} PoE device ${device.name}: HTTP ${response.status}`);
          addLog({
            type: enable ? "speakers_enabled" : "speakers_disabled",
            message: `⚠️ PoE ${device.name} failed: HTTP ${response.status}`,
          });
        } else {
          debugLog(`[PoE Control] Successfully ${enable ? 'enabled' : 'disabled'} ${device.name}`);
        }
      } catch (error) {
        console.error(`Failed to control PoE device ${device.name}:`, error);
        addLog({
          type: enable ? "speakers_enabled" : "speakers_disabled",
          message: `⚠️ PoE ${device.name} error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    });

    await Promise.allSettled(promises);
  }, [poeDevices, selectedDevices, devices, addLog, emulationMode]);

  // Emergency Controls
  const emergencyKillAll = useCallback(async () => {
    debugLog('[AudioMonitoring] EMERGENCY: Killing all speakers');
    addLog({
      type: "speakers_disabled",
      message: "EMERGENCY KILL: Shutting down paging and all speakers IMMEDIATELY",
    });

    // NEW FLOW: Emergency shutdown
    // 1. Mute all speakers to getIdleVolumeString()
    await setDevicesVolume(0);

    // 2. Disable paging transmitter (INSTANT silence - no more audio broadcast!)
    await setPagingMulticast(0);

    // 3. Disable all speaker receivers
    await setSpeakersMulticast(0);

    // Reset state
    setSpeakersEnabled(false);
    setAudioDetected(false);
    currentVolumeRef.current = 0;
    if (volumeRampIntervalRef.current) {
      clearInterval(volumeRampIntervalRef.current);
      volumeRampIntervalRef.current = null;
    }

    debugLog(`[AudioMonitoring] ✓ EMERGENCY KILL COMPLETE: All devices mode 0, volume ${getIdleVolumeString()}`);
  }, [setDevicesVolume, setPagingMulticast, setSpeakersMulticast, addLog]);

  const emergencyEnableAll = useCallback(async () => {
    debugLog('[AudioMonitoring] EMERGENCY: Enabling all speakers');
    addLog({
      type: "speakers_enabled",
      message: "EMERGENCY ENABLE: Activating paging and all speakers at target volume",
    });

    // NEW FLOW: Emergency enable
    // 1. Set speakers to mode 2 (receivers)
    await setSpeakersMulticast(2);

    // 2. Enable paging transmitter (mode 1 - START broadcasting!)
    await setPagingMulticast(1);

    // 3. Set to target volume (instant - no ramp in emergency)
    await setDevicesVolume(targetVolume);

    setSpeakersEnabled(true);
    currentVolumeRef.current = targetVolume;

    debugLog('[AudioMonitoring] ✓ EMERGENCY ENABLE COMPLETE: Paging ON, Speakers listening, Volume set');
  }, [setSpeakersMulticast, setPagingMulticast, setDevicesVolume, targetVolume, addLog]);

  const controlSingleSpeaker = useCallback(async (speakerId: string, enable: boolean) => {
    const speaker = devices.find(d => d.id === speakerId);
    if (!speaker) {
      console.error(`Speaker ${speakerId} not found`);
      return;
    }

    debugLog(`[AudioMonitoring] ${enable ? 'Enabling' : 'Disabling'} single speaker: ${speaker.name}`);
    addLog({
      type: enable ? "speakers_enabled" : "speakers_disabled",
      message: `${enable ? 'Enabled' : 'Disabled'} speaker: ${speaker.name}`,
    });

    try {
      // Control multicast
      await fetch("/api/algo/speakers/mcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speakers: [{
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod,
          }],
          enable,
        }),
      });

      // If disabling, also mute
      if (!enable) {
        await fetch("/api/algo/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod,
            settings: { "audio.page.vol": getIdleVolumeString() }, // IDLE state - eliminates buzzing
          }),
        });
      }
    } catch (error) {
      console.error(`Failed to control speaker ${speaker.name}:`, error);
    }
  }, [devices, addLog]);

  // ============================================================================
  // EMULATION MODE - Testing without physical devices
  // ============================================================================

  /**
   * Enable/disable emulation mode
   * When enabled: Creates 12 fake speakers + 1 fake paging device
   */
  const setEmulationMode = useCallback((enabled: boolean) => {
    setEmulationModeState(enabled);

    if (enabled) {
      // Generate fake devices
      const now = new Date();
      const fakePaging: AlgoDevice = {
        id: 'emu-paging-1',
        name: 'EMU Paging Device 8301',
        type: '8301',
        ipAddress: '192.168.1.100',
        apiPassword: 'emu-pass',
        authMethod: 'basic',
        linkedSpeakerIds: [], // Will be populated with speaker IDs
        ownerEmail: user?.email || '',
        zone: null,
        volume: 100,
        isOnline: true,
        lastSeen: now,
        createdAt: now,
        updatedAt: now,
      };

      const fakeSpeakers: AlgoDevice[] = [];
      for (let i = 1; i <= 12; i++) {
        const isEven = i % 2 === 0;
        fakeSpeakers.push({
          id: `emu-speaker-${i}`,
          name: `EMU Speaker ${isEven ? '8198' : '8180g2'}-${i}`,
          type: isEven ? '8198' : '8180g2',
          ipAddress: `192.168.1.${100 + i}`,
          apiPassword: 'emu-pass',
          authMethod: 'basic',
          ownerEmail: user?.email || '',
          zone: null,
          volume: 100,
          maxVolume: 100,
          isOnline: true,
          lastSeen: now,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Link speakers to paging device
      fakePaging.linkedSpeakerIds = fakeSpeakers.map(s => s.id);

      // Set devices
      setDevices([fakePaging, ...fakeSpeakers]);
      setSelectedDevicesState([fakePaging.id]); // Auto-select paging device

      addLog({
        type: 'system',
        message: '🧪 EMULATION MODE ENABLED: 1 paging device + 12 speakers created'
      });

      console.log('[Emulation] Generated devices:', { paging: fakePaging, speakers: fakeSpeakers });
    } else {
      // Clear fake devices
      setDevices([]);
      setSelectedDevicesState([]);

      addLog({
        type: 'system',
        message: '🧪 EMULATION MODE DISABLED: Fake devices removed'
      });
    }
  }, [setDevices, addLog]);

  /**
   * Trigger a test emergency call
   * Simulates audio input for testing the system by injecting fake audio events
   */
  const triggerTestCall = useCallback((durationSeconds: number = 5) => {
    if (!isCapturing) {
      addLog({
        type: 'system',
        message: '⚠️ Cannot trigger test call: Monitoring not started'
      });
      return;
    }

    if (!batchCoordinatorRef.current) {
      addLog({
        type: 'system',
        message: '⚠️ Cannot trigger test call: Batch coordinator not initialized'
      });
      return;
    }

    addLog({
      type: 'system',
      message: `🧪 TEST CALL TRIGGERED: ${durationSeconds}s simulated emergency audio`
    });

    console.log(`[Emulation] Test call started: ${durationSeconds}s`);

    // Inject fake audio detection events
    const coordinator = batchCoordinatorRef.current;
    const injectionInterval = 100; // Inject events every 100ms
    let elapsed = 0;

    const injectionTimer = setInterval(() => {
      elapsed += injectionInterval;

      if (elapsed > durationSeconds * 1000) {
        // Test call duration complete - trigger silence
        clearInterval(injectionTimer);
        coordinator.onSilence();

        addLog({
          type: 'system',
          message: '🧪 TEST CALL ENDED - injected silence event'
        });

        console.log('[Emulation] Test call ended');
        return;
      }

      // Inject fake audio detection (simulates sustained audio above threshold)
      // Use variable level for realism (50-90%)
      const fakeLevel = 0.5 + Math.random() * 0.4;
      coordinator.onAudioDetected(fakeLevel);

    }, injectionInterval);

    // Store timeout ref for cleanup
    if (testCallTimeoutRef.current) {
      clearTimeout(testCallTimeoutRef.current);
    }
    testCallTimeoutRef.current = injectionTimer as unknown as NodeJS.Timeout;

  }, [isCapturing, addLog]);

  // ============================================================================
  // END EMULATION MODE
  // ============================================================================

  // Check connectivity of all linked speakers
  const checkSpeakerConnectivity = useCallback(async () => {
    const linkedSpeakerIds = new Set<string>();

    // Safety check: ensure selectedDevices is iterable
    const safeSelectedDevices = selectedDevices || [];

    // Get all linked speakers from selected paging devices
    for (const deviceId of safeSelectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;
      if (device.type === "8301" && device.linkedSpeakerIds) {
        device.linkedSpeakerIds.forEach(id => linkedSpeakerIds.add(id));
      }
    }

    if (linkedSpeakerIds.size === 0) {
      setSpeakerStatuses([]);
      return;
    }

    // Build device list for health check API
    const speakersToCheck = Array.from(linkedSpeakerIds)
      .map(id => devices.find(d => d.id === id))
      .filter((s): s is AlgoDevice => !!s && !!s.ipAddress && !!s.apiPassword);

    if (speakersToCheck.length === 0) {
      setSpeakerStatuses([]);
      return;
    }

    debugLog(`[AudioMonitoring] Checking connectivity for ${speakersToCheck.length} speakers...`);

    try {
      const response = await fetch("/api/algo/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          devices: speakersToCheck.map(s => ({
            id: s.id,
            ipAddress: s.ipAddress,
            apiPassword: s.apiPassword,
            authMethod: s.authMethod || "standard",
          })),
          timeout: 3000,
        }),
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      const result = await response.json();

      // Convert API response to SpeakerStatus array
      const statuses: SpeakerStatus[] = result.devices.map((d: { id: string; ipAddress: string; isOnline: boolean; error?: string }) => {
        const speaker = devices.find(s => s.id === d.id);
        return {
          speakerId: d.id,
          speakerName: speaker?.name || 'Unknown',
          ipAddress: d.ipAddress,
          isOnline: d.isOnline,
          lastChecked: new Date(),
          errorMessage: d.error,
        };
      });

      setSpeakerStatuses(statuses);

      const onlineCount = statuses.filter(s => s.isOnline).length;
      const offlineCount = statuses.filter(s => !s.isOnline).length;

      addLog({
        type: offlineCount > 0 ? "speakers_disabled" : "speakers_enabled",
        message: `Connectivity check: ${onlineCount} online, ${offlineCount} offline`,
      });

      debugLog(`[AudioMonitoring] Connectivity check complete: ${onlineCount} online, ${offlineCount} offline`);
    } catch (error) {
      console.error('[AudioMonitoring] Connectivity check failed:', error);
      // Set all as unknown status on error
      const statuses: SpeakerStatus[] = speakersToCheck.map(s => ({
        speakerId: s.id,
        speakerName: s.name || 'Unknown',
        ipAddress: s.ipAddress || 'Unknown',
        isOnline: false,
        lastChecked: new Date(),
        errorMessage: 'Check failed',
      }));
      setSpeakerStatuses(statuses);
    }
  }, [selectedDevices, devices, addLog]);

  // 🚀 NEW CALL COORDINATOR: Upload callback for saving recordings to Firebase
  const uploadRecordingToFirebase = useCallback(async (blob: Blob, mimeType: string, firstAudioTimestamp: number, isPlayback?: boolean): Promise<string> => {
    if (!user) {
      throw new Error('No user logged in');
    }

    // Check if recording is enabled
    if (!recordingEnabled) {
      debugLog('[Upload] Recording disabled, skipping upload');
      throw new Error('Recording disabled');
    }

    try {
      // Determine file extension based on mime type
      let fileExtension = 'webm';
      if (mimeType.includes('ogg')) {
        fileExtension = 'ogg';
      } else if (mimeType.includes('mp4')) {
        fileExtension = 'm4a';
      }

      // Use first audio detection timestamp (PST) for filename
      const detectionTime = new Date(firstAudioTimestamp);
      const pstTime = new Date(detectionTime.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
      const year = pstTime.getFullYear();
      const month = String(pstTime.getMonth() + 1).padStart(2, '0');
      const day = String(pstTime.getDate()).padStart(2, '0');
      let hours = pstTime.getHours();
      const minutes = String(pstTime.getMinutes()).padStart(2, '0');
      const seconds = String(pstTime.getSeconds()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      const hoursStr = String(hours).padStart(2, '0');

      const timestamp = `${year}-${month}-${day}-${hoursStr}-${minutes}-${seconds}-${ampm}`;

      // Append "-playback" suffix if this is a playback recording
      const recordingType = isPlayback ? 'playback' : 'input';
      const filenameSuffix = isPlayback ? '-playback' : '';
      const filename = `recording-${timestamp}${filenameSuffix}.${fileExtension}`;

      // Create daily folder (clean format: YYYY-MM-DD)
      const dailyFolder = `${year}-${month}-${day}`;

      // Use email instead of UID for folder structure
      const userEmail = user.email || user.uid;
      const filePath = `${userEmail}/${dailyFolder}/${filename}`;

      // Upload to Firebase Storage
      debugLog(`[CallCoordinator] Uploading ${recordingType.toUpperCase()} recording (${fileExtension.toUpperCase()}) to ${filePath}`);
      const fileRef = storageRef(storage, filePath);
      await uploadBytes(fileRef, blob);

      // Get download URL
      const downloadUrl = await getDownloadURL(fileRef);
      debugLog(`[CallCoordinator] ${recordingType.toUpperCase()} recording upload successful:`, downloadUrl);

      // Save metadata to Firestore for fast querying (admin recordings page)
      try {
        await addRecording({
          userId: user.uid,
          userEmail: user.email || 'unknown',
          filename,
          storageUrl: downloadUrl,
          storagePath: filePath,
          size: blob.size,
          mimeType,
          timestamp: detectionTime,
          dateKey: dailyFolder,
        });
        debugLog('[CallCoordinator] Metadata saved to Firestore');
      } catch (metaError) {
        console.error('[CallCoordinator] Failed to save metadata to Firestore:', metaError);
        // Don't throw - upload succeeded, metadata is optional
      }

      return downloadUrl;
    } catch (error) {
      console.error('[CallCoordinator] Upload failed:', error);
      throw error;
    }
  }, [user, recordingEnabled]);

  // 🚀 COORDINATOR SYSTEM: Initialize/update when config changes
  useEffect(() => {
    if (!USE_NEW_CALL_SYSTEM && !USE_BATCH_SYSTEM) return;
    if (!isCapturing) return;
    if (!monitoringStream) return;

    // Check which coordinator is currently active and handle state accordingly
    if (USE_BATCH_SYSTEM) {
      // Using BatchCoordinator
      if (batchCoordinatorRef.current) {
        const currentState = batchCoordinatorRef.current.getState();
        if (currentState !== 'Idle') {
          debugLog('[BatchCoordinator] Config changed but call is active, will apply on next call');
          return;
        } else {
          debugLog('[BatchCoordinator] Config changed, recreating coordinator in Idle state');
          batchCoordinatorRef.current.abort();
          batchCoordinatorRef.current = null;
        }
      }
    } else if (USE_NEW_CALL_SYSTEM) {
      // Using CallCoordinator (legacy)
      if (callCoordinatorRef.current) {
        const currentState = callCoordinatorRef.current.getState();
        if (currentState !== 'Idle') {
          debugLog('[CallCoordinator] Config changed but call is active, will apply on next call');
          return;
        } else {
          debugLog('[CallCoordinator] Config changed, recreating coordinator in Idle state');
          callCoordinatorRef.current.abort();
          callCoordinatorRef.current = null;
        }
      }
    }

    const coordinatorName = USE_BATCH_SYSTEM ? 'BatchCoordinator' : 'CallCoordinator';
    debugLog(`[${coordinatorName}] Initializing with current config`);

    // Get the first selected paging device (type 8301)
    const pagingDevices = devices.filter(d =>
      d.type === "8301" && selectedDevices.includes(d.id)
    );
    const pagingDevice = pagingDevices.length > 0
      ? {
          id: pagingDevices[0].id,
          name: pagingDevices[0].name,
          ip: pagingDevices[0].ipAddress, // CallCoordinator uses 'ip'
          ipAddress: pagingDevices[0].ipAddress, // BatchCoordinator uses 'ipAddress'
          password: pagingDevices[0].apiPassword || '',
          authMethod: pagingDevices[0].authMethod || 'basic',
        }
      : null;

    // Extract linked speakers for this paging device
    const linkedSpeakers = pagingDevice
      ? devices
          .filter(d => {
            // Find the paging device in the devices array
            const paging = devices.find(pd => pd.id === pagingDevice.id);
            // Check if this device is in the paging device's linkedSpeakerIds
            return d.type !== "8301" && paging?.linkedSpeakerIds?.includes(d.id);
          })
          .map(s => ({
            id: s.id,
            name: s.name,
            ipAddress: s.ipAddress, // BatchCoordinator expects 'ipAddress', CallCoordinator expects 'ip'
            ip: s.ipAddress, // Keep for CallCoordinator backward compatibility
            volume: s.maxVolume ?? 100, // BatchCoordinator expects 'volume'
            maxVolume: s.maxVolume ?? 100, // Keep for CallCoordinator backward compatibility
          }))
      : [];

    debugLog(`[${coordinatorName}] Found ${linkedSpeakers.length} linked speakers for paging device ${pagingDevice?.name || 'N/A'}`);

    // Create speaker volume control callback
    const setSpeakerVolume = async (speakerId: string, volumePercent: number) => {
      const speaker = devices.find(d => d.id === speakerId);
      if (!speaker || !speaker.ipAddress || !speaker.apiPassword) {
        debugLog(`[CallCoordinator] Speaker ${speakerId} not found or missing credentials`);
        return;
      }

      // 🧪 EMULATION MODE: Skip actual API calls
      if (emulationMode) {
        debugLog(`[CallCoordinator] 🧪 EMULATION: Simulated setting ${speaker.name} volume to ${volumePercent.toFixed(0)}%`);
        return;
      }

      // Calculate actual volume: volumePercent represents ramp progress (0-100%)
      // Scale by speaker's maxVolume
      const speakerMaxVolume = speaker.maxVolume ?? 100;
      const actualVolume = (volumePercent / 100) * speakerMaxVolume;

      // Convert 0-100% to dB for Algo API
      let volumeDbString: string;
      if (actualVolume === 0) {
        volumeDbString = getIdleVolumeString(); // IDLE state
      } else {
        const volumeScale = Math.round((actualVolume / 100) * 10);
        const volumeDb = (volumeScale - 10) * 3;
        volumeDbString = volumeDb === 0 ? "0dB" : `${volumeDb}dB`;
      }

      try {
        const response = await fetch("/api/algo/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod || "standard",
            settings: {
              "audio.page.vol": volumeDbString,
            },
          }),
        });

        if (!response.ok) {
          debugLog(`[CallCoordinator] ❌ Failed to set ${speaker.name} volume`);
        } else {
          debugLog(`[CallCoordinator] ✓ Set ${speaker.name} to ${volumeDbString} (${actualVolume.toFixed(0)}%)`);
        }
      } catch (error) {
        debugLog(`[CallCoordinator] ❌ Network error setting ${speaker.name} volume`);
      }
    };

    // Extract PoE devices (for passing to coordinator)
    const poeDevicesForCoordinator = poeDevices.map(d => ({
      id: d.id,
      name: d.name,
      mode: d.mode,
      linkedPagingDevices: d.linkedPagingDeviceIds || [],
    }));

    // Create shared config properties
    const sharedConfig = {
      audioThreshold,
      sustainDuration,
      playbackEnabled,
      playbackDelay: playbackDelay,
      // Use playbackDisableDelay when playback is enabled, otherwise use legacy disableDelay
      disableDelay: playbackEnabled ? playbackDisableDelay : disableDelay,
      pagingDevice,
      setPagingMulticastIP,
      onUpload: uploadRecordingToFirebase,
      // Speaker volume control
      linkedSpeakers,
      setSpeakerVolume,
      rampEnabled,
      dayNightMode,
      dayStartHour,
      dayEndHour,
      nightRampDuration,
      targetVolume,
      // PoE device control
      poeDevices: poeDevicesForCoordinator,
    };

    // Instantiate the appropriate coordinator based on feature flag
    if (USE_BATCH_SYSTEM) {
      // BatchCoordinator config (includes batch-specific settings)
      const batchConfig: BatchCoordinatorConfig = {
        ...sharedConfig,
        onLog: (entry: { type: string; message: string; audioLevel?: number }) => {
          // Wrapper to cast string type to AudioLogEntry type union
          addLog(entry as Omit<AudioLogEntry, "timestamp">);
        },
        controlPoEDevices: async (deviceIds: string[], action: 'on' | 'off') => {
          // Wrapper to match BatchCoordinator interface signature
          await controlPoEDevices(action === 'on');
        },
        batchDuration: 5000, // 5 seconds per batch
        minBatchDuration: 1000, // 1 second minimum
        maxBatchDuration: 10000, // 10 seconds maximum
        tailGuardDuration, // User-configurable TailGuard window
        postPlaybackGraceDuration, // User-configurable post-playback grace window
        playbackRampDuration, // User-configurable ramp duration
        playbackStartVolume, // User-configurable start volume (0-2.0)
        playbackMaxVolume, // User-configurable max volume (0-2.0)
        playbackVolume, // User-configurable volume when ramp is disabled (0-2.0)
        onPlaybackLevelUpdate: setPlaybackAudioLevel, // Real-time playback audio monitoring
      };

      batchCoordinatorRef.current = new BatchCoordinator(batchConfig);

      // Start the coordinator with the monitoring stream
      batchCoordinatorRef.current.start(monitoringStream).then(() => {
        debugLog('[BatchCoordinator] ✅ Batch coordinator started and ready');
      }).catch((error) => {
        console.error('[BatchCoordinator] Failed to start:', error);
      });
    } else if (USE_NEW_CALL_SYSTEM) {
      // CallCoordinator config (legacy streaming with original signatures)
      const callConfig = {
        ...sharedConfig,
        onLog: addLog,
        controlPoEDevices: controlPoEDevices,
      };

      // CallCoordinator (legacy streaming)
      callCoordinatorRef.current = new CallCoordinator(callConfig);

      // Start the coordinator with the monitoring stream
      callCoordinatorRef.current.start(monitoringStream).then(() => {
        debugLog('[CallCoordinator] ✅ Call coordinator started and ready');
      }).catch((error) => {
        console.error('[CallCoordinator] Failed to start:', error);
      });
    }

    // Cleanup function - abort coordinator if monitoring stops or config changes during active call
    return () => {
      if (USE_BATCH_SYSTEM && batchCoordinatorRef.current) {
        if (batchCoordinatorRef.current.getState() !== 'Idle') {
          debugLog('[BatchCoordinator] Stopping active call due to monitoring stop or config change');
          batchCoordinatorRef.current.abort();
          batchCoordinatorRef.current = null;
        }
      } else if (USE_NEW_CALL_SYSTEM && callCoordinatorRef.current) {
        if (callCoordinatorRef.current.getState() !== 'Idle') {
          debugLog('[CallCoordinator] Stopping active call due to monitoring stop or config change');
          callCoordinatorRef.current.abort();
          callCoordinatorRef.current = null;
        }
      }
    };
  }, [
    isCapturing,
    monitoringStream,
    audioThreshold,
    sustainDuration,
    playbackEnabled,
    playbackDelay,
    disableDelay,
    playbackDisableDelay,
    devices,
    selectedDevices,
    setPagingMulticastIP,
    addLog,
    uploadRecordingToFirebase,
    rampEnabled,
    dayNightMode,
    dayStartHour,
    dayEndHour,
    nightRampDuration,
    targetVolume,
    poeDevices,
    controlPoEDevices,
    getIdleVolumeString,
    emulationMode,
  ]);

  // Audio activity detection with sustained audio requirement
  useEffect(() => {
    if (!isCapturing) {
      // Clean up sustained audio tracking when not capturing
      if (sustainedAudioStartRef.current) {
        sustainedAudioStartRef.current = null;
      }
      // 🔍 DEBUG: Log when audio detection is skipped due to not capturing
      if (audioLevel > audioThreshold && audioLevel > 5) {
        debugLog(`⚠️ Audio detected (${audioLevel.toFixed(0)}%) but NOT capturing - skipping coordinator call`);
      }
      return;
    }

    // 🚀 COORDINATOR SYSTEM: Delegate to appropriate coordinator if enabled
    if (USE_BATCH_SYSTEM && batchCoordinatorRef.current) {
      // BatchCoordinator system
      if (audioLevel > audioThreshold) {
        // 🔍 DEBUG: Log every audio detection to help diagnose missing events
        if (audioLevel > audioThreshold * 2) { // Only log significant audio to avoid spam
          debugLog(`🔊 AudioMonitoring → BatchCoordinator.onAudioDetected(${audioLevel.toFixed(0)}%)`);
        }
        batchCoordinatorRef.current.onAudioDetected(audioLevel);
      } else {
        batchCoordinatorRef.current.onSilence();
      }
      return; // Skip legacy audio detection logic
    } else if (USE_NEW_CALL_SYSTEM && callCoordinatorRef.current) {
      // CallCoordinator system (legacy streaming)
      if (audioLevel > audioThreshold) {
        callCoordinatorRef.current.onAudioDetected(audioLevel);
      } else {
        callCoordinatorRef.current.onSilence();
      }
      return; // Skip legacy audio detection logic
    }

    // Use configurable disable delay (default 3 seconds)

    if (audioLevel > audioThreshold) {
      // Audio is above threshold

      // Start tracking sustained audio if not already tracking
      // Note: speakersEnabled is always true during monitoring, use audioDetected instead
      if (!sustainedAudioStartRef.current && !audioDetected) {
        sustainedAudioStartRef.current = Date.now();
        debugLog(`[AudioMonitoring] Audio above threshold (${audioLevel.toFixed(1)}%), starting ${sustainDuration}ms sustain timer`);

        // Start continuous recording if not already active (captures from beginning)
        if (!continuousRecordingRef.current && recordingEnabled) {
          continuousRecordingRef.current = true;
          validRecordingStartIndexRef.current = recordedChunksRef.current.length; // Mark where this recording starts

          // Only start MediaRecorder if not already running
          const isAlreadyRecording = mediaRecorderRef.current?.state === 'recording';
          if (!isAlreadyRecording) {
            debugLog('[AudioMonitoring] Starting continuous recording to capture from beginning');
            startRecording();
          } else {
            debugLog('[AudioMonitoring] MediaRecorder already running, marking start point for this audio');
          }
        }
      }

      // Check if audio has been sustained long enough
      // Note: speakersEnabled is always true during monitoring (always-on mode)
      // We use audioDetected to track if we're actively playing audio
      if (sustainedAudioStartRef.current && !audioDetected && !controllingSpakersRef.current) {
        const sustainedFor = Date.now() - sustainedAudioStartRef.current;

        if (sustainedFor >= sustainDuration) {
          // 🚨 EMERGENCY INTERCEPTION: Cancel any ongoing shutdown!
          if (shutdownInProgressRef.current) {
            console.log('');
            console.log('═══════════════════════════════════════════════════════');
            console.log('🚨 EMERGENCY CALL INTERCEPTED DURING SHUTDOWN! 🚨');
            console.log('New audio detected while paging was shutting down');
            console.log('CANCELLING SHUTDOWN - Keeping paging ON for new call');
            console.log('═══════════════════════════════════════════════════════');
            console.log('');
            shutdownInProgressRef.current = false; // CANCEL THE SHUTDOWN!

            addLog({
              type: "audio_detected",
              audioLevel,
              message: `🚨 EMERGENCY: New call during shutdown - shutdown cancelled!`,
            });
          }

          // Audio has been sustained - ramp volume up!
          // CRITICAL: Speakers are already listening (multicast enabled at start)
          // We only need to ramp up volume - this is INSTANT compared to enabling multicast
          sustainedAudioStartRef.current = null;
          setAudioDetected(true);
          controllingSpakersRef.current = true;
          speakersEnabledTimeRef.current = Date.now(); // Track when audio started playing

          const skipRamp = shouldSkipRamping();
          addLog({
            type: "audio_detected",
            audioLevel,
            audioThreshold,
            message: skipRamp
              ? `Audio sustained ${sustainDuration}ms at ${audioLevel.toFixed(1)}% (speakers already listening)`
              : `Audio sustained ${sustainDuration}ms at ${audioLevel.toFixed(1)}% - ramping volume (speakers already listening)`,
          });

          if (skipRamp) {
            addLog({
              type: "volume_change",
              audioLevel,
              speakersEnabled: true,
              volume: targetVolume,
              message: `Speakers at operating volume ${targetVolume}% (paging Zone 1 → speakers receive audio)`,
            });
          } else {
            addLog({
              type: "volume_change",
              audioLevel,
              speakersEnabled: true,
              volume: targetVolume,
              message: `Volume ramping to ${targetVolume}% (paging Zone 1 → speakers receive audio)`,
            });
          }

          (async () => {
            // Recording already running (continuous mode) - just confirm it's valid
            if (continuousRecordingRef.current) {
              debugLog('[AudioMonitoring] Audio sustained - confirming recording (captured from beginning)');
              // Keep the recording - it already has audio from the start
              continuousRecordingRef.current = false; // No longer speculative
            } else {
              // Fallback: Start recording if somehow not running (shouldn't happen)
              const isRecording = mediaRecorderRef.current?.state === 'recording';
              if (!isRecording && recordingEnabled) {
                debugLog('[AudioMonitoring] WARNING: Recording not active, starting now');
                await startRecording();
              }
            }

            // Enable PoE devices (lights, etc.) in auto mode
            await controlPoEDevices(true);

            // NEW APPROACH: Switch paging to Zone 1 (speakers listening)
            // Paging is already in mode 1 (transmitter), just switch multicast IP to active
            debugLog('[AudioMonitoring] AUDIO DETECTED - Switching paging to active mode');
            await setPagingMulticastIP(true); // Includes reload + polling internally
            pagingWasEnabledRef.current = true; // Track that paging is active

            // CRITICAL: Start volume ramp BEFORE playback!
            // This ensures speakers are audible when audio starts playing
            const skipRampNow = shouldSkipRamping();
            if (skipRampNow) {
              const reason = !rampEnabled ? 'Ramp DISABLED' : 'DAYTIME (day/night mode)';
              debugLog(`[AudioMonitoring] ${reason} - Speakers already at operating volume, no ramp needed`);
            } else {
              debugLog('[AudioMonitoring] NIGHTTIME or ramp mode - Starting volume ramp');
              startVolumeRamp();
            }

            // NEW: Wait for playback delay (configurable) before starting playback
            // This gives paging device time to fully initialize and volume to ramp up
            if (playbackEnabled && playbackDelay > 0) {
              debugLog(`[AudioMonitoring] Waiting ${playbackDelay}ms (playback delay) before starting playback...`);
              await new Promise(resolve => setTimeout(resolve, playbackDelay));
            }

            // NEW: Start playback AFTER delay
            if (playbackEnabled) {
              await startPlayback();
            }

            controllingSpakersRef.current = false;
          })();
        }
      }

      // Clear disable timeout if audio is detected again
      if (audioDetectionTimeoutRef.current) {
        clearTimeout(audioDetectionTimeoutRef.current);
        audioDetectionTimeoutRef.current = null;
      }

    } else {
      // Audio is below threshold

      // Reset sustained audio timer if it was tracking
      if (sustainedAudioStartRef.current) {
        debugLog(`[AudioMonitoring] Audio dropped below threshold before sustain duration`);
        sustainedAudioStartRef.current = null;

        // Discard chunks from the noise spike but KEEP MediaRecorder running
        if (continuousRecordingRef.current) {
          const chunksToDiscard = recordedChunksRef.current.length - validRecordingStartIndexRef.current;
          if (chunksToDiscard > 0) {
            debugLog(`[AudioMonitoring] Discarding ${chunksToDiscard} chunks from noise spike (keeping MediaRecorder running)`);
            recordedChunksRef.current.splice(validRecordingStartIndexRef.current);
          }
          continuousRecordingRef.current = false;
        }
      }

      // Start mute countdown if audio was playing
      // Note: We DON'T disable multicast - speakers stay listening (always-on mode)
      // We only mute the volume so speakers are ready for the next audio burst
      if (audioDetected) {
        if (!audioDetectionTimeoutRef.current) {
          // 🎯 SMART DELAY: Use playback disable delay when playback is enabled (ensures audio fully captured)
          // Otherwise use regular disable delay
          const effectiveDelay = playbackEnabled ? playbackDisableDelay : disableDelay;

          addLog({
            type: "audio_silent",
            audioLevel,
            audioThreshold,
            message: `Audio below threshold: ${audioLevel.toFixed(1)}% - starting ${effectiveDelay/1000}s ${playbackEnabled ? 'playback' : 'mute'} countdown`,
          });

          audioDetectionTimeoutRef.current = setTimeout(() => {
            if (!controllingSpakersRef.current) {
              controllingSpakersRef.current = true;
              // DON'T disable speakers - keep them listening!
              // setSpeakersEnabled(false); // REMOVED - speakers stay on
              setAudioDetected(false); // Just mark audio as not active

              // Calculate how long audio was playing
              const duration = speakersEnabledTimeRef.current
                ? ((Date.now() - speakersEnabledTimeRef.current) / 1000).toFixed(1)
                : '?';
              speakersEnabledTimeRef.current = null;

              (async () => {
                let recordingUrl: string | null = null;

                // Stop recording and upload (happens at audio end + disable delay)
                // IMPORTANT: Always stop recording here, even during playback!
                // Blob playback will continue from the recorded chunks
                recordingUrl = await stopRecordingAndUpload();

                // Reset continuous recording flag for next call
                continuousRecordingRef.current = false;
                validRecordingStartIndexRef.current = 0;

                if (playbackEnabled) {
                  // Wait for playback to finish before shutdown
                  debugLog('[AudioMonitoring] Live playback enabled - waiting for playback to finish before shutdown...');

                  // Wait for playback to complete with timeout safety mechanism
                  const checkPlaybackFinished = async () => {
                    const maxWaitTime = 120000; // 2 minutes maximum wait (for long recordings)
                    const startTime = Date.now();

                    while (isPlayingLiveRef.current) {
                      // Safety timeout: if playback is stuck for 2 minutes, force it to stop
                      if (Date.now() - startTime > maxWaitTime) {
                        console.warn('[AudioMonitoring] ⚠️ Playback timeout after 2 minutes - forcing shutdown');
                        isPlayingLiveRef.current = false;
                        break;
                      }
                      await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
                    }
                  };

                  await checkPlaybackFinished();
                  debugLog('[AudioMonitoring] Playback finished - stopping playback and recording');

                  // NOW that playback is done, stop it
                  stopPlayback();

                  // Stop and upload recording (if not already done)
                  if (!recordingUrl && mediaRecorderRef.current) {
                    debugLog('[AudioMonitoring] Stopping MediaRecorder and uploading recording after playback');
                    recordingUrl = await stopRecordingAndUpload();

                    // Reset continuous recording flag for next call
                    continuousRecordingRef.current = false;
                    validRecordingStartIndexRef.current = 0;
                  }
                } else {
                  // Original flow: Stop playback immediately (if it was running)
                  stopPlayback();
                }

                // 🚨 CRITICAL: Set shutdown flag NOW (after playback completes)
                // This protects the actual shutdown sequence (PoE disable, paging mode 0, volume ramp)
                shutdownInProgressRef.current = true;
                debugLog('[AudioMonitoring] 🔒 SHUTDOWN STARTED - Flag set (paging will go to mode 0)');

                // 🚨 Check if new audio arrived after playback stopped
                if (!shutdownInProgressRef.current) {
                  debugLog('[AudioMonitoring] 🚨 NEW AUDIO DETECTED after playback - ABORTING SHUTDOWN!');
                  controllingSpakersRef.current = false;
                  return; // Exit shutdown immediately
                }

                // Disable PoE devices (lights, etc.) in auto mode
                await controlPoEDevices(false);

                // 🚨 FINAL CHECK before disabling paging (most critical!)
                if (!shutdownInProgressRef.current) {
                  debugLog('[AudioMonitoring] 🚨 NEW AUDIO DETECTED before paging OFF - ABORTING SHUTDOWN!');
                  controllingSpakersRef.current = false;
                  return; // Exit shutdown immediately - paging stays ON
                }

                // NEW APPROACH: Switch paging multicast IP to idle mode
                // Speakers stay listening, but paging is on different IP/port
                debugLog('[AudioMonitoring] AUDIO ENDED - Switching paging to idle mode');
                await setPagingMulticastIP(false); // Includes reload + polling internally

                pagingWasEnabledRef.current = false; // Mark paging as idle

                // Ramp down or keep at operating volume
                const skipRampDown = shouldSkipRamping();
                if (skipRampDown) {
                  const reason = !rampEnabled ? 'Ramp DISABLED' : 'DAYTIME (day/night mode)';
                  debugLog(`[AudioMonitoring] ${reason} - Keeping speakers at operating volume`);
                  // Speakers stay at operating volume - no change needed
                } else {
                  debugLog('[AudioMonitoring] NIGHTTIME or ramp mode - Ramping volume down to idle');
                  stopVolumeRamp();
                  await setDevicesVolume(0);
                }

                // Log with recording URL if available
                const recordingStatus = recordingUrl
                  ? ' 🎙️ Recording saved'
                  : (!recordingEnabled ? ' 🎵 Playback only (not saved)' : '');

                const shutdownMessage = playbackEnabled
                  ? `Paging → Zone 2 (idle) after playback completed (duration: ${duration}s)${recordingStatus}`
                  : rampEnabled
                    ? `Paging → Zone 2 (idle) after ${disableDelay/1000}s silence (duration: ${duration}s) - NO STATIC!${recordingStatus}`
                    : `Paging → Zone 2 (idle) after ${disableDelay/1000}s silence (duration: ${duration}s) - Speakers stay at operating volume${recordingStatus}`;

                addLog({
                  type: "volume_change",
                  speakersEnabled: true, // Speakers STAY in mode 2 (ready)
                  volume: rampEnabled ? 0 : targetVolume,
                  message: shutdownMessage,
                  recordingUrl: recordingUrl || undefined,
                });

                // 🚨 Shutdown complete - clear flag
                shutdownInProgressRef.current = false;
                debugLog('[AudioMonitoring] 🔓 SHUTDOWN COMPLETE - Flag cleared');

                controllingSpakersRef.current = false;
              })();
            }
            audioDetectionTimeoutRef.current = null;
          }, effectiveDelay); // Use smart delay (playback delay if enabled, otherwise regular delay)
        }
      }
    }
  }, [audioLevel, isCapturing, audioDetected, speakersEnabled, audioThreshold, sustainDuration, disableDelay, controlSpeakers, setDevicesVolume, startVolumeRamp, stopVolumeRamp, targetVolume, addLog, startRecording, stopRecordingAndUpload, setPagingMulticastIP, controlPoEDevices, playbackEnabled, playbackDelay, playbackDisableDelay, startPlayback, stopPlayback, rampEnabled, recordingEnabled, shouldSkipRamping]);

  const startMonitoring = useCallback(async (inputDevice?: string) => {
    debugLog('[AudioMonitoring] Starting monitoring', inputDevice);

    // Reset paging state tracker
    pagingWasEnabledRef.current = false;

    // Set speakers to idle mode (don't listen to paging yet)
    await setPagingMulticastIP(false);

    addLog({
      type: "audio_detected",
      audioThreshold,
      message: `Monitoring started with threshold: ${audioThreshold}%`,
    });

    // Start audio capture IMMEDIATELY - don't wait for speaker setup
    // This ensures the UI responds instantly and audio is being captured
    startCapture(inputDevice);

    // 🚀 NEW CALL COORDINATOR SYSTEM: Initialization happens in useEffect when stream is ready
    // Skip legacy speaker setup if using new system
    if (USE_NEW_CALL_SYSTEM) {
      debugLog('[CallCoordinator] Using new call coordinator system - skipping legacy speaker setup');
      return; // CallCoordinator will handle everything
    }

    // LEGACY SYSTEM BELOW:

    // Check speaker connectivity first (in background)
    checkSpeakerConnectivity();

    // NEW FLOW: Set up devices for instant response with NO STATIC
    debugLog(`[AudioMonitoring] NEW FLOW: Setting up paging and speakers (mode 2)`);

    // Run speaker setup in background - offline speakers shouldn't block monitoring
    (async () => {
      try {
        // Step 1: Set speakers to starting volume (depends on ramp setting and time of day)
        const skipRamp = shouldSkipRamping();
        if (skipRamp) {
          // Ramp disabled OR daytime with day/night mode: Start at operating volume, stay there
          const reason = !rampEnabled ? 'Ramp DISABLED' : 'DAYTIME (day/night mode)';
          debugLog(`[AudioMonitoring] Step 1: ${reason} - Setting speakers to operating volume`);
          await setDevicesVolume(100); // 100% scales to each speaker's maxVolume (operating volume)
        } else {
          // Nighttime or day/night mode disabled: Start at idle volume, will ramp up when audio detected
          debugLog(`[AudioMonitoring] Step 1: NIGHTTIME or ramp mode - Setting speakers to idle volume ${getIdleVolumeString()}`);
          await setDevicesVolume(0); // 0% = idle volume
        }

        // Wait briefly to ensure volume command is fully processed
        await new Promise(resolve => setTimeout(resolve, 200));

        // Step 2: Set paging to Zone 2 (idle - speakers only listen to Zone 1)
        // NOTE: We don't change mcast mode here - only change zones!
        debugLog('[AudioMonitoring] Step 2: Setting paging to idle mode');
        await setPagingMulticastIP(false); // Includes reload + polling internally

        pagingWasEnabledRef.current = false; // Paging is in idle mode, not active

        // Step 3: REMOVED - We NEVER change speaker multicast mode!
        // Speakers should ALWAYS be pre-configured to mode 2 (receiver) and left alone
        // await setSpeakersMulticast(2); // ← REMOVED
        debugLog('[AudioMonitoring] Step 3: Speakers assumed to be in mode 2 (receiver - listening Zone 1)');

        setSpeakersEnabled(true); // Mark as ready

        const skipRampForLog = shouldSkipRamping();
        const volumeMsg = skipRampForLog
          ? `Operating Volume (${!rampEnabled ? 'ramp disabled' : 'daytime - no ramping'})`
          : `Idle Volume=${getIdleVolumeString()} (will ramp when audio detected)`;

        addLog({
          type: "speakers_enabled",
          speakersEnabled: true,
          volume: skipRampForLog ? 100 : 0,
          message: `Monitoring ready: Paging=Zone 2 (idle), Speakers=pre-configured (multicast unchanged), ${volumeMsg}`,
        });

        debugLog(`[AudioMonitoring] ✓ Setup complete: Paging Zone 2 (idle), Speakers pre-configured (multicast unchanged), ${volumeMsg}`);
      } catch (error) {
        console.error('[AudioMonitoring] Error during speaker setup:', error);
        // Continue anyway - audio capture is already running
        setSpeakersEnabled(true);
      }
    })();
  }, [startCapture, audioThreshold, addLog, setDevicesVolume, setPagingMulticastIP, setSpeakersMulticast, checkSpeakerConnectivity, shouldSkipRamping, sustainDuration, playbackEnabled, playbackDelay, disableDelay, devices, selectedDevices, uploadRecordingToFirebase, monitoringStream]);

  const stopMonitoring = useCallback(async () => {
    debugLog('[AudioMonitoring] Stopping monitoring');

    // Calculate duration if audio was playing
    const duration = speakersEnabledTimeRef.current
      ? ((Date.now() - speakersEnabledTimeRef.current) / 1000).toFixed(1)
      : null;
    speakersEnabledTimeRef.current = null;

    addLog({
      type: "speakers_disabled",
      message: duration
        ? `Monitoring stopped (audio was playing for ${duration}s)`
        : 'Monitoring stopped - shutting down all devices',
    });

    stopCapture();
    stopVolumeRamp();

    // Clear any pending audio detection timeout
    if (audioDetectionTimeoutRef.current) {
      clearTimeout(audioDetectionTimeoutRef.current);
      audioDetectionTimeoutRef.current = null;
    }

    // NEW FLOW: Clean shutdown - set everything to mode 0 and getIdleVolumeString()
    if (!controllingSpakersRef.current) {
      controllingSpakersRef.current = true;
      setSpeakersEnabled(false);
      setAudioDetected(false);

      debugLog(`[AudioMonitoring] STOP: Shutting down paging and speakers to mode 0, volume ${getIdleVolumeString()}`);

      // Step 1: Set speakers to idle volume
      await setDevicesVolume(0);

      // Step 2: REMOVED - We NEVER change speaker multicast mode!
      // Speakers should ALWAYS stay in mode 2 (receiver)
      // await setSpeakersMulticast(0); // ← REMOVED

      controllingSpakersRef.current = false;
      debugLog(`[AudioMonitoring] ✓ Clean shutdown complete: Speakers ${getIdleVolumeString()}, multicast unchanged`);
    }

    // 🚀 COORDINATOR SYSTEM: Abort if active
    if (USE_BATCH_SYSTEM && batchCoordinatorRef.current) {
      debugLog('[BatchCoordinator] Aborting batch coordinator');
      await batchCoordinatorRef.current.abort();
      batchCoordinatorRef.current = null;
    } else if (USE_NEW_CALL_SYSTEM && callCoordinatorRef.current) {
      debugLog('[CallCoordinator] Aborting call coordinator');
      await callCoordinatorRef.current.abort();
      callCoordinatorRef.current = null;
    }

    // Clean up playback
    isPlayingLiveRef.current = false;
    playbackPositionRef.current = 0;
    if (playbackAudioRef.current) {
      playbackAudioRef.current.pause();
      playbackAudioRef.current = null;
    }

    // Clean up MediaSource if active
    cleanupMediaSource();

    // Set speakers to idle mode (stop listening to paging)
    await setPagingMulticastIP(false);

    // Reset continuous recording flag
    continuousRecordingRef.current = false;
    validRecordingStartIndexRef.current = 0;
  }, [stopCapture, stopVolumeRamp, setDevicesVolume, setSpeakersMulticast, addLog, cleanupMediaSource, setPagingMulticastIP]);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
  }, []);

  const setInputDevice = useCallback((deviceId: string) => {
    setSelectedInputDeviceState(deviceId);
  }, []);

  const setSelectedDevices = useCallback((devs: string[]) => {
    setSelectedDevicesState(devs);
  }, []);

  const setTargetVolume = useCallback((vol: number) => {
    setTargetVolumeState(vol);
  }, []);

  const setAudioThreshold = useCallback((threshold: number) => {
    setAudioThresholdState(threshold);
  }, []);

  const setRampEnabled = useCallback((enabled: boolean) => {
    setRampEnabledState(enabled);
  }, []);

  const setRampDuration = useCallback((duration: number) => {
    setRampDurationState(duration);
  }, []);

  const setDayNightMode = useCallback((enabled: boolean) => {
    setDayNightModeState(enabled);
  }, []);

  const setDayStartHour = useCallback((hour: number) => {
    setDayStartHourState(hour);
  }, []);

  const setDayEndHour = useCallback((hour: number) => {
    setDayEndHourState(hour);
  }, []);

  const setNightRampDuration = useCallback((duration: number) => {
    setNightRampDurationState(duration);
  }, []);

  const setSustainDuration = useCallback((duration: number) => {
    setSustainDurationState(duration);
  }, []);

  const setDisableDelay = useCallback((delay: number) => {
    setDisableDelayState(delay);
  }, []);

  const setLoggingEnabled = useCallback((enabled: boolean) => {
    setLoggingEnabledState(enabled);
  }, []);

  const setRecordingEnabled = useCallback((enabled: boolean) => {
    setRecordingEnabledState(enabled);
  }, []);

  const setPlaybackEnabled = useCallback((enabled: boolean) => {
    setPlaybackEnabledState(enabled);
    debugLog('[AudioMonitoring] Playback mode:', enabled ? 'ENABLED' : 'DISABLED');
  }, []);

  const setPlaybackDelay = useCallback((delay: number) => {
    setPlaybackDelayState(delay);
    debugLog('[AudioMonitoring] Playback delay set to:', `${delay}ms`);
  }, []);

  const setPlaybackDisableDelay = useCallback((delay: number) => {
    setPlaybackDisableDelayState(delay);
    debugLog('[AudioMonitoring] Playback disable delay set to:', `${delay}ms`);
  }, []);

  const setTailGuardDurationCallback = useCallback((duration: number) => {
    setTailGuardDuration(duration);
    debugLog('[AudioMonitoring] TailGuard duration set to:', `${duration}ms`);
  }, []);

  const setPostPlaybackGraceDurationCallback = useCallback((duration: number) => {
    setPostPlaybackGraceDuration(duration);
    debugLog('[AudioMonitoring] Post-playback grace duration set to:', `${duration}ms`);
  }, []);

  const setPlaybackRampDurationCallback = useCallback((duration: number) => {
    setPlaybackRampDuration(duration);
    debugLog('[AudioMonitoring] Playback ramp duration set to:', `${duration}ms`);
  }, []);

  const setPlaybackStartVolumeCallback = useCallback((volume: number) => {
    setPlaybackStartVolume(volume);
    debugLog('[AudioMonitoring] Playback start volume set to:', volume.toFixed(2));
  }, []);

  const setPlaybackMaxVolumeCallback = useCallback((volume: number) => {
    setPlaybackMaxVolume(volume);
    debugLog('[AudioMonitoring] Playback max volume set to:', volume.toFixed(2));
  }, []);

  const setPlaybackVolumeCallback = useCallback((volume: number) => {
    setPlaybackVolume(volume);
    debugLog('[AudioMonitoring] Playback volume (ramp disabled) set to:', volume.toFixed(2));
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    debugLog('[AudioLog] Logs cleared');
  }, []);

  const exportLogs = useCallback(() => {
    const header = "Timestamp,Type,Audio Level,Threshold,Speakers,Volume,Message\n";
    const rows = logs.map(log => {
      const timestamp = new Date(log.timestamp).toLocaleString();
      return `"${timestamp}","${log.type}","${log.audioLevel ?? ''}","${log.audioThreshold ?? ''}","${log.speakersEnabled ?? ''}","${log.volume ?? ''}","${log.message}"`;
    }).join("\n");

    return header + rows;
  }, [logs]);

  return (
    <AudioMonitoringContext.Provider
      value={{
        isCapturing,
        audioLevel,
        playbackAudioLevel,
        selectedInputDevice,
        volume,
        targetVolume,
        audioThreshold,
        audioDetected,
        speakersEnabled,
        rampEnabled,
        rampDuration,
        dayNightMode,
        dayStartHour,
        dayEndHour,
        nightRampDuration,
        sustainDuration,
        disableDelay,
        setRampEnabled,
        setRampDuration,
        setDayNightMode,
        setDayStartHour,
        setDayEndHour,
        setNightRampDuration,
        setSustainDuration,
        setDisableDelay,
        selectedDevices,
        setSelectedDevices,
        startMonitoring,
        stopMonitoring,
        setInputDevice,
        setVolume,
        setTargetVolume,
        setAudioThreshold,
        devices,
        setDevices,
        poeDevices,
        setPoeDevices,
        logs,
        clearLogs,
        exportLogs,
        loggingEnabled,
        setLoggingEnabled,
        recordingEnabled,
        setRecordingEnabled,
        playbackEnabled,
        setPlaybackEnabled,
        playbackDelay,
        setPlaybackDelay,
        playbackDisableDelay,
        setPlaybackDisableDelay,
        tailGuardDuration,
        setTailGuardDuration: setTailGuardDurationCallback,
        postPlaybackGraceDuration,
        setPostPlaybackGraceDuration: setPostPlaybackGraceDurationCallback,
        playbackRampDuration,
        setPlaybackRampDuration: setPlaybackRampDurationCallback,
        playbackStartVolume,
        setPlaybackStartVolume: setPlaybackStartVolumeCallback,
        playbackMaxVolume,
        setPlaybackMaxVolume: setPlaybackMaxVolumeCallback,
        playbackVolume,
        setPlaybackVolume: setPlaybackVolumeCallback,
        emergencyKillAll,
        emergencyEnableAll,
        controlSingleSpeaker,
        speakerStatuses,
        checkSpeakerConnectivity,

        // Emulation Mode
        emulationMode,
        setEmulationMode,
        emulationNetworkDelay,
        setEmulationNetworkDelay: setEmulationNetworkDelay,
        triggerTestCall,
      }}
    >
      {children}
    </AudioMonitoringContext.Provider>
  );
}

export function useAudioMonitoring() {
  const context = useContext(AudioMonitoringContext);
  if (!context) {
    throw new Error("useAudioMonitoring must be used within AudioMonitoringProvider");
  }
  return context;
}
