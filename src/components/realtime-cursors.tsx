"use client";

import { useEffect, useState } from "react";
import { useRealtimeSync } from "@/contexts/realtime-sync-context";
import { MousePointer2 } from "lucide-react";

export function RealtimeCursors() {
  const { cursors, updateMyCursor } = useRealtimeSync();
  const [docSize, setDocSize] = useState({ width: 0, height: 0 });

  // Track document size for cursor positioning (not just viewport)
  useEffect(() => {
    const updateSize = () => {
      setDocSize({
        width: Math.max(document.documentElement.scrollWidth, window.innerWidth),
        height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
      });
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    // Also update when DOM changes (e.g., content loads)
    const observer = new MutationObserver(updateSize);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("resize", updateSize);
      observer.disconnect();
    };
  }, []);

  // Track mouse movement with throttling
  useEffect(() => {
    let rafId: number | null = null;
    let lastUpdateTime = 0;
    const THROTTLE_MS = 50; // Update cursor max every 50ms

    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();

      // Throttle updates to reduce Firebase writes
      if (now - lastUpdateTime < THROTTLE_MS) {
        return;
      }

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        updateMyCursor(e.clientX, e.clientY, false);
        lastUpdateTime = now;
        rafId = null;
      });
    };

    const handleMouseDown = (e: MouseEvent) => {
      updateMyCursor(e.clientX, e.clientY, true);
      // Reset click state after animation
      setTimeout(() => {
        updateMyCursor(e.clientX, e.clientY, false);
      }, 300);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("mousedown", handleMouseDown);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mousedown", handleMouseDown);
    };
  }, [updateMyCursor]);

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999]">
      {cursors.map((cursor) => {
        // Convert percentage of document to absolute pixels
        const xPixels = (cursor.x / 100) * docSize.width;
        const yPixels = (cursor.y / 100) * docSize.height;

        // Subtract scroll offset to get viewport-relative position
        const viewportX = xPixels - window.scrollX;
        const viewportY = yPixels - window.scrollY;

        return (
          <div
            key={cursor.userId}
            className="absolute transition-all duration-100 ease-out"
            style={{
              left: `${viewportX}px`,
              top: `${viewportY}px`,
              transform: "translate(-2px, -2px)",
            }}
          >

          {/* Cursor arrow */}
          <div className="relative">
            <MousePointer2
              className={`transition-transform duration-200 ${
                cursor.isClicking ? "scale-75" : "scale-100"
              }`}
              style={{
                color: cursor.color,
                filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
              }}
              size={24}
            />

            {/* Click animation ripple */}
            {cursor.isClicking && (
              <div
                className="absolute top-0 left-0 w-6 h-6 rounded-full animate-ping"
                style={{
                  backgroundColor: cursor.color,
                  opacity: 0.4,
                }}
              />
            )}

            {/* User name label */}
            <div
              className="absolute top-6 left-6 px-2 py-1 rounded text-xs font-medium whitespace-nowrap shadow-lg"
              style={{
                backgroundColor: cursor.color,
                color: "white",
              }}
            >
              {cursor.userName}
              {cursor.userRole === "admin" && " 👑"}
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}
