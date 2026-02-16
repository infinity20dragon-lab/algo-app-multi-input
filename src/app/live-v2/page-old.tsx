"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Mic,
  MicOff,
  Radio,
  Square,
  Circle,
  Pause,
  Play,
  Volume2,
  Download,
  Upload,
  Music,
  AlertCircle,
} from "lucide-react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/config";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { getDevices, getAudioFiles, addAudioFile } from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/auth-context";
import type { AlgoDevice, AudioFile } from "@/lib/algo/types";
import { formatDuration } from "@/lib/utils";

export default function LiveBroadcastPage() {
  const { user } = useAuth();
  const isDev = process.env.NODE_ENV === 'development';
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [broadcasting, setBroadcasting] = useState(false);
  const [preTone, setPreTone] = useState("");
  const [volume, setVolume] = useState(50);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const [playingPreTone, setPlayingPreTone] = useState(false);
  const [selectedInputDevice, setSelectedInputDevice] = useState<string>("");
  const [audioDetected, setAudioDetected] = useState(false);
  const [speakersEnabled, setSpeakersEnabled] = useState(false);
  const [targetVolume, setTargetVolume] = useState(100); // Target volume for ramp (0-100)
  const [isResuming, setIsResuming] = useState(false); // True when auto-resuming monitoring

  const preToneAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioDetectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const controllingSpakersRef = useRef<boolean>(false);
  const volumeRampIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentVolumeRef = useRef<number>(0);
  const hasRestoredStateRef = useRef<boolean>(false);
  const isResumingRef = useRef<boolean>(false); // Prevent duplicate auto-resumes
  const cleanupDataRef = useRef<{ devices: AlgoDevice[], selectedDevices: string[], speakersEnabled: boolean }>({
    devices: [],
    selectedDevices: [],
    speakersEnabled: false,
  });

  // LocalStorage keys
  const STORAGE_KEYS = {
    IS_MONITORING: 'algo_live_is_monitoring',
    SELECTED_DEVICES: 'algo_live_selected_devices',
    SELECTED_INPUT: 'algo_live_selected_input',
    TARGET_VOLUME: 'algo_live_target_volume',
    INPUT_GAIN: 'algo_live_input_gain',
  };

  const {
    isCapturing,
    isRecording,
    isPaused,
    audioLevel,
    duration,
    error,
    startCapture,
    stopCapture,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    setVolume: setGainVolume,
    getInputDevices,
  } = useAudioCapture();

  const [enablingDisablingSpeakers, setEnablingDisablingSpeakers] = useState(false);

  // Load data and restore persisted state on mount
  useEffect(() => {
    const initializeApp = async () => {
      try {
        console.log('[Live] Initializing app...');

        // Load devices and audio files from Firestore first
        await loadData();
        await loadInputDevices();

        console.log('[Live] Data loaded, restoring state...');

        // Now restore persisted state from localStorage
        const savedDevices = localStorage.getItem(STORAGE_KEYS.SELECTED_DEVICES);
        const savedInput = localStorage.getItem(STORAGE_KEYS.SELECTED_INPUT);
        const savedTargetVolume = localStorage.getItem(STORAGE_KEYS.TARGET_VOLUME);
        const savedInputGain = localStorage.getItem(STORAGE_KEYS.INPUT_GAIN);
        const wasMonitoring = localStorage.getItem(STORAGE_KEYS.IS_MONITORING) === 'true';

        console.log('[Live] Saved state:', {
          devices: savedDevices,
          input: savedInput,
          targetVolume: savedTargetVolume,
          inputGain: savedInputGain,
          wasMonitoring,
        });

        if (savedDevices) {
          const deviceIds = JSON.parse(savedDevices);
          console.log('[Live] Restoring selected devices:', deviceIds);
          setSelectedDevices(deviceIds);
        }
        if (savedInput) {
          console.log('[Live] Restoring input device:', savedInput);
          setSelectedInputDevice(savedInput);
        }
        if (savedTargetVolume) {
          setTargetVolume(parseInt(savedTargetVolume));
        }
        if (savedInputGain) {
          setVolume(parseInt(savedInputGain));
        }

        // Mark as restored AFTER setting state
        setTimeout(() => {
          hasRestoredStateRef.current = true;
          console.log('[Live] State restoration complete');
        }, 100);

        // Auto-start monitoring if it was active before
        if (wasMonitoring && !isResumingRef.current) {
          console.log('[Live] Auto-resuming monitoring from previous session');
          isResumingRef.current = true;
          setIsResuming(true);
          setTimeout(() => {
            startCapture(savedInput || undefined);
            setIsResuming(false);
          }, 500); // Short delay to ensure audio devices are ready
        }
      } catch (error) {
        console.error('[Live] Failed to initialize app:', error);
        hasRestoredStateRef.current = true; // Allow saving even if restore failed
      }
    };

    initializeApp();
  }, []);

  useEffect(() => {
    setGainVolume(volume);
  }, [volume, setGainVolume]);

  // Persist state changes to localStorage
  useEffect(() => {
    if (!hasRestoredStateRef.current) {
      console.log('[Live] Skipping save - not restored yet');
      return; // Don't save initial state before restoration
    }

    console.log('[Live] Saving selected devices:', selectedDevices);
    localStorage.setItem(STORAGE_KEYS.SELECTED_DEVICES, JSON.stringify(selectedDevices));
  }, [selectedDevices]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;

    console.log('[Live] Saving input device:', selectedInputDevice);
    localStorage.setItem(STORAGE_KEYS.SELECTED_INPUT, selectedInputDevice);
  }, [selectedInputDevice]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;

    console.log('[Live] Saving target volume:', targetVolume);
    localStorage.setItem(STORAGE_KEYS.TARGET_VOLUME, targetVolume.toString());
  }, [targetVolume]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;

    console.log('[Live] Saving input gain:', volume);
    localStorage.setItem(STORAGE_KEYS.INPUT_GAIN, volume.toString());
  }, [volume]);

  useEffect(() => {
    if (!hasRestoredStateRef.current) return;

    console.log('[Live] Saving monitoring state:', isCapturing);
    localStorage.setItem(STORAGE_KEYS.IS_MONITORING, isCapturing.toString());
  }, [isCapturing]);

  // Keep cleanup data ref updated with current values
  useEffect(() => {
    cleanupDataRef.current = {
      devices,
      selectedDevices,
      speakersEnabled,
    };
  }, [devices, selectedDevices, speakersEnabled]);

  // Cleanup on unmount - ONLY cleanup intervals, DON'T stop monitoring
  // Monitoring should continue even when navigating to other pages
  useEffect(() => {
    return () => {
      console.log('[Live] Component unmounting - cleaning up intervals only');

      // Clear volume ramp interval (but don't reset volume or disable speakers)
      if (volumeRampIntervalRef.current) {
        clearInterval(volumeRampIntervalRef.current);
        volumeRampIntervalRef.current = null;
      }

      // Clear audio detection timeout
      if (audioDetectionTimeoutRef.current) {
        clearTimeout(audioDetectionTimeoutRef.current);
        audioDetectionTimeoutRef.current = null;
      }

      // Reset resuming flag so component can auto-resume when remounting
      isResumingRef.current = false;

      // NOTE: We deliberately DON'T call stopCapture() or disable speakers here
      // because we want monitoring to continue even when navigating to other pages.
      // The user must explicitly click "Stop Monitoring" to stop.
      // When the component re-mounts, the auto-resume logic will restart audio capture.
    };
  }, []); // Empty deps - only run on mount/unmount

  // Audio activity detection - automatically enable/disable speakers
  useEffect(() => {
    if (!isCapturing) return;

    const AUDIO_THRESHOLD = 5; // 5% minimum level to consider "audio detected"
    const DISABLE_DELAY = 10000; // Disable speakers after 10 seconds of silence

    if (audioLevel > AUDIO_THRESHOLD) {
      // Audio detected
      if (!audioDetected) {
        setAudioDetected(true);
      }

      // Clear any pending disable timeout
      if (audioDetectionTimeoutRef.current) {
        clearTimeout(audioDetectionTimeoutRef.current);
        audioDetectionTimeoutRef.current = null;
      }

      // Enable speakers if not already enabled and not currently controlling
      if (!speakersEnabled && !controllingSpakersRef.current) {
        controllingSpakersRef.current = true;
        setSpeakersEnabled(true); // Set state immediately (optimistic)

        // Enable speakers
        (async () => {
          // IMPORTANT: Set volume to -42dB BEFORE turning speakers on
          // This prevents a loud blast when speakers first enable
          await setDevicesVolume(0);

          // Now turn speakers on - they'll receive the -42dB signal
          await controlSpeakers(true);

          // Start volume ramp from -42dB to target
          startVolumeRamp();
          controllingSpakersRef.current = false;
        })();
      }
    } else {
      // No audio / silence
      if (audioDetected && speakersEnabled) {
        // Start countdown to disable speakers
        if (!audioDetectionTimeoutRef.current) {
          audioDetectionTimeoutRef.current = setTimeout(() => {
            if (!controllingSpakersRef.current) {
              controllingSpakersRef.current = true;
              setSpeakersEnabled(false); // Set state immediately (optimistic)
              setAudioDetected(false);

              // Stop and disable
              (async () => {
                stopVolumeRamp();
                // Reset volume to 0 before turning off speakers
                await setDevicesVolume(0);
                // Now turn speakers off
                await controlSpeakers(false);
                controllingSpakersRef.current = false;
              })();
            }
            audioDetectionTimeoutRef.current = null;
          }, DISABLE_DELAY);
        }
      }
    }
  }, [audioLevel, isCapturing, audioDetected, speakersEnabled]);

  const loadData = async () => {
    try {
      const [devicesData, audioData] = await Promise.all([
        getDevices(),
        getAudioFiles(),
      ]);
      setDevices(devicesData);
      setAudioFiles(audioData);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadInputDevices = async () => {
    const devices = await getInputDevices();
    setInputDevices(devices);
  };

  // Set volume on all linked speakers (8180s)
  const setDevicesVolume = async (volumePercent: number) => {
    // Get all linked speaker IDs from selected paging devices
    const linkedSpeakerIds = new Set<string>();

    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      // If it's a paging device with linked speakers, add them
      if (device.type === "8301" && device.linkedSpeakerIds) {
        device.linkedSpeakerIds.forEach(id => linkedSpeakerIds.add(id));
      }
    }

    // Convert 0-100% to 0-10 scale for Algo 8180 speakers
    const volumeScale = Math.round((volumePercent / 100) * 10);

    // Set volume on all linked speakers IN PARALLEL (for performance with many speakers)
    const volumePromises = Array.from(linkedSpeakerIds).map(async (speakerId) => {
      const speaker = devices.find(d => d.id === speakerId);
      if (!speaker) return;

      try {
        await fetch("/api/algo/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipAddress: speaker.ipAddress,
            password: speaker.apiPassword,
            authMethod: speaker.authMethod,
            settings: {
              "audio.page.vol": `${volumeScale}`,
            },
          }),
        });
      } catch (error) {
        console.error(`Failed to set volume for ${speaker.name}:`, error);
      }
    });

    // Wait for all volume updates to complete
    await Promise.all(volumePromises);
  };

  // Ramp volume from 0 to target over 15 seconds
  const startVolumeRamp = useCallback(() => {
    // Clear any existing ramp
    if (volumeRampIntervalRef.current) {
      clearInterval(volumeRampIntervalRef.current);
    }

    currentVolumeRef.current = 0;
    const rampDuration = 15000; // 15 seconds
    const stepInterval = 500; // Update every 500ms
    const steps = rampDuration / stepInterval;
    const volumeIncrement = targetVolume / steps;

    // Set initial volume to 0
    setDevicesVolume(0);

    volumeRampIntervalRef.current = setInterval(() => {
      currentVolumeRef.current += volumeIncrement;

      if (currentVolumeRef.current >= targetVolume) {
        currentVolumeRef.current = targetVolume;
        setDevicesVolume(targetVolume);
        if (volumeRampIntervalRef.current) {
          clearInterval(volumeRampIntervalRef.current);
          volumeRampIntervalRef.current = null;
        }
      } else {
        setDevicesVolume(currentVolumeRef.current);
      }
    }, stepInterval);
  }, [targetVolume, selectedDevices, devices]);

  // Stop volume ramp and reset to 0
  const stopVolumeRamp = useCallback(() => {
    if (volumeRampIntervalRef.current) {
      clearInterval(volumeRampIntervalRef.current);
      volumeRampIntervalRef.current = null;
    }
    currentVolumeRef.current = 0;
    setDevicesVolume(0);
  }, [selectedDevices, devices]);

  // Enable/disable speakers for paging devices
  const controlSpeakers = useCallback(async (enable: boolean) => {
    setEnablingDisablingSpeakers(true);

    for (const deviceId of selectedDevices) {
      const device = devices.find(d => d.id === deviceId);
      if (!device) continue;

      // Only control speakers for paging devices with linked speakers
      if (device.type === "8301" && device.linkedSpeakerIds && device.linkedSpeakerIds.length > 0) {
        const linkedSpeakers = devices.filter(d => device.linkedSpeakerIds?.includes(d.id));

        try {
          console.log(`${enable ? 'Enabling' : 'Disabling'} speakers for ${device.name}:`, linkedSpeakers.map(s => s.ipAddress));

          const response = await fetch("/api/algo/speakers/mcast", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              speakers: linkedSpeakers.map(s => ({
                ipAddress: s.ipAddress,
                password: s.apiPassword,
                authMethod: s.authMethod,
              })),
              enable,
            }),
          });

          const responseData = await response.json();

          if (!response.ok) {
            console.error(`Failed to ${enable ? 'enable' : 'disable'} speakers for ${device.name}:`, responseData);
          } else {
            // Check if individual speakers succeeded
            if (responseData.results) {
              responseData.results.forEach((result: any) => {
                if (result.success) {
                  console.log(`✅ Speaker ${result.ip}: ${enable ? 'enabled' : 'disabled'}`);
                } else {
                  console.error(`❌ Speaker ${result.ip}: ${result.error}`);
                }
              });
            }
            console.log(`Speaker control complete for ${device.name}. Overall success: ${responseData.success}`);
          }
        } catch (error) {
          console.error(`Failed to control speakers for ${device.name}:`, error);
        }
      }
    }

    setEnablingDisablingSpeakers(false);
  }, [selectedDevices, devices]);

  const toggleDevice = (deviceId: string) => {
    setSelectedDevices((prev) => {
      const newDevices = prev.includes(deviceId)
        ? prev.filter((id) => id !== deviceId)
        : [...prev, deviceId];
      console.log('[Live] Device selection changed:', newDevices);
      return newDevices;
    });
  };

  const selectAllDevices = () => {
    if (selectedDevices.length === devices.length) {
      setSelectedDevices([]);
    } else {
      setSelectedDevices(devices.map((d) => d.id));
    }
  };

  const playPreToneAudio = async (): Promise<void> => {
    if (!preTone) return Promise.resolve();

    const audioFile = audioFiles.find((a) => a.id === preTone);
    if (!audioFile) return Promise.resolve();

    return new Promise((resolve) => {
      setPlayingPreTone(true);
      const audio = new Audio(audioFile.storageUrl);
      preToneAudioRef.current = audio;

      audio.onended = () => {
        setPlayingPreTone(false);
        resolve();
      };

      audio.onerror = () => {
        setPlayingPreTone(false);
        resolve();
      };

      audio.play();
    });
  };

  const handleStartBroadcast = async () => {
    if (selectedDevices.length === 0) {
      alert("Please select at least one device");
      return;
    }

    setBroadcasting(true);

    // Play pre-tone on selected devices first
    if (preTone) {
      const audioFile = audioFiles.find((a) => a.id === preTone);
      if (audioFile) {
        for (const deviceId of selectedDevices) {
          const device = devices.find((d) => d.id === deviceId);
          if (!device) continue;

          // Get linked speakers if this is a paging device
          const linkedSpeakers = device.type === "8301" && device.linkedSpeakerIds
            ? devices.filter(d => device.linkedSpeakerIds?.includes(d.id))
            : [];

          try {
            await fetch("/api/algo/distribute", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                device: {
                  ipAddress: device.ipAddress,
                  password: device.apiPassword,
                  authMethod: device.authMethod,
                  type: device.type,
                },
                speakers: linkedSpeakers.map(s => ({
                  ipAddress: s.ipAddress,
                  password: s.apiPassword,
                  authMethod: s.authMethod,
                })),
                filename: "chime.wav", // Use built-in tone for pre-tone
                loop: false,
                volume,
              }),
            });
          } catch (error) {
            console.error("Pre-tone error:", error);
          }
        }
        // Wait for pre-tone to finish (approximate)
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    // Start recording
    startRecording();
  };

  const handleStopBroadcast = async () => {
    const blob = await stopRecording();
    setRecordedBlob(blob);
    setBroadcasting(false);

    // Stop any playing audio on devices
    for (const deviceId of selectedDevices) {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) continue;

      // Get linked speakers if this is a paging device
      const linkedSpeakers = device.type === "8301" && device.linkedSpeakerIds
        ? devices.filter(d => device.linkedSpeakerIds?.includes(d.id))
        : [];

      try {
        await fetch("/api/algo/distribute/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device: {
              ipAddress: device.ipAddress,
              password: device.apiPassword,
              authMethod: device.authMethod,
              type: device.type,
            },
            speakers: linkedSpeakers.map(s => ({
              ipAddress: s.ipAddress,
              password: s.apiPassword,
              authMethod: s.authMethod,
            })),
          }),
        });
      } catch (error) {
        console.error("Stop error:", error);
      }
    }
  };

  const handleSaveRecording = async () => {
    if (!recordedBlob) return;

    const name = prompt("Enter a name for this recording:");
    if (!name) return;

    setSaving(true);
    try {
      // Convert webm to wav would require additional processing
      // For now, save as webm
      const filename = `recording-${Date.now()}.webm`;
      const storageRef = ref(storage, `audio/${filename}`);
      await uploadBytes(storageRef, recordedBlob);
      const downloadUrl = await getDownloadURL(storageRef);

      await addAudioFile({
        name,
        filename,
        storageUrl: downloadUrl,
        duration,
        fileSize: recordedBlob.size,
        uploadedBy: user?.uid || "unknown",
        ownerEmail: user?.email || "unknown",
      });

      setRecordedBlob(null);
      await loadData();
      alert("Recording saved!");
    } catch (error) {
      console.error("Save error:", error);
      alert("Failed to save recording");
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadRecording = () => {
    if (!recordedBlob) return;

    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Live Audio Monitoring</h1>
          <p className="text-gray-500">
            Automatically enable speakers when audio is detected, disable when silent
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md bg-red-50 p-4 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Audio Input */}
          <div className="space-y-6 lg:col-span-2">
            {/* Audio Capture */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Audio Input</CardTitle>
                <CardDescription>
                  Capture audio from your microphone or line-in
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Input Device Selection */}
                <div className="space-y-2">
                  <Label>Input Device</Label>
                  <Select
                    value={selectedInputDevice}
                    onChange={(e) => setSelectedInputDevice(e.target.value)}
                    disabled={isCapturing}
                  >
                    <option value="">Default Input</option>
                    {inputDevices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Input ${device.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </Select>
                  <p className="text-xs text-gray-500">
                    Select microphone, line-in, or aux input
                  </p>
                </div>

                {/* Audio Level Meter */}
                <div className="space-y-2">
                  <Label>Audio Level</Label>
                  <div className="h-4 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className={`h-full transition-all duration-75 ${
                        audioLevel > 80
                          ? "bg-red-500"
                          : audioLevel > 50
                          ? "bg-yellow-500"
                          : "bg-green-500"
                      }`}
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                  <p className="text-sm text-gray-500">
                    {isCapturing ? `Level: ${audioLevel}%` : "Not capturing"}
                  </p>
                </div>

                {/* Input Gain Control */}
                <div className="space-y-2">
                  <Label>Input Gain: {volume}%</Label>
                  <Slider
                    min={0}
                    max={200}
                    value={volume}
                    onChange={(e) => setVolume(parseInt(e.target.value))}
                    showValue
                  />
                  <p className="text-sm text-gray-500">
                    Adjust input volume (100% = normal, 200% = 2x boost)
                  </p>
                </div>

                {/* Target Volume Control */}
                <div className="space-y-2">
                  <Label>Target Speaker Volume: {targetVolume}% (Level {Math.round((targetVolume / 100) * 10)}/10)</Label>
                  <Slider
                    min={0}
                    max={100}
                    value={targetVolume}
                    onChange={(e) => setTargetVolume(parseInt(e.target.value))}
                    showValue
                  />
                  <p className="text-sm text-gray-500">
                    Ramps from 0 to level {Math.round((targetVolume / 100) * 10)} over 15 seconds (lower for testing)
                  </p>
                </div>

                {/* Capture Controls */}
                <div className="space-y-3">
                  <div className="flex gap-3">
                    {isResuming ? (
                      <Button disabled>
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Resuming...
                      </Button>
                    ) : !isCapturing ? (
                      <Button
                        onClick={() => {
                          console.log('[Live] User clicked Start Monitoring');
                          // Set monitoring flag immediately
                          localStorage.setItem(STORAGE_KEYS.IS_MONITORING, 'true');
                          startCapture(selectedInputDevice || undefined);
                        }}
                      >
                        <Mic className="mr-2 h-4 w-4" />
                        Start Monitoring
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        onClick={() => {
                          console.log('[Live] User clicked Stop Monitoring - stopping capture and disabling speakers');

                          // Clear monitoring flag immediately (don't wait for effect)
                          localStorage.setItem(STORAGE_KEYS.IS_MONITORING, 'false');

                          stopCapture();
                          // Stop volume ramp
                          stopVolumeRamp();
                          // Ensure speakers are disabled when stopping
                          if (speakersEnabled && !controllingSpakersRef.current) {
                            controllingSpakersRef.current = true;
                            setSpeakersEnabled(false);
                            console.log('[Live] Disabling speakers...');
                            controlSpeakers(false).finally(() => {
                              controllingSpakersRef.current = false;
                              console.log('[Live] Speakers disabled successfully');
                            });
                          } else {
                            console.log('[Live] Speakers already disabled or being controlled');
                          }
                        }}
                      >
                        <MicOff className="mr-2 h-4 w-4" />
                        Stop Monitoring
                      </Button>
                    )}
                  </div>

                  {/* Resuming Status */}
                  {isResuming && (
                    <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                        <span className="font-medium text-blue-700">Resuming monitoring...</span>
                      </div>
                    </div>
                  )}

                  {/* Audio Detection Status */}
                  {isCapturing && !isResuming && (
                    <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Audio Activity:</span>
                        <Badge variant={audioDetected ? "success" : "secondary"}>
                          {audioDetected ? "Detected" : "Silent"}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Speakers:</span>
                        <Badge variant={speakersEnabled ? "success" : "secondary"}>
                          {speakersEnabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Device Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Target Devices</CardTitle>
                    <CardDescription>
                      Select devices to broadcast to
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={selectAllDevices}>
                    {selectedDevices.length === devices.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {devices.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    No devices available.{" "}
                    <a href="/devices" className="text-blue-600 hover:underline">
                      Add some first
                    </a>
                    .
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {devices.map((device) => (
                      <button
                        key={device.id}
                        onClick={() => toggleDevice(device.id)}
                        className={`flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                          selectedDevices.includes(device.id)
                            ? "border-blue-500 bg-blue-50"
                            : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div
                          className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                            selectedDevices.includes(device.id)
                              ? "border-blue-500 bg-blue-500"
                              : "border-gray-300"
                          }`}
                        >
                          {selectedDevices.includes(device.id) && (
                            <div className="h-2 w-2 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">
                            {device.name}
                          </p>
                          <p className="truncate text-sm text-gray-500">
                            {device.ipAddress}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Broadcast Controls */}
          <div className="space-y-6">
            {/* Pre-Tone Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Pre-Tone</CardTitle>
                <CardDescription>
                  Play a tone before broadcasting
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Select
                  value={preTone}
                  onChange={(e) => setPreTone(e.target.value)}
                >
                  <option value="">No pre-tone</option>
                  <option value="__builtin_chime">Built-in Chime</option>
                  <option value="__builtin_alert">Built-in Alert</option>
                  {audioFiles.map((audio) => (
                    <option key={audio.id} value={audio.id}>
                      {audio.name}
                    </option>
                  ))}
                </Select>
                <p className="text-sm text-gray-500">
                  Plays on devices before your voice/audio
                </p>
              </CardContent>
            </Card>

            {/* Broadcast Controls */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Broadcast</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isCapturing ? (
                  <div className="rounded-md bg-yellow-50 p-3 text-sm text-yellow-700">
                    Start audio capture first to enable broadcasting
                  </div>
                ) : !broadcasting ? (
                  <Button
                    className="w-full"
                    size="lg"
                    onClick={handleStartBroadcast}
                    disabled={selectedDevices.length === 0}
                  >
                    <Radio className="mr-2 h-5 w-5" />
                    Start Broadcast
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 rounded-md bg-red-50 p-4">
                      <Circle className="h-3 w-3 animate-pulse fill-red-500 text-red-500" />
                      <span className="font-medium text-red-700">
                        LIVE - {formatDuration(duration)}
                      </span>
                    </div>
                    <Button
                      variant="destructive"
                      className="w-full"
                      size="lg"
                      onClick={handleStopBroadcast}
                    >
                      <Square className="mr-2 h-5 w-5" />
                      Stop Broadcast
                    </Button>
                  </div>
                )}

                {/* Recording Status */}
                {isRecording && (
                  <div className="flex items-center justify-between rounded-md bg-gray-100 p-3">
                    <div className="flex items-center gap-2">
                      <Circle className="h-3 w-3 fill-red-500 text-red-500" />
                      <span className="text-sm font-medium">Recording</span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {formatDuration(duration)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recorded Audio */}
            {recordedBlob && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Recording</CardTitle>
                  <CardDescription>
                    {formatDuration(duration)} recorded
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <audio
                    controls
                    className="w-full"
                    src={URL.createObjectURL(recordedBlob)}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDownloadRecording}
                    >
                      <Download className="mr-1 h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveRecording}
                      isLoading={saving}
                    >
                      <Upload className="mr-1 h-4 w-4" />
                      Save to Library
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Status */}
            <Card>
              <CardContent className="p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Capture</span>
                    <Badge variant={isResuming ? "default" : isCapturing ? "success" : "secondary"}>
                      {isResuming ? "Resuming..." : isCapturing ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Broadcast</span>
                    <Badge variant={broadcasting ? "destructive" : "secondary"}>
                      {broadcasting ? "Live" : "Off"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Devices</span>
                    <span className="font-medium">{selectedDevices.length} selected</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Debug Info */}
            {isDev && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Debug Info</CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-1 text-xs font-mono">
                    <div className="text-gray-600">Selected Devices (State):</div>
                    <div className="text-gray-900 break-all">
                      {selectedDevices.length > 0 ? selectedDevices.join(', ') : 'None'}
                    </div>
                    <div className="text-gray-600 mt-2">Selected Devices (Storage):</div>
                    <div className="text-gray-900 break-all">
                      {(() => {
                        try {
                          const stored = localStorage.getItem(STORAGE_KEYS.SELECTED_DEVICES);
                          if (!stored) return 'None';
                          const parsed = JSON.parse(stored);
                          return parsed.length > 0 ? parsed.join(', ') : 'None';
                        } catch {
                          return 'Error reading storage';
                        }
                      })()}
                    </div>
                    <div className="text-gray-600 mt-2">Input Device:</div>
                    <div className="text-gray-900 break-all">
                      {selectedInputDevice || 'Default'}
                    </div>
                    <div className="text-gray-600 mt-2">Monitoring:</div>
                    <div className="text-gray-900">
                      {isCapturing ? 'Active' : 'Stopped'} (Storage: {localStorage.getItem(STORAGE_KEYS.IS_MONITORING) || 'not set'})
                    </div>
                    <div className="text-gray-600 mt-2">Restored:</div>
                    <div className="text-gray-900">
                      {hasRestoredStateRef.current ? 'Yes' : 'No'}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-3 w-full"
                      onClick={() => {
                        console.log('[Live] localStorage contents:', {
                          devices: localStorage.getItem(STORAGE_KEYS.SELECTED_DEVICES),
                          input: localStorage.getItem(STORAGE_KEYS.SELECTED_INPUT),
                          monitoring: localStorage.getItem(STORAGE_KEYS.IS_MONITORING),
                          volume: localStorage.getItem(STORAGE_KEYS.TARGET_VOLUME),
                          gain: localStorage.getItem(STORAGE_KEYS.INPUT_GAIN),
                        });
                        alert('Check console for localStorage contents');
                      }}
                    >
                      Log Storage
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full"
                      onClick={() => {
                        localStorage.clear();
                        alert('localStorage cleared! Refresh to start fresh.');
                      }}
                    >
                      Clear Storage
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
