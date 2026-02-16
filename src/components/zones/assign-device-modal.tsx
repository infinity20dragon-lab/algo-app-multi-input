"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Speaker, Search, CheckCircle } from "lucide-react";
import type { AlgoDevice } from "@/lib/algo/types";

interface AssignDeviceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zoneName: string;
  devices: AlgoDevice[];
  assignedDeviceIds: string[];
  onAssign: (deviceIds: string[]) => Promise<void>;
}

export function AssignDeviceModal({
  open,
  onOpenChange,
  zoneName,
  devices,
  assignedDeviceIds,
  onAssign,
}: AssignDeviceModalProps) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Initialize selected IDs when modal opens
  useEffect(() => {
    if (open) {
      setSelectedIds(assignedDeviceIds);
      setSearch("");
    }
  }, [open, assignedDeviceIds]);

  const filteredDevices = devices.filter((device) =>
    device.name.toLowerCase().includes(search.toLowerCase()) ||
    device.ipAddress.includes(search)
  );

  const toggleDevice = (deviceId: string) => {
    setSelectedIds((prev) =>
      prev.includes(deviceId)
        ? prev.filter((id) => id !== deviceId)
        : [...prev, deviceId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onAssign(selectedIds);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to assign devices:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader onClose={() => onOpenChange(false)}>
          <DialogTitle>Assign Devices to {zoneName}</DialogTitle>
          <DialogDescription>
            Select which speakers should be assigned to this zone
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search devices..."
                className="pl-10"
              />
            </div>

            {/* Device List */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {filteredDevices.length === 0 ? (
                <div className="py-8 text-center">
                  <Speaker className="mx-auto h-8 w-8 text-[var(--text-muted)] mb-2" />
                  <p className="text-sm text-[var(--text-muted)]">
                    {search ? "No devices found" : "No devices available"}
                  </p>
                </div>
              ) : (
                filteredDevices.map((device) => {
                  const isSelected = selectedIds.includes(device.id);
                  return (
                    <button
                      key={device.id}
                      type="button"
                      onClick={() => toggleDevice(device.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                        isSelected
                          ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]/10"
                          : "border-[var(--border-color)] hover:border-[var(--accent-blue)]/50 hover:bg-[var(--bg-tertiary)]"
                      }`}
                    >
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${
                          isSelected
                            ? "border-[var(--accent-blue)] bg-[var(--accent-blue)]"
                            : "border-[var(--border-color)]"
                        }`}
                      >
                        {isSelected && (
                          <CheckCircle className="h-4 w-4 text-white" />
                        )}
                      </div>
                      <Speaker className="h-4 w-4 text-[var(--text-muted)]" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {device.name}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {device.ipAddress}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Selected Count */}
            <div className="text-sm text-[var(--text-muted)]">
              {selectedIds.length} device{selectedIds.length !== 1 ? "s" : ""} selected
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} isLoading={saving} disabled={saving}>
            Assign Devices
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
