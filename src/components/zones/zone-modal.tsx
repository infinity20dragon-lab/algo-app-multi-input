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
import { Label } from "@/components/ui/label";
import { Flame, Heart, Bell } from "lucide-react";
import type { Zone } from "@/lib/algo/types";

interface ZoneModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zone?: Zone | null;
  zoneIndex?: number;
  routing?: { fire: boolean; medical: boolean; allCall: boolean };
  onSave: (data: {
    zone: Omit<Zone, "id" | "createdAt" | "updatedAt"> & { id?: string };
    routing: { fire: boolean; medical: boolean; allCall: boolean };
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
  ownerEmail: string;
}

const colorOptions = [
  { value: "#6366f1", label: "Indigo" },
  { value: "#22c55e", label: "Green" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#ec4899", label: "Pink" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#f43f5e", label: "Rose" },
  { value: "#8b5cf6", label: "Violet" },
  { value: "#06b6d4", label: "Cyan" },
];

export function ZoneModal({
  open,
  onOpenChange,
  zone,
  zoneIndex,
  routing = { fire: true, medical: true, allCall: true },
  onSave,
  onDelete,
  ownerEmail,
}: ZoneModalProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(colorOptions[0].value);
  const [fire, setFire] = useState(true);
  const [medical, setMedical] = useState(true);
  const [allCall, setAllCall] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const isEdit = zone !== undefined && zone !== null;

  // Reset form when zone changes or modal opens
  useEffect(() => {
    if (open) {
      if (zone) {
        setName(zone.name);
        setColor(zone.color);
        setFire(routing.fire);
        setMedical(routing.medical);
        setAllCall(routing.allCall);
      } else {
        setName("");
        setColor(colorOptions[0].value);
        setFire(true);
        setMedical(true);
        setAllCall(true);
      }
      setError("");
    }
  }, [open, zone, routing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Zone name is required");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        zone: {
          id: zone?.id,
          name: name.trim(),
          color,
          deviceIds: zone?.deviceIds || [],
          ownerEmail,
        },
        routing: { fire, medical, allCall },
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save zone");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm(`Delete zone "${name}"? This will unassign all devices from this zone.`)) return;

    setDeleting(true);
    try {
      await onDelete();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete zone");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader onClose={() => onOpenChange(false)}>
          <DialogTitle>{isEdit ? "Edit Zone" : "Create Zone"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update zone details and alert routing"
              : "Create a new zone and configure which alerts it receives"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <DialogBody>
            <div className="space-y-4">
              {/* Name Input */}
              <div className="space-y-2">
                <Label htmlFor="zone-name">Zone Name *</Label>
                <Input
                  id="zone-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Apparatus Bay"
                  disabled={saving || deleting}
                  autoFocus
                />
              </div>

              {/* Color Picker */}
              <div className="space-y-2">
                <Label>Zone Color</Label>
                <div className="grid grid-cols-4 gap-2">
                  {colorOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setColor(option.value)}
                      className={`h-12 rounded-lg border-2 transition-all ${
                        color === option.value
                          ? "border-white ring-2 ring-white/50 scale-110"
                          : "border-[var(--border-color)] hover:scale-105"
                      }`}
                      style={{ backgroundColor: option.value }}
                      title={option.label}
                      disabled={saving || deleting}
                    />
                  ))}
                </div>
              </div>

              {/* Alert Routing */}
              <div className="space-y-2">
                <Label>Receives Alerts</Label>
                <div className="space-y-3">
                  {/* Fire */}
                  <label className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] cursor-pointer hover:bg-[var(--bg-tertiary)]">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded-lg gradient-fire">
                        <Flame className="h-4 w-4 text-white" />
                      </div>
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        🔥 Fire Calls
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={fire}
                      onChange={(e) => setFire(e.target.checked)}
                      disabled={saving || deleting}
                      className="h-5 w-5 rounded border-[var(--border-color)]"
                    />
                  </label>

                  {/* Medical */}
                  <label className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] cursor-pointer hover:bg-[var(--bg-tertiary)]">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded-lg gradient-medical">
                        <Heart className="h-4 w-4 text-white" />
                      </div>
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        🏥 Medical Calls
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={medical}
                      onChange={(e) => setMedical(e.target.checked)}
                      disabled={saving || deleting}
                      className="h-5 w-5 rounded border-[var(--border-color)]"
                    />
                  </label>

                  {/* All-Call */}
                  <label className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)] cursor-pointer hover:bg-[var(--bg-tertiary)]">
                    <div className="flex items-center gap-3">
                      <div className="p-1.5 rounded-lg gradient-all">
                        <Bell className="h-4 w-4 text-white" />
                      </div>
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        📢 All-Call
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={allCall}
                      onChange={(e) => setAllCall(e.target.checked)}
                      disabled={saving || deleting}
                      className="h-5 w-5 rounded border-[var(--border-color)]"
                    />
                  </label>
                </div>
              </div>

              {/* Preview */}
              <div className="space-y-2">
                <Label>Preview</Label>
                <div
                  className="h-16 rounded-lg flex items-center justify-center font-bold text-sm relative"
                  style={{
                    backgroundColor: `${color}30`,
                    border: `2px solid ${color}`,
                    color: color,
                  }}
                >
                  {name || "Zone Name"}
                  {/* Routing indicators */}
                  <div className="absolute bottom-2 right-2 flex gap-1">
                    {fire && <div className="w-2 h-2 rounded-full bg-[var(--accent-red)]" title="Fire" />}
                    {medical && <div className="w-2 h-2 rounded-full bg-[var(--accent-blue)]" title="Medical" />}
                    {allCall && <div className="w-2 h-2 rounded-full bg-[var(--accent-purple)]" title="All-Call" />}
                  </div>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="rounded-lg border border-[var(--accent-red)]/50 bg-[var(--accent-red)]/10 p-3 text-sm text-[var(--accent-red)]">
                  {error}
                </div>
              )}
            </div>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving || deleting}
            >
              Cancel
            </Button>
            {isEdit && onDelete && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                isLoading={deleting}
                disabled={saving || deleting}
              >
                Delete
              </Button>
            )}
            <Button type="submit" isLoading={saving} disabled={saving || deleting}>
              {isEdit ? "Save Changes" : "Create Zone"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
