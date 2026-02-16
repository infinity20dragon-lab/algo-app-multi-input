"use client";

import { useEffect, useRef } from "react";
import { useRealtimeSync } from "@/contexts/realtime-sync-context";

/**
 * Simulates admin cursor interactions on the user's screen
 * When admin clicks, this component finds the element at that position and clicks it
 * When admin hovers, this triggers hover effects
 */
export function AdminCursorSimulator() {
  const { cursors } = useRealtimeSync();
  const hoveredElementsRef = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    cursors.forEach((cursor) => {
      // Convert percentage of document to absolute pixels
      const docWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
      const docHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);

      const xPixels = (cursor.x / 100) * docWidth;
      const yPixels = (cursor.y / 100) * docHeight;

      // Convert to viewport-relative coordinates
      const viewportX = xPixels - window.scrollX;
      const viewportY = yPixels - window.scrollY;

      // Find element at cursor position (viewport coordinates)
      const element = document.elementFromPoint(viewportX, viewportY) as HTMLElement;

      if (!element) return;

      // DISABLED: Admin clicks their own UI now, not user's UI
      // Cursor is just for visual tracking
      // if (cursor.isClicking) {
      //   console.log('[AdminCursor] Admin clicked at', cursor.x + '%,', cursor.y + '% (', xPixels, ',', yPixels, 'px) element:', element.tagName);
      //   element.click();
      // }

      // Handle hover - add hover class to element
      const previousElement = hoveredElementsRef.current.get(cursor.userId);

      if (element !== previousElement) {
        // Remove hover from previous element
        if (previousElement) {
          previousElement.classList.remove('admin-cursor-hover');
          previousElement.style.removeProperty('outline');
        }

        // Add hover to new element (only for interactive elements)
        if (
          element.tagName === 'BUTTON' ||
          element.tagName === 'A' ||
          element.tagName === 'INPUT' ||
          element.tagName === 'SELECT' ||
          element.tagName === 'TEXTAREA' ||
          element.getAttribute('role') === 'button' ||
          element.onclick !== null
        ) {
          element.classList.add('admin-cursor-hover');
          // Add visual indicator that admin is hovering
          element.style.outline = `2px solid ${cursor.color}`;
          element.style.outlineOffset = '2px';
        }

        hoveredElementsRef.current.set(cursor.userId, element);
      }
    });

    // Clean up hover effects for cursors that no longer exist
    const currentCursorIds = new Set(cursors.map(c => c.userId));
    hoveredElementsRef.current.forEach((element, userId) => {
      if (!currentCursorIds.has(userId)) {
        element.classList.remove('admin-cursor-hover');
        element.style.removeProperty('outline');
        hoveredElementsRef.current.delete(userId);
      }
    });
  }, [cursors]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      hoveredElementsRef.current.forEach((element) => {
        element.classList.remove('admin-cursor-hover');
        element.style.removeProperty('outline');
      });
      hoveredElementsRef.current.clear();
    };
  }, []);

  return null; // This component doesn't render anything
}
