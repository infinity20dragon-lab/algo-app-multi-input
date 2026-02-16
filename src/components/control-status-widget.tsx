"use client";

import { useState } from "react";
import { useRealtimeSync } from "@/contexts/realtime-sync-context";
import { Gamepad2, ChevronRight, ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ControlStatusWidget() {
  const { isBeingControlled, controllersInfo } = useRealtimeSync();
  const [isExpanded, setIsExpanded] = useState(true);

  if (!isBeingControlled || controllersInfo.length === 0) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-[9998] flex items-start gap-2">
      {/* Expand/Collapse button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--accent-blue)]/50 hover:bg-[var(--bg-secondary)] transition-colors shadow-lg"
        title={isExpanded ? "Collapse" : "Expand"}
      >
        {isExpanded ? (
          <ChevronRight className="h-4 w-4 text-[var(--accent-blue)]" />
        ) : (
          <ChevronLeft className="h-4 w-4 text-[var(--accent-blue)]" />
        )}
      </button>

      {/* Status panel */}
      <div
        className={`bg-[var(--bg-card)] border border-[var(--accent-blue)]/50 rounded-lg shadow-lg transition-all duration-300 overflow-hidden ${
          isExpanded ? "opacity-100 max-w-xs" : "opacity-0 max-w-0"
        }`}
      >
        <div className="p-3 space-y-2">
          {/* Header */}
          <div className="flex items-center gap-2 pb-2 border-b border-[var(--border-color)]">
            <Gamepad2 className="h-4 w-4 text-[var(--accent-blue)]" />
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              Being Controlled
            </span>
          </div>

          {/* Controllers list */}
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {controllersInfo.map((controller) => (
              <div
                key={controller.uid}
                className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-secondary)]"
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: controller.color }}
                />
                <span className="text-sm text-[var(--text-primary)] flex-1">
                  {controller.name}
                </span>
                <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded">
                  Admin
                </span>
              </div>
            ))}
          </div>

          {/* Info text */}
          <p className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border-color)]">
            {controllersInfo.length === 1 ? "An admin" : `${controllersInfo.length} admins`} {controllersInfo.length === 1 ? "is" : "are"} viewing and controlling your session
          </p>
        </div>
      </div>
    </div>
  );
}
