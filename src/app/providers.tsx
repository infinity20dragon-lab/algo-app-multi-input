"use client";

import { AuthProvider } from "@/contexts/auth-context";
import { AudioMonitoringProvider } from "@/contexts/audio-monitoring-context";
import { SimpleMonitoringProvider } from "@/contexts/simple-monitoring-context";
import { RealtimeSyncProvider } from "@/contexts/realtime-sync-context";
import { SessionManagerProvider } from "@/contexts/session-manager-context";
import { type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SessionManagerProvider>
        <RealtimeSyncProvider>
          <AudioMonitoringProvider>
            <SimpleMonitoringProvider>
              {children}
            </SimpleMonitoringProvider>
          </AudioMonitoringProvider>
        </RealtimeSyncProvider>
      </SessionManagerProvider>
    </AuthProvider>
  );
}
