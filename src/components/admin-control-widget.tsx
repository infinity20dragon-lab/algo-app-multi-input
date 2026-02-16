"use client";

import { useState, useEffect } from "react";
import { useRealtimeSync } from "@/contexts/realtime-sync-context";
import { Gamepad2, ChevronRight, ChevronLeft, X, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AdminControlWidget() {
  const { viewingAsUserId, viewingAsUserEmail, onlineUsers, stopControlling, sessionState } = useRealtimeSync();
  const [isExpanded, setIsExpanded] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<number>(0);
  const [isSynced, setIsSynced] = useState(true);

  // Track last sync time
  useEffect(() => {
    if (sessionState?.lastUpdatedAt) {
      setLastSyncTime(sessionState.lastUpdatedAt);
      setIsSynced(true);

      // If no updates for 5 seconds, show as potentially out of sync
      const timeout = setTimeout(() => {
        setIsSynced(false);
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [sessionState?.lastUpdatedAt]);

  // Only show if admin is viewing as another user
  if (!viewingAsUserId || !viewingAsUserEmail) {
    return null;
  }

  // Get the user being controlled
  const controlledUser = onlineUsers.find(u => u.uid === viewingAsUserId);

  return (
    <div className="fixed top-4 right-4 z-[9998] flex items-start gap-2">
      {/* Expand/Collapse button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--accent-purple)]/50 hover:bg-[var(--bg-secondary)] transition-colors shadow-lg"
        title={isExpanded ? "Collapse" : "Expand"}
      >
        {isExpanded ? (
          <ChevronRight className="h-4 w-4 text-[var(--accent-purple)]" />
        ) : (
          <ChevronLeft className="h-4 w-4 text-[var(--accent-purple)]" />
        )}
      </button>

      {/* Status panel */}
      <div
        className={`bg-[var(--bg-card)] border border-[var(--accent-purple)]/50 rounded-lg shadow-lg transition-all duration-300 overflow-hidden ${
          isExpanded ? "opacity-100 max-w-xs" : "opacity-0 max-w-0"
        }`}
      >
        <div className="p-3 space-y-2">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2">
              <Gamepad2 className="h-4 w-4 text-[var(--accent-purple)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                Controlling User
              </span>
            </div>
            {/* Sync indicator */}
            {isSynced ? (
              <div className="flex items-center gap-1 text-[var(--accent-green)]" title="Synced">
                <Check className="h-3 w-3" />
                <span className="text-xs">Synced</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-[var(--accent-orange)]" title="Syncing...">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span className="text-xs">Syncing</span>
              </div>
            )}
          </div>

          {/* Controlled user info */}
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-secondary)]">
            <div className="w-3 h-3 rounded-full bg-[var(--accent-purple)]" />
            <div className="flex-1">
              <p className="text-sm text-[var(--text-primary)] font-medium">
                {controlledUser?.displayName || viewingAsUserEmail}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {viewingAsUserEmail}
              </p>
            </div>
          </div>

          {/* Info text */}
          <p className="text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border-color)]">
            You are viewing and controlling this user's session. Changes will sync to their UI in real-time.
          </p>

          {/* Release button */}
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2 border-[var(--accent-red)]/50 text-[var(--accent-red)] hover:bg-[var(--accent-red)]/10"
            onClick={async () => {
              if (viewingAsUserId) {
                await stopControlling(viewingAsUserId);
              }
            }}
          >
            <X className="mr-2 h-4 w-4" />
            Release Control
          </Button>
        </div>
      </div>
    </div>
  );
}
