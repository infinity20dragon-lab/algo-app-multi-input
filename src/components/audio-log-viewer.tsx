"use client";

import { useAudioMonitoring, type AudioLogEntry } from "@/contexts/audio-monitoring-context";
import { useRealtimeSync } from "@/contexts/realtime-sync-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Trash2, Copy, Activity } from "lucide-react";
import { useState } from "react";

export function AudioLogViewer() {
  const { logs, clearLogs, exportLogs, loggingEnabled, recordingEnabled } = useAudioMonitoring();
  const { viewingAsUserId } = useRealtimeSync();
  const [copied, setCopied] = useState(false);

  const handleExport = () => {
    const csvData = exportLogs();
    const blob = new Blob([csvData], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audio-monitoring-log-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    const csvData = exportLogs();
    navigator.clipboard.writeText(csvData);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--accent-purple)]/15">
              <Activity className="h-5 w-5 text-[var(--accent-purple)]" />
            </div>
            <div>
              <CardTitle className="text-lg">Activity Log</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-[var(--text-secondary)]">
                  {logs.length} entries
                </span>
                {!loggingEnabled && (
                  <Badge variant="secondary" className="text-xs">Logging OFF</Badge>
                )}
                {recordingEnabled && (
                  <Badge variant="success" className="text-xs">Recording ON</Badge>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
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
              Export
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={clearLogs}
              disabled={logs.length === 0}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {viewingAsUserId && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/30">
            <p className="text-sm text-[var(--accent-blue)]">
              📝 Note: Logs are local to each instance. You're viewing your own admin logs, not the user's logs.
              Activity logs are generated on the device where monitoring occurs.
            </p>
          </div>
        )}
        {logs.length === 0 ? (
          <div className="py-12 text-center">
            <Activity className="mx-auto h-8 w-8 text-[var(--text-muted)] mb-3" />
            <p className="text-sm text-[var(--text-muted)]">
              No events logged yet. Start monitoring to see activity.
            </p>
          </div>
        ) : (
          <div className="max-h-[400px] overflow-y-auto rounded-lg border border-[var(--border-color)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Time</th>
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Level</th>
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Message</th>
                  <th className="px-4 py-3 text-left font-semibold text-[var(--text-secondary)]">Recording</th>
                </tr>
              </thead>
              <tbody>
                {[...logs].reverse().map((log, index) => (
                  <tr
                    key={index}
                    className="border-b border-[var(--border-color)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap font-mono text-xs">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={getTypeColor(log.type)} className="text-xs">
                        {getTypeLabel(log.type)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      {log.audioLevel !== undefined ? (
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
  );
}
