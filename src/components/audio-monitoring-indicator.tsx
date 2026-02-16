"use client";

import { useAudioMonitoring } from "@/contexts/audio-monitoring-context";
import { Radio, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";

export function AudioMonitoringIndicator() {
  const { isCapturing, audioDetected, speakersEnabled, audioLevel } = useAudioMonitoring();

  // Don't show on desktop since status is in sidebar
  // Only show on mobile when monitoring
  if (!isCapturing) return null;

  return (
    <Link href="/live-v2" className="lg:hidden">
      <div
        className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg transition-all hover:shadow-xl ${
          speakersEnabled
            ? "border-[var(--accent-red)]/40 bg-gradient-to-r from-[var(--accent-red)]/20 to-[var(--accent-orange)]/10"
            : "border-[var(--accent-green)]/40 bg-gradient-to-r from-[var(--accent-green)]/20 to-[var(--accent-blue)]/10"
        }`}
      >
        <div className="flex items-center gap-2">
          <Radio
            className={`h-5 w-5 animate-pulse ${
              speakersEnabled ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]"
            }`}
          />
          <div className="text-sm">
            <div
              className={`font-semibold ${
                speakersEnabled ? "text-[var(--accent-red)]" : "text-[var(--accent-green)]"
              }`}
            >
              {speakersEnabled ? "Broadcasting" : "Monitoring"}
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <span className="flex items-center gap-1">
                {speakersEnabled ? (
                  <Volume2 className="h-3 w-3" />
                ) : (
                  <VolumeX className="h-3 w-3" />
                )}
                {audioDetected ? "Audio" : "Silent"}
              </span>
              <span className="font-mono">{audioLevel.toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
