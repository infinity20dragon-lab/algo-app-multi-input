"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { VUMeter, CircularVUMeter } from "@/components/vu-meter";
import {
  Mic,
  MicOff,
  AlertCircle,
  Volume2,
  Settings2,
  Speaker,
  Clock,
  Sun,
  Moon,
  Power,
  PowerOff,
  AlertTriangle,
  Wifi,
  WifiOff,
  RefreshCw,
  Map as MapIcon,
} from "lucide-react";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useSimpleMonitoring } from "@/contexts/simple-monitoring-context";
import { useAudioMonitoring } from "@/contexts/audio-monitoring-context";
import { getDevices, getPoEDevices } from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/auth-context";

function LiveV2Content() {
  const { user } = useAuth();
  const isDev = process.env.NODE_ENV === 'development';

  // Check if old monitoring system (/live page) is active
  const oldMonitoring = useAudioMonitoring();
  const otherPageIsMonitoring = oldMonitoring.isCapturing;

  // Get monitoring state from CLEAN simple monitoring context
  const {
    isMonitoring,
    audioLevel,
    playbackAudioLevel,
    selectedInputDevice,
    targetVolume,
    audioThreshold,
    audioDetected,
    speakersEnabled,

    // Multi-Input Mode
    medicalInputDevice,
    fireInputDevice,
    allCallInputDevice,
    medicalAudioLevel,
    fireAudioLevel,
    allCallAudioLevel,
    medicalEnabled,
    fireEnabled,
    allCallEnabled,
    setMedicalInputDevice,
    setFireInputDevice,
    setAllCallInputDevice,
    setMedicalEnabled,
    setFireEnabled,
    setAllCallEnabled,
    medicalChannel,
    fireChannel,
    allCallChannel,
    setMedicalChannel,
    setFireChannel,
    setAllCallChannel,
    rampEnabled,
    rampDuration,
    dayNightMode,
    dayStartHour,
    dayEndHour,
    nightRampDuration,
    sustainDuration,
    disableDelay,
    selectedDevices,
    setSelectedDevices,
    startMonitoring,
    stopMonitoring,
    setInputDevice,
    setTargetVolume,
    setAudioThreshold,
    setRampEnabled,
    setRampDuration,
    setDayNightMode,
    setDayStartHour,
    setDayEndHour,
    setNightRampDuration,
    setSustainDuration,
    setDisableDelay,
    playbackEnabled,
    playbackDelay,
    setPlaybackDelay,
    silenceTimeout,
    setSilenceTimeout,
    hardwareGracePeriod,
    setHardwareGracePeriod,
    playbackRampDuration,
    setPlaybackRampDuration,
    playbackStartVolume,
    setPlaybackStartVolume,
    playbackMaxVolume,
    setPlaybackMaxVolume,
    playbackVolume,
    setPlaybackVolume,
    playbackRampEnabled,
    setPlaybackRampEnabled,
    playbackRampStartVolume,
    setPlaybackRampStartVolume,
    playbackRampTargetVolume,
    setPlaybackRampTargetVolume,
    playbackSessionRampDuration,
    setPlaybackSessionRampDuration,
    playbackRampScheduleEnabled,
    setPlaybackRampScheduleEnabled,
    playbackRampStartHour,
    setPlaybackRampStartHour,
    playbackRampEndHour,
    setPlaybackRampEndHour,
    devices: contextDevices,
    setDevices: setContextDevices,
    poeDevices,
    setPoeDevices,
    poeKeepAliveDuration,
    setPoeKeepAliveDuration,
    poeAutoDisabled,
    togglePoEAutoControl,
    setPoeAllAutoEnabled,
    poeParallelMode,
    setPoeParallelMode,
    poeToggleDelay,
    setPoeToggleDelay,
    emergencyKillAll,
    emergencyEnableAll,
    controlSingleSpeaker,
    speakerStatuses,
    checkSpeakerConnectivity,
    emulationMode,
    setEmulationMode,
    emulationNetworkDelay,
    setEmulationNetworkDelay,
    triggerTestCall,
    onAudioDetected,
    logs,
    zones: contextZones,
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
  } = useSimpleMonitoring();

  // Safety check: ensure selectedDevices is always an array
  const safeSelectedDevices = selectedDevices || [];

  const [loading, setLoading] = useState(true);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [editingSpeakerId, setEditingSpeakerId] = useState<string | null>(null);
  const [localMaxVolumes, setLocalMaxVolumes] = useState<Record<string, number>>({});

  const {
    error,
    getInputDevices,
  } = useAudioCapture();

  // Alias isMonitoring as isCapturing for UI compatibility
  const isCapturing = isMonitoring;
  const [monitoringTransition, setMonitoringTransition] = useState(false);

  useEffect(() => {
    if (user?.email) {
      loadData();
      loadInputDevices();
    }
  }, [user?.email]);

  const loadData = async () => {
    if (!user) return;

    try {
      const userEmail = user.email || "";

      const [devicesData, poeDevicesData] = await Promise.all([
        getDevices(userEmail),
        getPoEDevices(userEmail),
      ]);
      setContextDevices(devicesData);
      setPoeDevices(poeDevicesData);
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

  const toggleDevice = (deviceId: string) => {
    const newDevices = safeSelectedDevices.includes(deviceId)
      ? safeSelectedDevices.filter((id) => id !== deviceId)
      : [...selectedDevices, deviceId];
    console.log('[Live V2] Device selection changed:', newDevices);
    setSelectedDevices(newDevices);
  };

  const selectAllDevices = () => {
    if (safeSelectedDevices.length === contextDevices.length) {
      setSelectedDevices([]);
    } else {
      setSelectedDevices(contextDevices.map((d) => d.id));
    }
  };


  // Determine if currently in day or night mode
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour + (currentMinute >= 30 ? 0.5 : 0);
  const isDaytime = currentTime >= dayStartHour && currentTime < dayEndHour;

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-12">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Live Monitoring</h1>
          </div>
          {isCapturing && (
            <div className="flex items-center gap-3">
              <Badge variant={speakersEnabled ? "destructive" : "success"} className="px-3 py-1">
                <div className={`w-2 h-2 rounded-full mr-2 ${speakersEnabled ? "bg-white animate-blink" : "bg-white"}`} />
                {speakersEnabled ? "Broadcasting" : "Standby"}
              </Badge>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--accent-red)]/15 border border-[var(--accent-red)]/30 p-4 text-[var(--accent-red)]">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Audio Input & VU Meter */}
          <div className="space-y-6 lg:col-span-2">
            {/* Audio Level Display */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--accent-blue)]/15">
                      <Mic className="h-5 w-5 text-[var(--accent-blue)]" />
                    </div>
                    <CardTitle>Audio Monitor</CardTitle>
                  </div>
                  {!isCapturing ? (
                    <Button
                      onClick={async () => {
                        console.log('[Live V2] User clicked Start Monitoring');
                        setMonitoringTransition(true);
                        try { await startMonitoring(); } finally { setMonitoringTransition(false); }
                      }}
                      disabled={otherPageIsMonitoring || monitoringTransition}
                      title={otherPageIsMonitoring ? "Monitoring is already active on /live page" : ""}
                    >
                      {monitoringTransition ? (
                        <><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent inline-block" /> Starting...</>
                      ) : (
                        <><Mic className="mr-2 h-4 w-4" />{otherPageIsMonitoring ? "Monitoring Active on /live" : "Start Monitoring"}</>
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      onClick={async () => {
                        console.log('[Live V2] User clicked Stop Monitoring');
                        setMonitoringTransition(true);
                        try { await stopMonitoring(); } finally { setMonitoringTransition(false); }
                      }}
                      disabled={monitoringTransition}
                    >
                      {monitoringTransition ? (
                        <><span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent inline-block" /> Stopping...</>
                      ) : (
                        <><MicOff className="mr-2 h-4 w-4" />Stop</>
                      )}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Three Input VU Meters */}
                <div className={`grid gap-4 ${
                  [medicalEnabled, fireEnabled, allCallEnabled].filter(Boolean).length === 3
                    ? 'md:grid-cols-3'
                    : [medicalEnabled, fireEnabled, allCallEnabled].filter(Boolean).length === 2
                      ? 'md:grid-cols-2'
                      : 'grid-cols-1'
                }`}>
                  {/* Medical VU Meter */}
                  {medicalEnabled && (
                    medicalInputDevice ? (
                      <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--accent-blue)]/30">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-[var(--accent-blue)]">🏥 MEDICAL</span>
                          <span className="text-xs font-mono text-[var(--accent-blue)]">
                            {isCapturing ? `${medicalAudioLevel.toFixed(1)}%` : "-- %"}
                          </span>
                        </div>
                        <VUMeter level={isCapturing ? medicalAudioLevel : 0} barCount={16} showPeakHold={false} />
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--accent-blue)]/20 flex flex-col items-center justify-center gap-2 min-h-[80px]">
                        <span className="text-xs font-semibold text-[var(--accent-blue)]">🏥 MEDICAL</span>
                        <span className="text-[10px] text-[var(--text-muted)] text-center">No input device selected</span>
                      </div>
                    )
                  )}

                  {/* Fire VU Meter */}
                  {fireEnabled && (
                    fireInputDevice ? (
                      <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--accent-red)]/30">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-[var(--accent-red)]">🔥 FIRE</span>
                          <span className="text-xs font-mono text-[var(--accent-red)]">
                            {isCapturing ? `${fireAudioLevel.toFixed(1)}%` : "-- %"}
                          </span>
                        </div>
                        <VUMeter level={isCapturing ? fireAudioLevel : 0} barCount={16} showPeakHold={false} />
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--accent-red)]/20 flex flex-col items-center justify-center gap-2 min-h-[80px]">
                        <span className="text-xs font-semibold text-[var(--accent-red)]">🔥 FIRE</span>
                        <span className="text-[10px] text-[var(--text-muted)] text-center">No input device selected</span>
                      </div>
                    )
                  )}

                  {/* All-Call VU Meter */}
                  {allCallEnabled && (
                    allCallInputDevice ? (
                      <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--accent-purple)]/30">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-semibold text-[var(--accent-purple)]">📢 ALL-CALL</span>
                          <span className="text-xs font-mono text-[var(--accent-purple)]">
                            {isCapturing ? `${allCallAudioLevel.toFixed(1)}%` : "-- %"}
                          </span>
                        </div>
                        <VUMeter level={isCapturing ? allCallAudioLevel : 0} barCount={16} showPeakHold={false} />
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--accent-purple)]/20 flex flex-col items-center justify-center gap-2 min-h-[80px]">
                        <span className="text-xs font-semibold text-[var(--accent-purple)]">📢 ALL-CALL</span>
                        <span className="text-[10px] text-[var(--text-muted)] text-center">No input device selected</span>
                      </div>
                    )
                  )}
                </div>

                {/* Threshold indicator */}
                <div className="flex items-center gap-2 p-3 rounded-lg bg-[var(--bg-secondary)]">
                  <div className="flex-1 h-1 bg-[var(--bg-tertiary)] rounded relative">
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-[var(--accent-orange)]"
                      style={{ left: `${audioThreshold * 2}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">
                    Threshold: {audioThreshold}%
                  </span>
                </div>

                {/* Playback Audio VU Meter */}
                {playbackEnabled && (
                  <div className="p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm font-semibold text-[var(--text-secondary)]">Playback Level</span>
                      <span className="text-sm font-mono text-[var(--accent-green)]">
                        {playbackAudioLevel > 0 ? `${playbackAudioLevel.toFixed(1)}%` : "-- %"}
                      </span>
                    </div>
                    <VUMeter level={playbackAudioLevel} barCount={24} showPeakHold={false} />

                    {/* Playback status */}
                    <div className="mt-4 flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${playbackAudioLevel > 0 ? 'bg-[var(--accent-green)] animate-pulse' : 'bg-[var(--text-muted)]'}`}></div>
                      <span className="text-xs text-[var(--text-muted)]">
                        {playbackAudioLevel > 0 ? "Playing to system audio" : "No playback"}
                      </span>
                    </div>

                    {/* Playback Volume Slider */}
                    <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm">Playback Volume</Label>
                        <span className="text-sm font-mono text-[var(--accent-green)]">
                          {(playbackVolume * 100).toFixed(0)}%
                        </span>
                      </div>
                      <Slider
                        min={0}
                        max={2}
                        step={0.05}
                        value={playbackVolume}
                        onChange={(e) => setPlaybackVolume(parseFloat(e.target.value))}
                      />
                      <p className="text-xs text-[var(--text-muted)] mt-2">
                        0% = mute, 100% = normal, 200% = amplified
                      </p>
                    </div>

                    {/* Playback Volume Ramping */}
                    <div className="mt-4 pt-4 border-t border-[var(--border-color)] space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm">Session Volume Ramp</Label>
                          <p className="text-xs text-[var(--text-muted)]">Fade in volume at start of each session</p>
                        </div>
                        <Switch
                          checked={playbackRampEnabled}
                          onCheckedChange={setPlaybackRampEnabled}
                        />
                      </div>

                      {playbackRampEnabled && (
                        <div className="space-y-4 p-3 rounded-lg bg-[var(--accent-blue)]/5 border border-[var(--accent-blue)]/20">
                          {/* Start Volume */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">Start Volume</Label>
                              <span className="text-xs font-mono text-[var(--accent-blue)]">
                                {(playbackRampStartVolume * 100).toFixed(0)}%
                              </span>
                            </div>
                            <Slider
                              min={0}
                              max={2}
                              step={0.05}
                              value={playbackRampStartVolume}
                              onChange={(e) => setPlaybackRampStartVolume(parseFloat(e.target.value))}
                            />
                          </div>

                          {/* Target Volume */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">Target Volume</Label>
                              <span className="text-xs font-mono text-[var(--accent-green)]">
                                {(playbackRampTargetVolume * 100).toFixed(0)}%
                              </span>
                            </div>
                            <Slider
                              min={0}
                              max={2}
                              step={0.05}
                              value={playbackRampTargetVolume}
                              onChange={(e) => setPlaybackRampTargetVolume(parseFloat(e.target.value))}
                            />
                          </div>

                          {/* Ramp Duration */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">Ramp Duration</Label>
                              <span className="text-xs font-mono text-[var(--accent-purple)]">
                                {(playbackSessionRampDuration / 1000).toFixed(1)}s
                              </span>
                            </div>
                            <Slider
                              min={0}
                              max={5000}
                              step={100}
                              value={playbackSessionRampDuration}
                              onChange={(e) => setPlaybackSessionRampDuration(parseInt(e.target.value))}
                            />
                          </div>

                          {/* Time-Based Schedule */}
                          <div className="mt-4 pt-4 border-t border-[var(--accent-blue)]/20">
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <Label className="text-xs">Schedule Ramping</Label>
                                <p className="text-xs text-[var(--text-muted)]">Only ramp during specific hours</p>
                              </div>
                              <Switch
                                checked={playbackRampScheduleEnabled}
                                onCheckedChange={setPlaybackRampScheduleEnabled}
                              />
                            </div>

                            {playbackRampScheduleEnabled && (
                              <div className="space-y-3">
                                {/* Start Time */}
                                <div>
                                  <Label className="text-xs">Start Time (Ramp Enabled)</Label>
                                  <select
                                    className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm"
                                    value={playbackRampStartHour}
                                    onChange={(e) => setPlaybackRampStartHour(parseFloat(e.target.value))}
                                  >
                                    {Array.from({ length: 48 }, (_, i) => i * 0.5).map(hour => {
                                      const h = Math.floor(hour);
                                      const m = (hour % 1) * 60;
                                      const ampm = h >= 12 ? 'PM' : 'AM';
                                      const displayHour = h % 12 || 12;
                                      const time = `${displayHour}:${m === 0 ? '00' : '30'} ${ampm}`;
                                      return <option key={hour} value={hour}>{time}</option>;
                                    })}
                                  </select>
                                </div>

                                {/* End Time */}
                                <div>
                                  <Label className="text-xs">End Time (Ramp Disabled)</Label>
                                  <select
                                    className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-sm"
                                    value={playbackRampEndHour}
                                    onChange={(e) => setPlaybackRampEndHour(parseFloat(e.target.value))}
                                  >
                                    {Array.from({ length: 48 }, (_, i) => i * 0.5).map(hour => {
                                      const h = Math.floor(hour);
                                      const m = (hour % 1) * 60;
                                      const ampm = h >= 12 ? 'PM' : 'AM';
                                      const displayHour = h % 12 || 12;
                                      const time = `${displayHour}:${m === 0 ? '00' : '30'} ${ampm}`;
                                      return <option key={hour} value={hour}>{time}</option>;
                                    })}
                                  </select>
                                </div>

                                <div className="flex items-start gap-2 p-2 rounded bg-[var(--accent-purple)]/10">
                                  <span className="text-xs">🕐</span>
                                  <p className="text-xs text-[var(--text-secondary)]">
                                    <strong>Example:</strong> 6:00 PM - 7:30 AM = ramp enabled at night, static volume during day
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex items-start gap-2 p-2 rounded bg-[var(--accent-blue)]/10">
                            <span className="text-xs">🎚️</span>
                            <p className="text-xs text-[var(--text-secondary)]">
                              <strong>Example:</strong> 0% → 200% over 2s = dramatic fade-in at start of each session
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Status Grid */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-center">
                    <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${isCapturing ? "bg-[var(--accent-green)]" : "bg-[var(--text-muted)]"}`} />
                    <div className="text-xs text-[var(--text-muted)]">Monitoring</div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{isCapturing ? "Active" : "Off"}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-center">
                    <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${audioDetected ? "bg-[var(--accent-orange)]" : "bg-[var(--text-muted)]"}`} />
                    <div className="text-xs text-[var(--text-muted)]">Audio</div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{audioDetected ? "Detected" : "Silent"}</div>
                  </div>
                  <div className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] text-center">
                    <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${speakersEnabled ? "bg-[var(--accent-red)] animate-blink" : "bg-[var(--text-muted)]"}`} />
                    <div className="text-xs text-[var(--text-muted)]">Speakers</div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{speakersEnabled ? "On" : "Off"}</div>
                  </div>
                </div>

                {/* Three Input Device Selection */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">Input Channels</Label>
                    {nativeAudioAvailable && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--text-muted)]">Native Audio</span>
                        <Switch
                          checked={useNativeAudio}
                          onCheckedChange={setUseNativeAudio}
                          disabled={isCapturing}
                        />
                      </div>
                    )}
                  </div>

                  {useNativeAudio && nativeAudioAvailable && (
                    <div className="p-3 rounded-lg bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/30 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--accent-green)]">CoreAudio Direct Capture</span>
                        <button
                          onClick={refreshNativeDevices}
                          className="text-xs text-[var(--accent-blue)] hover:underline"
                          disabled={isCapturing}
                        >
                          Refresh
                        </button>
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        Bypasses browser stereo limitation. Each channel captured independently via PortAudio.
                      </p>
                    </div>
                  )}

                  {/* Medical Input */}
                  <div className="p-4 rounded-lg border border-[var(--accent-blue)]/30 bg-[var(--accent-blue)]/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-[var(--accent-blue)]">MEDICAL DEPT</Label>
                      <Switch
                        checked={medicalEnabled}
                        onCheckedChange={setMedicalEnabled}
                        disabled={isCapturing}
                      />
                    </div>
                    {medicalEnabled && (
                      <div className="flex gap-2 items-center">
                        {useNativeAudio && nativeAudioAvailable ? (
                          <Select
                            value={medicalNativeDeviceId !== null ? String(medicalNativeDeviceId) : ""}
                            onChange={(e) => setMedicalNativeDeviceId(e.target.value ? Number(e.target.value) : null)}
                            disabled={isCapturing}
                            className="flex-1"
                          >
                            <option value="">Select Native Device</option>
                            {nativeDevices.map((device) => (
                              <option key={device.id} value={device.id}>
                                {device.name} ({device.maxInputChannels}ch)
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Select
                            value={medicalInputDevice || ""}
                            onChange={(e) => setMedicalInputDevice(e.target.value)}
                            disabled={isCapturing}
                            className="flex-1"
                          >
                            <option value="">Select Input Device</option>
                            {inputDevices.map((device) => (
                              <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `Input ${device.deviceId.slice(0, 8)}`}
                              </option>
                            ))}
                          </Select>
                        )}
                        {((useNativeAudio && medicalNativeDeviceId !== null) || (!useNativeAudio && medicalInputDevice)) && (() => {
                          const nativeDev = useNativeAudio ? nativeDevices.find(d => d.id === medicalNativeDeviceId) : null;
                          const maxCh = nativeDev ? nativeDev.maxInputChannels : 2;
                          return (
                            <div className="flex rounded-lg border border-[var(--accent-blue)]/40 overflow-hidden flex-shrink-0">
                              {Array.from({ length: maxCh }, (_, i) => (
                                <button
                                  key={i}
                                  onClick={() => setMedicalChannel(i)}
                                  disabled={isCapturing}
                                  className={`px-2.5 py-1.5 text-xs font-bold transition-colors ${medicalChannel === i ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                                >{maxCh <= 2 ? (i === 0 ? 'L' : 'R') : String(i + 1)}</button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Fire Input */}
                  <div className="p-4 rounded-lg border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-[var(--accent-red)]">FIRE DEPT</Label>
                      <Switch
                        checked={fireEnabled}
                        onCheckedChange={setFireEnabled}
                        disabled={isCapturing}
                      />
                    </div>
                    {fireEnabled && (
                      <div className="flex gap-2 items-center">
                        {useNativeAudio && nativeAudioAvailable ? (
                          <Select
                            value={fireNativeDeviceId !== null ? String(fireNativeDeviceId) : ""}
                            onChange={(e) => setFireNativeDeviceId(e.target.value ? Number(e.target.value) : null)}
                            disabled={isCapturing}
                            className="flex-1"
                          >
                            <option value="">Select Native Device</option>
                            {nativeDevices.map((device) => (
                              <option key={device.id} value={device.id}>
                                {device.name} ({device.maxInputChannels}ch)
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Select
                            value={fireInputDevice || ""}
                            onChange={(e) => setFireInputDevice(e.target.value)}
                            disabled={isCapturing}
                            className="flex-1"
                          >
                            <option value="">Select Input Device</option>
                            {inputDevices.map((device) => (
                              <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `Input ${device.deviceId.slice(0, 8)}`}
                              </option>
                            ))}
                          </Select>
                        )}
                        {((useNativeAudio && fireNativeDeviceId !== null) || (!useNativeAudio && fireInputDevice)) && (() => {
                          const nativeDev = useNativeAudio ? nativeDevices.find(d => d.id === fireNativeDeviceId) : null;
                          const maxCh = nativeDev ? nativeDev.maxInputChannels : 2;
                          return (
                            <div className="flex rounded-lg border border-[var(--accent-red)]/40 overflow-hidden flex-shrink-0">
                              {Array.from({ length: maxCh }, (_, i) => (
                                <button
                                  key={i}
                                  onClick={() => setFireChannel(i)}
                                  disabled={isCapturing}
                                  className={`px-2.5 py-1.5 text-xs font-bold transition-colors ${fireChannel === i ? 'bg-[var(--accent-red)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                                >{maxCh <= 2 ? (i === 0 ? 'L' : 'R') : String(i + 1)}</button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* All-Call Input */}
                  <div className="p-4 rounded-lg border border-[var(--accent-purple)]/30 bg-[var(--accent-purple)]/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold text-[var(--accent-purple)]">ALL-CALL</Label>
                      <Switch
                        checked={allCallEnabled}
                        onCheckedChange={setAllCallEnabled}
                        disabled={isCapturing}
                      />
                    </div>
                    {allCallEnabled && (
                      <div className="flex gap-2 items-center">
                        {useNativeAudio && nativeAudioAvailable ? (
                          <Select
                            value={allCallNativeDeviceId !== null ? String(allCallNativeDeviceId) : ""}
                            onChange={(e) => setAllCallNativeDeviceId(e.target.value ? Number(e.target.value) : null)}
                            disabled={isCapturing}
                            className="flex-1"
                          >
                            <option value="">Select Native Device</option>
                            {nativeDevices.map((device) => (
                              <option key={device.id} value={device.id}>
                                {device.name} ({device.maxInputChannels}ch)
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Select
                            value={allCallInputDevice || ""}
                            onChange={(e) => setAllCallInputDevice(e.target.value)}
                            disabled={isCapturing}
                            className="flex-1"
                          >
                            <option value="">Select Input Device</option>
                            {inputDevices.map((device) => (
                              <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `Input ${device.deviceId.slice(0, 8)}`}
                              </option>
                            ))}
                          </Select>
                        )}
                        {((useNativeAudio && allCallNativeDeviceId !== null) || (!useNativeAudio && allCallInputDevice)) && (() => {
                          const nativeDev = useNativeAudio ? nativeDevices.find(d => d.id === allCallNativeDeviceId) : null;
                          const maxCh = nativeDev ? nativeDev.maxInputChannels : 2;
                          return (
                            <div className="flex rounded-lg border border-[var(--accent-purple)]/40 overflow-hidden flex-shrink-0">
                              {Array.from({ length: maxCh }, (_, i) => (
                                <button
                                  key={i}
                                  onClick={() => setAllCallChannel(i)}
                                  disabled={isCapturing}
                                  className={`px-2.5 py-1.5 text-xs font-bold transition-colors ${allCallChannel === i ? 'bg-[var(--accent-purple)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                                >{maxCh <= 2 ? (i === 0 ? 'L' : 'R') : String(i + 1)}</button>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Emulation Mode */}
            <Card className="border-[var(--accent-cyan)]/30">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-cyan)]/15">
                    <Settings2 className="h-5 w-5 text-[var(--accent-cyan)]" />
                  </div>
                  <div>
                    <CardTitle>🧪 Emulation Mode</CardTitle>
                    <span className="text-xs text-[var(--text-muted)]">Test with virtual devices</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--accent-cyan)]/10 border border-[var(--accent-cyan)]/30">
                  <div className="flex flex-col gap-1">
                    <Label className="text-sm font-medium">Enable Emulation</Label>
                    <span className="text-xs text-[var(--text-muted)]">
                      Creates 12 virtual speakers + 1 paging device
                    </span>
                  </div>
                  <Switch
                    checked={emulationMode}
                    onCheckedChange={(checked) => {
                      setEmulationMode(checked);
                      if (checked) {
                        console.log('[Emulation] Mode enabled');
                      } else {
                        console.log('[Emulation] Mode disabled');
                      }
                    }}
                    disabled={isCapturing}
                  />
                </div>

                {emulationMode && (
                  <div className="space-y-3 p-3 rounded-lg bg-[var(--accent-cyan)]/5">
                    <div className="flex items-center gap-2 text-xs text-[var(--accent-cyan)]">
                      <AlertCircle className="h-4 w-4" />
                      <span>Virtual devices active (no physical hardware needed)</span>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm">Network Delay Simulation</Label>
                        <span className="text-xs font-mono text-[var(--accent-cyan)]">
                          {(emulationNetworkDelay / 1000).toFixed(0)}s
                        </span>
                      </div>
                      <Slider
                        min={0}
                        max={30000}
                        step={1000}
                        value={emulationNetworkDelay}
                        onChange={(e) => setEmulationNetworkDelay(parseFloat(e.target.value))}
                      />
                      <p className="text-xs text-[var(--text-muted)]">
                        Simulates slow polling/network (0s = instant, 20s = realistic)
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm">Trigger Test Call</Label>
                      <div className="grid grid-cols-3 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => triggerTestCall(3)}
                          disabled={!isCapturing}
                          className="text-xs"
                        >
                          3s
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => triggerTestCall(5)}
                          disabled={!isCapturing}
                          className="text-xs"
                        >
                          5s
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => triggerTestCall(10)}
                          disabled={!isCapturing}
                          className="text-xs"
                        >
                          10s
                        </Button>
                      </div>
                      {!isCapturing && (
                        <p className="text-xs text-[var(--accent-yellow)]">
                          Start monitoring first to trigger test calls
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Emergency Controls */}
            <Card className="border-[var(--accent-red)]/30">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-red)]/15">
                    <AlertTriangle className="h-5 w-5 text-[var(--accent-red)]" />
                  </div>
                  <div>
                    <CardTitle>Emergency Controls</CardTitle>
                    <span className="text-xs text-[var(--text-muted)]">Manual speaker control</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Quick Actions */}
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="destructive"
                    className="h-14"
                    onClick={emergencyKillAll}
                  >
                    <PowerOff className="mr-2 h-5 w-5" />
                    KILL ALL
                  </Button>
                  <Button
                    variant="outline"
                    className="h-14 border-[var(--accent-green)] text-[var(--accent-green)] hover:bg-[var(--accent-green)]/10"
                    onClick={emergencyEnableAll}
                  >
                    <Power className="mr-2 h-5 w-5" />
                    ENABLE ALL
                  </Button>
                </div>

                {/* Individual Speaker Controls */}
                {contextDevices.filter(d => d.type !== "8301").length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Label className="text-[var(--text-muted)] text-xs uppercase tracking-wider">
                          Individual Speakers
                        </Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => checkSpeakerConnectivity()}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Check
                        </Button>
                        {speakerStatuses.length > 0 && (
                          <span className="text-xs text-[var(--text-muted)]">
                            ({speakerStatuses.filter(s => s.isOnline).length}/{speakerStatuses.length} online)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-3 max-h-[400px] overflow-y-auto">
                      {contextDevices
                        .filter(d => d.type !== "8301")
                        .map((speaker) => {
                          const isEditing = editingSpeakerId === speaker.id;
                          const storedMaxVolume = speaker.maxVolume ?? 100;
                          const displayLevel = Math.round(storedMaxVolume / 10);
                          const localLevel = localMaxVolumes[speaker.id] !== undefined
                            ? Math.round(localMaxVolumes[speaker.id] / 10)
                            : displayLevel;
                          const speakerStatus = speakerStatuses.find(s => s.speakerId === speaker.id);

                          return (
                            <div
                              key={speaker.id}
                              className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] space-y-3 transition-all"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <Speaker className="h-4 w-4 text-[var(--text-muted)]" />
                                  <div>
                                    <p className="text-sm font-medium flex items-center gap-2 text-[var(--text-primary)]">
                                      {speaker.name}
                                      {speakerStatus && (
                                        speakerStatus.isOnline
                                          ? <Wifi className="h-3 w-3 text-[var(--accent-green)]" />
                                          : <WifiOff className="h-3 w-3 text-[var(--accent-red)]" />
                                      )}
                                    </p>
                                    <button
                                      onClick={() => {
                                        if (!isEditing) {
                                          setLocalMaxVolumes(prev => ({
                                            ...prev,
                                            [speaker.id]: storedMaxVolume
                                          }));
                                          setEditingSpeakerId(speaker.id);
                                        }
                                      }}
                                      className="text-xs text-[var(--accent-blue)] hover:underline cursor-pointer"
                                      title="Click to edit"
                                    >
                                      Max: Level {displayLevel}/10 (click to edit)
                                    </button>
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-[var(--accent-green)] border-[var(--accent-green)]/50 hover:bg-[var(--accent-green)]/10"
                                    onClick={() => controlSingleSpeaker(speaker.id, true)}
                                  >
                                    <Power className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-[var(--accent-red)] border-[var(--accent-red)]/50 hover:bg-[var(--accent-red)]/10"
                                    onClick={() => controlSingleSpeaker(speaker.id, false)}
                                  >
                                    <PowerOff className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>

                              {isEditing && (
                                <div className="space-y-2 pt-2 border-t border-[var(--border-color)]">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-xs">Max Volume Level</Label>
                                    <span className="text-xs font-mono text-[var(--accent-blue)]">Level {localLevel}/10</span>
                                  </div>
                                  <Slider
                                    min={0}
                                    max={10}
                                    value={localLevel}
                                    onChange={(e) => {
                                      const level = parseInt(e.target.value);
                                      setLocalMaxVolumes(prev => ({
                                        ...prev,
                                        [speaker.id]: level * 10
                                      }));
                                    }}
                                  />
                                  <p className="text-xs text-[var(--text-muted)]">
                                    Algo speakers use 0-10 scale (0=mute, 10=max)
                                  </p>
                                  <div className="flex gap-2 pt-1">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="flex-1 text-xs"
                                      onClick={async () => {
                                        try {
                                          const { updateDevice } = await import("@/lib/firebase/firestore");
                                          const volumeToSave = localMaxVolumes[speaker.id];
                                          await updateDevice(speaker.id, { maxVolume: volumeToSave });
                                          speaker.maxVolume = volumeToSave;
                                          setEditingSpeakerId(null);
                                          await loadData();
                                        } catch (error) {
                                          console.error("Failed to update max volume:", error);
                                          alert("Failed to save max volume");
                                        }
                                      }}
                                    >
                                      Save
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="flex-1 text-xs"
                                      onClick={() => {
                                        setEditingSpeakerId(null);
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Detection Settings */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-orange)]/15">
                    <Settings2 className="h-5 w-5 text-[var(--accent-orange)]" />
                  </div>
                  <div>
                    <CardTitle>Detection Settings</CardTitle>
                    {isCapturing && (
                      <span className="text-xs text-[var(--accent-green)]">Live adjustable</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Audio Threshold */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Audio Threshold</Label>
                    <span className="text-sm font-mono text-[var(--accent-blue)]">{audioThreshold}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={50}
                    value={audioThreshold}
                    onChange={(e) => setAudioThreshold(parseInt(e.target.value))}
                  />
                  <p className="text-xs text-[var(--text-muted)]">
                    Minimum audio level to trigger speaker activation
                  </p>
                </div>

                {/* Sustain Duration */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Sustain Duration</Label>
                    <span className="text-sm font-mono text-[var(--accent-blue)]">{sustainDuration === 0 ? 'Instant (0ms)' : sustainDuration >= 1000 ? `${(sustainDuration / 1000).toFixed(1)}s` : `${sustainDuration}ms`}</span>
                  </div>
                  <Slider
                    min={0}
                    max={3000}
                    step={10}
                    value={sustainDuration}
                    onChange={(e) => setSustainDuration(parseInt(e.target.value))}
                  />
                  <p className="text-xs text-[var(--text-muted)]">
                    {sustainDuration === 0 ? 'Instant trigger (no delay) - captures everything' : 'Audio must stay above threshold for this duration to trigger'}
                  </p>
                </div>

                {/* Playback Delay */}
                {playbackEnabled && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Playback Delay</Label>
                      <span className="text-sm font-mono text-[var(--accent-blue)]">{(playbackDelay / 1000).toFixed(1)}s</span>
                    </div>
                    <Slider
                      min={0}
                      max={10000}
                      step={100}
                      value={playbackDelay}
                      onChange={(e) => setPlaybackDelay(parseInt(e.target.value))}
                    />
                    <p className="text-xs text-[var(--text-muted)]">
                      Wait after paging device is ready before starting playback
                    </p>
                  </div>
                )}

                {/* Silence Timeout - KEY DIFFERENTIATOR */}
                {playbackEnabled && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Silence Timeout</Label>
                      <span className="text-sm font-mono text-[var(--accent-blue)]">{(silenceTimeout / 1000).toFixed(1)}s</span>
                    </div>
                    <Slider
                      min={0}
                      max={30000}
                      step={1000}
                      value={silenceTimeout}
                      onChange={(e) => setSilenceTimeout(parseInt(e.target.value))}
                    />
                    <p className="text-xs text-[var(--text-muted)]">
                      How long to wait after silence before stopping batching. 0s = new session per pause, higher = more forgiving pauses in same session.
                    </p>
                  </div>
                )}

                {/* Hardware Grace Period */}
                {playbackEnabled && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Hardware Grace Period</Label>
                      <span className="text-sm font-mono text-[var(--accent-blue)]">{(hardwareGracePeriod / 1000).toFixed(1)}s</span>
                    </div>
                    <Slider
                      min={1000}
                      max={30000}
                      step={1000}
                      value={hardwareGracePeriod}
                      onChange={(e) => setHardwareGracePeriod(parseInt(e.target.value))}
                    />
                    <p className="text-xs text-[var(--text-muted)]">
                      How long to keep speakers active after a session ends before deactivating. Covers re-activation cost (~{(playbackDelay / 1000).toFixed(1)}s warmup) so back-to-back sentences don't cycle speakers.
                    </p>
                  </div>
                )}

                {/* PoE Keep-Alive Duration */}
                {poeDevices.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>PoE Keep-Alive</Label>
                      <span className="text-sm font-mono text-[var(--accent-blue)]">
                        {Math.floor(poeKeepAliveDuration / 60000)}:{((poeKeepAliveDuration % 60000) / 1000).toFixed(0).padStart(2, '0')}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={600000}
                      step={30000}
                      value={poeKeepAliveDuration}
                      onChange={(e) => setPoeKeepAliveDuration(parseInt(e.target.value))}
                    />
                    <p className="text-xs text-[var(--text-muted)]">
                      How long PoE lights stay on after a call ends. Gives crew time to get ready.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>


          </div>

          {/* Right Column - Devices & Broadcast */}
          <div className="space-y-6">

            {/* Device Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--accent-green)]/15">
                      <Speaker className="h-5 w-5 text-[var(--accent-green)]" />
                    </div>
                    <div>
                      <CardTitle>Target Devices</CardTitle>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={selectAllDevices}>
                    {safeSelectedDevices.length === contextDevices.length ? "Deselect" : "Select All"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {contextDevices.length === 0 ? (
                  <div className="text-center py-6">
                    <Speaker className="mx-auto h-8 w-8 text-[var(--text-muted)] mb-2" />
                    <p className="text-sm text-[var(--text-muted)]">
                      No devices available.{" "}
                      <Link href="/devices" className="text-[var(--accent-blue)] hover:underline">
                        Add some first
                      </Link>
                      .
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {contextDevices.map((device) => {
                      const deviceZone = contextZones.find(z => z.id === device.zone);
                      return (
                        <button
                          key={device.id}
                          onClick={() => toggleDevice(device.id)}
                          className={`flex items-center gap-3 w-full rounded-xl border p-3 text-left transition-all ${
                            safeSelectedDevices.includes(device.id)
                              ? "border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10"
                              : "border-[var(--border-color)] hover:border-[var(--border-active)] hover:bg-[var(--bg-tertiary)]"
                          }`}
                        >
                          <div
                            className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                              safeSelectedDevices.includes(device.id)
                                ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]"
                                : "border-[var(--border-color)]"
                            }`}
                          >
                            {safeSelectedDevices.includes(device.id) && (
                              <div className="h-2 w-2 rounded-full bg-white" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-[var(--text-primary)]">
                              {device.name}
                            </p>
                            <p className="truncate text-xs text-[var(--text-muted)]">
                              {deviceZone ? (
                                <span style={{ color: deviceZone.color }}>
                                  {deviceZone.name}
                                </span>
                              ) : (
                                device.ipAddress
                              )}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Session Target Devices */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Active Session</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Status</span>
                    <Badge variant={isCapturing ? "success" : "secondary"}>
                      {isCapturing ? "Active" : "Inactive"}
                    </Badge>
                  </div>

                  {/* Show paging device and linked speakers */}
                  {safeSelectedDevices.length > 0 && (() => {
                    const pagingDevice = contextDevices.find(d => d.id === safeSelectedDevices[0] && d.type === "8301");
                    const linkedSpeakers = pagingDevice?.linkedSpeakerIds
                      ? contextDevices.filter(d => pagingDevice.linkedSpeakerIds?.includes(d.id))
                      : [];

                    if (pagingDevice) {
                      return (
                        <>
                          <div className="pt-2 border-t border-[var(--border-color)]">
                            <div className="text-xs text-[var(--text-muted)] mb-2">Paging Device</div>
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/30">
                              <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)]" />
                              <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                                {pagingDevice.name}
                              </span>
                            </div>
                          </div>

                          {linkedSpeakers.length > 0 && (
                            <div className="pt-2 border-t border-[var(--border-color)]">
                              <div className="text-xs text-[var(--text-muted)] mb-2">
                                Linked Speakers ({linkedSpeakers.length})
                              </div>
                              <div className="space-y-1 max-h-[200px] overflow-y-auto">
                                {linkedSpeakers.map((speaker) => (
                                  <div
                                    key={speaker.id}
                                    className="flex items-center gap-2 p-2 rounded-lg bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/30"
                                  >
                                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)]" />
                                    <span className="text-xs text-[var(--text-primary)] truncate">
                                      {speaker.name}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    }
                    return null;
                  })()}

                  <div className="flex items-center justify-between pt-2 border-t border-[var(--border-color)]">
                    <span className="text-[var(--text-muted)]">Architecture</span>
                    <Badge variant="secondary">Micro-Batch</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* PoE Lights Control */}
            {poeDevices.filter((d: any) => d.mode === 'auto').length > 0 && (
              <Card className="border-[var(--accent-yellow)]/30">
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-[var(--accent-yellow)]/15">
                        <Power className="h-3.5 w-3.5 text-[var(--accent-yellow)]" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">PoE Lights</CardTitle>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          Auto-controlled during calls
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[10px]"
                        onClick={() => setPoeAllAutoEnabled(true)}
                      >
                        All On
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[10px]"
                        onClick={() => setPoeAllAutoEnabled(false)}
                      >
                        All Off
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="py-0 pb-3 space-y-1.5">
                  <div className="flex items-center gap-3 pb-1.5 mb-1.5 border-b border-[var(--border-color)]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[var(--text-muted)]">Mode:</span>
                      <button
                        className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${poeParallelMode ? 'bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)]' : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'}`}
                        onClick={() => setPoeParallelMode(!poeParallelMode)}
                      >
                        {poeParallelMode ? 'Parallel' : 'Sequential'}
                      </button>
                    </div>
                    {!poeParallelMode && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[var(--text-muted)]">Delay:</span>
                        <select
                          className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                          value={poeToggleDelay}
                          onChange={(e) => setPoeToggleDelay(parseInt(e.target.value))}
                        >
                          <option value={0}>None</option>
                          <option value={500}>500ms</option>
                          <option value={1000}>1s</option>
                          <option value={2000}>2s</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <div className="max-h-[200px] overflow-y-auto space-y-1.5">
                  {poeDevices
                    .filter((d: any) => d.mode === 'auto')
                    .map((device: any) => {
                      const isEnabled = !poeAutoDisabled.has(device.id);
                      return (
                        <div
                          key={device.id}
                          className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                            isEnabled
                              ? 'border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/5'
                              : 'border-[var(--border-color)] opacity-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isEnabled ? 'bg-[var(--accent-yellow)]' : 'bg-[var(--text-muted)]'}`} />
                            <span className="text-xs font-medium text-[var(--text-primary)] truncate">
                              {device.name || `Port ${device.portNumber}`}
                            </span>
                          </div>
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={() => togglePoEAutoControl(device.id)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Zone Routing Panel */}
            <Card className={zonedPlayback ? "border-[var(--accent-purple)]/40" : ""}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapIcon className="h-4 w-4 text-[var(--accent-purple)]" />
                    <div>
                      <CardTitle className="text-sm">Zone Routing</CardTitle>
                      {zoneScheduleEnabled ? (
                        <p className="text-[10px] text-[var(--accent-purple)] mt-0.5 flex items-center gap-1">
                          {isDaytime ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
                          {isDaytime ? "Auto · Day — all speakers" : "Auto · Night — channel routing active"}
                        </p>
                      ) : zonedPlayback ? (
                        <p className="text-[10px] text-[var(--accent-purple)] mt-0.5">Active — each channel routes to its zone</p>
                      ) : (
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Off — all speakers receive all channels</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {zoneScheduleEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-purple)]/15 text-[var(--accent-purple)] font-medium">
                        Auto
                      </span>
                    )}
                    <Switch
                      checked={zonedPlayback}
                      onCheckedChange={(checked) => {
                        setZonedPlayback(checked);
                      }}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="py-0 pb-3 space-y-2">
                {/* Link to Schedule sub-toggle */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                  <div>
                    <p className="text-xs font-medium text-[var(--text-primary)]">Link to Schedule</p>
                    <p className="text-[10px] text-[var(--text-muted)]">Auto-switch zones based on Day/Night hours</p>
                  </div>
                  <Switch
                    checked={zoneScheduleEnabled}
                    onCheckedChange={setZoneScheduleEnabled}
                  />
                </div>

                {/* Current schedule state indicator */}
                {zoneScheduleEnabled && (
                  <div className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[10px] ${
                    isDaytime
                      ? "bg-[var(--accent-orange)]/10 text-[var(--accent-orange)]"
                      : "bg-[var(--accent-purple)]/10 text-[var(--accent-purple)]"
                  }`}>
                    {isDaytime ? <Sun className="h-3 w-3 flex-shrink-0" /> : <Moon className="h-3 w-3 flex-shrink-0" />}
                    <span>
                      {isDaytime
                        ? "Day — all speakers receive all channels"
                        : "Night — each channel routes to its assigned zones only"}
                    </span>
                  </div>
                )}

                {contextZones.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] text-center py-2">No zones configured</p>
                ) : (
                  <div className={`space-y-1.5 max-h-[200px] overflow-y-auto ${!zonedPlayback ? "opacity-40" : ""}`}>
                    {contextZones.map((zone) => {
                      const routing = zoneRouting[zone.id];
                      const hasRouting = routing?.medical || routing?.fire || routing?.allCall;
                      return (
                        <div
                          key={zone.id}
                          className="flex items-center justify-between p-2 rounded-lg border border-[var(--border-color)]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: zone.color || '#888' }}
                            />
                            <span className="text-xs font-medium text-[var(--text-primary)] truncate">{zone.name}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                            {routing?.medical && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] font-medium">Med</span>
                            )}
                            {routing?.fire && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-red)]/15 text-[var(--accent-red)] font-medium">Fire</span>
                            )}
                            {routing?.allCall && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent-yellow)]/15 text-[var(--accent-yellow)] font-medium">All</span>
                            )}
                            {!hasRouting && (
                              <span className="text-[10px] text-[var(--text-muted)]">No routing</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Debug Info (Dev only) */}
            {isDev && (
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-xs text-[var(--text-muted)]">Debug</CardTitle>
                </CardHeader>
                <CardContent className="py-0 pb-3 overflow-x-auto">
                  <div className="space-y-1 text-xs font-mono text-[var(--text-muted)] min-w-0">
                    <div className="truncate" title={safeSelectedDevices.join(', ')}>
                      Devices: {safeSelectedDevices.length > 0 ? safeSelectedDevices.join(', ') : 'None'}
                    </div>
                    <div className="truncate" title={selectedInputDevice || 'Default'}>
                      Input: {selectedInputDevice || 'Default'}
                    </div>
                    <div>Monitoring: {isCapturing ? 'Active' : 'Stopped'}</div>
                    <div>Silence Timeout: {silenceTimeout}ms</div>
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


export default function LiveV2Page() {
  return <LiveV2Content />;
}
