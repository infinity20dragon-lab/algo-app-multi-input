/**
 * Simple Monitoring Context
 *
 * Provides state and config for SimpleRecorder-based live monitoring
 */

"use client";

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { SimpleRecorder } from "@/lib/simple-recorder";
import { useAuth } from "./auth-context";
import { useRealtimeSync } from "./realtime-sync-context";
import { storage } from "@/lib/firebase/config";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { addRecording, getZones, getUserZoneRouting, addActivityLog } from "@/lib/firebase/firestore";
import type { Zone, ZoneRouting } from "@/lib/algo/types";

// TODO: Import proper types
type Device = any;
type PoEDevice = any;

interface SpeakerStatus {
  speakerId: string;
  isOnline: boolean;
}

interface SimpleMonitoringContextType {
  // State
  isMonitoring: boolean;
  audioLevel: number;
  playbackAudioLevel: number;
  selectedInputDevice: string | null;
  audioDetected: boolean;
  speakersEnabled: boolean;

  // Multi-Input Mode
  multiInputMode: boolean;
  medicalInputDevice: string | null;
  fireInputDevice: string | null;
  allCallInputDevice: string | null;
  medicalAudioLevel: number;
  fireAudioLevel: number;
  allCallAudioLevel: number;
  medicalEnabled: boolean;
  fireEnabled: boolean;
  allCallEnabled: boolean;
  medicalChannel: number;
  fireChannel: number;
  allCallChannel: number;
  setMedicalChannel: (channel: number) => void;
  setFireChannel: (channel: number) => void;
  setAllCallChannel: (channel: number) => void;

  // Audio Settings
  batchDuration: number;
  silenceTimeout: number;
  playbackDelay: number;
  hardwareGracePeriod: number;
  audioThreshold: number;
  sustainDuration: number;
  disableDelay: number;

  // Volume & Ramp Settings
  targetVolume: number;
  rampEnabled: boolean;
  rampDuration: number;
  dayNightMode: boolean;
  dayStartHour: number;
  dayEndHour: number;
  nightRampDuration: number;

  // Playback Volume Settings
  playbackRampDuration: number;
  playbackStartVolume: number;
  playbackMaxVolume: number;
  playbackVolume: number;

  // Playback Volume Ramping (Web Audio API - per session)
  playbackRampEnabled: boolean;
  playbackRampStartVolume: number;
  playbackRampTargetVolume: number;
  playbackSessionRampDuration: number;
  playbackRampScheduleEnabled: boolean;
  playbackRampStartHour: number;
  playbackRampEndHour: number;

  // Recording & Playback
  saveRecording: boolean;
  recordingEnabled: boolean;
  loggingEnabled: boolean;
  playbackEnabled: boolean;

  // Devices
  devices: Device[];
  selectedDevices: string[];
  poeDevices: PoEDevice[];
  speakerStatuses: SpeakerStatus[];

  // Zones (for zoned playback)
  zones: Zone[];
  zoneRouting: Record<string, ZoneRouting>;
  zonedPlayback: boolean;
  setZonedPlayback: (enabled: boolean) => void;
  zoneScheduleEnabled: boolean;
  setZoneScheduleEnabled: (enabled: boolean) => void;

  // Native Audio (Electron + naudiodon)
  nativeAudioAvailable: boolean;
  useNativeAudio: boolean;
  setUseNativeAudio: (enabled: boolean) => void;
  nativeDevices: Array<{ id: number; name: string; maxInputChannels: number; defaultSampleRate: number; hostAPIName: string }>;
  medicalNativeDeviceId: number | null;
  fireNativeDeviceId: number | null;
  allCallNativeDeviceId: number | null;
  setMedicalNativeDeviceId: (id: number | null) => void;
  setFireNativeDeviceId: (id: number | null) => void;
  setAllCallNativeDeviceId: (id: number | null) => void;
  refreshNativeDevices: () => Promise<void>;

  // Emulation
  emulationMode: boolean;
  emulationNetworkDelay: number;

  // Actions
  startMonitoring: () => Promise<void>;
  stopMonitoring: () => Promise<void>;
  setInputDevice: (deviceId: string) => void;

  // Multi-Input Actions
  setMultiInputMode: (enabled: boolean) => void;
  setMedicalInputDevice: (deviceId: string | null) => void;
  setFireInputDevice: (deviceId: string | null) => void;
  setAllCallInputDevice: (deviceId: string | null) => void;
  setMedicalEnabled: (enabled: boolean) => void;
  setFireEnabled: (enabled: boolean) => void;
  setAllCallEnabled: (enabled: boolean) => void;
  setBatchDuration: (ms: number) => void;
  setSilenceTimeout: (ms: number) => void;
  setPlaybackDelay: (ms: number) => void;
  setHardwareGracePeriod: (ms: number) => void;
  setAudioThreshold: (value: number) => void;
  setSustainDuration: (ms: number) => void;
  setDisableDelay: (ms: number) => void;
  setTargetVolume: (value: number) => void;
  setRampEnabled: (enabled: boolean) => void;
  setRampDuration: (ms: number) => void;
  setDayNightMode: (enabled: boolean) => void;
  setDayStartHour: (hour: number) => void;
  setDayEndHour: (hour: number) => void;
  setNightRampDuration: (ms: number) => void;
  setPlaybackRampDuration: (ms: number) => void;
  setPlaybackStartVolume: (value: number) => void;
  setPlaybackMaxVolume: (value: number) => void;
  setPlaybackVolume: (value: number) => void;
  setPlaybackRampEnabled: (enabled: boolean) => void;
  setPlaybackRampStartVolume: (value: number) => void;
  setPlaybackRampTargetVolume: (value: number) => void;
  setPlaybackSessionRampDuration: (ms: number) => void;
  setPlaybackRampScheduleEnabled: (enabled: boolean) => void;
  setPlaybackRampStartHour: (hour: number) => void;
  setPlaybackRampEndHour: (hour: number) => void;
  setSaveRecording: (enabled: boolean) => void;
  setRecordingEnabled: (enabled: boolean) => void;
  setLoggingEnabled: (enabled: boolean) => void;
  setPlaybackEnabled: (enabled: boolean) => void;
  setDevices: (devices: Device[]) => void;
  setSelectedDevices: (deviceIds: string[]) => void;
  setPoeDevices: (devices: PoEDevice[]) => void;
  setEmulationMode: (enabled: boolean) => void;
  setEmulationNetworkDelay: (ms: number) => void;
  onAudioDetected: (level: number) => void;

  // PoE Control
  poeKeepAliveDuration: number;
  setPoeKeepAliveDuration: (ms: number) => void;
  poeAutoDisabled: Set<string>;
  togglePoEAutoControl: (deviceId: string) => void;
  setPoeAllAutoEnabled: (enabled: boolean) => void;
  poeParallelMode: boolean;
  setPoeParallelMode: (enabled: boolean) => void;
  poeToggleDelay: number;
  setPoeToggleDelay: (ms: number) => void;

  // Emergency Controls
  emergencyKillAll: () => Promise<void>;
  emergencyEnableAll: () => Promise<void>;
  controlSingleSpeaker: (speakerId: string, enable: boolean) => Promise<void>;
  checkSpeakerConnectivity: () => Promise<void>;
  triggerTestCall: (durationSeconds: number) => void;

  // Logs
  logs: Array<{ timestamp: string; message: string; type: 'info' | 'error' | 'warning' }>;
}

const SimpleMonitoringContext = createContext<SimpleMonitoringContextType | null>(null);

