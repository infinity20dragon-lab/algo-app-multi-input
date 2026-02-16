"use client";

import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Map,
  Speaker,
  Flame,
  Heart,
  Bell,
  Settings2,
  Plus,
  Check,
  Edit,
  Trash2,
} from "lucide-react";
import { getDevices, getZones, addZone, updateZone, deleteZone as deleteZoneFromDB, getUserZoneRouting, setZoneRouting, updateDevice } from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/auth-context";
import type { AlgoDevice, Zone, ZoneRouting } from "@/lib/algo/types";
import { ZoneModal } from "@/components/zones/zone-modal";
import { AssignDeviceModal } from "@/components/zones/assign-device-modal";

export default function ZonesPage() {
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const { user } = useAuth();
  const [zoneRouting, setZoneRoutingState] = useState<Record<string, ZoneRouting>>({});
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [editingZoneIndex, setEditingZoneIndex] = useState<number>(-1);

  // Load data from Firebase
  useEffect(() => {
    if (user?.email) loadData();
  }, [user?.email]);

  const loadData = async () => {
    if (!user?.email) return;
    try {
      setLoading(true);
      const [devicesData, zonesData, routingData] = await Promise.all([
        getDevices(user.email),
        getZones(user.email),
        getUserZoneRouting(user.email),
      ]);

      setDevices(devicesData);
      setZones(zonesData);
      setZoneRoutingState(routingData);

      // Auto-select first zone
      if (zonesData.length > 0 && !selectedZone) {
        setSelectedZone(zonesData[0].id);
      }
    } catch (error) {
      console.error("Failed to load zones data:", error);
    } finally {
      setLoading(false);
    }
  };

  const selectedZoneData = zones.find(z => z.id === selectedZone);
  const routing = selectedZone ? zoneRouting[selectedZone] : null;

  // Open modal to add new zone
  const handleAddZone = () => {
    setEditingZone(null);
    setEditingZoneIndex(-1);
    setZoneModalOpen(true);
  };

  // Open modal to edit existing zone
  const handleEditZone = (zone: Zone, index: number) => {
    setEditingZone(zone);
    setEditingZoneIndex(index);
    setZoneModalOpen(true);
  };

  // Save zone (create or update)
  const handleSaveZone = async (data: {
    zone: Omit<Zone, "id" | "createdAt" | "updatedAt"> & { id?: string };
    routing: { fire: boolean; medical: boolean; allCall: boolean };
  }) => {
    try {
      let zoneId: string;

      if (data.zone.id) {
        // Update existing zone
        zoneId = data.zone.id;
        await updateZone(zoneId, {
          name: data.zone.name,
          color: data.zone.color,
          deviceIds: data.zone.deviceIds,
        });
      } else {
        // Create new zone
        zoneId = await addZone({
          name: data.zone.name,
          color: data.zone.color,
          deviceIds: [],
          ownerEmail: user?.email || "unknown",
        });
      }

      // Save routing configuration
      await setZoneRouting(zoneId, {
        zoneId,
        fire: data.routing.fire,
        medical: data.routing.medical,
        allCall: data.routing.allCall,
      });

      // Reload data
      await loadData();

      // Select the newly created/edited zone
      setSelectedZone(zoneId);
    } catch (error) {
      console.error("Failed to save zone:", error);
      throw error;
    }
  };

  // Delete zone
  const handleDeleteZone = async () => {
    if (!editingZone) return;

    try {
      // Unassign all devices from this zone first
      const devicesInZone = devices.filter(d => d.zone === editingZone.id);
      await Promise.all(
        devicesInZone.map(device =>
          updateDevice(device.id, { zone: null })
        )
      );

      // Delete the zone
      await deleteZoneFromDB(editingZone.id);

      // If this was the selected zone, clear selection
      if (selectedZone === editingZone.id) {
        setSelectedZone(null);
      }

      // Reload data
      await loadData();
    } catch (error) {
      console.error("Failed to delete zone:", error);
      throw error;
    }
  };

  // Open assign device modal
  const handleAssignDevices = () => {
    if (!selectedZone) return;
    setAssignModalOpen(true);
  };

  // Assign devices to zone
  const handleDeviceAssignment = async (deviceIds: string[]) => {
    if (!selectedZone) return;

    try {
      // Get current zone data
      const zone = zones.find(z => z.id === selectedZone);
      if (!zone) return;

      // Get previously assigned devices for this zone
      const previouslyAssigned = devices.filter(d => d.zone === selectedZone);

      // Unassign devices that are no longer in the list
      const toUnassign = previouslyAssigned.filter(d => !deviceIds.includes(d.id));
      await Promise.all(
        toUnassign.map(device => updateDevice(device.id, { zone: null }))
      );

      // Assign new devices
      await Promise.all(
        deviceIds.map(deviceId => updateDevice(deviceId, { zone: selectedZone }))
      );

      // Update zone's deviceIds array
      await updateZone(selectedZone, { deviceIds });

      // Reload data
      await loadData();
    } catch (error) {
      console.error("Failed to assign devices:", error);
      throw error;
    }
  };

  // Update routing for selected zone
  const updateRouting = async (type: "fire" | "medical" | "allCall", value: boolean) => {
    if (!selectedZone) return;

    try {
      const currentRouting = zoneRouting[selectedZone] || {
        zoneId: selectedZone,
        fire: true,
        medical: true,
        allCall: true,
      };

      await setZoneRouting(selectedZone, {
        ...currentRouting,
        [type]: value,
      });

      // Update local state
      setZoneRoutingState(prev => ({
        ...prev,
        [selectedZone]: {
          ...currentRouting,
          [type]: value,
          id: selectedZone,
        },
      }));
    } catch (error) {
      console.error("Failed to update routing:", error);
    }
  };

  // Get devices assigned to selected zone
  const assignedDevices = selectedZone
    ? devices.filter(d => d.zone === selectedZone)
    : [];

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Station Zones</h1>
            <p className="text-[var(--text-secondary)] text-sm">
              Configure zones and speaker assignments
            </p>
          </div>
          <Button onClick={handleAddZone}>
            <Plus className="mr-2 h-4 w-4" />
            Add Zone
          </Button>
        </div>

        {zones.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <Map className="mx-auto h-12 w-12 text-[var(--text-muted)] mb-4" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                  No Zones Yet
                </h3>
                <p className="text-sm text-[var(--text-secondary)] mb-6">
                  Create zones to organize your speakers by location
                </p>
                <Button onClick={handleAddZone}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Your First Zone
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Floor Plan */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-purple)]/15">
                    <Map className="h-5 w-5 text-[var(--accent-purple)]" />
                  </div>
                  <div>
                    <CardTitle>Floor Plan</CardTitle>
                    <CardDescription>Click a zone to configure</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Interactive Floor Plan */}
                <div className="grid grid-cols-3 gap-3 aspect-[16/9]">
                  {zones.map((zone, index) => {
                    const routing = zoneRouting[zone.id];
                    return (
                      <button
                        key={zone.id}
                        onClick={() => setSelectedZone(zone.id)}
                        className={`rounded-xl p-4 flex flex-col items-center justify-center text-center transition-all ${
                          index === 2 ? "row-span-2" : ""
                        } ${
                          selectedZone === zone.id
                            ? "ring-2 ring-white ring-offset-2 ring-offset-[var(--bg-primary)]"
                            : "hover:scale-[1.02]"
                        }`}
                        style={{
                          backgroundColor: `${zone.color}30`,
                          border: `2px solid ${zone.color}`,
                        }}
                      >
                        <span className="text-sm font-bold" style={{ color: zone.color }}>
                          {zone.name.toUpperCase()}
                        </span>
                        <span className="text-xs text-[var(--text-muted)] mt-2">
                          {zone.deviceIds?.length || 0} speakers
                        </span>
                        <div className="flex gap-1 mt-2">
                          {zoneRouting?.fire && (
                            <div className="w-2 h-2 rounded-full bg-[var(--accent-red)]" title="Fire" />
                          )}
                          {zoneRouting?.medical && (
                            <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)]" title="Medical" />
                          )}
                          {zoneRouting?.allCall && (
                            <div className="w-2 h-2 rounded-full bg-[var(--accent-purple)]" title="All-Call" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex items-center justify-center gap-6 mt-6 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[var(--accent-red)]" />
                    <span className="text-[var(--text-muted)]">Fire</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[var(--accent-blue)]" />
                    <span className="text-[var(--text-muted)]">Medical</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-[var(--accent-purple)]" />
                    <span className="text-[var(--text-muted)]">All-Call</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Zone Config Panel */}
            {selectedZoneData && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="p-2 rounded-lg"
                          style={{ backgroundColor: `${selectedZoneData.color}30` }}
                        >
                          <Settings2 className="h-5 w-5" style={{ color: selectedZoneData.color }} />
                        </div>
                        <div>
                          <CardTitle>{selectedZoneData.name}</CardTitle>
                          <CardDescription>Zone configuration</CardDescription>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditZone(selectedZoneData, zones.findIndex(z => z.id === selectedZone))}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Call Type Routing */}
                    <div className="space-y-4">
                      <Label className="text-[var(--text-muted)] text-xs uppercase tracking-wider">
                        Call Type Routing
                      </Label>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-lg gradient-fire">
                              <Flame className="h-4 w-4 text-white" />
                            </div>
                            <span className="text-sm font-medium text-[var(--text-primary)]">Fire Alerts</span>
                          </div>
                          <Switch
                            checked={routing?.fire ?? true}
                            onCheckedChange={(v) => updateRouting("fire", v)}
                          />
                        </div>

                        <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-lg gradient-medical">
                              <Heart className="h-4 w-4 text-white" />
                            </div>
                            <span className="text-sm font-medium text-[var(--text-primary)]">Medical Alerts</span>
                          </div>
                          <Switch
                            checked={routing?.medical ?? true}
                            onCheckedChange={(v) => updateRouting("medical", v)}
                          />
                        </div>

                        <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
                          <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-lg gradient-all">
                              <Bell className="h-4 w-4 text-white" />
                            </div>
                            <span className="text-sm font-medium text-[var(--text-primary)]">All-Call</span>
                          </div>
                          <Switch
                            checked={routing?.allCall ?? true}
                            onCheckedChange={(v) => updateRouting("allCall", v)}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Assigned Devices */}
                    <div className="space-y-3">
                      <Label className="text-[var(--text-muted)] text-xs uppercase tracking-wider">
                        Assigned Devices ({assignedDevices.length})
                      </Label>

                      <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {assignedDevices.length === 0 ? (
                          <div className="text-center py-4">
                            <Speaker className="mx-auto h-6 w-6 text-[var(--text-muted)] mb-2" />
                            <p className="text-sm text-[var(--text-muted)]">
                              No devices assigned
                            </p>
                          </div>
                        ) : (
                          assignedDevices.map((device) => (
                            <div
                              key={device.id}
                              className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]"
                            >
                              <Speaker className="h-4 w-4 text-[var(--text-muted)]" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                                  {device.name}
                                </p>
                                <p className="text-xs text-[var(--text-muted)]">{device.ipAddress}</p>
                              </div>
                              <Check className="h-4 w-4 text-[var(--accent-green)]" />
                            </div>
                          ))
                        )}
                      </div>

                      <Button variant="outline" size="sm" className="w-full" onClick={handleAssignDevices}>
                        <Plus className="mr-2 h-4 w-4" />
                        Assign Device
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Zone Stats */}
                <Card>
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-4 text-center">
                      <div>
                        <p className="text-2xl font-bold text-[var(--text-primary)]">
                          {assignedDevices.length}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">Speakers</p>
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-[var(--text-primary)]">
                          {[routing?.fire, routing?.medical, routing?.allCall].filter(Boolean).length}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">Alert Types</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Zone Modal */}
      <ZoneModal
        open={zoneModalOpen}
        onOpenChange={setZoneModalOpen}
        zone={editingZone}
        zoneIndex={editingZoneIndex}
        routing={
          editingZone && zoneRouting[editingZone.id]
            ? {
                fire: zoneRouting[editingZone.id].fire,
                medical: zoneRouting[editingZone.id].medical,
                allCall: zoneRouting[editingZone.id].allCall,
              }
            : { fire: true, medical: true, allCall: true }
        }
        onSave={handleSaveZone}
        ownerEmail={user?.email || "unknown"}
        onDelete={editingZone ? handleDeleteZone : undefined}
      />

      {/* Assign Device Modal */}
      {selectedZoneData && (
        <AssignDeviceModal
          open={assignModalOpen}
          onOpenChange={setAssignModalOpen}
          zoneName={selectedZoneData.name}
          devices={devices}
          assignedDeviceIds={assignedDevices.map(d => d.id)}
          onAssign={handleDeviceAssignment}
        />
      )}
    </AppLayout>
  );
}
