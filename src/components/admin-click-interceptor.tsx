"use client";

import { useEffect } from "react";
import { useRealtimeSync } from "@/contexts/realtime-sync-context";

/**
 * DISABLED: Admin now controls their own UI (a clone of user's state)
 * Clicks are NOT intercepted - admin interacts normally with their UI
 * Changes sync to user's session in Firebase via useSessionSync
 * Cursor is just for visual tracking
 */
export function AdminClickInterceptor() {
  // const { viewingAsUserId } = useRealtimeSync();

  // Admin clicks their own UI now - no need to intercept
  // useEffect(() => {
  //   if (!viewingAsUserId) return;
  //
  //   const handleClick = (e: MouseEvent) => {
  //     if (e.isTrusted) {
  //       console.log('[AdminInterceptor] Intercepting admin click');
  //       e.preventDefault();
  //       e.stopPropagation();
  //       e.stopImmediatePropagation();
  //     }
  //   };
  //
  //   document.addEventListener('click', handleClick, true);
  //   return () => document.removeEventListener('click', handleClick, true);
  // }, [viewingAsUserId]);

  return null; // This component doesn't render anything
}