export function SimpleMonitoringProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { syncSessionState, sessionState } = useRealtimeSync();

  // State
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [playbackAudioLevel, setPlaybackAudioLevel] = useState(0);
  const [selectedInputDevice, setSelectedInputDevice] = useState<string | null>(null);
  const [audioDetected, setAudioDetected] = useState(false);
  const [speakersEnabled, setSpeakersEnabled] = useState(false);

  // Multi-Input Mode (ALWAYS ON - three inputs is the default)
  const [multiInputMode, setMultiInputMode] = useState(true); // Default: TRUE
  const [medicalInputDevice, setMedicalInputDevice] = useState<string | null>(null);
  const [fireInputDevice, setFireInputDevice] = useState<string | null>(null);
  const [allCallInputDevice, setAllCallInputDevice] = useState<string | null>(null);
  const [medicalAudioLevel, setMedicalAudioLevel] = useState(0);
  const [fireAudioLevel, setFireAudioLevel] = useState(0);
  const [allCallAudioLevel, setAllCallAudioLevel] = useState(0);

  // Enable/Disable per input
  const [medicalEnabled, setMedicalEnabled] = useState(true);
  const [fireEnabled, setFireEnabled] = useState(true);
  const [allCallEnabled, setAllCallEnabled] = useState(true);

  // Channel selection per input (0=Left/Mono, 1=Right)
  const [medicalChannel, setMedicalChannel] = useState(0);
  const [fireChannel, setFireChannel] = useState(1);
  const [allCallChannel, setAllCallChannel] = useState(0);

  // Audio Settings
  const [batchDuration, setBatchDuration] = useState(5000);
  const [silenceTimeout, setSilenceTimeout] = useState(8000);
  const [playbackDelay, setPlaybackDelay] = useState(4000);
  const [hardwareGracePeriod, setHardwareGracePeriod] = useState(5000);
  const [audioThreshold, setAudioThreshold] = useState(0);
  const [sustainDuration, setSustainDuration] = useState(0);
  const [disableDelay, setDisableDelay] = useState(8000);

  // Volume & Ramp Settings
  const [targetVolume, setTargetVolume] = useState(100);
  const [rampEnabled, setRampEnabled] = useState(false);
  const [rampDuration, setRampDuration] = useState(2000);
  const [dayNightMode, setDayNightMode] = useState(false);
  const [dayStartHour, setDayStartHour] = useState(7);
  const [dayEndHour, setDayEndHour] = useState(19);
  const [nightRampDuration, setNightRampDuration] = useState(3000);

  // Playback Volume Settings
  const [playbackRampDuration, setPlaybackRampDuration] = useState(0);
  const [playbackStartVolume, setPlaybackStartVolume] = useState(0.5);
  const [playbackMaxVolume, setPlaybackMaxVolume] = useState(1.0);
  const [playbackVolume, setPlaybackVolume] = useState(1.0);

  // Playback Volume Ramping (Web Audio API - per session)
  const [playbackRampEnabled, setPlaybackRampEnabled] = useState(false);
  const [playbackRampStartVolume, setPlaybackRampStartVolume] = useState(0);
  const [playbackRampTargetVolume, setPlaybackRampTargetVolume] = useState(2.0);
  const [playbackSessionRampDuration, setPlaybackSessionRampDuration] = useState(2000);
  const [playbackRampScheduleEnabled, setPlaybackRampScheduleEnabled] = useState(false);
  const [playbackRampStartHour, setPlaybackRampStartHour] = useState(18); // 6:00 PM
  const [playbackRampEndHour, setPlaybackRampEndHour] = useState(6); // 6:00 AM

  // Recording & Playback
  const [saveRecording, setSaveRecording] = useState(true);
  const [loggingEnabled, setLoggingEnabled] = useState(true);
  const [playbackEnabled, setPlaybackEnabled] = useState(true);

  // Devices
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [poeDevices, setPoeDevices] = useState<PoEDevice[]>([]);
  const [speakerStatuses, setSpeakerStatuses] = useState<SpeakerStatus[]>([]);

  // Zones (for zoned playback)
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneRouting, setZoneRouting] = useState<Record<string, ZoneRouting>>({});
  const [zonedPlayback, setZonedPlayback] = useState(false);
  const [zoneScheduleEnabled, setZoneScheduleEnabled] = useState(false);

  // Native Audio (Electron + naudiodon)
  const [nativeAudioAvailable, setNativeAudioAvailable] = useState(false);
  const [useNativeAudio, setUseNativeAudio] = useState(false);
  const [nativeDevices, setNativeDevices] = useState<Array<{ id: number; name: string; maxInputChannels: number; defaultSampleRate: number; hostAPIName: string }>>([]);
  const [medicalNativeDeviceId, setMedicalNativeDeviceId] = useState<number | null>(null);
  const [fireNativeDeviceId, setFireNativeDeviceId] = useState<number | null>(null);
  const [allCallNativeDeviceId, setAllCallNativeDeviceId] = useState<number | null>(null);

  // PoE Control
  const [poeKeepAliveDuration, setPoeKeepAliveDuration] = useState(240000); // 4 minutes default
  const [poeAutoDisabled, setPoeAutoDisabled] = useState<Set<string>>(new Set());
  const [poeParallelMode, setPoeParallelMode] = useState(false); // false = sequential (safe), true = parallel (fast)
  const [poeToggleDelay, setPoeToggleDelay] = useState(0); // delay between sequential toggles in ms

  // Emulation
  const [emulationMode, setEmulationMode] = useState(false);
  const [emulationNetworkDelay, setEmulationNetworkDelay] = useState(0);

  // Logs
  const [logs, setLogs] = useState<Array<{ timestamp: string; message: string; type: 'info' | 'error' | 'warning' }>>([]);

  // Refs
  const recorderRef = useRef<SimpleRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const linkedSpeakersRef = useRef<any[]>([]);
  const controlPoEDevicesRef = useRef<(enable: boolean, force?: boolean) => Promise<void>>(async () => {});
  const poeOffTimerRef = useRef<NodeJS.Timeout | null>(null);
  const poeCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const poeIsOnRef = useRef(false);
  const splitContextRef = useRef<AudioContext | null>(null);
  // Native audio bridge refs
  const nativeBridgeContextRef = useRef<AudioContext | null>(null);
  const nativePcmUnsubRef = useRef<(() => void) | null>(null);

  // Update recorder's playback volume when it changes
  useEffect(() => {
    if (recorderRef.current) {
      recorderRef.current.setPlaybackVolume(playbackVolume);
    }
  }, [playbackVolume]);

  // Detect native audio availability on mount
  useEffect(() => {
    const detect = async () => {
      try {
        if (window.nativeAudio) {
          const available = await window.nativeAudio.isAvailable();
          setNativeAudioAvailable(available);
          if (available) {
            const devs = await window.nativeAudio.listDevices();
            setNativeDevices(devs);
            console.log('[NativeAudio] Available. Devices:', devs.length);
          }
        }
      } catch {
        setNativeAudioAvailable(false);
      }
    };
    detect();
  }, []);

  // Refresh native device list
  const refreshNativeDevices = useCallback(async () => {
    if (!window.nativeAudio) return;
    try {
      const devs = await window.nativeAudio.listDevices();
      setNativeDevices(devs);
    } catch {
      // ignore
    }
  }, []);

  // Load zones + zone routing from Firebase (user-scoped — only this user's zones)
  useEffect(() => {
    if (!user?.email) return;
    Promise.all([
      getZones(user.email),
      getUserZoneRouting(user.email),
    ]).then(([loadedZones, loadedRouting]) => {
      setZones(loadedZones);
      setZoneRouting(loadedRouting);
    }).catch(() => {
      // Non-fatal — zoned playback falls back to all speakers if zones fail to load
    });
  }, [user]);

  // Auto-manage zonedPlayback based on day/night schedule
  // When zoneScheduleEnabled is on: night = zone routing active, day = all speakers
  // Uses dayStartHour/dayEndHour regardless of whether dayNightMode (detection ramping) is on
  // Runs every minute to catch schedule transitions mid-session
  useEffect(() => {
    if (!zoneScheduleEnabled) return;

    const checkSchedule = () => {
      const now = new Date();
      const currentTime = now.getHours() + (now.getMinutes() >= 30 ? 0.5 : 0);
      const isDay = currentTime >= dayStartHour && currentTime < dayEndHour;
      const shouldBeZoned = !isDay;

      setZonedPlayback(shouldBeZoned);

      // Update live recorder if monitoring is active — no restart needed
      if (recorderRef.current) {
        recorderRef.current.setZonedPlayback(shouldBeZoned);
      }
    };

    checkSchedule(); // Apply immediately when schedule link is toggled on
    const interval = setInterval(checkSchedule, 60_000); // Re-check every minute
    return () => clearInterval(interval);
  }, [zoneScheduleEnabled, dayStartHour, dayEndHour]);

  // Load settings from sessionState on mount
  useEffect(() => {
    if (!sessionState) return;

    // Load device selection
    if (sessionState.selectedDevices !== undefined) setSelectedDevices(sessionState.selectedDevices);
    if (sessionState.selectedInputDevice !== undefined) setSelectedInputDevice(sessionState.selectedInputDevice);

    // Load SimpleRecorder settings
    if (sessionState.batchDuration !== undefined) setBatchDuration(sessionState.batchDuration);
    if (sessionState.silenceTimeout !== undefined) setSilenceTimeout(sessionState.silenceTimeout);
    if (sessionState.playbackDelay !== undefined) setPlaybackDelay(sessionState.playbackDelay);
    if (sessionState.hardwareGracePeriod !== undefined) setHardwareGracePeriod(sessionState.hardwareGracePeriod);
    if (sessionState.audioThreshold !== undefined) setAudioThreshold(sessionState.audioThreshold);
    if (sessionState.sustainDuration !== undefined) setSustainDuration(sessionState.sustainDuration);
    if (sessionState.disableDelay !== undefined) setDisableDelay(sessionState.disableDelay);

    // Load volume settings
    if (sessionState.targetVolume !== undefined) setTargetVolume(sessionState.targetVolume);
    if (sessionState.rampEnabled !== undefined) setRampEnabled(sessionState.rampEnabled);
    if (sessionState.rampDuration !== undefined) setRampDuration(sessionState.rampDuration);
    if (sessionState.dayNightMode !== undefined) setDayNightMode(sessionState.dayNightMode);
    if (sessionState.dayStartHour !== undefined) setDayStartHour(sessionState.dayStartHour);
    if (sessionState.dayEndHour !== undefined) setDayEndHour(sessionState.dayEndHour);
    if (sessionState.nightRampDuration !== undefined) setNightRampDuration(sessionState.nightRampDuration);

    // Load playback volume settings
    if (sessionState.playbackRampDuration !== undefined) setPlaybackRampDuration(sessionState.playbackRampDuration);
    if (sessionState.playbackStartVolume !== undefined) setPlaybackStartVolume(sessionState.playbackStartVolume);
    if (sessionState.playbackMaxVolume !== undefined) setPlaybackMaxVolume(sessionState.playbackMaxVolume);
    if (sessionState.playbackVolume !== undefined) setPlaybackVolume(sessionState.playbackVolume);

    // Load session volume ramping settings
    if (sessionState.playbackRampEnabled !== undefined) setPlaybackRampEnabled(sessionState.playbackRampEnabled);
    if (sessionState.playbackRampStartVolume !== undefined) setPlaybackRampStartVolume(sessionState.playbackRampStartVolume);
    if (sessionState.playbackRampTargetVolume !== undefined) setPlaybackRampTargetVolume(sessionState.playbackRampTargetVolume);
    if (sessionState.playbackSessionRampDuration !== undefined) setPlaybackSessionRampDuration(sessionState.playbackSessionRampDuration);
    if (sessionState.playbackRampScheduleEnabled !== undefined) setPlaybackRampScheduleEnabled(sessionState.playbackRampScheduleEnabled);
    if (sessionState.playbackRampStartHour !== undefined) setPlaybackRampStartHour(sessionState.playbackRampStartHour);
    if (sessionState.playbackRampEndHour !== undefined) setPlaybackRampEndHour(sessionState.playbackRampEndHour);

    // Load recording/playback settings
    if (sessionState.saveRecording !== undefined) setSaveRecording(sessionState.saveRecording);
    if (sessionState.loggingEnabled !== undefined) setLoggingEnabled(sessionState.loggingEnabled);
    // playbackEnabled is always true in current version - ignore stale session values

    // Load emulation settings
    if (sessionState.emulationMode !== undefined) setEmulationMode(sessionState.emulationMode);
    if (sessionState.emulationNetworkDelay !== undefined) setEmulationNetworkDelay(sessionState.emulationNetworkDelay);

    // Load multi-input device selections
    if (sessionState.medicalInputDevice !== undefined) setMedicalInputDevice(sessionState.medicalInputDevice);
    if (sessionState.fireInputDevice !== undefined) setFireInputDevice(sessionState.fireInputDevice);
    if (sessionState.allCallInputDevice !== undefined) setAllCallInputDevice(sessionState.allCallInputDevice);
    if (sessionState.medicalEnabled !== undefined) setMedicalEnabled(sessionState.medicalEnabled);
    if (sessionState.fireEnabled !== undefined) setFireEnabled(sessionState.fireEnabled);
    if (sessionState.allCallEnabled !== undefined) setAllCallEnabled(sessionState.allCallEnabled);
    if (sessionState.medicalChannel !== undefined) setMedicalChannel(sessionState.medicalChannel);
    if (sessionState.fireChannel !== undefined) setFireChannel(sessionState.fireChannel);
    if (sessionState.allCallChannel !== undefined) setAllCallChannel(sessionState.allCallChannel);

    // Load zone settings
    if (sessionState.zonedPlayback !== undefined) setZonedPlayback(sessionState.zonedPlayback);
    if (sessionState.zoneScheduleEnabled !== undefined) setZoneScheduleEnabled(sessionState.zoneScheduleEnabled);

    // Load native audio settings
    if (sessionState.useNativeAudio !== undefined) setUseNativeAudio(sessionState.useNativeAudio);
    if (sessionState.medicalNativeDeviceId !== undefined) setMedicalNativeDeviceId(sessionState.medicalNativeDeviceId);
    if (sessionState.fireNativeDeviceId !== undefined) setFireNativeDeviceId(sessionState.fireNativeDeviceId);
    if (sessionState.allCallNativeDeviceId !== undefined) setAllCallNativeDeviceId(sessionState.allCallNativeDeviceId);

    // Load PoE settings
    if (sessionState.poeKeepAliveDuration !== undefined) setPoeKeepAliveDuration(sessionState.poeKeepAliveDuration);
    if (sessionState.poeParallelMode !== undefined) setPoeParallelMode(sessionState.poeParallelMode);
    if (sessionState.poeToggleDelay !== undefined) setPoeToggleDelay(sessionState.poeToggleDelay);
  }, [sessionState]);

  // Sync settings to RTDB when they change
  useEffect(() => {
    syncSessionState({
      selectedDevices,
      selectedInputDevice: selectedInputDevice || undefined,
      batchDuration,
      silenceTimeout,
      playbackDelay,
      hardwareGracePeriod,
      audioThreshold,
      sustainDuration,
      disableDelay,
      targetVolume,
      rampEnabled,
      rampDuration,
      dayNightMode,
      dayStartHour,
      dayEndHour,
      nightRampDuration,
      playbackRampDuration,
      playbackStartVolume,
      playbackMaxVolume,
      playbackVolume,
      playbackRampEnabled,
      playbackRampStartVolume,
      playbackRampTargetVolume,
      playbackSessionRampDuration,
      playbackRampScheduleEnabled,
      playbackRampStartHour,
      playbackRampEndHour,
      saveRecording,
      loggingEnabled,
      playbackEnabled,
      emulationMode,
      emulationNetworkDelay,
      medicalInputDevice,
      fireInputDevice,
      allCallInputDevice,
      medicalEnabled,
      fireEnabled,
      allCallEnabled,
      medicalChannel,
      fireChannel,
      allCallChannel,
      zonedPlayback,
      zoneScheduleEnabled,
      useNativeAudio,
      medicalNativeDeviceId,
      fireNativeDeviceId,
      allCallNativeDeviceId,
      poeKeepAliveDuration,
      poeParallelMode,
      poeToggleDelay,
    });
  }, [
    selectedDevices,
    selectedInputDevice,
    batchDuration, silenceTimeout, playbackDelay, hardwareGracePeriod, audioThreshold, sustainDuration, disableDelay,
    targetVolume, rampEnabled, rampDuration, dayNightMode, dayStartHour, dayEndHour, nightRampDuration,
    playbackRampDuration, playbackStartVolume, playbackMaxVolume, playbackVolume,
    playbackRampEnabled, playbackRampStartVolume, playbackRampTargetVolume, playbackSessionRampDuration,
    playbackRampScheduleEnabled, playbackRampStartHour, playbackRampEndHour,
    saveRecording, loggingEnabled, playbackEnabled, emulationMode, emulationNetworkDelay,
    medicalInputDevice, fireInputDevice, allCallInputDevice,
    medicalEnabled, fireEnabled, allCallEnabled,
    medicalChannel, fireChannel, allCallChannel,
    zonedPlayback, zoneScheduleEnabled,
    useNativeAudio, medicalNativeDeviceId, fireNativeDeviceId, allCallNativeDeviceId,
    poeKeepAliveDuration, poeParallelMode, poeToggleDelay,
    syncSessionState,
  ]);

  // Create a synthetic MediaStream from native audio IPC for a specific device+channel
  const createNativeMediaStream = async (
    nativeDeviceId: number,
    channel: number,
    ctx: AudioContext
  ): Promise<MediaStream> => {
    // Load the pcm-bridge worklet
    await ctx.audioWorklet.addModule('/audio/pcm-bridge.worklet.js');
    const bridgeNode = new AudioWorkletNode(ctx, 'pcm-bridge', {
      outputChannelCount: [1],
    });
    const dest = ctx.createMediaStreamDestination();
    bridgeNode.connect(dest);

    // Subscribe to IPC PCM data for this device+channel
    const unsub = window.nativeAudio!.onPCM((data) => {
      if (data.deviceId === nativeDeviceId && data.channel === channel) {
        bridgeNode.port.postMessage({ samples: data.samples });
      }
    });

    // Store unsubscriber for cleanup
    const prevUnsub = nativePcmUnsubRef.current;
    nativePcmUnsubRef.current = () => {
      unsub();
      if (prevUnsub) prevUnsub();
    };

    return dest.stream;
  };

  // Start monitoring
  const startMonitoring = useCallback(async () => {
    try {
      addLog(multiInputMode ? 'Starting multi-input monitoring...' : 'Starting monitoring...', 'info');

      // Get microphone stream(s)
      let stream: MediaStream | null = null;
      let medicalStream: MediaStream | null = null;
      let fireStream: MediaStream | null = null;
      let allCallStream: MediaStream | null = null;

      console.log('[startMonitoring] Native audio check:', { multiInputMode, useNativeAudio, nativeAudioAvailable, medicalNativeDeviceId, fireNativeDeviceId, allCallNativeDeviceId });

      if (multiInputMode && useNativeAudio && nativeAudioAvailable) {
        // === NATIVE AUDIO PATH (Electron + naudiodon) ===
        addLog('Using native audio capture (naudiodon)...', 'info');

        const bridgeCtx = new AudioContext({ sampleRate: 48000 });
        nativeBridgeContextRef.current = bridgeCtx;

        // Determine which native devices to capture and their channel counts
        const devicesToCapture = new Map<number, number>(); // deviceId → channelCount needed

        if (medicalEnabled && medicalNativeDeviceId !== null) {
          const dev = nativeDevices.find(d => d.id === medicalNativeDeviceId);
          if (dev) {
            const needed = Math.max(devicesToCapture.get(dev.id) || 0, medicalChannel + 1);
            devicesToCapture.set(dev.id, Math.min(needed, dev.maxInputChannels));
          }
        }
        if (fireEnabled && fireNativeDeviceId !== null) {
          const dev = nativeDevices.find(d => d.id === fireNativeDeviceId);
          if (dev) {
            const needed = Math.max(devicesToCapture.get(dev.id) || 0, fireChannel + 1);
            devicesToCapture.set(dev.id, Math.min(needed, dev.maxInputChannels));
          }
        }
        if (allCallEnabled && allCallNativeDeviceId !== null) {
          const dev = nativeDevices.find(d => d.id === allCallNativeDeviceId);
          if (dev) {
            const needed = Math.max(devicesToCapture.get(dev.id) || 0, allCallChannel + 1);
            devicesToCapture.set(dev.id, Math.min(needed, dev.maxInputChannels));
          }
        }

        // Start native captures
        for (const [deviceId, channelCount] of devicesToCapture) {
          const ok = await window.nativeAudio!.startCapture({ deviceId, channelCount, sampleRate: 48000 });
          if (!ok) {
            throw new Error(`Failed to start native capture on device ${deviceId}`);
          }
          const dev = nativeDevices.find(d => d.id === deviceId);
          addLog(`Native capture started: ${dev?.name || deviceId} (${channelCount}ch)`, 'info');
        }

        // Create synthetic MediaStreams via pcm-bridge worklet
        if (medicalEnabled && medicalNativeDeviceId !== null) {
          medicalStream = await createNativeMediaStream(medicalNativeDeviceId, medicalChannel, bridgeCtx);
        }
        if (fireEnabled && fireNativeDeviceId !== null) {
          fireStream = await createNativeMediaStream(fireNativeDeviceId, fireChannel, bridgeCtx);
        }
        if (allCallEnabled && allCallNativeDeviceId !== null) {
          allCallStream = await createNativeMediaStream(allCallNativeDeviceId, allCallChannel, bridgeCtx);
        }

        const enabledCount = [medicalStream, fireStream, allCallStream].filter(s => s !== null).length;
        addLog(`Native audio: ${enabledCount} stream(s) bridged to Web Audio`, 'info');

        if (enabledCount === 0) {
          throw new Error('At least one native input must be enabled with a device selected');
        }
      } else if (multiInputMode) {
        // === BROWSER getUserMedia PATH (fallback) ===
        // Helper: extract a single channel from a stereo stream
        const extractChannel = (stereoStream: MediaStream, channelIndex: number, ctx: AudioContext): MediaStream => {
          const source = ctx.createMediaStreamSource(stereoStream);
          const splitter = ctx.createChannelSplitter(2);
          source.connect(splitter);
          const merger = ctx.createChannelMerger(1);
          splitter.connect(merger, channelIndex, 0);
          const dest = ctx.createMediaStreamDestination();
          merger.connect(dest);
          return dest.stream;
        };

        // Check if Medical and Fire share the same device (e.g., 4i4 stereo → L+R split)
        const medFireSharedDevice = medicalEnabled && fireEnabled &&
          medicalInputDevice && fireInputDevice &&
          medicalInputDevice === fireInputDevice;

        if (medFireSharedDevice) {
          // Single capture, split into two channels
          const rawStream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: medicalInputDevice! }, channelCount: { ideal: 2 } },
            video: false,
          });
          const splitCtx = new AudioContext();
          splitContextRef.current = splitCtx;
          medicalStream = extractChannel(rawStream, medicalChannel, splitCtx);
          fireStream = extractChannel(rawStream, fireChannel, splitCtx);
          const devName = devices.find(d => d.id === medicalInputDevice)?.name || 'shared device';
          addLog(`Shared capture: ${devName} → Medical(${medicalChannel === 0 ? 'L' : 'R'}) + Fire(${fireChannel === 0 ? 'L' : 'R'})`, 'info');
        } else {
          // Independent captures
          const streamPromises: Promise<MediaStream | null>[] = [];

          if (medicalEnabled && medicalInputDevice) {
            streamPromises.push(navigator.mediaDevices.getUserMedia({
              audio: { deviceId: { exact: medicalInputDevice }, channelCount: { ideal: 2 } },
              video: false,
            }));
          } else {
            streamPromises.push(Promise.resolve(null));
          }

          if (fireEnabled && fireInputDevice) {
            streamPromises.push(navigator.mediaDevices.getUserMedia({
              audio: { deviceId: { exact: fireInputDevice }, channelCount: { ideal: 2 } },
              video: false,
            }));
          } else {
            streamPromises.push(Promise.resolve(null));
          }

          const [rawMedical, rawFire] = await Promise.all(streamPromises);

          // Apply channel selection if needed
          if (rawMedical && medicalChannel !== 0) {
            if (!splitContextRef.current) splitContextRef.current = new AudioContext();
            medicalStream = extractChannel(rawMedical, medicalChannel, splitContextRef.current);
          } else {
            medicalStream = rawMedical;
          }

          if (rawFire && fireChannel !== 0) {
            if (!splitContextRef.current) splitContextRef.current = new AudioContext();
            fireStream = extractChannel(rawFire, fireChannel, splitContextRef.current);
          } else {
            fireStream = rawFire;
          }
        }

        // All-Call — always independent
        if (allCallEnabled && allCallInputDevice) {
          const rawAllCall = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: allCallInputDevice }, channelCount: { ideal: 2 } },
            video: false,
          });
          if (allCallChannel !== 0) {
            if (!splitContextRef.current) splitContextRef.current = new AudioContext();
            allCallStream = extractChannel(rawAllCall, allCallChannel, splitContextRef.current);
          } else {
            allCallStream = rawAllCall;
          }
        }

        const enabledCount = [medicalStream, fireStream, allCallStream].filter(s => s !== null).length;
        addLog(`${enabledCount} input stream(s) acquired`, 'info');

        // Diagnostic: log audio track details for each stream
        const streamDiag = [
          { name: 'Medical', stream: medicalStream },
          { name: 'Fire', stream: fireStream },
          { name: 'AllCall', stream: allCallStream },
        ];
        for (const { name, stream: s } of streamDiag) {
          if (s) {
            const tracks = s.getAudioTracks();
            for (const track of tracks) {
              const settings = track.getSettings();
              console.log(`[AudioDiag] ${name} track:`, {
                label: track.label,
                enabled: track.enabled,
                muted: track.muted,
                readyState: track.readyState,
                sampleRate: settings.sampleRate,
                channelCount: settings.channelCount,
                deviceId: settings.deviceId?.substring(0, 16) + '...',
              });
            }
          }
        }

        if (enabledCount === 0) {
          throw new Error('At least one input must be enabled with a device selected');
        }
      } else {
        // Single input mode
        const constraints: MediaStreamConstraints = {
          audio: selectedInputDevice
            ? { deviceId: { exact: selectedInputDevice } }
            : true,
          video: false,
        };

        stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
      }

      // Get linked speakers and paging device
      let linkedSpeakers: any[];
      let pagingDevice: any;

      if (emulationMode) {
        // Create 12 virtual speakers + 1 paging device for emulation
        linkedSpeakers = Array.from({ length: 12 }, (_, i) => ({
          id: `virtual-speaker-${i + 1}`,
          name: `Virtual Speaker ${i + 1}`,
          ipAddress: `192.168.1.${100 + i}`,
          type: '8180', // Speaker type
          zone: i < 6 ? 'zone-a' : 'zone-b', // Split across 2 zones
        }));

        pagingDevice = {
          id: 'virtual-paging-1',
          name: 'Virtual Paging Device',
          ipAddress: '192.168.1.200',
          type: '8301', // Paging device type
        };

        addLog(`🧪 Emulation Mode: Created 12 virtual speakers + 1 paging device`, 'info');
      } else {
        // User must explicitly select a paging device — multiple paging devices may exist
        // and only one should be active at a time. selectedDevices is the source of truth.
        const selectedPagingDevices = devices.filter(d =>
          selectedDevices.includes(d.id) && d.type === "8301"
        );

        if (selectedPagingDevices.length > 0) {
          pagingDevice = selectedPagingDevices[0];
          const linkedSpeakerIds = pagingDevice.linkedSpeakerIds || [];
          linkedSpeakers = devices.filter(d => linkedSpeakerIds.includes(d.id));

          addLog(`📢 Paging Device: ${pagingDevice.name}`, 'info');
          addLog(`🔊 Linked Speakers: ${linkedSpeakers.length}`, 'info');
          linkedSpeakers.forEach((s, i) => {
            addLog(`   ${i + 1}. ${s.name} (${s.ipAddress})`, 'info');
          });
        } else {
          pagingDevice = null;
          linkedSpeakers = [];
          addLog(`ℹ️  No paging device selected — hardware control inactive`, 'info');
        }
      }

      // Store for emergency controls
      linkedSpeakersRef.current = linkedSpeakers;

      // Create SimpleRecorder
      // Compute speakers-per-channel from zone routing (for zoned playback)
      // For each channel, collect speakers that belong to zones routed to that channel
      const allDevices = devices;
      const computeSpeakersForChannel = (channel: 'medical' | 'fire' | 'allCall') => {
        return allDevices.filter(device => {
          if (!device.zone) return false;
          const routing = zoneRouting[device.zone];
          return routing ? routing[channel] === true : false;
        });
      };
      const speakersByChannel = {
        medical: computeSpeakersForChannel('medical'),
        fire: computeSpeakersForChannel('fire'),
        allCall: computeSpeakersForChannel('allCall'),
      };

      recorderRef.current = new SimpleRecorder({
        multiInputMode,
        batchDuration,
        silenceTimeout,
        playbackDelay,
        hardwareGracePeriod,
        audioThreshold,
        sustainDuration,
        linkedSpeakers,
        pagingDevice,
        saveRecording,
        emulationMode,
        emulationNetworkDelay,
        playbackVolume,
        playbackRampEnabled,
        playbackRampStartVolume,
        playbackRampTargetVolume,
        playbackRampDuration: playbackSessionRampDuration,
        playbackRampScheduleEnabled,
        playbackRampStartHour,
        playbackRampEndHour,
        zonedPlayback,
        speakersByChannel,
        onMedicalAudioLevel: (level) => setMedicalAudioLevel(level),
        onFireAudioLevel: (level) => setFireAudioLevel(level),
        onAllCallAudioLevel: (level) => setAllCallAudioLevel(level),
        uploadCallback: async (blob, filename, sessionId) => {
          try {
            addLog(`Uploading ${filename} (${(blob.size / 1024).toFixed(2)} KB)...`, 'info');

            // Upload to Firebase Storage: recordings/{userId}/{filename}
            const fileRef = storageRef(storage, `recordings/${user?.uid}/${filename}`);
            await uploadBytes(fileRef, blob, {
              contentType: 'audio/webm;codecs=opus', // Set proper MIME type
            });

            // Get download URL
            const downloadURL = await getDownloadURL(fileRef);

            // Log the download URL so user can access it
            addLog(`✓ Upload complete: ${filename}`, 'info');
            addLog(`🔗 Download: ${downloadURL}`, 'info');

            // Save metadata to Firestore for fast querying
            if (user) {
              const { dateKey } = getPSTTime();

              // Save to Firestore (for admin recordings page)
              // Use sessionId as document ID to prevent duplicates on retry
              await addRecording({
                sessionId, // Use session ID as Firestore document ID
                userId: user.uid,
                userEmail: user.email || 'unknown',
                filename,
                storageUrl: downloadURL,
                storagePath: `recordings/${user.uid}/${filename}`,
                size: blob.size,
                mimeType: 'audio/webm;codecs=opus',
                timestamp: new Date(),
                dateKey,
              });

              addLog('✓ Metadata saved to Firestore', 'info');
            }

            return downloadURL;
          } catch (error) {
            addLog(`❌ Upload failed: ${error}`, 'error');
            console.error('[SimpleMonitoring] Upload error:', error);
            throw error;
          }
        },
        onLog: (message, type) => {
          addLog(message, type);
        },
        onError: (error) => {
          addLog(`Error: ${error.message}`, 'error');
        },
        onAudioLevel: (level) => {
          setAudioLevel(level);
          setAudioDetected(level > audioThreshold);
        },
        onPlaybackLevel: (level) => {
          setPlaybackAudioLevel(level);
        },
        setSpeakerZoneIP: setSpeakersZoneIP,
        controlPoEDevices,
        setSpeakerVolume: async (speakerId: string, volumePercent: number) => {
          // 🧪 EMULATION MODE: Skip API calls
          if (emulationMode) {
            addLog(`🧪 EMULATION: Skipping volume set for speaker ${speakerId}`, 'info');
            return;
          }

          // Find speaker device
          const speaker = devices.find(d => d.id === speakerId);
          if (!speaker || !speaker.ipAddress || !speaker.apiPassword) {
            addLog(`⚠️  Speaker ${speakerId} not found or missing credentials - skipping volume set`, 'warning');
            return;
          }

          // Use speaker's maxVolume setting from /live-v2 page (NOT default volume from output page)
          const speakerMaxVolume = speaker.maxVolume ?? 100;

          // Convert to level (0-10) and then to dB
          // Formula: dB = (level - 10) * 3
          // Level 7 (70%) = -9dB, Level 10 (100%) = 0dB
          let volumeDbString: string;
          const volumeScale = Math.round((speakerMaxVolume / 100) * 10);
          const volumeDb = (volumeScale - 10) * 3;
          volumeDbString = volumeDb === 0 ? "0dB" : `${volumeDb}dB`;

          try {
            const response = await fetch("/api/algo/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ipAddress: speaker.ipAddress,
                password: speaker.apiPassword,
                authMethod: speaker.authMethod || 'basic',
                settings: {
                  "audio.page.vol": volumeDbString,
                },
              }),
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({ error: 'Unknown' }));
              throw new Error(`${response.status}: ${errorData.error}`);
            }

            addLog(`✓ ${speaker.name} page volume set to ${volumeDbString} (level ${volumeScale})`, 'info');
          } catch (error) {
            // Don't throw - just log and continue with other speakers
            addLog(`⚠️  ${speaker.name} volume failed: ${error}`, 'warning');
          }
        },
      });

      // Start recorder
      if (multiInputMode) {
        // At least one stream must be non-null (validated above)
        await recorderRef.current.startMultiInput(medicalStream, fireStream, allCallStream);
      } else if (stream) {
        await recorderRef.current.start(stream);
      } else {
        throw new Error('No stream available');
      }

      // Initialize hardware (set to idle + individual volumes)
      addLog('Initializing hardware...', 'info');
      await recorderRef.current.initializeHardware();

      // Ensure all PoE devices are OFF on start (force — no countdown)
      await controlPoEDevicesRef.current(false, true);

      setIsMonitoring(true);
      addLog('✅ Monitoring started', 'info');

    } catch (error) {
      addLog(`Failed to start: ${error}`, 'error');
      console.error('Failed to start monitoring:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInputDevice, batchDuration, silenceTimeout, playbackDelay, hardwareGracePeriod, saveRecording, devices, selectedDevices, audioThreshold, emulationMode, emulationNetworkDelay, medicalInputDevice, fireInputDevice, allCallInputDevice, medicalEnabled, fireEnabled, allCallEnabled, medicalChannel, fireChannel, allCallChannel, useNativeAudio, nativeAudioAvailable, medicalNativeDeviceId, fireNativeDeviceId, allCallNativeDeviceId]);

  // Stop monitoring
  const stopMonitoring = useCallback(async () => {
    try {
      addLog('Stopping monitoring...', 'info');

      if (recorderRef.current) {
        await recorderRef.current.stop();
        recorderRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (splitContextRef.current) {
        splitContextRef.current.close();
        splitContextRef.current = null;
      }

      // Clean up native audio
      if (nativePcmUnsubRef.current) {
        nativePcmUnsubRef.current();
        nativePcmUnsubRef.current = null;
      }
      if (nativeBridgeContextRef.current) {
        nativeBridgeContextRef.current.close();
        nativeBridgeContextRef.current = null;
      }
      if (window.nativeAudio) {
        window.nativeAudio.stopAllCaptures().catch(() => {});
      }

      // Ensure all PoE devices are OFF on stop (force immediate), then clear session
      await controlPoEDevicesRef.current(false, true);
      // Clear PoE sessions server-side
      fetch('/api/poe/clear-session', { method: 'POST' }).catch(() => {});

      linkedSpeakersRef.current = [];
      setIsMonitoring(false);
      addLog('Monitoring stopped', 'info');

    } catch (error) {
      addLog(`Failed to stop: ${error}`, 'error');
      console.error('Failed to stop monitoring:', error);
    }
  }, []);

  // Audio level callback
  const onAudioDetected = useCallback((level: number) => {
    setAudioLevel(level);

    // Update audio detected state
    setAudioDetected(level > audioThreshold);

    if (recorderRef.current) {
      recorderRef.current.onAudioDetected(level);
    }
  }, [audioThreshold]);

  // Set input device
  const setInputDevice = useCallback((deviceId: string) => {
    setSelectedInputDevice(deviceId);
  }, []);

  // Helper to get PST time
  const getPSTTime = () => {
    const now = new Date();

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year')?.value || '';
    const month = parts.find(p => p.type === 'month')?.value || '';
    const day = parts.find(p => p.type === 'day')?.value || '';
    const hour = parts.find(p => p.type === 'hour')?.value || '';
    const minute = parts.find(p => p.type === 'minute')?.value || '';
    const second = parts.find(p => p.type === 'second')?.value || '';

    const timestamp = `${hour}:${minute}:${second}`;
    const dateKey = `${year}-${month}-${day}`;

    return { timestamp, dateKey };
  };

  // Add log (write to Firebase RTDB for activity page)
  const addLog = useCallback((message: string, type: 'info' | 'error' | 'warning') => {
    const { timestamp, dateKey } = getPSTTime();
    const logEntry = { timestamp, message, type };

    // Add to local state (for console/debugging)
    setLogs(prev => [...prev.slice(-99), logEntry]); // Keep last 100

    // Only persist key state-change events to Firebase — everything else is console-only
    if (!user || !loggingEnabled) return;

    let eventType: string | null = null;
    let cleanMessage = message;

    // Extract channel name from multi-input messages like "[MEDICAL]", "[FIRE]", "[ALLCALL]"
    const channelMatch = message.match(/\[(MEDICAL|FIRE|ALLCALL)\]/);
    const channel = channelMatch
      ? channelMatch[1] === 'ALLCALL' ? 'All-Call'
        : channelMatch[1] === 'MEDICAL' ? 'Medical'
        : 'Fire'
      : null;

    if (message.includes('VOICE DETECTED')) {
      eventType = 'audio_detected';
      cleanMessage = 'Voice detected';
    } else if (message.includes('NEW SESSION CREATED') || message.includes('NEW SESSION:')) {
      eventType = 'system';
      cleanMessage = channel ? `Session started (${channel})` : 'Session started';
    } else if (message.includes('SESSION CLOSED') || message.includes('Silence timeout')) {
      eventType = 'audio_silent';
      cleanMessage = channel ? `Session ended (${channel})` : 'Session ended (silence timeout)';
    } else if (message.includes('HARDWARE ACTIVATION COMPLETE')) {
      eventType = 'speakers_enabled';
      cleanMessage = 'Speakers activated';
    } else if (message.includes('HARDWARE DEACTIVATION COMPLETE')) {
      eventType = 'speakers_disabled';
      cleanMessage = 'Speakers deactivated';
    } else if (message.includes('SAVE COMPLETE') || message.includes('Session saved')) {
      eventType = 'system';
      cleanMessage = channel ? `Recording saved (${channel})` : 'Recording saved';
    } else if (message.includes('Recording started')) {
      eventType = 'system';
      cleanMessage = channel ? `Recording started (${channel})` : 'Recording started';
    } else if (message.includes('Saving session:')) {
      eventType = 'system';
      const fileMatch = message.match(/Saving session: (.+)/);
      const filename = fileMatch ? fileMatch[1] : 'unknown';
      cleanMessage = channel ? `Saving ${channel}: ${filename}` : `Saving: ${filename}`;
    } else if (message.includes('Upload complete:')) {
      eventType = 'system';
      const fileMatch = message.match(/Upload complete: (.+)/);
      cleanMessage = fileMatch ? `Upload complete: ${fileMatch[1]}` : 'Upload complete';
    } else if (message.includes('Uploading')) {
      eventType = 'system';
      const fileMatch = message.match(/Uploading (.+?)(?:\s*\(|\.\.\.)/);
      cleanMessage = fileMatch ? `Uploading: ${fileMatch[1]}` : 'Uploading recording';
    } else if (message.includes('Monitoring started')) {
      eventType = 'system';
      cleanMessage = 'Monitoring started';
    } else if (message.includes('Monitoring stopped')) {
      eventType = 'system';
      cleanMessage = 'Monitoring stopped';
    } else if (message.includes('deactivating hardware') || message.includes('All idle conditions met')) {
      eventType = 'speakers_disabled';
      cleanMessage = 'Hardware deactivated (idle)';
    } else if (message.includes('PoE:') || message.includes('PoE ')) {
      // PoE device events: "PoE: ON — light1", "PoE device1 failed", etc.
      if (message.includes('ON')) {
        eventType = 'speakers_enabled';
      } else if (message.includes('OFF')) {
        eventType = 'speakers_disabled';
      } else {
        eventType = 'system';
      }
      cleanMessage = message.replace(/^[^\w]*/, ''); // Strip leading emojis
    }

    if (!eventType) return; // Not a key event — skip Firebase write

    addActivityLog({
      timestamp,
      dateKey,
      type: eventType as "audio_detected" | "audio_silent" | "speakers_enabled" | "speakers_disabled" | "volume_change" | "system",
      message: cleanMessage,
      userId: user.uid,
      userEmail: user.email || null,
    }).catch((error) => {
      console.error('[SimpleMonitoring] Failed to write log to Firestore:', error);
    });
  }, [user, loggingEnabled]);

  // Set zone IP on a list of speakers (shared by SimpleRecorder and emergency controls)
  const setSpeakersZoneIP = useCallback(async (speakers: any[], zoneIP: string) => {
    if (speakers.length === 0) {
      addLog(`⚠️  No speakers to control`, 'warning');
      return;
    }

    if (emulationMode) {
      const mode = zoneIP.includes(':50002') ? 'ACTIVE' : 'IDLE';
      addLog(`🧪 EMULATION: Skipping API call for ${speakers.length} speakers' mcast.zone1 → ${zoneIP} (${mode})`, 'info');
      return;
    }

    const mode = zoneIP.includes(':50002') ? 'ACTIVE' : 'IDLE';
    addLog(`Setting ${speakers.length} speakers' mcast.zone1 to ${zoneIP} (${mode}) - in parallel`, 'info');

    try {
      const results = await Promise.allSettled(
        speakers.map(async (speaker) => {
          const response = await fetch("/api/algo/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ipAddress: speaker.ipAddress,
              password: speaker.apiPassword || speaker.password,
              authMethod: speaker.authMethod || 'basic',
              settings: {
                "mcast.zone1": zoneIP,
              },
            }),
          });

          if (!response.ok) {
            throw new Error(`${speaker.name}: API returned ${response.status}`);
          }

          return { speaker: speaker.name, success: true };
        })
      );

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      const failCount = speakers.length - successCount;

      if (failCount > 0) {
        addLog(`⚠️  ${successCount}/${speakers.length} speakers updated (${failCount} failed)`, 'warning');
      } else {
        addLog(`✓ All ${speakers.length} speakers' zone IP set to ${zoneIP}`, 'info');
      }
    } catch (error) {
      addLog(`❌ Failed to set speaker zone IP: ${error}`, 'error');
      throw error;
    }
  }, [emulationMode, addLog]);

  // Helper: clear PoE countdown timer and interval
  const clearPoECountdown = useCallback(() => {
    if (poeOffTimerRef.current) {
      clearTimeout(poeOffTimerRef.current);
      poeOffTimerRef.current = null;
    }
    if (poeCountdownRef.current) {
      clearInterval(poeCountdownRef.current);
      poeCountdownRef.current = null;
    }
  }, []);

  // Low-level PoE toggle (sends the actual API call)
  const sendPoEToggle = useCallback(async (enable: boolean) => {
    // Get PoE devices in auto mode, excluding user-disabled ones
    const autoPoEDevices = poeDevices.filter((d: any) => d.mode === 'auto' && !poeAutoDisabled.has(d.id));
    if (autoPoEDevices.length === 0) return;

    // Get active paging devices (8301) from selected devices
    const activePagingDeviceIds = selectedDevices.filter(deviceId => {
      const device = devices.find((d: any) => d.id === deviceId);
      return device && device.type === '8301';
    });

    // Filter: only control devices linked to an active paging device
    const eligiblePoEDevices = autoPoEDevices.filter((poeDevice: any) => {
      if (!poeDevice.linkedPagingDeviceIds || poeDevice.linkedPagingDeviceIds.length === 0) return false;
      return poeDevice.linkedPagingDeviceIds.some((linkedId: string) => activePagingDeviceIds.includes(linkedId));
    });

    if (eligiblePoEDevices.length === 0) return;

    addLog(`💡 PoE: ${enable ? 'ON' : 'OFF'} — ${eligiblePoEDevices.map((d: any) => d.name).join(', ')}`, 'info');

    try {
      const response = await fetch('/api/poe/toggle-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devices: eligiblePoEDevices.map((d: any) => ({ deviceId: d.id, enabled: enable })),
          parallel: poeParallelMode,
          delay: poeToggleDelay,
        }),
      });
      if (!response.ok) {
        addLog(`⚠️ PoE bulk toggle failed: HTTP ${response.status}`, 'warning');
      } else {
        const result = await response.json();
        const failed = result.results?.filter((r: any) => !r.success) || [];
        if (failed.length > 0) {
          addLog(`⚠️ PoE: ${failed.length} device(s) failed`, 'warning');
        }
      }
    } catch (error) {
      addLog(`⚠️ PoE error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'warning');
    }
  }, [poeDevices, poeAutoDisabled, poeParallelMode, poeToggleDelay, selectedDevices, devices, addLog]);

  // Toggle individual PoE device auto-control (include/exclude from auto-control)
  const togglePoEAutoControl = useCallback((deviceId: string) => {
    setPoeAutoDisabled(prev => {
      const next = new Set(prev);
      if (next.has(deviceId)) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }
      return next;
    });
  }, []);

  // Enable/disable all PoE devices for auto-control
  const setPoeAllAutoEnabled = useCallback((enabled: boolean) => {
    if (enabled) {
      setPoeAutoDisabled(new Set());
    } else {
      const allAutoIds = poeDevices.filter((d: any) => d.mode === 'auto').map((d: any) => d.id);
      setPoeAutoDisabled(new Set(allAutoIds));
    }
  }, [poeDevices]);

  // Control PoE devices with keep-alive timer and per-second countdown logging
  const controlPoEDevices = useCallback(async (enable: boolean, force?: boolean) => {
    if (emulationMode) {
      addLog(`🧪 EMULATION: Simulated ${enable ? 'enabling' : 'disabling'} PoE devices`, 'info');
      return;
    }

    // Check if any PoE devices are auto-enabled (force mode bypasses this)
    const hasEnabledDevices = poeDevices.some((d: any) => d.mode === 'auto' && !poeAutoDisabled.has(d.id));
    if (!hasEnabledDevices && !force) return;

    // Clear any pending countdown
    clearPoECountdown();

    if (enable) {
      // Turn ON immediately (if not already on)
      if (!poeIsOnRef.current) {
        poeIsOnRef.current = true;
        await sendPoEToggle(true);
      } else {
        addLog('💡 PoE: already ON — timer reset', 'info');
        console.log('[PoE] Timer reset — lights stay ON');
      }
    } else if (force) {
      // FORCE OFF — immediate (stop monitoring / emergency), ALL auto devices regardless of toggle state
      poeIsOnRef.current = false;
      // Send to all auto PoE devices (bypass poeAutoDisabled filter)
      const allAutoDevices = poeDevices.filter((d: any) => d.mode === 'auto');
      const activePagingDeviceIds = selectedDevices.filter(deviceId => {
        const device = devices.find((d: any) => d.id === deviceId);
        return device && device.type === '8301';
      });
      const eligibleDevices = allAutoDevices.filter((d: any) => {
        if (!d.linkedPagingDeviceIds || d.linkedPagingDeviceIds.length === 0) return false;
        return d.linkedPagingDeviceIds.some((id: string) => activePagingDeviceIds.includes(id));
      });
      if (eligibleDevices.length > 0) {
        addLog(`💡 PoE: FORCE OFF — ${eligibleDevices.map((d: any) => d.name).join(', ')}`, 'info');
        try {
          await fetch('/api/poe/toggle-bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ devices: eligibleDevices.map((d: any) => ({ deviceId: d.id, enabled: false })) }),
          });
        } catch (error) {
          addLog(`⚠️ PoE force off error: ${error instanceof Error ? error.message : 'Unknown'}`, 'warning');
        }
      }
    } else {
      // Start countdown with per-second logging
      let remaining = Math.ceil(poeKeepAliveDuration / 1000);
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      addLog(`💡 PoE: will turn OFF in ${mins}:${secs.toString().padStart(2, '0')}`, 'info');

      poeCountdownRef.current = setInterval(() => {
        remaining--;
        const m = Math.floor(remaining / 60);
        const s = remaining % 60;
        console.log(`[PoE] Lights OFF in ${m}:${s.toString().padStart(2, '0')}...`);

        if (remaining <= 0) {
          clearPoECountdown();
          console.log('[PoE] Turning lights OFF now');
          if (poeIsOnRef.current) {
            poeIsOnRef.current = false;
            sendPoEToggle(false);
          }
        }
      }, 1000);
    }
  }, [emulationMode, poeDevices, poeAutoDisabled, poeKeepAliveDuration, sendPoEToggle, clearPoECountdown, addLog]);

  // Keep ref in sync for use in stopMonitoring (which is defined before controlPoEDevices)
  controlPoEDevicesRef.current = controlPoEDevices;

  // Emergency Controls — speakers and PoE devices
  const emergencyKillAll = useCallback(async () => {
    const speakers = linkedSpeakersRef.current;
    if (speakers.length === 0) {
      addLog('🚨 No linked speakers to mute', 'warning');
      return;
    }
    addLog(`🚨 EMERGENCY: Muting all ${speakers.length} speakers (idle zone)...`, 'warning');
    await setSpeakersZoneIP(speakers, '224.0.2.60:50022');
    await controlPoEDevices(false, true); // force immediate off
  }, [setSpeakersZoneIP, controlPoEDevices, addLog]);

  const emergencyEnableAll = useCallback(async () => {
    const speakers = linkedSpeakersRef.current;
    if (speakers.length === 0) {
      addLog('⚠️  No linked speakers to enable', 'warning');
      return;
    }
    addLog(`✅ EMERGENCY: Enabling all ${speakers.length} speakers (active receiver zone)...`, 'info');
    await setSpeakersZoneIP(speakers, '224.0.2.60:50002');
    await controlPoEDevices(true);
  }, [setSpeakersZoneIP, controlPoEDevices, addLog]);

  const controlSingleSpeaker = useCallback(async (speakerId: string, enable: boolean) => {
    const speakers = linkedSpeakersRef.current;
    const speaker = speakers.find((s: any) => s.id === speakerId);
    if (!speaker) {
      addLog(`⚠️  Speaker ${speakerId} not found in linked speakers`, 'warning');
      return;
    }
    const action = enable ? 'Enabling' : 'Muting';
    addLog(`${action} speaker ${speaker.name}...`, 'info');
    await setSpeakersZoneIP([speaker], enable ? '224.0.2.60:50002' : '224.0.2.60:50022');
  }, [setSpeakersZoneIP, addLog]);

  const checkSpeakerConnectivity = useCallback(async () => {
    addLog('Checking speaker connectivity (not implemented yet)', 'warning');
  }, []);

  const triggerTestCall = useCallback((durationSeconds: number) => {
    addLog(`Triggering test call for ${durationSeconds}s (not implemented yet)`, 'warning');
  }, []);

  const value: SimpleMonitoringContextType = {
    // State
    isMonitoring,
    audioLevel,
    playbackAudioLevel,
    selectedInputDevice,
    audioDetected,
    speakersEnabled,

    // Multi-Input Mode
    multiInputMode,
    medicalInputDevice,
    fireInputDevice,
    allCallInputDevice,
    medicalAudioLevel,
    fireAudioLevel,
    allCallAudioLevel,
    medicalEnabled,
    fireEnabled,
    allCallEnabled,
    medicalChannel,
    fireChannel,
    allCallChannel,
    setMedicalChannel,
    setFireChannel,
    setAllCallChannel,

    // Audio Settings
    batchDuration,
    silenceTimeout,
    playbackDelay,
    hardwareGracePeriod,
    audioThreshold,
    sustainDuration,
    disableDelay,

    // Volume & Ramp Settings
    targetVolume,
    rampEnabled,
    rampDuration,
    dayNightMode,
    dayStartHour,
    dayEndHour,
    nightRampDuration,

    // Playback Volume Settings
    playbackRampDuration,
    playbackStartVolume,
    playbackMaxVolume,
    playbackVolume,

    // Playback Volume Ramping (Web Audio API - per session)
    playbackRampEnabled,
    playbackRampStartVolume,
    playbackRampTargetVolume,
    playbackSessionRampDuration,
    playbackRampScheduleEnabled,
    playbackRampStartHour,
    playbackRampEndHour,

    // Recording & Playback
    saveRecording,
    recordingEnabled: saveRecording, // Alias
    loggingEnabled,
    playbackEnabled,

    // Devices
    devices,
    selectedDevices,
    poeDevices,
    speakerStatuses,

    // Zones (for zoned playback)
    zones,
    zoneRouting,
    zonedPlayback,
    setZonedPlayback,
    zoneScheduleEnabled,
    setZoneScheduleEnabled,

    // Native Audio
    nativeAudioAvailable,
    useNativeAudio,
    setUseNativeAudio,
    nativeDevices,
    medicalNativeDeviceId,
    fireNativeDeviceId,
    allCallNativeDeviceId,
    setMedicalNativeDeviceId,
    setFireNativeDeviceId,
    setAllCallNativeDeviceId,
    refreshNativeDevices,

    // Emulation
    emulationMode,
    emulationNetworkDelay,

    // Actions
    startMonitoring,
    stopMonitoring,
    setInputDevice,

    // Multi-Input Actions
    setMultiInputMode,
    setMedicalInputDevice,
    setFireInputDevice,
    setAllCallInputDevice,
    setMedicalEnabled,
    setFireEnabled,
    setAllCallEnabled,

    setBatchDuration,
    setSilenceTimeout,
    setPlaybackDelay,
    setHardwareGracePeriod,
    setAudioThreshold,
    setSustainDuration,
    setDisableDelay,
    setTargetVolume,
    setRampEnabled,
    setRampDuration,
    setDayNightMode,
    setDayStartHour,
    setDayEndHour,
    setNightRampDuration,
    setPlaybackRampDuration,
    setPlaybackStartVolume,
    setPlaybackMaxVolume,
    setPlaybackVolume,
    setPlaybackRampEnabled,
    setPlaybackRampStartVolume,
    setPlaybackRampTargetVolume,
    setPlaybackSessionRampDuration,
    setPlaybackRampScheduleEnabled,
    setPlaybackRampStartHour,
    setPlaybackRampEndHour,
    setSaveRecording,
    setRecordingEnabled: setSaveRecording, // Alias
    setLoggingEnabled,
    setPlaybackEnabled,
    setDevices,
    setSelectedDevices,
    setPoeDevices,
    setEmulationMode,
    setEmulationNetworkDelay,
    onAudioDetected,

    // PoE Control
    poeKeepAliveDuration,
    setPoeKeepAliveDuration,
    poeAutoDisabled,
    togglePoEAutoControl,
    setPoeAllAutoEnabled,
    poeParallelMode,
    setPoeParallelMode,
    poeToggleDelay,
    setPoeToggleDelay,

    // Emergency Controls
    emergencyKillAll,
    emergencyEnableAll,
    controlSingleSpeaker,
    checkSpeakerConnectivity,
    triggerTestCall,

    // Logs
    logs,
  };

  return (
    <SimpleMonitoringContext.Provider value={value}>
      {children}
    </SimpleMonitoringContext.Provider>
  );
}

export function useSimpleMonitoring() {
  const context = useContext(SimpleMonitoringContext);
  if (!context) {
    throw new Error('useSimpleMonitoring must be used within SimpleMonitoringProvider');
  }
  return context;
}
