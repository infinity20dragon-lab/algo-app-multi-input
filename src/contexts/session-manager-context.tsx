"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { realtimeDb } from "@/lib/firebase/config";
import { ref, set, onValue, serverTimestamp } from "firebase/database";

// Generate unique session ID for this browser/tab
function generateSessionId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

interface SessionManagerContextType {
  currentSessionId: string;
}

const SessionManagerContext = createContext<SessionManagerContextType | undefined>(undefined);

export function SessionManagerProvider({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const sessionIdRef = useRef<string>(generateSessionId());
  const isLoggingOutRef = useRef(false);

  useEffect(() => {
    if (!user) return;

    const userSessionRef = ref(realtimeDb, `activeSessions/${user.uid}`);
    const mySessionId = sessionIdRef.current;

    // Claim this session as active
    console.log(`[Session] Claiming session for user ${user.email}: ${mySessionId}`);
    set(userSessionRef, {
      sessionId: mySessionId,
      email: user.email,
      timestamp: Date.now(),
    });

    // Listen for session changes
    const unsubscribe = onValue(userSessionRef, (snapshot) => {
      const data = snapshot.val();

      if (!data) return;

      // If session ID changed and it's not mine, someone else logged in
      if (data.sessionId !== mySessionId && !isLoggingOutRef.current) {
        console.log(`[Session] Another device logged in. Logging out this session.`);
        isLoggingOutRef.current = true;

        // Show alert
        alert("You have been logged out because your account was accessed from another device.");

        // Force logout
        signOut();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [user, signOut]);

  const value: SessionManagerContextType = {
    currentSessionId: sessionIdRef.current,
  };

  return (
    <SessionManagerContext.Provider value={value}>
      {children}
    </SessionManagerContext.Provider>
  );
}

export function useSessionManager() {
  const context = useContext(SessionManagerContext);
  if (!context) {
    throw new Error("useSessionManager must be used within SessionManagerProvider");
  }
  return context;
}
