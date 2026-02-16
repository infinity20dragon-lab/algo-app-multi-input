"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface AudioCaptureState {
  isCapturing: boolean;
  isRecording: boolean;
  isPaused: boolean;
  audioLevel: number;
  duration: number;
  error: string | null;
}

interface UseAudioCaptureOptions {
  onAudioData?: (data: Float32Array) => void;
}

export function useAudioCapture(options: UseAudioCaptureOptions = {}) {
  const [state, setState] = useState<AudioCaptureState>({
    isCapturing: false,
    isRecording: false,
    isPaused: false,
    audioLevel: 0,
    duration: 0,
    error: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isCapturingRef = useRef<boolean>(false);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopCapture();
    };
  }, []);

  const updateAudioLevel = useCallback(() => {
    if (!analyserNodeRef.current || !isCapturingRef.current) {
      return;
    }

    const analyser = analyserNodeRef.current;

    // Try both frequency and time domain data
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);

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

    setState((prev) => ({ ...prev, audioLevel: level }));

    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, []); // No dependencies - use refs instead

  const startCapture = useCallback(async (deviceId?: string) => {
    try {
      setState((prev) => ({ ...prev, error: null }));

      // Request microphone/line-in access
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      };

      // If a specific device is requested, use it
      if (deviceId) {
        audioConstraints.deviceId = { exact: deviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      // DEBUG: Log information about the captured stream
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const track = audioTracks[0];
        console.log('[AudioCapture] 🎤 Started monitoring:');
        console.log('  - Device Label:', track.label);
        console.log('  - Device ID:', track.getSettings().deviceId);
        console.log('  - Sample Rate:', track.getSettings().sampleRate);
        console.log('  - Channel Count:', track.getSettings().channelCount);
      }

      mediaStreamRef.current = stream;

      // Create audio context
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Create nodes
      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;

      const gainNode = audioContext.createGain();
      gainNodeRef.current = gainNode;

      const analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNodeRef.current = analyserNode;

      // Connect nodes: source -> gain -> analyser
      sourceNode.connect(gainNode);
      gainNode.connect(analyserNode);

      // Set capturing flag BEFORE starting animation frame
      isCapturingRef.current = true;
      setState((prev) => ({ ...prev, isCapturing: true }));

      // Start level monitoring
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to access audio input";
      setState((prev) => ({ ...prev, error: errorMessage }));
      console.error("Audio capture error:", error);
    }
  }, [updateAudioLevel]);

  const stopCapture = useCallback(() => {
    // Stop capturing flag first
    isCapturingRef.current = false;

    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop duration interval
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    // Stop all tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Clear refs
    sourceNodeRef.current = null;
    gainNodeRef.current = null;
    analyserNodeRef.current = null;
    recordedChunksRef.current = [];

    setState({
      isCapturing: false,
      isRecording: false,
      isPaused: false,
      audioLevel: 0,
      duration: 0,
      error: null,
    });
  }, []);

  const setVolume = useCallback((volume: number) => {
    if (gainNodeRef.current) {
      // Convert 0-100 to 0-2 (allowing boost up to 2x)
      gainNodeRef.current.gain.value = volume / 50;
    }
  }, []);

  const startRecording = useCallback(() => {
    if (!mediaStreamRef.current || state.isRecording) return;

    recordedChunksRef.current = [];

    const mediaRecorder = new MediaRecorder(mediaStreamRef.current, {
      mimeType: "audio/webm;codecs=opus",
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100); // Collect data every 100ms

    startTimeRef.current = Date.now();
    durationIntervalRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setState((prev) => ({ ...prev, duration: elapsed }));
    }, 1000);

    setState((prev) => ({ ...prev, isRecording: true, duration: 0 }));
  }, [state.isRecording]);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || !state.isRecording) {
        resolve(null);
        return;
      }

      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }

      const mediaRecorder = mediaRecorderRef.current;

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        recordedChunksRef.current = [];
        setState((prev) => ({ ...prev, isRecording: false }));
        resolve(blob);
      };

      mediaRecorder.stop();
    });
  }, [state.isRecording]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording && !state.isPaused) {
      mediaRecorderRef.current.pause();
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      setState((prev) => ({ ...prev, isPaused: true }));
    }
  }, [state.isRecording, state.isPaused]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording && state.isPaused) {
      mediaRecorderRef.current.resume();
      durationIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setState((prev) => ({ ...prev, duration: elapsed }));
      }, 1000);
      setState((prev) => ({ ...prev, isPaused: false }));
    }
  }, [state.isRecording, state.isPaused]);

  const getInputDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === "audioinput");
    } catch (error) {
      console.error("Failed to enumerate devices:", error);
      return [];
    }
  }, []);

  return {
    ...state,
    startCapture,
    stopCapture,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    setVolume,
    getInputDevices,
    mediaStream: mediaStreamRef.current, // Expose the monitoring stream
  };
}
