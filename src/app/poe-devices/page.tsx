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
import { Plus, Pencil, Trash2, RefreshCw, X, Lightbulb, Power, Network, Link2, Activity } from "lucide-react";
import { getPoESwitches, getPoEDevices, addPoESwitch, updatePoESwitch, deletePoESwitch, addPoEDevice, updatePoEDevice, deletePoEDevice, getDevices } from "@/lib/firebase/firestore";
import type { PoESwitch, PoEDevice, PoEDeviceMode, PoESwitchType, AlgoDevice } from "@/lib/algo/types";
import { formatDate, isValidIpAddress } from "@/lib/utils";
import { useAudioMonitoring } from "@/contexts/audio-monitoring-context";
import { useAuth } from "@/contexts/auth-context";

export default function PoEDevicesPage() {
  const { user } = useAuth();
  const { setPoeDevices } = useAudioMonitoring();
  const [switches, setSwitches] = useState<PoESwitch[]>([]);
  const [devices, setDevices] = useState<PoEDevice[]>([]);
  const [algoDevices, setAlgoDevices] = useState<AlgoDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSwitchForm, setShowSwitchForm] = useState(false);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [editingSwitch, setEditingSwitch] = useState<PoESwitch | null>(null);
  const [editingDevice, setEditingDevice] = useState<PoEDevice | null>(null);

  const [switchFormData, setSwitchFormData] = useState({
    name: "",
    type: "netgear_gs308ep" as PoESwitchType,
    ipAddress: "",
    password: "",
  });

  const [deviceFormData, setDeviceFormData] = useState({
    name: "",
    switchId: "",
    portNumber: 1,
    mode: "auto" as PoEDeviceMode,
    zone: "",
    linkedPagingDeviceIds: [] as string[],
  });

  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingSwitch, setTestingSwitch] = useState<string | null>(null);
  const [syncingSwitch, setSyncingSwitch] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email) {
      loadData();
    }
  }, [user?.email]); // Only re-run if email changes (more stable)

  // Update audio monitoring context when devices change
  useEffect(() => {
    setPoeDevices(devices);
  }, [devices, setPoeDevices]);

  const loadData = async () => {
    if (!user) return;

    try {
      const userEmail = user.email || "";
      const [switchesData, devicesData, algoDevicesData] = await Promise.all([
        getPoESwitches(userEmail),
        getPoEDevices(userEmail),
        getDevices(userEmail),
      ]);
      setSwitches(switchesData);
      setDevices(devicesData);
      setAlgoDevices(algoDevicesData);
    } catch (error) {
      console.error("Failed to load PoE data:", error);
    } finally {
      setLoading(false);
    }
  };

  const resetSwitchForm = () => {
    setSwitchFormData({
      name: "",
      type: "netgear_gs308ep",
      ipAddress: "",
      password: "",
    });
    setFormError("");
    setEditingSwitch(null);
  };

  const resetDeviceForm = () => {
    setDeviceFormData({
      name: "",
      switchId: "",
      portNumber: 1,
      mode: "auto",
      zone: "",
      linkedPagingDeviceIds: [],
    });
    setFormError("");
    setEditingDevice(null);
  };

  const openAddSwitchForm = () => {
    resetSwitchForm();
    setShowSwitchForm(true);
  };

  const openEditSwitchForm = (poeSwitch: PoESwitch) => {
    setSwitchFormData({
      name: poeSwitch.name,
      type: poeSwitch.type,
      ipAddress: poeSwitch.ipAddress,
      password: poeSwitch.password,
    });
    setEditingSwitch(poeSwitch);
    setShowSwitchForm(true);
  };

  const openAddDeviceForm = () => {
    resetDeviceForm();
    setShowDeviceForm(true);
  };

  const openEditDeviceForm = (device: PoEDevice) => {
    setDeviceFormData({
      name: device.name,
      switchId: device.switchId,
      portNumber: device.portNumber,
      mode: device.mode,
      zone: device.zone || "",
      linkedPagingDeviceIds: device.linkedPagingDeviceIds || [],
    });
    setEditingDevice(device);
    setShowDeviceForm(true);
  };

  const handleSwitchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!switchFormData.name.trim()) {
      setFormError("Switch name is required");
      return;
    }
    if (!isValidIpAddress(switchFormData.ipAddress)) {
      setFormError("Invalid IP address format");
      return;
    }
    if (!switchFormData.password.trim()) {
      setFormError("Password is required");
      return;
    }

    setSaving(true);
    try {
      if (editingSwitch) {
        await updatePoESwitch(editingSwitch.id, switchFormData);
      } else {
        await addPoESwitch({
          ...switchFormData,
          ownerEmail: user?.email || "",
          isOnline: false,
          lastSeen: null,
        });
      }
      await loadData();
      setShowSwitchForm(false);
      resetSwitchForm();
    } catch (error) {
      setFormError("Failed to save switch. Please try again.");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeviceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!deviceFormData.name.trim()) {
      setFormError("Device name is required");
      return;
    }
    if (!deviceFormData.switchId) {
      setFormError("Please select a switch");
      return;
    }
    if (deviceFormData.portNumber < 1 || deviceFormData.portNumber > 8) {
      setFormError("Port number must be between 1 and 8");
      return;
    }

    setSaving(true);
    try {
      if (editingDevice) {
        await updatePoEDevice(editingDevice.id, deviceFormData);
      } else {
        await addPoEDevice({
          ...deviceFormData,
          ownerEmail: user?.email || "",
          zone: deviceFormData.zone || null,
          isEnabled: false,
          isOnline: false,
          lastToggled: null,
        });
      }
      await loadData();
      setShowDeviceForm(false);
      resetDeviceForm();
    } catch (error) {
      setFormError("Failed to save device. Please try again.");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSwitch = async (id: string) => {
    if (!confirm("Are you sure you want to delete this switch? All devices using this switch will also be deleted.")) return;
    try {
      // Delete all devices using this switch
      const switchDevices = devices.filter(d => d.switchId === id);
      await Promise.all(switchDevices.map(d => deletePoEDevice(d.id)));

      await deletePoESwitch(id);
      await loadData();
    } catch (error) {
      console.error("Failed to delete switch:", error);
    }
  };

  const handleDeleteDevice = async (id: string) => {
    if (!confirm("Are you sure you want to delete this device?")) return;
    try {
      await deletePoEDevice(id);
      await loadData();
    } catch (error) {
      console.error("Failed to delete device:", error);
    }
  };

  const handleTestSwitch = async (poeSwitch: PoESwitch) => {
    setTestingSwitch(poeSwitch.id);
    try {
      const response = await fetch("/api/poe/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipAddress: poeSwitch.ipAddress,
          password: poeSwitch.password,
          type: poeSwitch.type,
          switchId: poeSwitch.id,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        alert(`Test failed: ${data.error || "Unknown error"}`);
      } else {
        alert(data.message);
        await loadData(); // Refresh to show updated status
      }
    } catch (error) {
      alert("Failed to connect to switch");
      console.error(error);
    } finally {
      setTestingSwitch(null);
    }
  };

  const handleToggleDevice = async (device: PoEDevice) => {
    try {
      const response = await fetch("/api/poe/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: device.id,
          enabled: !device.isEnabled,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        alert(`Failed to toggle: ${data.error || "Unknown error"}`);
        return;
      }

      await loadData();
    } catch (error) {
      console.error("Failed to toggle device:", error);
      alert("Failed to toggle device");
    }
  };

  const handleSyncSwitchStatus = async (poeSwitch: PoESwitch) => {
    setSyncingSwitch(poeSwitch.id);
    try {
      const response = await fetch("/api/poe/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          switchId: poeSwitch.id,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        alert(`Sync failed: ${data.error || "Unknown error"}`);
      } else {
        alert(`✓ Synced ${data.portStatuses.length} ports, updated ${data.updatedDevices} devices`);
        await loadData();
      }
    } catch (error) {
      alert("Failed to sync switch status");
      console.error(error);
    } finally {
      setSyncingSwitch(null);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">PoE Controlled Devices</h1>
            <p className="text-[var(--text-secondary)] text-sm">Manage lights and other PoE-powered devices</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadData}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" onClick={openAddSwitchForm}>
              <Network className="mr-2 h-4 w-4" />
              Add Switch
            </Button>
            <Button onClick={openAddDeviceForm} disabled={switches.length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              Add Device
            </Button>
          </div>
        </div>

        {/* Switch Form Modal */}
        {showSwitchForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <Card className="w-full max-w-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>
                    {editingSwitch ? "Edit Switch" : "Add Switch"}
                  </CardTitle>
                  <button
                    onClick={() => setShowSwitchForm(false)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <CardDescription>
                  Configure a PoE switch to control devices
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSwitchSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-lg bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 p-3 text-sm text-[var(--accent-red)]">
                      {formError}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="switch-name">Switch Name</Label>
                    <Input
                      id="switch-name"
                      placeholder="Main PoE Switch"
                      value={switchFormData.name}
                      onChange={(e) =>
                        setSwitchFormData({ ...switchFormData, name: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="switch-type">Switch Type</Label>
                    <Select
                      id="switch-type"
                      value={switchFormData.type}
                      onChange={(e) =>
                        setSwitchFormData({
                          ...switchFormData,
                          type: e.target.value as PoESwitchType,
                        })
                      }
                    >
                      <option value="netgear_gs308ep">Netgear GS308EP</option>
                      <option value="other">Other</option>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="switch-ip">IP Address</Label>
                    <Input
                      id="switch-ip"
                      placeholder="192.168.68.110"
                      value={switchFormData.ipAddress}
                      onChange={(e) =>
                        setSwitchFormData({ ...switchFormData, ipAddress: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="switch-password">Password</Label>
                    <PasswordInput
                      id="switch-password"
                      placeholder="Switch password"
                      value={switchFormData.password}
                      onChange={(e) =>
                        setSwitchFormData({ ...switchFormData, password: e.target.value })
                      }
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowSwitchForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" isLoading={saving}>
                      {editingSwitch ? "Update" : "Add"} Switch
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Device Form Modal */}
        {showDeviceForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
            <Card className="w-full max-w-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>
                    {editingDevice ? "Edit Device" : "Add Device"}
                  </CardTitle>
                  <button
                    onClick={() => setShowDeviceForm(false)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <CardDescription>
                  Add a device connected to a PoE switch port
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleDeviceSubmit} className="space-y-4">
                  {formError && (
                    <div className="rounded-lg bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 p-3 text-sm text-[var(--accent-red)]">
                      {formError}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="device-name">Device Name</Label>
                    <Input
                      id="device-name"
                      placeholder="Apparatus Bay Light"
                      value={deviceFormData.name}
                      onChange={(e) =>
                        setDeviceFormData({ ...deviceFormData, name: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="device-switch">PoE Switch</Label>
                    <Select
                      id="device-switch"
                      value={deviceFormData.switchId}
                      onChange={(e) =>
                        setDeviceFormData({ ...deviceFormData, switchId: e.target.value })
                      }
                    >
                      <option value="">Select a switch</option>
                      {switches.map((sw) => (
                        <option key={sw.id} value={sw.id}>
                          {sw.name} ({sw.ipAddress})
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="device-port">Port Number (1-8)</Label>
                    <Input
                      id="device-port"
                      type="number"
                      min="1"
                      max="8"
                      value={deviceFormData.portNumber}
                      onChange={(e) =>
                        setDeviceFormData({
                          ...deviceFormData,
                          portNumber: parseInt(e.target.value),
                        })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="device-mode">Mode</Label>
                    <Select
                      id="device-mode"
                      value={deviceFormData.mode}
                      onChange={(e) =>
                        setDeviceFormData({
                          ...deviceFormData,
                          mode: e.target.value as PoEDeviceMode,
                        })
                      }
                    >
                      <option value="always_on">Always ON</option>
                      <option value="auto">Auto (on audio detection)</option>
                      <option value="always_off">Always OFF</option>
                    </Select>
                    <p className="text-xs text-[var(--text-muted)]">
                      Auto mode turns device ON when audio is detected, OFF after call ends
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="device-zone">Zone (optional)</Label>
                    <Input
                      id="device-zone"
                      placeholder="apparatus, dorms, common"
                      value={deviceFormData.zone}
                      onChange={(e) =>
                        setDeviceFormData({ ...deviceFormData, zone: e.target.value })
                      }
                    />
                  </div>

                  {/* Paging Device Linking (for auto mode) */}
                  {deviceFormData.mode === "auto" && (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Link2 className="h-4 w-4" />
                        Linked Paging Devices (required for auto mode)
                      </Label>
                      <p className="text-xs text-[var(--text-muted)] mb-2">
                        Device will ONLY turn on when one of these linked paging devices is active. If no paging devices are selected, auto mode won't work (device won't automatically turn on/off).
                      </p>
                      <div className="max-h-40 overflow-y-auto border border-[var(--border-color)] rounded-lg p-2 space-y-2 bg-[var(--bg-secondary)]">
                        {algoDevices.filter(d => d.type === "8301").length === 0 ? (
                          <p className="text-sm text-[var(--text-muted)] py-2 text-center">
                            No paging devices (8301) available. Add paging devices first.
                          </p>
                        ) : (
                          algoDevices
                            .filter(d => d.type === "8301")
                            .map(pagingDevice => (
                              <label key={pagingDevice.id} className="flex items-center gap-2 cursor-pointer hover:bg-[var(--bg-tertiary)] p-2 rounded-lg transition-colors">
                                <input
                                  type="checkbox"
                                  checked={deviceFormData.linkedPagingDeviceIds.includes(pagingDevice.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setDeviceFormData({
                                        ...deviceFormData,
                                        linkedPagingDeviceIds: [...deviceFormData.linkedPagingDeviceIds, pagingDevice.id],
                                      });
                                    } else {
                                      setDeviceFormData({
                                        ...deviceFormData,
                                        linkedPagingDeviceIds: deviceFormData.linkedPagingDeviceIds.filter(id => id !== pagingDevice.id),
                                      });
                                    }
                                  }}
                                  className="rounded border-[var(--border-color)] bg-[var(--bg-tertiary)]"
                                />
                                <span className="text-sm text-[var(--text-primary)]">{pagingDevice.name}</span>
                                <span className="text-xs text-[var(--text-muted)]">({pagingDevice.ipAddress})</span>
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
                      onClick={() => setShowDeviceForm(false)}
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

        {/* Switches */}
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">PoE Switches</h2>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent" />
            </div>
          ) : switches.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Network className="h-12 w-12 text-[var(--text-muted)] mb-4" />
                <p className="text-[var(--text-muted)] mb-4">No switches configured yet</p>
                <Button onClick={openAddSwitchForm}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Switch
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {switches.map((poeSwitch) => (
                <Card key={poeSwitch.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg">{poeSwitch.name}</CardTitle>
                        <CardDescription>{poeSwitch.ipAddress}</CardDescription>
                      </div>
                      <Badge variant={poeSwitch.isOnline ? "success" : "secondary"}>
                        {poeSwitch.isOnline ? "Online" : "Offline"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2 text-sm">
                      <Badge variant="outline">{poeSwitch.type.toUpperCase()}</Badge>
                    </div>
                    <p className="text-xs text-[var(--text-muted)]">
                      {devices.filter(d => d.switchId === poeSwitch.id).length} devices connected
                    </p>
                    <div className="flex gap-2 pt-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleTestSwitch(poeSwitch)}
                        isLoading={testingSwitch === poeSwitch.id}
                      >
                        Test
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSyncSwitchStatus(poeSwitch)}
                        isLoading={syncingSwitch === poeSwitch.id}
                      >
                        <Activity className="mr-1 h-3 w-3" />
                        Sync Status
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditSwitchForm(poeSwitch)}
                      >
                        <Pencil className="mr-1 h-3 w-3" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteSwitch(poeSwitch.id)}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Devices */}
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">PoE Devices</h2>
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent" />
            </div>
          ) : devices.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Lightbulb className="h-12 w-12 text-[var(--text-muted)] mb-4" />
                <p className="text-[var(--text-muted)] mb-4">No devices configured yet</p>
                <Button onClick={openAddDeviceForm} disabled={switches.length === 0}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Device
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {devices.map((device) => {
                const deviceSwitch = switches.find(s => s.id === device.switchId);
                return (
                  <Card key={device.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <CardTitle className="text-lg">{device.name}</CardTitle>
                            <div className={`h-2 w-2 rounded-full ${device.isEnabled ? 'bg-[var(--accent-green)]' : 'bg-[var(--accent-red)]'}`}></div>
                          </div>
                          <CardDescription>
                            Port {device.portNumber} on {deviceSwitch?.name || "Unknown Switch"}
                          </CardDescription>
                        </div>
                        <Badge variant={device.isEnabled ? "success" : "secondary"}>
                          {device.isEnabled ? "ON" : "OFF"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-2 text-sm">
                        <Badge variant="outline">
                          {device.mode === "always_on" ? "Always ON" : device.mode === "auto" ? "Auto" : "Always OFF"}
                        </Badge>
                        {device.zone && (
                          <Badge variant="outline">{device.zone}</Badge>
                        )}
                      </div>
                      {device.mode === "auto" && device.linkedPagingDeviceIds && device.linkedPagingDeviceIds.length > 0 && (
                        <div className="flex items-center gap-2 text-sm text-[var(--accent-blue)]">
                          <Link2 className="h-4 w-4" />
                          <span>
                            Linked to {device.linkedPagingDeviceIds.length} paging device{device.linkedPagingDeviceIds.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      )}
                      {device.lastToggled && (
                        <p className="text-xs text-[var(--text-muted)]">
                          Last toggled: {formatDate(device.lastToggled)}
                        </p>
                      )}
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleToggleDevice(device)}
                        >
                          <Power className="mr-1 h-3 w-3" />
                          Toggle
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditDeviceForm(device)}
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteDevice(device.id)}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          Delete
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
