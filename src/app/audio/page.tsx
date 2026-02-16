"use client";

import { useEffect, useState, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Trash2, RefreshCw, Music, X, Speaker, Radio } from "lucide-react";
import { getDevices } from "@/lib/firebase/firestore";
import type { AlgoDevice } from "@/lib/algo/types";
import { formatBytes } from "@/lib/utils";
import { Select } from "@/components/ui/select";

// Default tones that come pre-installed on Algo devices
const DEFAULT_TONES = [
  "bell-na.wav",
  "bell-uk.wav",
  "buzzer.wav",
  "chime.wav",
  "dogs.wav",
  "gong.wav",
  "page-notif.wav",
  "speech-test.wav",
  "tone-1kHz-max.wav",
  "warble1-low.wav",
  "warble2-med.wav",
  "warble3-high.wav",
  "warble4-trill.wav",
];

export default function AudioPage() {
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Device tones state
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [deviceTones, setDeviceTones] = useState<string[]>([]);
  const [loadingTones, setLoadingTones] = useState(false);
  const [playingTone, setPlayingTone] = useState<string | null>(null);

  useEffect(() => {
    loadDevices();
  }, []);

  const loadDevices = async () => {
    try {
      const deviceList = await getDevices();
      setDevices(deviceList);
      // Auto-select first 8301 device if available
      const pagingDevice = deviceList.find(d => d.type === "8301");
      if (pagingDevice) {
        setSelectedDevice(pagingDevice.id);
      }
    } catch (error) {
      console.error("Failed to load devices:", error);
    } finally {
      setLoading(false);
    }
  };

  // Auto-load tones when device is selected
  useEffect(() => {
    if (selectedDevice) {
      fetchDeviceTones();
    }
  }, [selectedDevice]);

  const fetchDeviceTones = async () => {
    const device = devices.find(d => d.id === selectedDevice);
    if (!device) return;

    setLoadingTones(true);
    try {
      const response = await fetch("/api/algo/tones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipAddress: device.ipAddress,
          password: device.apiPassword,
          authMethod: device.authMethod,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setDeviceTones(data.tones);
      } else {
        alert("Failed to fetch tones: " + data.error);
      }
    } catch (error) {
      console.error("Failed to fetch device tones:", error);
      alert("Failed to connect to device");
    } finally {
      setLoadingTones(false);
    }
  };

  const playDeviceTone = async (toneName: string) => {
    const device = devices.find(d => d.id === selectedDevice);
    if (!device) return;

    // Get linked speakers for this paging device
    const linkedSpeakers = devices.filter(
      d => device.linkedSpeakerIds?.includes(d.id)
    );

    setPlayingTone(toneName);
    try {
      const response = await fetch("/api/algo/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paging: {
            ipAddress: device.ipAddress,
            password: device.apiPassword,
            authMethod: device.authMethod,
          },
          speakers: linkedSpeakers.map(s => ({
            ipAddress: s.ipAddress,
            password: s.apiPassword,
            authMethod: s.authMethod,
          })),
          tone: toneName,
          loop: false,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        alert("Failed to play tone: " + data.error);
      }
    } catch (error) {
      console.error("Failed to play tone:", error);
    } finally {
      setPlayingTone(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.name.toLowerCase().endsWith(".wav")) {
        alert("Please select a WAV file. Algo devices require WAV format.");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUploadToDevice = async () => {
    const device = devices.find(d => d.id === selectedDevice);
    if (!selectedFile || !device) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("ipAddress", device.ipAddress);
      formData.append("password", device.apiPassword);
      formData.append("authMethod", device.authMethod);

      const response = await fetch("/api/algo/files/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        // Reload tones from device
        await fetchDeviceTones();
        setShowUpload(false);
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } else {
        alert("Failed to upload: " + data.error);
      }
    } catch (error) {
      console.error("Upload failed:", error);
      alert("Failed to upload file. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteTone = async (toneName: string) => {
    if (DEFAULT_TONES.includes(toneName)) {
      alert("Cannot delete default system tones.");
      return;
    }

    if (!confirm(`Delete "${toneName}"? This cannot be undone.`)) return;

    const device = devices.find(d => d.id === selectedDevice);
    if (!device) return;

    setDeleting(toneName);
    try {
      const response = await fetch("/api/algo/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipAddress: device.ipAddress,
          password: device.apiPassword,
          authMethod: device.authMethod,
          filename: toneName,
        }),
      });

      const data = await response.json();
      if (data.success) {
        await fetchDeviceTones();
      } else {
        alert("Failed to delete: " + data.error);
      }
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Failed to delete file.");
    } finally {
      setDeleting(null);
    }
  };

  const isCustomTone = (toneName: string) => !DEFAULT_TONES.includes(toneName);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Audio Library</h1>
            <p className="text-[var(--text-secondary)] text-sm">Manage audio files on your Algo paging device</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={fetchDeviceTones}
              disabled={!selectedDevice || loadingTones}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={() => setShowUpload(true)} disabled={!selectedDevice}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Audio
            </Button>
          </div>
        </div>

        {/* Upload Modal */}
        {showUpload && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <Card className="w-full max-w-md">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--accent-purple)]/15">
                      <Upload className="h-5 w-5 text-[var(--accent-purple)]" />
                    </div>
                    <CardTitle>Upload Audio to Device</CardTitle>
                  </div>
                  <button
                    onClick={() => {
                      setShowUpload(false);
                      setSelectedFile(null);
                    }}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <CardDescription>
                  Upload a WAV file directly to your Algo paging device
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="file">Audio File (WAV only)</Label>
                  <Input
                    ref={fileInputRef}
                    id="file"
                    type="file"
                    accept=".wav"
                    onChange={handleFileSelect}
                  />
                  {selectedFile && (
                    <p className="text-sm text-[var(--text-muted)]">
                      {selectedFile.name} ({formatBytes(selectedFile.size)})
                    </p>
                  )}
                </div>

                <div className="rounded-xl bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/30 p-3 text-sm text-[var(--accent-blue)]">
                  The file will be uploaded directly to the selected device and will be available immediately for playback.
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowUpload(false);
                      setSelectedFile(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleUploadToDevice}
                    disabled={!selectedFile}
                    isLoading={uploading}
                  >
                    Upload to Device
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Device Selection */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-orange)]/15">
                  <Radio className="h-5 w-5 text-[var(--accent-orange)]" />
                </div>
                <div>
                  <CardTitle>Paging Device</CardTitle>
                  <CardDescription>
                    Select the Algo 8301 paging device to manage
                  </CardDescription>
                </div>
              </div>
              <Select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                className="w-64"
              >
                <option value="">Select Device</option>
                {devices.filter(d => d.type === "8301").map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name} ({device.ipAddress})
                  </option>
                ))}
              </Select>
            </div>
          </CardHeader>
        </Card>

        {/* Device Tones Section */}
        {selectedDevice && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-green)]/15">
                  <Music className="h-5 w-5 text-[var(--accent-green)]" />
                </div>
                <div>
                  <CardTitle>Audio Files on Device</CardTitle>
                  <CardDescription>
                    Click to play through speakers. Custom files can be deleted.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loadingTones ? (
                <div className="flex justify-center py-8">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent" />
                </div>
              ) : deviceTones.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="mb-4 rounded-full bg-[var(--bg-tertiary)] p-4">
                    <Music className="h-8 w-8 text-[var(--text-muted)]" />
                  </div>
                  <p className="text-[var(--text-muted)]">No tones found on device</p>
                  <Button
                    variant="outline"
                    onClick={fetchDeviceTones}
                    className="mt-4"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reload
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Default Tones */}
                  <div>
                    <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Default Tones</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {deviceTones.filter(t => !isCustomTone(t)).map((tone) => (
                        <Button
                          key={tone}
                          variant={playingTone === tone ? "default" : "outline"}
                          className="justify-start"
                          onClick={() => playDeviceTone(tone)}
                          disabled={playingTone !== null}
                        >
                          <Speaker className="mr-2 h-4 w-4" />
                          {tone.replace(".wav", "")}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Custom Tones */}
                  {deviceTones.some(t => isCustomTone(t)) && (
                    <div>
                      <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Custom Tones</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {deviceTones.filter(t => isCustomTone(t)).map((tone) => (
                          <div
                            key={tone}
                            className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] p-2 bg-[var(--bg-secondary)]"
                          >
                            <Button
                              variant={playingTone === tone ? "default" : "ghost"}
                              size="sm"
                              className="flex-1 justify-start"
                              onClick={() => playDeviceTone(tone)}
                              disabled={playingTone !== null}
                            >
                              <Speaker className="mr-2 h-4 w-4" />
                              {tone.replace(".wav", "")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteTone(tone)}
                              disabled={deleting === tone}
                              className="text-[var(--accent-red)] hover:text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10"
                            >
                              {deleting === tone ? (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent-red)] border-t-transparent" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* No device selected message */}
        {!selectedDevice && !loading && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="mb-4 rounded-full bg-[var(--bg-tertiary)] p-4">
                <Music className="h-8 w-8 text-[var(--text-muted)]" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-[var(--text-primary)]">
                Select a Device
              </h3>
              <p className="text-center text-[var(--text-muted)]">
                Choose an Algo 8301 paging device above to manage its audio files
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
