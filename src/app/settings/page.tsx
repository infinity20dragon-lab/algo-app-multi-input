"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/auth-context";
import { Settings2, User, Info, VolumeX, CheckCircle2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useState, useEffect } from "react";
import { useSimpleMonitoring } from "@/contexts/simple-monitoring-context";

export default function SettingsPage() {
  const { user } = useAuth();
  const { loggingEnabled, setLoggingEnabled, recordingEnabled, setRecordingEnabled } = useSimpleMonitoring();

  const [idleVolume, setIdleVolume] = useState<number>(-45);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Load settings from localStorage
  useEffect(() => {
    const savedIdleVolume = localStorage.getItem("algoapp-idle-volume");
    if (savedIdleVolume) {
      setIdleVolume(parseInt(savedIdleVolume));
    }
  }, []);

  const handleSaveSettings = () => {
    try {
      localStorage.setItem("algoapp-idle-volume", idleVolume.toString());
      setSavedMessage("Settings saved! Restart monitoring for changes to take effect.");
      setTimeout(() => setSavedMessage(null), 5000);
    } catch (error) {
      setSavedMessage("Error: Failed to save settings");
      setTimeout(() => setSavedMessage(null), 5000);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Settings</h1>
          <p className="text-[var(--text-secondary)] text-sm">Configure your AlgoSound system</p>
        </div>

        {/* Account Info */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--accent-blue)]/15">
                <User className="h-5 w-5 text-[var(--accent-blue)]" />
              </div>
              <div>
                <CardTitle>Account</CardTitle>
                <CardDescription>Your account information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>User ID</Label>
              <Input value={user?.uid || ""} disabled />
            </div>
          </CardContent>
        </Card>

        {/* Default Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--accent-purple)]/15">
                <Settings2 className="h-5 w-5 text-[var(--accent-purple)]" />
              </div>
              <div>
                <CardTitle>Audio & Recording</CardTitle>
                <CardDescription>
                  Speaker and recording preferences
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="idleVolume" className="flex items-center gap-2">
                <VolumeX className="h-4 w-4 text-[var(--text-muted)]" />
                Idle Volume Level
              </Label>
              <div className="flex items-center gap-3">
                <select
                  id="idleVolume"
                  value={idleVolume}
                  onChange={(e) => setIdleVolume(parseInt(e.target.value))}
                  className="px-3 py-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                >
                  <option value={-45}>Level -5 (-45dB) - Default</option>
                  <option value={-42}>Level -4 (-42dB)</option>
                  <option value={-39}>Level -3 (-39dB)</option>
                  <option value={-36}>Level -2 (-36dB)</option>
                  <option value={-33}>Level -1 (-33dB)</option>
                  <option value={-30}>Level 0 (-30dB)</option>
                  <option value={-27}>Level 1 (-27dB)</option>
                  <option value={-24}>Level 2 (-24dB)</option>
                  <option value={-21}>Level 3 (-21dB)</option>
                  <option value={-18}>Level 4 (-18dB)</option>
                  <option value={-15}>Level 5 (-15dB)</option>
                  <option value={-12}>Level 6 (-12dB)</option>
                  <option value={-9}>Level 7 (-9dB)</option>
                  <option value={-6}>Level 8 (-6dB)</option>
                  <option value={-3}>Level 9 (-3dB)</option>
                  <option value={0}>Level 10 (0dB) - Max</option>
                </select>
                <span className="text-sm text-[var(--text-muted)] font-mono">
                  Current: Level {(idleVolume + 45) / 3 - 5}
                </span>
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                Volume level for speakers when idle/off (Level -5 to Level 10). Default: Level -5 (-45dB). Restart monitoring for changes to take effect.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="!text-[var(--text-primary)]">Activity Logging</Label>
                <p className="text-xs text-[var(--text-muted)]">Log events to the activity viewer</p>
              </div>
              <Switch checked={loggingEnabled} onCheckedChange={setLoggingEnabled} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="!text-[var(--text-primary)]">Save Recordings</Label>
                <p className="text-xs text-[var(--text-muted)]">
                  {recordingEnabled ? "Saving to Firebase Storage" : "Not saving"}
                </p>
              </div>
              <Switch checked={recordingEnabled} onCheckedChange={setRecordingEnabled} />
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleSaveSettings}>Save Settings</Button>
              {savedMessage && (
                <div className="flex items-center gap-2 text-sm text-[var(--accent-green)]">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{savedMessage}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--accent-green)]/15">
                <Info className="h-5 w-5 text-[var(--accent-green)]" />
              </div>
              <CardTitle>About AlgoSound</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-color)]">
              <div>
                <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">Version</p>
                <p className="text-[var(--text-primary)] font-medium">1.0.0</p>
              </div>
              <div>
                <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-1">Build</p>
                <p className="text-[var(--text-primary)] font-medium">Production</p>
              </div>
            </div>
            <div className="space-y-2 text-[var(--text-secondary)]">
              <p>
                <strong className="text-[var(--text-primary)]">Purpose:</strong> Sound distribution system for Algo IP endpoints
              </p>
              <p>
                <strong className="text-[var(--text-primary)]">Supported Devices:</strong> 8301 Paging Adapter, 8180G2 Speaker, 8198 Ceiling Speaker, and more
              </p>
            </div>
            <div className="p-4 rounded-xl bg-[var(--accent-red)]/5 border border-[var(--accent-red)]/20">
              <p className="text-[var(--text-secondary)]">
                Built for <strong className="text-[var(--accent-red)]">fire station alerting systems</strong> to ensure every call reaches all areas of the station.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
