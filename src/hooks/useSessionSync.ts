import { useEffect, useRef, useCallback } from "react";
import { useRealtimeSync } from "@/contexts/realtime-sync-context";
import { useAudioMonitoring } from "@/contexts/audio-monitoring-context";

/**
 * Hook to sync audio monitoring state with Firebase Realtime Database
 * This enables bidirectional sync between users and admins
 */
export function useSessionSync() {
  const {
    syncSessionState,
    sessionState,
    viewingAsUserId,
    isBeingControlled,
  } = useRealtimeSync();

  const {
    isCapturing,
    selectedDevices,
    volume,
    targetVolume,
    audioThreshold,
    rampEnabled,
    rampDuration,
    sustainDuration,
    disableDelay,
    selectedInputDevice,
    dayNightMode,
    dayStartHour,
    dayEndHour,
    nightRampDuration,
    loggingEnabled,
    recordingEnabled,
    playbackEnabled,
    playbackDelay,
    playbackDisableDelay,
    tailGuardDuration,
    postPlaybackGraceDuration,
    playbackRampDuration,
    playbackStartVolume,
    playbackMaxVolume,
    audioLevel,
    audioDetected,
    speakersEnabled,
    startMonitoring,
    stopMonitoring,
    setSelectedDevices,
    setVolume,
    setTargetVolume,
    setAudioThreshold,
    setRampEnabled,
    setRampDuration,
    setSustainDuration,
    setDisableDelay,
    setInputDevice,
    setDayNightMode,
    setDayStartHour,
    setDayEndHour,
    setNightRampDuration,
    setLoggingEnabled,
    setRecordingEnabled,
    setPlaybackEnabled,
    setPlaybackDelay,
    setPlaybackDisableDelay,
    setTailGuardDuration,
    setPostPlaybackGraceDuration,
    setPlaybackRampDuration,
    setPlaybackStartVolume,
    setPlaybackMaxVolume,
  } = useAudioMonitoring();

  const isApplyingRemoteUpdate = useRef(false);

  // Sync local state to Firebase when it changes
  useEffect(() => {
    if (isApplyingRemoteUpdate.current) return;

    // CRITICAL: Always sync, even when admin is viewing or user is being controlled!
    // syncSessionState handles routing to the correct session
    // Note: Removed noisy log - sync happens frequently and is expected behavior

    // Filter out undefined values to prevent Firebase errors
    const stateToSync: any = {
      audioInputMonitoring: isCapturing, // Updated field name
    };

    if (selectedDevices !== undefined) stateToSync.selectedDevices = selectedDevices;
    if (volume !== undefined) stateToSync.volume = volume;
    if (targetVolume !== undefined) stateToSync.targetVolume = targetVolume;
    if (audioThreshold !== undefined) stateToSync.audioThreshold = audioThreshold;
    if (rampEnabled !== undefined) stateToSync.rampEnabled = rampEnabled;
    if (rampDuration !== undefined) stateToSync.rampDuration = rampDuration;
    if (sustainDuration !== undefined) stateToSync.sustainDuration = sustainDuration;
    if (disableDelay !== undefined) stateToSync.disableDelay = disableDelay;
    if (selectedInputDevice !== undefined) stateToSync.selectedInputDevice = selectedInputDevice;
    if (dayNightMode !== undefined) stateToSync.dayNightMode = dayNightMode;
    if (dayStartHour !== undefined) stateToSync.dayStartHour = dayStartHour;
    if (dayEndHour !== undefined) stateToSync.dayEndHour = dayEndHour;
    if (nightRampDuration !== undefined) stateToSync.nightRampDuration = nightRampDuration;
    if (loggingEnabled !== undefined) stateToSync.loggingEnabled = loggingEnabled;
    if (recordingEnabled !== undefined) stateToSync.recordingEnabled = recordingEnabled;
    if (playbackEnabled !== undefined) stateToSync.playbackEnabled = playbackEnabled;
    if (playbackDelay !== undefined) stateToSync.playbackDelay = playbackDelay;
    if (playbackDisableDelay !== undefined) stateToSync.playbackDisableDelay = playbackDisableDelay;
    if (tailGuardDuration !== undefined) stateToSync.tailGuardDuration = tailGuardDuration;
    if (postPlaybackGraceDuration !== undefined) stateToSync.postPlaybackGraceDuration = postPlaybackGraceDuration;
    if (playbackRampDuration !== undefined) stateToSync.playbackRampDuration = playbackRampDuration;
    if (playbackStartVolume !== undefined) stateToSync.playbackStartVolume = playbackStartVolume;
    if (playbackMaxVolume !== undefined) stateToSync.playbackMaxVolume = playbackMaxVolume;
    if (audioLevel !== undefined) stateToSync.audioLevel = audioLevel;
    if (audioDetected !== undefined) stateToSync.audioDetected = audioDetected;
    if (speakersEnabled !== undefined) stateToSync.speakersEnabled = speakersEnabled;

    syncSessionState(stateToSync);
  }, [
    isCapturing,
    selectedDevices,
    volume,
    targetVolume,
    audioThreshold,
    rampEnabled,
    rampDuration,
    sustainDuration,
    disableDelay,
    selectedInputDevice,
    dayNightMode,
    dayStartHour,
    dayEndHour,
    nightRampDuration,
    loggingEnabled,
    recordingEnabled,
    playbackEnabled,
    playbackDelay,
    playbackDisableDelay,
    tailGuardDuration,
    postPlaybackGraceDuration,
    playbackRampDuration,
    playbackStartVolume,
    playbackMaxVolume,
    audioLevel,
    audioDetected,
    speakersEnabled,
    syncSessionState,
    viewingAsUserId,
    isBeingControlled,
  ]);

  // TEMPORARILY DISABLED: Remote control feature is buggy and causes infinite loops
  // Apply remote updates from Firebase (when being controlled by admin OR when admin viewing user)
  useEffect(() => {
    if (!sessionState) return;

    // Remote control feature is temporarily disabled
    return; // DISABLED

    // CRITICAL: Admin MUST apply user's state to local context to control it!
    // This way admin's sliders/buttons show user's actual values
    /*
    if (viewingAsUserId) {
      console.log('[SessionSync] Admin viewing user - applying user state to admin local context for control');
    } else {
      console.log('[SessionSync] User being controlled - applying admin state');
    }

    isApplyingRemoteUpdate.current = true;

    // Apply monitoring state
    if (sessionState && sessionState.audioInputMonitoring !== isCapturing) {
      if (sessionState.audioInputMonitoring) {
        startMonitoring();
      } else {
        stopMonitoring();
      }
    }

    // Apply device selection
    if (sessionState && sessionState.selectedDevices && JSON.stringify(sessionState.selectedDevices) !== JSON.stringify(selectedDevices)) {
      setSelectedDevices(sessionState.selectedDevices);
    }

    // Apply volume settings
    if (sessionState.volume !== undefined && sessionState.volume !== volume) {
      setVolume(sessionState.volume);
    }

    if (sessionState.targetVolume !== undefined && sessionState.targetVolume !== targetVolume) {
      setTargetVolume(sessionState.targetVolume);
    }

    if (sessionState.audioThreshold !== undefined && sessionState.audioThreshold !== audioThreshold) {
      setAudioThreshold(sessionState.audioThreshold);
    }

    // Apply ramp settings
    if (sessionState.rampEnabled !== undefined && sessionState.rampEnabled !== rampEnabled) {
      setRampEnabled(sessionState.rampEnabled);
    }

    if (sessionState.rampDuration !== undefined && sessionState.rampDuration !== rampDuration) {
      setRampDuration(sessionState.rampDuration);
    }

    if (sessionState.sustainDuration !== undefined && sessionState.sustainDuration !== sustainDuration) {
      setSustainDuration(sessionState.sustainDuration);
    }

    if (sessionState.disableDelay !== undefined && sessionState.disableDelay !== disableDelay) {
      setDisableDelay(sessionState.disableDelay);
    }

    // Apply input device
    if (sessionState.selectedInputDevice !== undefined && sessionState.selectedInputDevice !== selectedInputDevice) {
      console.log('[SessionSync] Applying input device change:', sessionState.selectedInputDevice, 'current:', selectedInputDevice);
      setInputDevice(sessionState.selectedInputDevice);
    }

    // Apply day/night mode settings
    if (sessionState.dayNightMode !== undefined && sessionState.dayNightMode !== dayNightMode) {
      setDayNightMode(sessionState.dayNightMode);
    }

    if (sessionState.dayStartHour !== undefined && sessionState.dayStartHour !== dayStartHour) {
      setDayStartHour(sessionState.dayStartHour);
    }

    if (sessionState.dayEndHour !== undefined && sessionState.dayEndHour !== dayEndHour) {
      setDayEndHour(sessionState.dayEndHour);
    }

    if (sessionState.nightRampDuration !== undefined && sessionState.nightRampDuration !== nightRampDuration) {
      setNightRampDuration(sessionState.nightRampDuration);
    }

    // Apply logging & recording settings
    if (sessionState.loggingEnabled !== undefined && sessionState.loggingEnabled !== loggingEnabled) {
      setLoggingEnabled(sessionState.loggingEnabled);
    }

    if (sessionState.recordingEnabled !== undefined && sessionState.recordingEnabled !== recordingEnabled) {
      setRecordingEnabled(sessionState.recordingEnabled);
    }

    if (sessionState.playbackEnabled !== undefined && sessionState.playbackEnabled !== playbackEnabled) {
      setPlaybackEnabled(sessionState.playbackEnabled);
    }

    if (sessionState.playbackDelay !== undefined && sessionState.playbackDelay !== playbackDelay) {
      setPlaybackDelay(sessionState.playbackDelay);
    }

    if (sessionState.playbackDisableDelay !== undefined && sessionState.playbackDisableDelay !== playbackDisableDelay) {
      setPlaybackDisableDelay(sessionState.playbackDisableDelay);
    }

    if (sessionState.tailGuardDuration !== undefined && sessionState.tailGuardDuration !== tailGuardDuration) {
      setTailGuardDuration(sessionState.tailGuardDuration);
    }

    if (sessionState.postPlaybackGraceDuration !== undefined && sessionState.postPlaybackGraceDuration !== postPlaybackGraceDuration) {
      setPostPlaybackGraceDuration(sessionState.postPlaybackGraceDuration);
    }

    if (sessionState.playbackRampDuration !== undefined && sessionState.playbackRampDuration !== playbackRampDuration) {
      setPlaybackRampDuration(sessionState.playbackRampDuration);
    }

    if (sessionState.playbackStartVolume !== undefined && sessionState.playbackStartVolume !== playbackStartVolume) {
      setPlaybackStartVolume(sessionState.playbackStartVolume);
    }

    if (sessionState.playbackMaxVolume !== undefined && sessionState.playbackMaxVolume !== playbackMaxVolume) {
      setPlaybackMaxVolume(sessionState.playbackMaxVolume);
    }

    // Reset flag after applying updates - increased to 200ms to avoid race conditions
    setTimeout(() => {
      isApplyingRemoteUpdate.current = false;
    }, 200);
    */
  }, [sessionState, viewingAsUserId]);
}
