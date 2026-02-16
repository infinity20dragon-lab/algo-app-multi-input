"use client";

/* @refresh reset */

import { useEffect, useState, useMemo, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Volume2, Radio, CheckCircle, XCircle, Loader2, Music, Speaker } from "lucide-react";
import { getDevices, getAudioFiles, addDistributionLog } from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/auth-context";
import type { AlgoDevice, AudioFile } from "@/lib/algo/types";
import Link from "next/link";

interface DistributionResult {
  deviceId: string;
  deviceName: string;
  success: boolean;
  error?: string;
}

export default function DistributePage() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [distributing, setDistributing] = useState(false);
  const [stopping, setStopping] = useState(false);

  // Distribution settings
  const [selectedAudio, setSelectedAudio] = useState("");
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [volume, setVolume] = useState(50);
  const [loop, setLoop] = useState(false);

  // Results
  const [results, setResults] = useState<DistributionResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;

    try {
      const userEmail = user.email || "";
      const [devicesData, audioData] = await Promise.all([
        getDevices(userEmail),
        getAudioFiles(userEmail),
      ]);
      setDevices(devicesData);
      setAudioFiles(audioData);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, loadData]);

  const toggleDevice = (deviceId: string) => {
    setSelectedDevices((prev) =>
      prev.includes(deviceId)
        ? prev.filter((id) => id !== deviceId)
        : [...prev, deviceId]
    );
  };

  const selectAllDevices = () => {
    if (selectedDevices.length === devices.length) {
      setSelectedDevices([]);
    } else {
      setSelectedDevices(devices.map((d) => d.id));
    }
  };

  const selectByZone = (zone: string) => {
    const zoneDevices = devices.filter((d) => d.zone === zone).map((d) => d.id);
    const allSelected = zoneDevices.every((id) => selectedDevices.includes(id));
    if (allSelected) {
      setSelectedDevices((prev) => prev.filter((id) => !zoneDevices.includes(id)));
    } else {
      setSelectedDevices((prev) => [...new Set([...prev, ...zoneDevices])]);
    }
  };

  const handleDistribute = async () => {
    if (!selectedAudio || selectedDevices.length === 0) {
      alert("Please select an audio file and at least one device");
      return;
    }

    setDistributing(true);
    setResults([]);
    setShowResults(true);

    const audioFile = audioFiles.find((a) => a.id === selectedAudio);
    const distributionResults: DistributionResult[] = [];

    for (const deviceId of selectedDevices) {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) continue;

      // Get linked speakers if this is a paging device
      const linkedSpeakers = device.type === "8301" && device.linkedSpeakerIds
        ? devices.filter(d => device.linkedSpeakerIds?.includes(d.id))
        : [];

      try {
        const response = await fetch("/api/algo/distribute", {
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
            audioUrl: audioFile?.storageUrl,
            filename: audioFile?.filename,
            loop,
            volume,
          }),
        });

        const data = await response.json();
        distributionResults.push({
          deviceId,
          deviceName: device.name,
          success: response.ok,
          error: response.ok ? undefined : data.error,
        });
      } catch (error) {
        distributionResults.push({
          deviceId,
          deviceName: device.name,
          success: false,
          error: error instanceof Error ? error.message : "Network error",
        });
      }

      // Update results in real-time
      setResults([...distributionResults]);
    }

    // Log the distribution
    if (audioFile) {
      const successCount = distributionResults.filter((r) => r.success).length;
      await addDistributionLog({
        audioFileId: selectedAudio,
        audioFileName: audioFile.name,
        targetDevices: selectedDevices,
        targetZones: [...new Set(devices.filter((d) => selectedDevices.includes(d.id)).map((d) => d.zone).filter((zone): zone is string => zone !== null))],
        triggeredBy: user?.uid || "unknown",
        status: successCount === selectedDevices.length ? "success" : successCount > 0 ? "partial" : "failed",
        results: distributionResults,
      });
    }

    setDistributing(false);
  };

  const handleStop = async () => {
    setStopping(true);

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
        console.error(`Failed to stop device ${device.name}:`, error);
      }
    }

    setStopping(false);
  };

  // Get unique zones - memoized to prevent recalculation on every render
  const zones = useMemo(() =>
    [...new Set(devices.map((d) => d.zone).filter((zone): zone is string => zone !== null))],
    [devices]
  );

  if (loading) {
    return (
      <AppLayout>
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Call Routing</h1>
          <p className="text-[var(--text-secondary)] text-sm">
            Play audio files across your Algo devices
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Controls */}
          <div className="space-y-6 lg:col-span-2">
            {/* Audio Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-purple)]/15">
                    <Music className="h-5 w-5 text-[var(--accent-purple)]" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Select Audio</CardTitle>
                    <CardDescription>
                      Choose an audio file from your library
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {audioFiles.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    No audio files available.{" "}
                    <Link href="/audio" className="text-[var(--accent-blue)] hover:underline">
                      Upload some first
                    </Link>
                    .
                  </p>
                ) : (
                  <Select
                    value={selectedAudio}
                    onChange={(e) => setSelectedAudio(e.target.value)}
                  >
                    <option value="">Select an audio file...</option>
                    {audioFiles.map((audio) => (
                      <option key={audio.id} value={audio.id}>
                        {audio.name}
                      </option>
                    ))}
                  </Select>
                )}
              </CardContent>
            </Card>

            {/* Device Selection */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--accent-green)]/15">
                      <Speaker className="h-5 w-5 text-[var(--accent-green)]" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">Select Devices</CardTitle>
                      <CardDescription>
                        Choose which devices to play the audio on
                      </CardDescription>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={selectAllDevices}>
                    {selectedDevices.length === devices.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Zone Quick Select */}
                {zones.length > 0 && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-sm text-[var(--text-muted)]">Quick select:</span>
                    {zones.map((zone) => (
                      <Button
                        key={zone}
                        variant="outline"
                        size="sm"
                        onClick={() => selectByZone(zone)}
                      >
                        {zone}
                      </Button>
                    ))}
                  </div>
                )}

                {/* Device List */}
                {devices.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">
                    No devices available.{" "}
                    <Link href="/devices" className="text-[var(--accent-blue)] hover:underline">
                      Add some first
                    </Link>
                    .
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {devices.map((device) => (
                      <button
                        key={device.id}
                        onClick={() => toggleDevice(device.id)}
                        className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                          selectedDevices.includes(device.id)
                            ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10"
                            : "border-[var(--border-color)] hover:border-[var(--accent-blue)]/50 hover:bg-[var(--bg-tertiary)]"
                        }`}
                      >
                        <div
                          className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                            selectedDevices.includes(device.id)
                              ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]"
                              : "border-[var(--border-color)]"
                          }`}
                        >
                          {selectedDevices.includes(device.id) && (
                            <CheckCircle className="h-4 w-4 text-white" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-[var(--text-primary)]">
                            {device.name}
                          </p>
                          <p className="truncate text-sm text-[var(--text-muted)]">
                            {device.ipAddress}
                            {device.zone && ` • ${device.zone}`}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Settings & Actions */}
          <div className="space-y-6">
            {/* Playback Settings */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-orange)]/15">
                    <Volume2 className="h-5 w-5 text-[var(--accent-orange)]" />
                  </div>
                  <CardTitle className="text-lg">Settings</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Volume: {volume}%</Label>
                  <Slider
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(e) => setVolume(parseInt(e.target.value))}
                    showValue
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="loop"
                    checked={loop}
                    onChange={(e) => setLoop(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--border-color)] bg-[var(--bg-tertiary)]"
                  />
                  <Label htmlFor="loop">Loop audio</Label>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="w-full"
                  onClick={handleDistribute}
                  disabled={!selectedAudio || selectedDevices.length === 0 || distributing}
                  isLoading={distributing}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Play on {selectedDevices.length} Device
                  {selectedDevices.length !== 1 ? "s" : ""}
                </Button>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={handleStop}
                  disabled={selectedDevices.length === 0 || stopping}
                  isLoading={stopping}
                >
                  <Square className="mr-2 h-4 w-4" />
                  Stop All
                </Button>
              </CardContent>
            </Card>

            {/* Results */}
            {showResults && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Results</CardTitle>
                </CardHeader>
                <CardContent>
                  {results.length === 0 && distributing ? (
                    <div className="flex items-center gap-2 text-[var(--text-muted)]">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Distributing...</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {results.map((result) => (
                        <div
                          key={result.deviceId}
                          className="flex items-center gap-2 text-sm"
                        >
                          {result.success ? (
                            <CheckCircle className="h-4 w-4 text-[var(--accent-green)]" />
                          ) : (
                            <XCircle className="h-4 w-4 text-[var(--accent-red)]" />
                          )}
                          <span
                            className={
                              result.success ? "text-[var(--text-primary)]" : "text-[var(--accent-red)]"
                            }
                          >
                            {result.deviceName}
                            {result.error && `: ${result.error}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Summary */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
                    <Radio className="h-5 w-5 text-[var(--text-muted)]" />
                  </div>
                  <div className="text-sm">
                    <p className="font-medium text-[var(--text-primary)]">
                      {selectedDevices.length} device
                      {selectedDevices.length !== 1 ? "s" : ""} selected
                    </p>
                    <p className="text-[var(--text-muted)]">
                      {selectedAudio
                        ? audioFiles.find((a) => a.id === selectedAudio)?.name
                        : "No audio selected"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
