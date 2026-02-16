"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Plus, Pencil, Trash2, Play, RefreshCw, X, Volume2, Link2, Search, Activity, Speaker } from "lucide-react";
import { getDevices, addDevice, updateDevice, deleteDevice } from "@/lib/firebase/firestore";
import type { AlgoDevice, AlgoDeviceType, AlgoAuthMethod } from "@/lib/algo/types";
import { formatDate, isValidIpAddress } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";

export default function DevicesPage() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingDevice, setEditingDevice] = useState<AlgoDevice | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    type: "8180g2" as AlgoDeviceType,
    ipAddress: "",
    authMethod: "basic" as AlgoAuthMethod,
    apiPassword: "algo",
    zone: "",
    volume: 50,
    maxVolume: 100, // Per-speaker max volume (0-100)
    linkedSpeakerIds: [] as string[],
  });
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingDevice, setTestingDevice] = useState<string | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<any[]>([]);
  const [selectedDiscoveredDevices, setSelectedDiscoveredDevices] = useState<Set<string>>(new Set());
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [lastStatusCheck, setLastStatusCheck] = useState<Date | null>(null);
  const [networkRange, setNetworkRange] = useState("");

  useEffect(() => {
    if (user?.email) {
      loadDevices();
    }
  }, [user?.email]); // Only re-run if email changes (more stable)

  // Periodic health check every 60 seconds
  useEffect(() => {
    if (devices.length === 0) return;

    // Initial check
    checkDeviceStatus();

    // Set up interval
    const interval = setInterval(() => {
      checkDeviceStatus();
    }, 60000); // 60 seconds

    return () => clearInterval(interval);
  }, [devices.length]);

  const loadDevices = async () => {
    if (!user) return;

    try {
      const userEmail = user.email || "";
      const data = await getDevices(userEmail);
      setDevices(data);
    } catch (error) {
      console.error("Failed to load devices:", error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      type: "8180g2",
      ipAddress: "",
      authMethod: "basic",
      apiPassword: "algo",
      zone: "",
      volume: 50,
      maxVolume: 100,
      linkedSpeakerIds: [],
    });
    setFormError("");
    setEditingDevice(null);
  };

  const openAddForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (device: AlgoDevice) => {
    setFormData({
      name: device.name,
      type: device.type,
      ipAddress: device.ipAddress,
      authMethod: device.authMethod,
      apiPassword: device.apiPassword,
      zone: device.zone || "",
      volume: device.volume,
      maxVolume: device.maxVolume ?? 100, // Default to 100 if not set
      linkedSpeakerIds: device.linkedSpeakerIds || [],
    });
    setEditingDevice(device);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!formData.name.trim()) {
      setFormError("Device name is required");
      return;
    }
    if (!isValidIpAddress(formData.ipAddress)) {
      setFormError("Invalid IP address format");
      return;
    }

    setSaving(true);
    try {
      if (editingDevice) {
        await updateDevice(editingDevice.id, formData);
      } else {
        await addDevice({
          ...formData,
          ownerEmail: user?.email || "",
          isOnline: false,
          lastSeen: null,
        });
      }
      await loadDevices();
      setShowForm(false);
      resetForm();
    } catch (error) {
      setFormError("Failed to save device. Please try again.");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this device?")) return;
    try {
      await deleteDevice(id);
      await loadDevices();
    } catch (error) {
      console.error("Failed to delete device:", error);
    }
  };

  const handleTestTone = async (device: AlgoDevice) => {
    setTestingDevice(device.id);
    try {
      const response = await fetch("/api/algo/devices/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipAddress: device.ipAddress,
          password: device.apiPassword,
          authMethod: device.authMethod,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        alert(`Test failed: ${data.error || "Unknown error"}`);
      }
    } catch (error) {
      alert("Failed to connect to device");
      console.error(error);
    } finally {
      setTestingDevice(null);
    }
  };

  const handleScanNetwork = () => {
    // Open modal without scanning yet
    setShowScanModal(true);
    setDiscoveredDevices([]);
    setSelectedDiscoveredDevices(new Set());
    setNetworkRange(""); // Will be auto-detected or manually entered
  };

  const startNetworkScan = async () => {
    setScanning(true);
    setDiscoveredDevices([]);
    setSelectedDiscoveredDevices(new Set());

    try {
      const response = await fetch("/api/algo/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          networkRange: networkRange || undefined, // Use custom or auto-detect
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to scan network");
      }

      const data = await response.json();

      // Show what network range was actually scanned
      if (data.networkRange) {
        setNetworkRange(data.networkRange.replace('.0/24', ''));
      }

      // Filter out devices that are already added
      const existingIPs = new Set(devices.map(d => d.ipAddress));
      const newDevices = data.devices.filter((d: any) => !existingIPs.has(d.ipAddress));

      setDiscoveredDevices(newDevices);
    } catch (error) {
      console.error("Network scan error:", error);
      alert("Failed to scan network. Please try again.");
    } finally {
      setScanning(false);
    }
  };

  const handleToggleDiscoveredDevice = (ipAddress: string) => {
    const newSelected = new Set(selectedDiscoveredDevices);
    if (newSelected.has(ipAddress)) {
      newSelected.delete(ipAddress);
    } else {
      newSelected.add(ipAddress);
    }
    setSelectedDiscoveredDevices(newSelected);
  };

  const handleAddDiscoveredDevices = async () => {
    if (selectedDiscoveredDevices.size === 0) {
      alert("Please select at least one device to add");
      return;
    }

    setSaving(true);
    try {
      const devicesToAdd = discoveredDevices.filter(d =>
        selectedDiscoveredDevices.has(d.ipAddress)
      );

      for (const discovered of devicesToAdd) {
        // Generate unique name: use detected name + last octet of IP
        // Example: "Algo 8180 IP Speaker - .101" or "8180 Speaker (.101)"
        const ipLastOctet = discovered.ipAddress.split('.').pop();
        let deviceName = discovered.name || discovered.model;

        // Make name unique by appending IP last octet
        deviceName = `${deviceName} (.${ipLastOctet})`;

        await addDevice({
          name: deviceName,
          type: discovered.type === "8301" ? "8301" : "8180g2",
          ipAddress: discovered.ipAddress,
          authMethod: "basic",
          apiPassword: "algo",
          ownerEmail: user?.email || "",
          zone: "",
          volume: 50,
          linkedSpeakerIds: [],
          isOnline: true,
          lastSeen: new Date(),
        });
      }

      await loadDevices();
      setShowScanModal(false);
      setDiscoveredDevices([]);
      setSelectedDiscoveredDevices(new Set());
    } catch (error) {
      console.error("Failed to add devices:", error);
      alert("Failed to add some devices. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const checkDeviceStatus = async () => {
    if (devices.length === 0) return;

    setCheckingStatus(true);

    try {
      const response = await fetch("/api/algo/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          devices: devices.map(d => ({
            id: d.id,
            ipAddress: d.ipAddress,
            apiPassword: d.apiPassword,
            authMethod: d.authMethod,
          })),
          timeout: 3000,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to check device status");
      }

      const data = await response.json();

      // Update devices with new status
      const updatedDevices = devices.map(device => {
        const healthInfo = data.devices.find((h: any) => h.id === device.id);
        if (healthInfo) {
          return {
            ...device,
            isOnline: healthInfo.isOnline,
            authValid: healthInfo.authValid,
            lastSeen: healthInfo.isOnline ? healthInfo.lastChecked : device.lastSeen,
          };
        }
        return device;
      });

      setDevices(updatedDevices);
      setLastStatusCheck(new Date());

      // Update Firestore with new status (in background, don't await)
      // Note: Firebase doesn't allow undefined values, so we filter them out
      updatedDevices.forEach(device => {
        const updateData: Record<string, unknown> = {
          isOnline: device.isOnline,
          lastSeen: device.lastSeen,
        };
        // Only include authValid if it's defined (not undefined)
        if (device.authValid !== undefined) {
          updateData.authValid = device.authValid;
        }
        updateDevice(device.id, updateData).catch(err => console.error(`Failed to update device ${device.id}:`, err));
      });

    } catch (error) {
      console.error("Failed to check device status:", error);
    } finally {
      setCheckingStatus(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Output & Speakers</h1>
            <div className="flex items-center gap-3">
              <p className="text-[var(--text-secondary)] text-sm">Manage your Algo IP endpoints</p>
              {lastStatusCheck && (
                <span className="text-xs text-[var(--text-muted)]">
                  Last checked: {lastStatusCheck.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={checkDeviceStatus}
              isLoading={checkingStatus}
            >
              <Activity className="mr-2 h-4 w-4" />
              Check Status
            </Button>
            <Button variant="outline" onClick={loadDevices}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" onClick={handleScanNetwork}>
              <Search className="mr-2 h-4 w-4" />
              Scan Network
            </Button>
            <Button onClick={openAddForm}>
              <Plus className="mr-2 h-4 w-4" />
              Add Device
            </Button>
          </div>
        </div>

        {/* Add/Edit Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <Card className="w-full max-w-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>
                    {editingDevice ? "Edit Device" : "Add Device"}
                  </CardTitle>
                  <button
                    onClick={() => setShowForm(false)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <CardDescription>
                  {editingDevice
                    ? "Update the device configuration"
                    : "Add a new Algo IP endpoint to your system"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-lg bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 p-3 text-sm text-[var(--accent-red)]">
                      {formError}
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Device Name</Label>
                      <Input
                        id="name"
                        placeholder="Dorm Speaker 1"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="type">Device Type</Label>
                      <Select
                        id="type"
                        value={formData.type}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            type: e.target.value as AlgoDeviceType,
                          })
                        }
                      >
                        <option value="8301">8301 Paging Adapter</option>
                        <option value="8180g2">8180G2 Speaker</option>
                        <option value="8198">8198 Ceiling Speaker</option>
                        <option value="8128">8128 Visual Alerter</option>
                        <option value="8138">8138 Visual Alerter</option>
                        <option value="other">Other</option>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ipAddress">IP Address</Label>
                    <Input
                      id="ipAddress"
                      placeholder="192.168.1.100"
                      value={formData.ipAddress}
                      onChange={(e) =>
                        setFormData({ ...formData, ipAddress: e.target.value })
                      }
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="authMethod">Auth Method</Label>
                      <Select
                        id="authMethod"
                        value={formData.authMethod}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            authMethod: e.target.value as AlgoAuthMethod,
                          })
                        }
                      >
                        <option value="standard">Standard (HMAC)</option>
                        <option value="basic">Basic</option>
                        <option value="none">None</option>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="apiPassword">API Password</Label>
                      <PasswordInput
                        id="apiPassword"
                        placeholder="algo"
                        value={formData.apiPassword}
                        onChange={(e) =>
                          setFormData({ ...formData, apiPassword: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="zone">Zone (optional)</Label>
                    <Input
                      id="zone"
                      placeholder="dorms, common, apparatus"
                      value={formData.zone}
                      onChange={(e) =>
                        setFormData({ ...formData, zone: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="volume">Default Volume: {formData.volume}%</Label>
                    <Slider
                      id="volume"
                      min={0}
                      max={100}
                      value={formData.volume}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          volume: parseInt(e.target.value),
                        })
                      }
                      showValue
                    />
                  </div>

                  {/* Operating Volume - only for speakers, not paging devices */}
                  {formData.type !== "8301" && (
                    <div className="space-y-2">
                      <Label htmlFor="maxVolume" className="flex items-center gap-2">
                        <Volume2 className="h-4 w-4 text-[var(--accent-orange)]" />
                        Operating Volume: {formData.maxVolume}%
                      </Label>
                      <Slider
                        id="maxVolume"
                        min={0}
                        max={100}
                        value={formData.maxVolume}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            maxVolume: parseInt(e.target.value),
                          })
                        }
                        showValue
                      />
                      <p className="text-xs text-[var(--text-muted)]">
                        Volume this speaker runs at during monitoring. When volume ramp is enabled, speaker ramps from idle to this level when audio is detected.
                      </p>
                    </div>
                  )}

                  {/* Speaker Linking (only for 8301 paging devices) */}
                  {formData.type === "8301" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2">
                          <Link2 className="h-4 w-4" />
                          Linked Speakers
                        </Label>
                        {devices.filter(d => d.type !== "8301" && d.id !== editingDevice?.id).length > 0 && (
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const allSpeakerIds = devices
                                  .filter(d => d.type !== "8301" && d.id !== editingDevice?.id)
                                  .map(d => d.id);
                                setFormData({
                                  ...formData,
                                  linkedSpeakerIds: allSpeakerIds,
                                });
                              }}
                              className="text-xs h-7 px-2"
                            >
                              Add All
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setFormData({
                                  ...formData,
                                  linkedSpeakerIds: [],
                                });
                              }}
                              className="text-xs h-7 px-2"
                            >
                              Remove All
                            </Button>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mb-2">
                        Speakers will auto-enable when playing and auto-disable when done (no white noise)
                      </p>
                      <div className="max-h-40 overflow-y-auto border border-[var(--border-color)] rounded-lg p-2 space-y-2 bg-[var(--bg-secondary)]">
                        {devices.filter(d => d.type !== "8301" && d.id !== editingDevice?.id).length === 0 ? (
                          <p className="text-sm text-[var(--text-muted)] py-2 text-center">
                            No speakers available. Add speakers first.
                          </p>
                        ) : (
                          devices
                            .filter(d => d.type !== "8301" && d.id !== editingDevice?.id)
                            .map(speaker => (
                              <label key={speaker.id} className="flex items-center gap-2 cursor-pointer hover:bg-[var(--bg-tertiary)] p-2 rounded-lg transition-colors">
                                <input
                                  type="checkbox"
                                  checked={formData.linkedSpeakerIds.includes(speaker.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setFormData({
                                        ...formData,
                                        linkedSpeakerIds: [...formData.linkedSpeakerIds, speaker.id],
                                      });
                                    } else {
                                      setFormData({
                                        ...formData,
                                        linkedSpeakerIds: formData.linkedSpeakerIds.filter(id => id !== speaker.id),
                                      });
                                    }
                                  }}
                                  className="rounded border-[var(--border-color)] bg-[var(--bg-tertiary)]"
                                />
                                <span className="text-sm text-[var(--text-primary)]">{speaker.name}</span>
                                <span className="text-xs text-[var(--text-muted)]">({speaker.ipAddress})</span>
                              </label>
                            ))
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" isLoading={saving}>
                      {editingDevice ? "Update" : "Add"} Device
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Network Scan Modal */}
        {showScanModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--accent-blue)]/15">
                      <Search className="h-5 w-5 text-[var(--accent-blue)]" />
                    </div>
                    <div>
                      <CardTitle>Network Scanner</CardTitle>
                      <CardDescription>
                        Automatically discover Algo devices on your network
                      </CardDescription>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowScanModal(false)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    disabled={scanning}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden flex flex-col">
                {!scanning && discoveredDevices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <div className="mb-4 rounded-full bg-[var(--accent-blue)]/15 p-4">
                      <Search className="h-8 w-8 text-[var(--accent-blue)]" />
                    </div>
                    <h3 className="text-lg font-medium text-[var(--text-primary)]">
                      Scan Your Network
                    </h3>
                    <div className="w-full max-w-md space-y-3">
                      <div className="space-y-2">
                        <Label htmlFor="networkRange">Network Range (optional)</Label>
                        <Input
                          id="networkRange"
                          placeholder="e.g., 10.211.37 or leave blank for auto-detect"
                          value={networkRange}
                          onChange={(e) => setNetworkRange(e.target.value)}
                        />
                        <p className="text-xs text-[var(--text-muted)]">
                          Enter first 3 octets (e.g., "10.211.37") or leave blank to auto-detect
                        </p>
                      </div>
                      <Button onClick={startNetworkScan} className="w-full">
                        <Search className="mr-2 h-4 w-4" />
                        Start Scanning
                      </Button>
                    </div>
                  </div>
                ) : scanning ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent mb-4" />
                    <p className="text-[var(--text-secondary)]">Scanning network for Algo devices...</p>
                    <p className="text-sm text-[var(--text-muted)] mt-2">
                      Scanning {networkRange || 'auto-detected network'}.0/24
                    </p>
                    <p className="text-sm text-[var(--text-muted)]">This may take 10-30 seconds</p>
                  </div>
                ) : discoveredDevices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="mb-4 rounded-full bg-[var(--bg-tertiary)] p-4">
                      <Search className="h-8 w-8 text-[var(--text-muted)]" />
                    </div>
                    <h3 className="mb-2 text-lg font-medium text-[var(--text-primary)]">
                      No new devices found
                    </h3>
                    <p className="text-center text-[var(--text-muted)] mb-4">
                      All Algo devices on your network are already added, or no devices were detected.
                    </p>
                    <Button onClick={startNetworkScan} variant="outline">
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Scan Again
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mb-4">
                      <p className="text-sm text-[var(--text-secondary)]">
                        Found {discoveredDevices.length} device{discoveredDevices.length !== 1 ? 's' : ''}.
                        Select the devices you want to add:
                      </p>
                    </div>
                    <div className="flex-1 overflow-y-auto border border-[var(--border-color)] rounded-lg divide-y divide-[var(--border-color)]">
                      {discoveredDevices.map((device) => (
                        <label
                          key={device.ipAddress}
                          className="flex items-start gap-3 p-4 cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedDiscoveredDevices.has(device.ipAddress)}
                            onChange={() => handleToggleDiscoveredDevice(device.ipAddress)}
                            className="mt-1 rounded border-[var(--border-color)] bg-[var(--bg-tertiary)]"
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-[var(--text-primary)]">
                                {device.name || device.model}
                              </span>
                              <Badge variant="outline">{device.type.toUpperCase()}</Badge>
                            </div>
                            <p className="text-sm text-[var(--text-muted)]">{device.ipAddress}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-4 mt-4 border-t border-[var(--border-color)]">
                      <Button variant="outline" onClick={startNetworkScan} disabled={saving}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Scan Again
                      </Button>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            const allIPs = new Set(discoveredDevices.map(d => d.ipAddress));
                            setSelectedDiscoveredDevices(
                              selectedDiscoveredDevices.size === discoveredDevices.length
                                ? new Set()
                                : allIPs
                            );
                          }}
                          disabled={saving}
                        >
                          {selectedDiscoveredDevices.size === discoveredDevices.length ? 'Deselect All' : 'Select All'}
                        </Button>
                        <Button
                          onClick={handleAddDiscoveredDevices}
                          isLoading={saving}
                          disabled={selectedDiscoveredDevices.size === 0}
                        >
                          Add {selectedDiscoveredDevices.size > 0 ? `(${selectedDiscoveredDevices.size})` : ''} Device{selectedDiscoveredDevices.size !== 1 ? 's' : ''}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Status Summary */}
        {!loading && devices.length > 0 && (
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-[var(--accent-green)]"></div>
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {devices.filter(d => d.isOnline).length} Online
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full bg-[var(--accent-red)]"></div>
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {devices.filter(d => !d.isOnline).length} Offline
                    </span>
                  </div>
                  {devices.filter(d => d.isOnline && d.authValid === false).length > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-[var(--accent-orange)]"></div>
                      <span className="text-sm font-medium text-[var(--accent-orange)]">
                        {devices.filter(d => d.isOnline && d.authValid === false).length} Auth Issue{devices.filter(d => d.isOnline && d.authValid === false).length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-4 w-4 text-[var(--text-muted)]" />
                    <span className="text-sm text-[var(--text-muted)]">
                      {devices.length} Total Device{devices.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {checkingStatus && (
                  <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent-blue)] border-t-transparent"></div>
                    <span>Checking status...</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Devices List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent" />
          </div>
        ) : devices.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="mb-4 rounded-full bg-[var(--bg-tertiary)] p-4">
                <Speaker className="h-8 w-8 text-[var(--text-muted)]" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-[var(--text-primary)]">
                No devices yet
              </h3>
              <p className="mb-4 text-center text-[var(--text-muted)]">
                Add your first Algo device to get started
              </p>
              <Button onClick={openAddForm}>
                <Plus className="mr-2 h-4 w-4" />
                Add Device
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Paging Devices Section */}
            {devices.filter(d => d.type === "8301").length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <div className="h-1 w-1 rounded-full bg-[var(--accent-blue)]"></div>
                  Paging Devices ({devices.filter(d => d.type === "8301").length})
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {devices.filter(d => d.type === "8301").map((device) => (
                    <Card key={device.id}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <CardTitle className="text-lg">{device.name}</CardTitle>
                              <div className={`h-2 w-2 rounded-full ${device.isOnline ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-red)]'}`}></div>
                            </div>
                            <CardDescription>{device.ipAddress}</CardDescription>
                          </div>
                          <div className="flex flex-col gap-1">
                            <Badge variant={device.isOnline ? "success" : "secondary"}>
                              {device.isOnline ? "Online" : "Offline"}
                            </Badge>
                            {device.isOnline && device.authValid === false && (
                              <Badge variant="warning" className="text-xs">
                                Auth Error
                              </Badge>
                            )}
                          </div>
                        </div>
                        {device.isOnline && device.authValid === false && (
                          <div className="bg-[var(--accent-orange)]/10 border border-[var(--accent-orange)]/30 rounded-lg p-3 text-sm text-[var(--accent-orange)]">
                            <strong>Authentication Failed:</strong> Wrong password or auth method. Please check device settings.
                          </div>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2 text-sm">
                          <Badge variant="outline">{device.type.toUpperCase()}</Badge>
                          {device.zone && (
                            <Badge variant="outline">{device.zone}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                          <Volume2 className="h-4 w-4" />
                          <span>Volume: {device.volume}%</span>
                        </div>
                        {device.linkedSpeakerIds && device.linkedSpeakerIds.length > 0 && (
                          <div className="flex items-center gap-2 text-sm text-[var(--accent-blue)]">
                            <Link2 className="h-4 w-4" />
                            <span>
                              {device.linkedSpeakerIds.length} linked speaker{device.linkedSpeakerIds.length !== 1 ? "s" : ""}
                            </span>
                          </div>
                        )}
                        <p className="text-xs text-[var(--text-muted)]">
                          Last seen: {formatDate(device.lastSeen)}
                        </p>
                        <div className="flex gap-2 pt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTestTone(device)}
                            isLoading={testingDevice === device.id}
                          >
                            <Play className="mr-1 h-3 w-3" />
                            Test
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditForm(device)}
                          >
                            <Pencil className="mr-1 h-3 w-3" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(device.id)}
                          >
                            <Trash2 className="mr-1 h-3 w-3" />
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Speakers Section */}
            {devices.filter(d => d.type !== "8301").length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                  <div className="h-1 w-1 rounded-full bg-[var(--accent-orange)]"></div>
                  Speakers ({devices.filter(d => d.type !== "8301").length})
                </h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {devices.filter(d => d.type !== "8301").map((device) => (
                    <Card key={device.id}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <CardTitle className="text-lg">{device.name}</CardTitle>
                              <div className={`h-2 w-2 rounded-full ${device.isOnline ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-red)]'}`}></div>
                            </div>
                            <CardDescription>{device.ipAddress}</CardDescription>
                          </div>
                          <div className="flex flex-col gap-1">
                            <Badge variant={device.isOnline ? "success" : "secondary"}>
                              {device.isOnline ? "Online" : "Offline"}
                            </Badge>
                            {device.isOnline && device.authValid === false && (
                              <Badge variant="warning" className="text-xs">
                                Auth Error
                              </Badge>
                            )}
                          </div>
                        </div>
                        {device.isOnline && device.authValid === false && (
                          <div className="bg-[var(--accent-orange)]/10 border border-[var(--accent-orange)]/30 rounded-lg p-3 text-sm text-[var(--accent-orange)]">
                            <strong>Authentication Failed:</strong> Wrong password or auth method. Please check device settings.
                          </div>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap gap-2 text-sm">
                          <Badge variant="outline">{device.type.toUpperCase()}</Badge>
                          {device.zone && (
                            <Badge variant="outline">{device.zone}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                          <Volume2 className="h-4 w-4" />
                          <span>
                            Volume: {device.volume}%
                            <span className="text-[var(--accent-orange)]"> (max: {device.maxVolume ?? 100}%)</span>
                          </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)]">
                          Last seen: {formatDate(device.lastSeen)}
                        </p>
                        <div className="flex gap-2 pt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTestTone(device)}
                            isLoading={testingDevice === device.id}
                          >
                            <Play className="mr-1 h-3 w-3" />
                            Test
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditForm(device)}
                          >
                            <Pencil className="mr-1 h-3 w-3" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(device.id)}
                          >
                            <Trash2 className="mr-1 h-3 w-3" />
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
