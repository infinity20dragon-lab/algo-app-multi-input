"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Trash2, Copy, Activity, Calendar, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useRealtimeSync } from "@/contexts/realtime-sync-context";
import { ref as dbRef, get, remove } from "firebase/database";
import { realtimeDb } from "@/lib/firebase/config";
import type { AudioLogEntry } from "@/contexts/audio-monitoring-context";

export default function ActivityPage() {
  const { user } = useAuth();
  const { viewingAsUserId } = useRealtimeSync();
  const [logs, setLogs] = useState<AudioLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Get PST date for initial load and default date picker value
  const getPSTDate = () => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(now);
    const year = parts.find(p => p.type === 'year')?.value || '';
    const month = parts.find(p => p.type === 'month')?.value || '';
    const day = parts.find(p => p.type === 'day')?.value || '';
    return `${year}-${month}-${day}`;
  };

  // Set default date to today (PST) on mount
  useEffect(() => {
    setSelectedDate(getPSTDate());
  }, []);

  // Load logs when date or user changes
  useEffect(() => {
    if (selectedDate && user) {
      loadLogs();
    }
  }, [selectedDate, user, viewingAsUserId]);

  const loadLogs = async () => {
    if (!selectedDate || !user) return;

    setLoading(true);
    try {
      // If admin is viewing a user, load that user's logs
      const targetUserId = viewingAsUserId || user.uid;
      const logsRef = dbRef(realtimeDb, `logs/${targetUserId}/${selectedDate}`);
      const snapshot = await get(logsRef);

      if (snapshot.exists()) {
        const logsData = snapshot.val();
        // Convert Firebase object to array and sort by timestamp
        const logsArray: AudioLogEntry[] = Object.keys(logsData)
          .map(key => ({
            ...logsData[key],
            id: key, // Store the Firebase key for deletion
          }))
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        setLogs(logsArray);
      } else {
        setLogs([]);
      }
    } catch (error) {
      console.error('[Activity] Failed to load logs:', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const csvData = exportLogs();
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-log-${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    const csvData = exportLogs();
    navigator.clipboard.writeText(csvData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportLogs = () => {
    const header = "Timestamp,Type,Audio Level,Threshold,Speakers,Volume,Message,Recording URL\n";
    const rows = logs.map(log => {
      // log.timestamp is already a PST time string (HH:MM:SS), use it directly
      const timestamp = log.timestamp;
      return `"${timestamp}","${log.type}","${log.audioLevel ?? ''}","${log.audioThreshold ?? ''}","${log.speakersEnabled ?? ''}","${log.volume ?? ''}","${log.message}","${log.recordingUrl ?? ''}"`;
    }).join("\n");

    return header + rows;
  };

  const handleDeleteDay = async () => {
    if (!selectedDate || !user) return;

    const confirmed = confirm(`Delete all logs for ${selectedDate}? This cannot be undone.`);
    if (!confirmed) return;

    setDeleting(true);
    try {
      // If admin is viewing a user, delete that user's logs
      const targetUserId = viewingAsUserId || user.uid;
      const logsRef = dbRef(realtimeDb, `logs/${targetUserId}/${selectedDate}`);
      await remove(logsRef);

      setLogs([]);
      console.log('[Activity] Deleted logs for', selectedDate);
    } catch (error) {
      console.error('[Activity] Failed to delete logs:', error);
      alert('Failed to delete logs. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const getTypeColor = (type: AudioLogEntry["type"]) => {
    switch (type) {
      case "audio_detected":
        return "warning";
      case "speakers_enabled":
        return "success";
      case "speakers_disabled":
        return "secondary";
      case "audio_silent":
        return "secondary";
      case "volume_change":
        return "default";
      default:
        return "default";
    }
  };

  const getTypeLabel = (type: AudioLogEntry["type"]) => {
    switch (type) {
      case "audio_detected":
        return "Audio";
      case "speakers_enabled":
        return "On";
      case "speakers_disabled":
        return "Off";
      case "audio_silent":
        return "Silent";
      case "volume_change":
        return "Volume";
      default:
        return type;
    }
  };

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]">Activity Log</h1>
            <p className="text-[var(--text-secondary)] mt-1">
              View and manage audio monitoring activity logs {viewingAsUserId && "(User's Logs)"}
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-purple)]/15">
                  <Activity className="h-5 w-5 text-[var(--accent-purple)]" />
                </div>
                <div>
                  <CardTitle className="text-lg">
                    {logs.length} entries on {selectedDate}
                  </CardTitle>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">
                    All times in PST (Pacific Standard Time)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {/* Date Picker */}
                <div className="flex items-center gap-2">
                  <Label htmlFor="date-picker" className="text-sm text-[var(--text-secondary)]">
                    Date:
                  </Label>
                  <div className="relative">
                    <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-white pointer-events-none z-10" />
                    <Input
                      id="date-picker"
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      max={getPSTDate()}
                      className="w-auto pl-8 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                    />
                  </div>
                </div>

                {/* Refresh Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadLogs}
                  disabled={loading}
                >
                  <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>

                {/* Action Buttons */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  disabled={logs.length === 0}
                >
                  <Copy className="mr-1 h-4 w-4" />
                  {copied ? "Copied!" : "Copy"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  disabled={logs.length === 0}
                >
                  <Download className="mr-1 h-4 w-4" />
                  Export CSV
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteDay}
                  disabled={logs.length === 0 || deleting}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  {deleting ? 'Deleting...' : 'Delete Day'}
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {viewingAsUserId && (
              <div className="mb-4 p-3 rounded-lg bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/30">
                <p className="text-sm text-[var(--accent-blue)]">
                  📝 Admin Mode: Viewing logs for the user you're controlling. These are their activity logs stored in Firebase.
                </p>
              </div>
            )}

            {loading ? (
              <div className="py-12 text-center">
                <RefreshCw className="mx-auto h-8 w-8 text-[var(--text-muted)] mb-3 animate-spin" />
                <p className="text-sm text-[var(--text-muted)]">Loading logs...</p>
              </div>
            ) : logs.length === 0 ? (
              <div className="py-12 text-center">
                <Activity className="mx-auto h-8 w-8 text-[var(--text-muted)] mb-3" />
                <p className="text-sm text-[var(--text-muted)]">
                  No logs found for {selectedDate}
                </p>
                <p className="text-xs text-[var(--text-muted)] mt-2">
                  Select a different date or start monitoring to generate logs
                </p>
              </div>
            ) : (
              <div className="max-h-[600px] overflow-y-auto rounded-lg border border-[var(--border-color)]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] z-10">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Time (PST)</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Type</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Level</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Message</th>
                      <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Recording</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...logs].reverse().map((log, index) => (
                      <tr
                        key={(log as any).id || index}
                        className="border-b border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                      >
                        <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap font-mono text-xs">
                          {log.timestamp /* Already PST formatted HH:MM:SS */}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={getTypeColor(log.type)} className="text-xs">
                            {getTypeLabel(log.type)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-[var(--text-secondary)]">
                          {log.audioLevel !== undefined && log.audioLevel !== null ? (
                            <span className="font-mono text-[var(--accent-blue)]">
                              {log.audioLevel.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-[var(--text-muted)]">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-primary)]">{log.message}</td>
                        <td className="px-4 py-3">
                          {log.recordingUrl ? (
                            <audio
                              controls
                              className="h-8 w-40"
                              preload="none"
                              src={log.recordingUrl}
                            />
                          ) : (
                            <span className="text-[var(--text-muted)] text-xs">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
