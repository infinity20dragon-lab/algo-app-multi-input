"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useAudioMonitoring } from "@/contexts/audio-monitoring-context";
import { useAuth } from "@/contexts/auth-context";
import { useRealtimeSync } from "@/contexts/realtime-sync-context";
import { updateDevice } from "@/lib/firebase/firestore";
import { storage } from "@/lib/firebase/config";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import type { AlgoDevice, InputChannelType } from "@/lib/algo/types";
import { Play, Square, Radio, Mic, Volume2, AlertCircle, CheckCircle2, Film, AlertTriangle } from "lucide-react";
import { getAlwaysKeepPagingOn } from "@/lib/settings";

interface InputChannel {
  type: InputChannelType;
  deviceId: string | null;
  isActive: boolean;
  audioLevel: number;
  mediaStream: MediaStream | null;
  analyser: AnalyserNode | null;
  // Recording state
  isRecording: boolean;
  recordingStartTime: string | null;
}

export default function InputRoutingPage() {
  const { devices, isCapturing, volume } = useAudioMonitoring();
  const { user } = useAuth();
  const { sessionState, syncSessionState } = useRealtimeSync();

  // Multi-input channels state
  const [channels, setChannels] = useState<InputChannel[]>([
    { type: "medical", deviceId: null, isActive: false, audioLevel: 0, mediaStream: null, analyser: null, isRecording: false, recordingStartTime: null },
    { type: "fire", deviceId: null, isActive: false, audioLevel: 0, mediaStream: null, analyser: null, isRecording: false, recordingStartTime: null },
    { type: "allCall", deviceId: null, isActive: false, audioLevel: 0, mediaStream: null, analyser: null, isRecording: false, recordingStartTime: null },
  ]);

  // Audio settings
  const [threshold, setThreshold] = useState(-40); // dB threshold for detection
  const [gain, setGain] = useState(1.0);
  const [isMonitoring, setIsMonitoring] = useState(false);

  // Recording settings
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [silenceDelay, setSilenceDelay] = useState(2000); // ms before stopping recording

  // Logging
  const [logs, setLogs] = useState<Array<{
    timestamp: string;
    channel: InputChannelType | "system";
    type: "audio_detected" | "audio_silent" | "speakers_enabled" | "speakers_disabled" | "recording_saved" | "system";
    message: string;
    recordingUrl?: string;
  }>>([]);
  const [loggingEnabled, setLoggingEnabled] = useState(true);

  // Available audio input devices
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);

  // Animation frame for monitoring
  const animationFrameRef = useRef<number | undefined>(undefined);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);

  // Recording refs (per channel)
  const mediaRecordersRef = useRef<Map<InputChannelType, MediaRecorder>>(new Map());
  const recordedChunksRef = useRef<Map<InputChannelType, Blob[]>>(new Map());
  const silenceTimersRef = useRef<Map<InputChannelType, NodeJS.Timeout>>(new Map());

  // Load available audio input devices
  useEffect(() => {
    async function loadAudioDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        setAudioInputDevices(audioInputs);
      } catch (error) {
        console.error("Failed to enumerate audio devices:", error);
      }
    }
    loadAudioDevices();
  }, []);

  // Sync multi-input monitoring state to Firebase
  useEffect(() => {
    syncSessionState({
      multiInputMonitoring: isMonitoring,
    });
  }, [isMonitoring, syncSessionState]);

  // Add log entry
  const addLog = useCallback((entry: {
    channel: InputChannelType | "system";
    type: "audio_detected" | "audio_silent" | "speakers_enabled" | "speakers_disabled" | "recording_saved" | "system";
    message: string;
    recordingUrl?: string;
  }) => {
    if (!loggingEnabled) return;

    const logEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    console.log(`[InputRouting] ${logEntry.message}`, logEntry);

    setLogs((prev) => {
      const newLogs = [...prev, logEntry];
      // Keep only last 500 entries
      if (newLogs.length > 500) {
        return newLogs.slice(-500);
      }
      return newLogs;
    });
  }, [loggingEnabled]);

  // Clear logs
  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // Export logs as CSV
  const exportLogs = useCallback(() => {
    const header = "Timestamp,Channel,Type,Message,Recording URL\n";
    const rows = logs.map((log) => {
      const timestamp = new Date(log.timestamp).toLocaleString();
      return `"${timestamp}","${log.channel}","${log.type}","${log.message}","${log.recordingUrl || ''}"`;
    }).join("\n");

    const csv = header + rows;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `multi-input-logs-${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  // Get speakers for each input type
  const getSpeakersForInput = useCallback((inputType: InputChannelType): AlgoDevice[] => {
    return devices.filter((d) => d.type !== "8301" && d.inputAssignment === inputType);
  }, [devices]);

  // Update channel device selection
  const updateChannelDevice = useCallback((channelType: InputChannelType, deviceId: string) => {
    setChannels((prev) =>
      prev.map((ch) =>
        ch.type === channelType ? { ...ch, deviceId: deviceId === "none" ? null : deviceId } : ch
      )
    );
  }, []);

  // Assign speaker to input channel
  const assignSpeakerToInput = useCallback(async (speakerId: string, inputType: InputChannelType | null) => {
    try {
      await updateDevice(speakerId, { inputAssignment: inputType });
      console.log(`[InputRouting] Assigned speaker ${speakerId} to ${inputType || "none"}`);
    } catch (error) {
      console.error("Failed to assign speaker:", error);
    }
  }, []);

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
        console.log('[InputRouting] Using mimeType:', type);
        return type;
      }
    }

    console.warn('[InputRouting] No preferred mimeType supported, using default');
    return '';
  }, []);

  // Start recording for a specific channel
  const startRecording = useCallback(async (channelType: InputChannelType, stream: MediaStream) => {
    if (!recordingEnabled || !user) {
      console.log(`[InputRouting] Recording disabled or no user for ${channelType}`);
      return;
    }

    try {
      // Get best supported mimeType
      const mimeType = getBestAudioMimeType();

      // Create media recorder with best supported format
      const options: MediaRecorderOptions = {};
      if (mimeType) {
        options.mimeType = mimeType;
      }

      const mediaRecorder = new MediaRecorder(stream, options);
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recordedChunksRef.current.set(channelType, chunks);
      mediaRecorder.start(100);
      mediaRecordersRef.current.set(channelType, mediaRecorder);

      setChannels((prev) =>
        prev.map((ch) =>
          ch.type === channelType
            ? { ...ch, isRecording: true, recordingStartTime: new Date().toISOString() }
            : ch
        )
      );

      console.log(`[InputRouting] 🔴 Started recording ${channelType} with mimeType:`, mimeType || 'default');
    } catch (error) {
      console.error(`[InputRouting] Failed to start recording ${channelType}:`, error);
    }
  }, [recordingEnabled, user, getBestAudioMimeType]);

  // Stop recording and upload for a specific channel
  const stopRecordingAndUpload = useCallback(async (channelType: InputChannelType): Promise<string | null> => {
    const mediaRecorder = mediaRecordersRef.current.get(channelType);
    const chunks = recordedChunksRef.current.get(channelType);

    if (!mediaRecorder || !user || !chunks) {
      return null;
    }

    return new Promise((resolve) => {
      mediaRecorder.onstop = async () => {
        try {
          // Get the mimeType that was actually used
          const actualMimeType = mediaRecorder.mimeType || 'audio/webm';

          // Create blob from recorded chunks
          const audioBlob = new Blob(chunks, { type: actualMimeType });

          if (audioBlob.size === 0) {
            console.warn(`[InputRouting] No audio data recorded for ${channelType}`);
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

          console.log(`[InputRouting] Saving ${channelType} as ${fileExtension} (${actualMimeType})`);

          // Get recording start time
          const channel = channels.find((ch) => ch.type === channelType);
          const timestamp = (channel?.recordingStartTime || new Date().toISOString()).replace(/[:.]/g, '-');
          const filename = `${channelType}-${timestamp}.${fileExtension}`;
          const filePath = `multi-input-recordings/${user.uid}/${filename}`;

          console.log(`[InputRouting] Uploading ${channelType} recording to ${filePath}`);
          const fileRef = storageRef(storage, filePath);
          await uploadBytes(fileRef, audioBlob);

          const downloadUrl = await getDownloadURL(fileRef);
          console.log(`[InputRouting] ✅ ${channelType} recording uploaded:`, downloadUrl);

          // Clean up
          mediaRecordersRef.current.delete(channelType);
          recordedChunksRef.current.delete(channelType);

          setChannels((prev) =>
            prev.map((ch) =>
              ch.type === channelType
                ? { ...ch, isRecording: false, recordingStartTime: null }
                : ch
            )
          );

          resolve(downloadUrl);
        } catch (error) {
          console.error(`[InputRouting] Failed to upload ${channelType} recording:`, error);
          resolve(null);
        }
      };

      mediaRecorder.stop();
    });
  }, [user, channels]);

  // Activate speakers for a specific channel
  const activateSpeakersForChannel = useCallback(async (channelType: InputChannelType) => {
    console.log(`[InputRouting] 🔥 ${channelType.toUpperCase()} AUDIO DETECTED - Activating speakers`);

    const speakers = getSpeakersForInput(channelType);

    if (speakers.length === 0) {
      console.log(`[InputRouting] No speakers assigned to ${channelType}`);
      addLog({
        channel: channelType,
        type: "system",
        message: `Audio detected but no speakers assigned to ${channelType}`,
      });
      return;
    }

    addLog({
      channel: channelType,
      type: "speakers_enabled",
      message: `Activating ${speakers.length} speaker(s) for ${channelType}`,
    });

    // Enable paging device (only if not always on)
    const alwaysKeepPagingOn = getAlwaysKeepPagingOn();
    const pagingDevices = devices.filter((d) => d.type === "8301");
    if (pagingDevices.length > 0 && !alwaysKeepPagingOn) {
      // Only toggle paging if not always on
      await fetch("/api/algo/speakers/mcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speakers: pagingDevices.map((p) => ({
            ipAddress: p.ipAddress,
            password: p.apiPassword,
            authMethod: p.authMethod,
          })),
          mode: 1, // Transmitter mode
        }),
      });
    }

    // Set speakers to receiver mode and ramp volume
    await fetch("/api/algo/speakers/mcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        speakers: speakers.map((s) => ({
          ipAddress: s.ipAddress,
          password: s.apiPassword,
          authMethod: s.authMethod,
        })),
        mode: 2, // Receiver mode
      }),
    });

    // Ramp volume (use individual speaker max volumes)
    for (const speaker of speakers) {
      const vol = speaker.maxVolume || 100;
      await fetch("/api/algo/speakers/volume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speakers: [{
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod,
          }],
          volume: vol,
        }),
      });
    }

    console.log(`[InputRouting] ✅ Activated ${speakers.length} speakers for ${channelType}`);
  }, [devices, getSpeakersForInput, addLog]);

  // Deactivate speakers for a specific channel
  const deactivateSpeakersForChannel = useCallback(async (channelType: InputChannelType) => {
    console.log(`[InputRouting] 🛑 ${channelType.toUpperCase()} AUDIO ENDED - Deactivating speakers`);

    const speakers = getSpeakersForInput(channelType);

    addLog({
      channel: channelType,
      type: "speakers_disabled",
      message: `Deactivating ${speakers.length} speaker(s) for ${channelType}`,
    });

    // Mute speakers to -45dB
    await fetch("/api/algo/speakers/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        speakers: speakers.map((s) => ({
          ipAddress: s.ipAddress,
          password: s.apiPassword,
          authMethod: s.authMethod,
        })),
        volume: 0, // -45dB
      }),
    });

    // Disable paging device (only if not always on)
    const alwaysKeepPagingOn = getAlwaysKeepPagingOn();
    const pagingDevices = devices.filter((d) => d.type === "8301");
    if (pagingDevices.length > 0 && !alwaysKeepPagingOn) {
      // Only toggle paging if not always on
      await fetch("/api/algo/speakers/mcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speakers: pagingDevices.map((p) => ({
            ipAddress: p.ipAddress,
            password: p.apiPassword,
            authMethod: p.authMethod,
          })),
          mode: 0, // Disabled
        }),
      });
    }

    console.log(`[InputRouting] ✅ Deactivated ${speakers.length} speakers for ${channelType}`);
  }, [devices, getSpeakersForInput, addLog]);

  // Start monitoring all 3 channels
  const startMonitoring = useCallback(async () => {
    console.log("[InputRouting] Starting multi-input monitoring");

    addLog({
      channel: "system",
      type: "system",
      message: `Multi-input monitoring started - Threshold: ${threshold}dB, Gain: ${gain.toFixed(1)}x`,
    });

    // Create audio context if needed
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    const ctx = audioContextRef.current;

    // Start each channel that has a device selected
    const updatedChannels = await Promise.all(
      channels.map(async (channel) => {
        if (!channel.deviceId) {
          console.log(`[InputRouting] Skipping ${channel.type} - no device selected`);
          return channel;
        }

        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: channel.deviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });

          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.8;

          // Apply gain
          const gainNode = ctx.createGain();
          gainNode.gain.value = gain;

          source.connect(gainNode);
          gainNode.connect(analyser);

          console.log(`[InputRouting] Started ${channel.type} on device ${channel.deviceId}`);

          return {
            ...channel,
            mediaStream: stream,
            analyser,
          };
        } catch (error) {
          console.error(`[InputRouting] Failed to start ${channel.type}:`, error);
          return channel;
        }
      })
    );

    setChannels(updatedChannels);
    setIsMonitoring(true);

    // Start monitoring loop
    monitorChannels();
  }, [channels, gain, threshold, addLog]);

  // Monitor all channels for audio activity
  const monitorChannels = useCallback(() => {
    if (!isMonitoring) return;

    setChannels((prevChannels) => {
      const updatedChannels = prevChannels.map((channel) => {
        if (!channel.analyser) return channel;

        // Get audio level
        const dataArray = new Uint8Array(channel.analyser.frequencyBinCount);
        channel.analyser.getByteFrequencyData(dataArray);

        const sum = dataArray.reduce((a, b) => a + b, 0);
        const average = sum / dataArray.length;
        const audioLevel = Math.round((average / 255) * 100);

        // Convert to dB (approximate)
        const db = 20 * Math.log10(average / 255);
        const isActive = db > threshold && audioLevel > 5;

        // If this channel just became active
        if (isActive && !channel.isActive) {
          // Cancel any pending silence timer
          const existingTimer = silenceTimersRef.current.get(channel.type);
          if (existingTimer) {
            clearTimeout(existingTimer);
            silenceTimersRef.current.delete(channel.type);
          }

          // Log audio detection
          addLog({
            channel: channel.type,
            type: "audio_detected",
            message: `Audio detected on ${channel.type} - Level: ${audioLevel}%`,
          });

          // Activate speakers
          activateSpeakersForChannel(channel.type);

          // Start recording if not already recording
          if (!channel.isRecording && channel.mediaStream) {
            startRecording(channel.type, channel.mediaStream);
          }
        }

        // If this channel just became inactive
        if (!isActive && channel.isActive) {
          // Log audio silence
          addLog({
            channel: channel.type,
            type: "audio_silent",
            message: `Audio below threshold on ${channel.type} - Starting ${(silenceDelay / 1000).toFixed(1)}s silence delay`,
          });

          // Set silence timer to deactivate speakers and stop recording
          const timer = setTimeout(async () => {
            await deactivateSpeakersForChannel(channel.type);

            // Stop recording and upload
            if (channel.isRecording) {
              const recordingUrl = await stopRecordingAndUpload(channel.type);

              // Log recording saved
              addLog({
                channel: channel.type,
                type: "recording_saved",
                message: `Recording saved for ${channel.type}${recordingUrl ? ' 🎙️' : ' (failed)'}`,
                recordingUrl: recordingUrl || undefined,
              });

              console.log(`[InputRouting] ${channel.type} recording saved:`, recordingUrl || 'failed');
            }

            silenceTimersRef.current.delete(channel.type);
          }, silenceDelay);

          silenceTimersRef.current.set(channel.type, timer);
        }

        return {
          ...channel,
          isActive,
          audioLevel,
        };
      });

      return updatedChannels;
    });

    animationFrameRef.current = requestAnimationFrame(monitorChannels);
  }, [isMonitoring, threshold, silenceDelay, startRecording, stopRecordingAndUpload, activateSpeakersForChannel, deactivateSpeakersForChannel, addLog]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    console.log("[InputRouting] Stopping multi-input monitoring");

    addLog({
      channel: "system",
      type: "system",
      message: "Multi-input monitoring stopped - All channels shut down",
    });

    // Cancel animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Clear all silence timers
    silenceTimersRef.current.forEach((timer) => clearTimeout(timer));
    silenceTimersRef.current.clear();

    // Stop all recordings
    channels.forEach(async (channel) => {
      if (channel.isRecording) {
        await stopRecordingAndUpload(channel.type);
      }
    });

    // Stop all media streams
    channels.forEach((channel) => {
      if (channel.mediaStream) {
        channel.mediaStream.getTracks().forEach((track) => track.stop());
      }
    });

    // Reset channels
    setChannels((prev) =>
      prev.map((ch) => ({
        ...ch,
        isActive: false,
        audioLevel: 0,
        mediaStream: null,
        analyser: null,
        isRecording: false,
        recordingStartTime: null,
      }))
    );

    setIsMonitoring(false);
  }, [channels, stopRecordingAndUpload, addLog]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      channels.forEach((ch) => {
        if (ch.mediaStream) {
          ch.mediaStream.getTracks().forEach((track) => track.stop());
        }
      });
    };
  }, []);

  // Get channel color
  const getChannelColor = (type: InputChannelType) => {
    switch (type) {
      case "medical":
        return "text-blue-500";
      case "fire":
        return "text-red-500";
      case "allCall":
        return "text-purple-500";
    }
  };

  // Get channel icon
  const getChannelIcon = (type: InputChannelType) => {
    switch (type) {
      case "medical":
        return "🏥";
      case "fire":
        return "🔥";
      case "allCall":
        return "📢";
    }
  };

  const speakers = devices.filter((d) => d.type !== "8301");
  const unassignedSpeakers = speakers.filter((s) => !s.inputAssignment);

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Warning if audio input is active */}
        {sessionState?.audioInputMonitoring && (
          <Card className="border-orange-500 bg-orange-50 dark:bg-orange-950">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-600" />
                <span className="text-orange-700 dark:text-orange-300 font-semibold">
                  Audio Input monitoring is currently active. Multi-Input Routing is disabled.
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Multi-Input Routing</h1>
            <p className="text-muted-foreground">
              Monitor 3 audio inputs simultaneously and route to assigned speakers
            </p>
          </div>

        <div className="flex items-center gap-4">
          {isMonitoring ? (
            <Button onClick={stopMonitoring} variant="destructive" size="lg">
              <Square className="mr-2 h-4 w-4" />
              Stop Monitoring
            </Button>
          ) : (
            <Button
              onClick={() => {
                // Check if audio input monitoring is active
                if (sessionState?.audioInputMonitoring) {
                  alert('Cannot start multi-input monitoring: Audio Input monitoring is currently active. Please stop audio input monitoring first.');
                  return;
                }
                startMonitoring();
              }}
              variant="default"
              size="lg"
              disabled={sessionState?.audioInputMonitoring}
              title={sessionState?.audioInputMonitoring ? 'Audio Input monitoring is active' : ''}
            >
              <Play className="mr-2 h-4 w-4" />
              Start Monitoring
            </Button>
          )}
        </div>
      </div>

      {/* Monitoring Status */}
      {isMonitoring && (
        <Card className="border-green-500 bg-green-50 dark:bg-green-950">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-green-600 animate-pulse" />
              <span className="text-green-700 dark:text-green-300 font-semibold">
                Multi-Input Monitoring Active
              </span>
              <Badge variant="outline" className="ml-auto">
                {channels.filter((ch) => ch.isActive).length} Active Channel(s)
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audio Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Audio Settings</CardTitle>
          <CardDescription>Configure detection, gain, and recording</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Detection Threshold: {threshold} dB</label>
            <Slider
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              min={-60}
              max={-10}
              step={1}
              disabled={isMonitoring}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Input Gain: {gain.toFixed(1)}x</label>
            <Slider
              value={gain * 10}
              onChange={(e) => setGain(Number(e.target.value) / 10)}
              min={1}
              max={30}
              step={1}
              disabled={isMonitoring}
            />
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-4">
              <div className="space-y-0.5">
                <Label className="flex items-center gap-2">
                  <Film className="h-4 w-4" />
                  Auto Recording
                </Label>
                <p className="text-sm text-muted-foreground">
                  Automatically record audio from each channel
                </p>
              </div>
              <Switch
                checked={recordingEnabled}
                onCheckedChange={setRecordingEnabled}
                disabled={isMonitoring}
              />
            </div>

            {recordingEnabled && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Silence Delay: {(silenceDelay / 1000).toFixed(1)}s
                </label>
                <Slider
                  value={silenceDelay}
                  onChange={(e) => setSilenceDelay(Number(e.target.value))}
                  min={500}
                  max={5000}
                  step={500}
                  disabled={isMonitoring}
                />
                <p className="text-xs text-muted-foreground">
                  Wait time before stopping recording after audio ends
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Input Channels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {channels.map((channel) => {
          const assignedSpeakers = getSpeakersForInput(channel.type);

          return (
            <Card
              key={channel.type}
              className={`${
                channel.isActive ? "border-green-500 bg-green-50 dark:bg-green-950" : ""
              }`}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 flex-wrap">
                  <span className={getChannelColor(channel.type)}>
                    {getChannelIcon(channel.type)} {channel.type.toUpperCase()}
                  </span>
                  <div className="flex gap-2 ml-auto">
                    {channel.isActive && (
                      <Badge variant="outline" className="bg-green-100 text-green-700">
                        ACTIVE
                      </Badge>
                    )}
                    {channel.isRecording && (
                      <Badge variant="outline" className="bg-red-100 text-red-700">
                        🔴 REC
                      </Badge>
                    )}
                  </div>
                </CardTitle>
                <CardDescription>
                  {assignedSpeakers.length} speaker(s) assigned
                  {channel.isRecording && recordingEnabled && (
                    <span className="ml-2 text-red-600">• Recording in progress</span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Input Device Selection */}
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Mic className="h-4 w-4" />
                    Audio Input Device
                  </label>
                  <Select
                    value={channel.deviceId || "none"}
                    onChange={(e) => updateChannelDevice(channel.type, e.target.value)}
                    disabled={isMonitoring}
                  >
                    <option value="none">None</option>
                    {audioInputDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Device ${device.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Audio Level Meter */}
                {isMonitoring && channel.analyser && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Volume2 className="h-4 w-4" />
                      Audio Level
                    </label>
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          channel.isActive ? "bg-green-500" : "bg-blue-500"
                        }`}
                        style={{ width: `${channel.audioLevel}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {channel.audioLevel}%
                    </span>
                  </div>
                )}

                {/* Assigned Speakers */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Assigned Speakers</label>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {assignedSpeakers.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No speakers assigned</p>
                    ) : (
                      assignedSpeakers.map((speaker) => (
                        <div
                          key={speaker.id}
                          className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-800 rounded"
                        >
                          <span className="text-sm">{speaker.name}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => assignSpeakerToInput(speaker.id, null)}
                            disabled={isMonitoring}
                          >
                            Remove
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Unassigned Speakers */}
      {unassignedSpeakers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-500" />
              Unassigned Speakers ({unassignedSpeakers.length})
            </CardTitle>
            <CardDescription>
              These speakers are not assigned to any input channel
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {unassignedSpeakers.map((speaker) => (
                <div
                  key={speaker.id}
                  className="p-3 bg-gray-100 dark:bg-gray-800 rounded-lg space-y-2"
                >
                  <p className="font-medium">{speaker.name}</p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => assignSpeakerToInput(speaker.id, "medical")}
                      disabled={isMonitoring}
                    >
                      🏥 Medical
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => assignSpeakerToInput(speaker.id, "fire")}
                      disabled={isMonitoring}
                    >
                      🔥 Fire
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => assignSpeakerToInput(speaker.id, "allCall")}
                      disabled={isMonitoring}
                    >
                      📢 All Call
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Activity Log</CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="logging-toggle" className="text-sm font-normal">
                  Enable Logging
                </Label>
                <Switch
                  id="logging-toggle"
                  checked={loggingEnabled}
                  onCheckedChange={setLoggingEnabled}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={clearLogs}
                disabled={logs.length === 0}
              >
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportLogs}
                disabled={logs.length === 0}
              >
                Export CSV
              </Button>
            </div>
          </div>
          <CardDescription>
            Real-time activity tracking for multi-input monitoring
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No activity logged yet. {!loggingEnabled && "Logging is disabled."}
              </p>
            ) : (
              logs.slice().reverse().map((log, idx) => {
                const getChannelColor = (channel: string) => {
                  switch (channel) {
                    case "medical": return "text-blue-600 bg-blue-100 dark:bg-blue-950";
                    case "fire": return "text-red-600 bg-red-100 dark:bg-red-950";
                    case "allCall": return "text-purple-600 bg-purple-100 dark:bg-purple-950";
                    default: return "text-gray-600 bg-gray-100 dark:bg-gray-800";
                  }
                };

                const getTypeIcon = (type: string) => {
                  switch (type) {
                    case "audio_detected": return "🎤";
                    case "audio_silent": return "🔇";
                    case "speakers_enabled": return "🔊";
                    case "speakers_disabled": return "🔕";
                    case "recording_saved": return "🎙️";
                    default: return "ℹ️";
                  }
                };

                return (
                  <div
                    key={`${log.timestamp}-${idx}`}
                    className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg text-sm"
                  >
                    <span className="text-lg">{getTypeIcon(log.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={getChannelColor(log.channel)}>
                          {log.channel.toUpperCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="mt-1 text-sm">{log.message}</p>
                      {log.recordingUrl && (
                        <a
                          href={log.recordingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                        >
                          📎 Download Recording
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Help Text */}
      <Card className="border-blue-500 bg-blue-50 dark:bg-blue-950">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <CheckCircle2 className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="space-y-2 text-sm text-blue-700 dark:text-blue-300">
              <p className="font-semibold">How Multi-Input Routing Works:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Assign speakers to input channels (Medical, Fire, All Call)</li>
                <li>Select audio input device for each channel</li>
                <li>Enable auto recording to save audio from each channel (optional)</li>
                <li>Start monitoring - all 3 inputs are listened to simultaneously</li>
                <li>When audio is detected on an input, only speakers assigned to that input activate</li>
                <li>Recordings are saved with channel metadata (medical-timestamp.opus, fire-timestamp.opus)</li>
                <li>Only ONE input will be active at any time (dispatch controls manually)</li>
              </ol>
              <p className="mt-3 text-xs">
                <strong>Recording:</strong> Audio is automatically recorded for each channel when enabled. Recordings are saved to Firebase Storage in the multi-input-recordings folder with the channel type in the filename.
              </p>
              <p className="mt-2 text-xs">
                <strong>OBS Noise Reduction:</strong> Configure 3 separate Audio Input Capture sources with filters, then route each to a separate virtual audio device (VAIO1, VAIO2, VAIO3 or BlackHole channels).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>
    </AppLayout>
  );
}
