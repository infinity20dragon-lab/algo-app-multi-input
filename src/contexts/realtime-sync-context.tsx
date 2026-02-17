"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/auth-context";
import { realtimeDb } from "@/lib/firebase/config";
import { ref, set, onValue, onDisconnect, serverTimestamp, remove, get } from "firebase/database";
import { usePathname, useRouter } from "next/navigation";

// Cursor position with click animation
// Using percentages instead of pixels to handle different screen sizes
export interface CursorPosition {
  x: number; // Percentage (0-100)
  y: number; // Percentage (0-100)
  userId: string;
  userName: string;
  userRole: string;
  color: string;
  isClicking?: boolean;
  timestamp: number;
}

// User presence (single session per user)
export interface UserPresence {
  uid: string;
  email: string;
  displayName: string;
  role: string;
  currentPage: string;
  isOnline: boolean;
  lastSeen: number;
  controlledBy: string[]; // Array of admin UIDs controlling this user
}

// Session state (all app state that gets synced)
export interface SessionState {
  // Audio monitoring (separated to prevent conflicts)
  audioInputMonitoring: boolean; // Audio input page
  multiInputMonitoring: boolean; // Multi-input routing page
  selectedDevices: string[];
  volume: number;
  targetVolume: number;
  audioThreshold: number;

  // Page navigation
  currentPage: string;

  // Ramp settings
  rampEnabled: boolean;
  rampDuration: number;
  sustainDuration: number;
  disableDelay: number;

  // Input device
  selectedInputDevice: string;
  availableInputDevices: Array<{ deviceId: string; label: string }>; // User's available audio inputs

  // Multi-input device selections (live-v2 page)
  medicalInputDevice: string | null;
  fireInputDevice: string | null;
  allCallInputDevice: string | null;
  medicalEnabled: boolean;
  fireEnabled: boolean;
  allCallEnabled: boolean;

  // Channel selection per input
  medicalChannel: number;
  fireChannel: number;
  allCallChannel: number;

  // Zone settings (live-v2 page)
  zonedPlayback: boolean;
  zoneScheduleEnabled: boolean;

  // Native Audio (Electron + naudiodon)
  useNativeAudio: boolean;
  medicalNativeDeviceId: number | null;
  fireNativeDeviceId: number | null;
  allCallNativeDeviceId: number | null;

  // Day/Night mode
  dayNightMode: boolean;
  dayStartHour: number;
  dayEndHour: number;
  nightRampDuration: number;

  // Logging & Recording
  loggingEnabled: boolean;
  recordingEnabled: boolean;
  playbackEnabled: boolean;
  playbackDelay: number;
  playbackDisableDelay: number;

  // Grace period settings
  tailGuardDuration: number;
  postPlaybackGraceDuration: number;

  // Playback volume ramp settings
  playbackRampDuration: number;
  playbackStartVolume: number;
  playbackMaxVolume: number;
  playbackVolume: number;

  // New SimpleRecorder settings (live-v2 page)
  batchDuration: number; // Batch recording duration (ms)
  silenceTimeout: number; // Silence timeout before stopping (ms)
  hardwareGracePeriod: number; // How long to keep speakers active after session ends (ms)
  playbackRampEnabled: boolean; // Enable per-session volume ramping
  playbackRampStartVolume: number; // Ramp start volume (0-2)
  playbackRampTargetVolume: number; // Ramp target volume (0-2)
  playbackSessionRampDuration: number; // Ramp duration (ms)
  playbackRampScheduleEnabled: boolean; // Enable time-based ramping schedule
  playbackRampStartHour: number; // Start hour for ramping (0-23.5, supports half hours)
  playbackRampEndHour: number; // End hour for ramping (0-23.5, supports half hours)
  emulationMode: boolean; // Hardware emulation mode
  emulationNetworkDelay: number; // Emulation delay (ms)
  saveRecording: boolean; // Save recordings to Firebase

  // Real-time audio state (for display only)
  audioLevel: number;
  playbackAudioLevel: number;
  audioDetected: boolean;
  speakersEnabled: boolean;

  // Scroll position (for cross-screen syncing)
  scrollX: number;
  scrollY: number;

  // Last update info
  lastUpdatedBy: string;
  lastUpdatedAt: number;
}

interface RealtimeSyncContextType {
  // Presence
  onlineUsers: UserPresence[];
  myPresence: UserPresence | null;

  // Control
  isBeingControlled: boolean;
  controllersInfo: { uid: string; name: string; color: string }[];
  startControlling: (targetUserId: string) => Promise<void>;
  stopControlling: (targetUserId: string) => Promise<void>;

  // Viewing as (for admin)
  viewingAsUserId: string | null; // Which user the admin is viewing as
  viewingAsUserEmail: string | null; // Email of the user being viewed
  setViewingAsUser: (userId: string | null) => void;

  // Cursors
  cursors: CursorPosition[];
  updateMyCursor: (x: number, y: number, isClicking?: boolean) => void;

  // Session sync
  syncSessionState: (state: Partial<SessionState>) => Promise<void>;
  sessionState: SessionState | null;
}

const RealtimeSyncContext = createContext<RealtimeSyncContextType | undefined>(undefined);

// Color palette for user cursors
const CURSOR_COLORS = [
  "#4a9eff", // blue
  "#a855f7", // purple
  "#ff5c5c", // red
  "#4aff9f", // green
  "#ffaa4a", // orange
  "#ff69b4", // pink
  "#00d9ff", // cyan
  "#ffd700", // gold
];

export function RealtimeSyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const [myPresence, setMyPresence] = useState<UserPresence | null>(null);
  const [cursors, setCursors] = useState<CursorPosition[]>([]);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [isBeingControlled, setIsBeingControlled] = useState(false);
  const [controllersInfo, setControllersInfo] = useState<{ uid: string; name: string; color: string }[]>([]);
  const [viewingAsUserId, setViewingAsUserId] = useState<string | null>(() => {
    // Restore from sessionStorage on mount
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('adminViewingUserId');
    }
    return null;
  });
  const [viewingAsUserEmail, setViewingAsUserEmail] = useState<string | null>(() => {
    // Restore from sessionStorage on mount
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('adminViewingUserEmail');
    }
    return null;
  });

  const cursorColorRef = useRef<string>(CURSOR_COLORS[0]);
  const isAdminRef = useRef(false);
  const navigationLockRef = useRef(false); // Prevent navigation loops
  const navigationQueueRef = useRef<{ page: string; timestamp: number } | null>(null);
  const navigationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSyncTimestampRef = useRef<number>(0); // Track when we last synced to prevent echo
  const syncDebounceTimerRef = useRef<NodeJS.Timeout | null>(null); // Debounce sync writes

  // Assign color based on user ID
  useEffect(() => {
    if (user) {
      const hash = user.uid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      cursorColorRef.current = CURSOR_COLORS[hash % CURSOR_COLORS.length];
    }
  }, [user]);

  // Set up presence system
  useEffect(() => {
    if (!user) return;

    const presenceRef = ref(realtimeDb, `presence/${user.uid}`);
    const myPresenceData: UserPresence = {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || user.email || "User",
      role: (user as any).role || "user",
      currentPage: pathname || "/",
      isOnline: true,
      lastSeen: Date.now(),
      controlledBy: [],
    };

    isAdminRef.current = myPresenceData.role === "admin";

    // Set presence
    set(presenceRef, myPresenceData);
    setMyPresence(myPresenceData);

    // Set up disconnect handler
    const disconnectRef = onDisconnect(presenceRef);
    disconnectRef.set({
      ...myPresenceData,
      isOnline: false,
      lastSeen: Date.now(),
    });

    // Update page when pathname changes
    const updatePage = async () => {
      await set(ref(realtimeDb, `presence/${user.uid}/currentPage`), pathname);
    };
    updatePage();

    return () => {
      // Clean up on unmount
      set(presenceRef, {
        ...myPresenceData,
        isOnline: false,
        lastSeen: Date.now(),
      });
    };
  }, [user, pathname]);

  // Listen to all users' presence
  useEffect(() => {
    if (!user) return;

    const presenceRef = ref(realtimeDb, "presence");
    const unsubscribe = onValue(presenceRef, (snapshot) => {
      const users: UserPresence[] = [];
      snapshot.forEach((childSnapshot) => {
        const presence = childSnapshot.val() as UserPresence;
        if (presence && presence.uid !== user.uid) {
          users.push(presence);
        }

        // Check if I'm being controlled
        if (presence && presence.uid === user.uid) {
          if (presence.controlledBy && presence.controlledBy.length > 0) {
            setIsBeingControlled(true);

            // Get controller info
            const controllers = presence.controlledBy.map((controllerUid, index) => {
              const controller = users.find(u => u.uid === controllerUid);
              return {
                uid: controllerUid,
                name: controller?.displayName || "Admin",
                color: CURSOR_COLORS[index % CURSOR_COLORS.length],
              };
            });
            setControllersInfo(controllers);
          } else {
            // Not being controlled - clear state
            setIsBeingControlled(false);
            setControllersInfo([]);
          }
        }
      });
      setOnlineUsers(users);
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to session state (for syncing other states like audio settings, NOT for navigation)
  useEffect(() => {
    if (!user) return;

    // If admin is viewing as another user, listen to their session instead
    const targetUserId = viewingAsUserId || user.uid;
    const sessionRef = ref(realtimeDb, `sessions/${targetUserId}`);

    const unsubscribe = onValue(sessionRef, (snapshot) => {
      const state = snapshot.val() as SessionState | null;

      // For admins viewing other users, always apply the state
      // For regular users, only apply if someone else updated it
      if (state && (viewingAsUserId || state.lastUpdatedBy !== user.uid)) {
        setSessionState(state);
        // NOTE: Navigation is handled by polling system below, NOT here!
        // NOTE: Cursor clearing is handled by activeControls listener, NOT here!
      }
    });

    return () => unsubscribe();
  }, [user, viewingAsUserId]);

  // SIMPLE WRITE: Sync current page to Firebase when pathname changes
  // Database is the source of truth - just write and let polling handle reads
  useEffect(() => {
    if (!user) return;
    if (navigationLockRef.current) return; // Skip if we just navigated due to polling

    const syncPage = async () => {
      const timestamp = Date.now();

      // Admin viewing user - write to user's session
      if (isAdminRef.current && viewingAsUserId) {
        console.log('[RealtimeSync] 📝 Admin writing page to DB:', pathname);
        const sessionRef = ref(realtimeDb, `sessions/${viewingAsUserId}`);
        const currentState = (await get(sessionRef)).val() || {};

        await set(sessionRef, {
          ...currentState,
          currentPage: pathname,
          lastUpdatedBy: user.uid,
          lastUpdatedAt: timestamp,
        });
      }
      // Regular user - write to own session
      else if (!viewingAsUserId) {
        console.log('[RealtimeSync] 📝 User writing page to DB:', pathname);
        const sessionRef = ref(realtimeDb, `sessions/${user.uid}`);
        const currentState = (await get(sessionRef)).val() || {};

        await set(sessionRef, {
          ...currentState,
          currentPage: pathname,
          lastUpdatedBy: user.uid,
          lastUpdatedAt: timestamp,
        });
      }
    };

    syncPage();
  }, [user, pathname, viewingAsUserId]);

  // POLLING SYSTEM (IQ 1000): Check database every 2 seconds for correct page
  // Works for BOTH admin viewing user AND user being controlled
  useEffect(() => {
    if (!user) return;

    // Determine target session to poll
    let targetUserId: string | null = null;
    let pollDescription = '';

    if (isAdminRef.current && viewingAsUserId) {
      // Admin viewing user - poll user's session
      targetUserId = viewingAsUserId;
      pollDescription = `Admin polling user ${viewingAsUserId}`;
    } else if (!isAdminRef.current && viewingAsUserId) {
      // This shouldn't happen (non-admin can't view others)
      return;
    } else {
      // Regular user - poll own session to follow admin's navigation
      targetUserId = user.uid;
      pollDescription = `User polling own session`;
    }

    if (!targetUserId) return;

    console.log('[RealtimeSync] 🔄 Starting polling:', pollDescription);

    const pollInterval = setInterval(async () => {
      if (navigationLockRef.current) {
        // Skip polling if we just navigated (prevents rapid re-navigation)
        console.log('[RealtimeSync] ⏭️  Skipping poll - navigation lock active');
        return;
      }

      try {
        const sessionRef = ref(realtimeDb, `sessions/${targetUserId}`);
        const snapshot = await get(sessionRef);
        const state = snapshot.val() as SessionState | null;

        if (state && state.currentPage) {
          const dbPage = state.currentPage;
          const myPage = pathname;

          // Check: Am I on the correct page according to the database?
          if (dbPage !== myPage) {
            console.log('[RealtimeSync] ⚠️ Page mismatch detected!');
            console.log('[RealtimeSync]   DB says:', dbPage);
            console.log('[RealtimeSync]   I am on:', myPage);
            console.log('[RealtimeSync]   → Navigating to:', dbPage);

            // Navigate to the correct page
            navigationLockRef.current = true;
            router.push(dbPage);

            // Release lock after 3 seconds (longer to prevent rapid re-polling)
            setTimeout(() => {
              navigationLockRef.current = false;
              console.log('[RealtimeSync] ✅ Navigation lock released');
            }, 3000);
          } else {
            // Pages match - we're in sync!
            // console.log('[RealtimeSync] ✓ Pages match:', myPage);
          }

          // Always update session state for other fields
          setSessionState(state);
        }
      } catch (error) {
        console.error('[RealtimeSync] Polling error:', error);
      }
    }, 2000); // Poll every 2 seconds

    return () => {
      console.log('[RealtimeSync] Stopping polling');
      clearInterval(pollInterval);
    };
  }, [user, viewingAsUserId, pathname, router]);

  // Track and sync scroll position
  useEffect(() => {
    if (!user) return;

    let scrollTimeout: NodeJS.Timeout | null = null;
    const isApplyingScroll = { current: false };

    const handleScroll = () => {
      if (isApplyingScroll.current) return;

      // Debounce scroll updates
      if (scrollTimeout) clearTimeout(scrollTimeout);

      scrollTimeout = setTimeout(async () => {
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        // Sync scroll position to Firebase
        if (isAdminRef.current && viewingAsUserId) {
          // Admin scrolling - sync to user's session
          const sessionRef = ref(realtimeDb, `sessions/${viewingAsUserId}`);
          const currentState = (await get(sessionRef)).val() || {};

          await set(sessionRef, {
            ...currentState,
            scrollX,
            scrollY,
            lastUpdatedBy: user.uid,
            lastUpdatedAt: Date.now(),
          });
        } else if (!viewingAsUserId) {
          // User scrolling - sync to own session
          const sessionRef = ref(realtimeDb, `sessions/${user.uid}`);
          const currentState = (await get(sessionRef)).val() || {};

          await set(sessionRef, {
            ...currentState,
            scrollX,
            scrollY,
            lastUpdatedBy: user.uid,
            lastUpdatedAt: Date.now(),
          });
        }
      }, 300); // Debounce 300ms
    };

    // Apply scroll from sessionState
    const applyScroll = () => {
      if (!sessionState) return;

      const scrollX = sessionState.scrollX;
      const scrollY = sessionState.scrollY;

      if (scrollX !== undefined && scrollY !== undefined) {
        // Check if we need to scroll
        if (Math.abs(window.scrollX - scrollX) > 10 || Math.abs(window.scrollY - scrollY) > 10) {
          isApplyingScroll.current = true;
          window.scrollTo({
            left: scrollX,
            top: scrollY,
            behavior: 'smooth',
          });
          setTimeout(() => {
            isApplyingScroll.current = false;
          }, 500);
        }
      }
    };

    // Listen for scroll events
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Apply scroll when sessionState changes (for following user/admin)
    applyScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, [user, viewingAsUserId, sessionState]);

  // Sync session state
  const syncSessionState = useCallback(async (state: Partial<SessionState>) => {
    if (!user) return;

    // Filter out undefined values to prevent Firebase errors
    const filteredState: any = {};
    Object.keys(state).forEach(key => {
      const value = (state as any)[key];
      if (value !== undefined) {
        filteredState[key] = value;
      }
    });

    // If admin is viewing a user, sync to that user's session
    if (isAdminRef.current && viewingAsUserId) {
      const sessionRef = ref(realtimeDb, `sessions/${viewingAsUserId}`);
      const currentState = (await get(sessionRef)).val() || {};

      await set(sessionRef, {
        ...currentState,
        ...filteredState,
        currentPage: pathname,
        lastUpdatedBy: user.uid,
        lastUpdatedAt: Date.now(),
      });
      return; // Don't write to admin's own session
    }

    // Regular user or admin not controlling anyone - write to own session
    const sessionRef = ref(realtimeDb, `sessions/${user.uid}`);
    const currentState = (await get(sessionRef)).val() || {};

    await set(sessionRef, {
      ...currentState,
      ...filteredState,
      currentPage: pathname,
      lastUpdatedBy: user.uid,
      lastUpdatedAt: Date.now(),
    });
  }, [user, pathname, viewingAsUserId]);

  // Update cursor position
  const updateMyCursor = useCallback((x: number, y: number, isClicking = false) => {
    if (!user || !myPresence) return;

    // CRITICAL: Check viewingAsUserId at call time, not closure time
    // This prevents queued updates from executing after release
    const currentViewingAsUserId = viewingAsUserId;

    // For admins: update cursor for the user they're viewing
    if (isAdminRef.current && currentViewingAsUserId) {
      // Account for scroll offset
      const scrollAdjustedX = x + window.scrollX;
      const scrollAdjustedY = y + window.scrollY;

      // Convert to percentages of document dimensions (not viewport)
      const docWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
      const docHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);

      const xPercent = (scrollAdjustedX / docWidth) * 100;
      const yPercent = (scrollAdjustedY / docHeight) * 100;

      const cursorRef = ref(realtimeDb, `cursors/${currentViewingAsUserId}/${user.uid}`);

      // Set cursor position (as percentages of document)
      set(cursorRef, {
        x: xPercent,
        y: yPercent,
        userId: user.uid,
        userName: myPresence.displayName,
        userRole: myPresence.role,
        color: cursorColorRef.current,
        isClicking,
        timestamp: Date.now(),
      });

      // Set up auto-cleanup on disconnect
      const disconnectRef = onDisconnect(cursorRef);
      disconnectRef.remove();
    }
    // else: Not viewing anyone - silently skip cursor update (no logging to prevent spam)
  }, [user, myPresence, viewingAsUserId]);

  // Track if there are active controls (source of truth)
  const [hasActiveControls, setHasActiveControls] = useState(false);

  // Listen to ACTIVE CONTROLS (source of truth for showing arrows)
  useEffect(() => {
    if (!user) return;

    console.log('[RealtimeSync] 👀 Listening to activeControls for user:', user.uid);

    const activeControlsRef = ref(realtimeDb, `activeControls/${user.uid}`);
    const unsubscribe = onValue(activeControlsRef, async (snapshot) => {
      const now = Date.now();
      const CONTROL_TIMEOUT = 5000; // 5 seconds - if no update, assume disconnected

      if (!snapshot.exists()) {
        console.log('[RealtimeSync] ✅ No activeControls node - clearing state and Firebase cursors');
        setHasActiveControls(false);
        // Clean up any stale cursor data in Firebase
        const cursorsRef = ref(realtimeDb, `cursors/${user.uid}`);
        await remove(cursorsRef);
        return;
      }

      // Check for stale controls
      let hasLiveControl = false;
      snapshot.forEach((adminSnapshot) => {
        const control = adminSnapshot.val() as {
          adminName: string;
          adminColor: string;
          lastSeen: number;
        };

        // Check if control is still active (admin still alive)
        if (control && now - control.lastSeen < CONTROL_TIMEOUT) {
          hasLiveControl = true;
          console.log('[RealtimeSync] ✓ Active control from:', control.adminName);
        } else {
          // Stale control - remove it
          console.log('[RealtimeSync] 🧹 Removing stale control from:', control?.adminName);
          remove(adminSnapshot.ref);
        }
      });

      setHasActiveControls(hasLiveControl);

      if (!hasLiveControl) {
        console.log('[RealtimeSync] ⚠️ No live controls - clearing Firebase cursors');
        // Clean up cursor data when no active controls
        const cursorsRef = ref(realtimeDb, `cursors/${user.uid}`);
        await remove(cursorsRef);
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to cursors on my screen (ONLY if there are active controls)
  useEffect(() => {
    if (!user) return;

    // CRITICAL: Only listen to cursors if we have active controls
    if (!hasActiveControls) {
      console.log('[RealtimeSync] 🚫 No active controls - clearing cursors and NOT listening');
      setCursors([]);
      return;
    }

    console.log('[RealtimeSync] 👁️ Has active controls - listening to cursor positions');

    const cursorsRef = ref(realtimeDb, `cursors/${user.uid}`);
    const unsubscribe = onValue(cursorsRef, (snapshot) => {
      // Double-check activeControls state
      if (!hasActiveControls) {
        console.log('[RealtimeSync] 🚫 Active controls cleared mid-listen - ignoring cursor data');
        setCursors([]);
        return;
      }

      const cursorsData: CursorPosition[] = [];
      const now = Date.now();
      const CURSOR_TIMEOUT = 10000; // 10 seconds

      if (!snapshot.exists()) {
        setCursors([]);
        return;
      }

      snapshot.forEach((childSnapshot) => {
        const cursor = childSnapshot.val() as CursorPosition;
        if (cursor) {
          // Filter out stale cursors (admin disconnected)
          if (now - cursor.timestamp < CURSOR_TIMEOUT) {
            cursorsData.push(cursor);
          } else {
            // Remove stale cursor
            console.log('[RealtimeSync] Removing stale cursor from', cursor.userName);
            remove(childSnapshot.ref);
          }
        }
      });

      console.log('[RealtimeSync] 📍 Displaying', cursorsData.length, 'cursor(s)');
      setCursors(cursorsData);
    });

    return () => unsubscribe();
  }, [user, hasActiveControls]);

  // Heartbeat: Keep activeControls updated while controlling (admin only)
  useEffect(() => {
    if (!user || !isAdminRef.current || !viewingAsUserId || !myPresence) return;

    console.log('[RealtimeSync] 💓 Starting activeControls heartbeat for user:', viewingAsUserId);

    // Initial write
    const activeControlRef = ref(realtimeDb, `activeControls/${viewingAsUserId}/${user.uid}`);
    set(activeControlRef, {
      adminName: myPresence.displayName,
      adminColor: cursorColorRef.current,
      startedAt: Date.now(),
      lastSeen: Date.now(),
    });

    // Update every 2 seconds to prove we're still alive
    const heartbeat = setInterval(() => {
      set(activeControlRef, {
        adminName: myPresence.displayName,
        adminColor: cursorColorRef.current,
        startedAt: Date.now(), // Keep original start time
        lastSeen: Date.now(), // Update last seen
      });
    }, 2000);

    // Cleanup on disconnect
    const disconnectRef = onDisconnect(activeControlRef);
    disconnectRef.remove();

    return () => {
      console.log('[RealtimeSync] 💔 Stopping activeControls heartbeat');
      clearInterval(heartbeat);
      // Remove activeControls entry when stopping control
      remove(activeControlRef);
    };
  }, [user, viewingAsUserId, myPresence]);

  // Start controlling a user (admin only)
  const startControlling = useCallback(async (targetUserId: string) => {
    if (!user || !isAdminRef.current) return;

    const targetPresenceRef = ref(realtimeDb, `presence/${targetUserId}/controlledBy`);
    const currentControllers = (await get(targetPresenceRef)).val() || [];

    if (!currentControllers.includes(user.uid)) {
      const updatedControllers = [...currentControllers, user.uid];

      // Set up auto-cleanup BEFORE adding ourselves
      // When we disconnect, remove ourselves from the array
      const disconnectRef = onDisconnect(targetPresenceRef);
      if (currentControllers.length === 0) {
        // If we're the only controller, remove the whole array on disconnect
        await disconnectRef.remove();
      } else {
        // If there are other controllers, restore to just them (without us)
        await disconnectRef.set(currentControllers);
      }

      // Now add ourselves to the controlledBy array
      await set(targetPresenceRef, updatedControllers);
    }
  }, [user]);

  // Stop controlling a user (admin only)
  const stopControlling = useCallback(async (targetUserId: string) => {
    if (!user || !isAdminRef.current) return;

    console.log('[RealtimeSync] 🛑 Stopping control of user:', targetUserId);

    // CRITICAL: Clear viewingAsUserId FIRST to stop cursor updates and heartbeat
    if (viewingAsUserId === targetUserId) {
      setViewingAsUserId(null);
      setViewingAsUserEmail(null);

      // Clear from sessionStorage
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('adminViewingUserId');
      }
    }

    // Remove from activeControls (source of truth) - this will trigger user to clear cursors
    const activeControlRef = ref(realtimeDb, `activeControls/${targetUserId}/${user.uid}`);
    await remove(activeControlRef);
    console.log('[RealtimeSync] ✅ Removed from activeControls - user will clear cursor');

    // Also remove cursor from Firebase
    const cursorRef = ref(realtimeDb, `cursors/${targetUserId}/${user.uid}`);
    await remove(cursorRef);
    console.log('[RealtimeSync] ✅ Removed cursor from Firebase');

    // Update controlledBy array
    const targetPresenceRef = ref(realtimeDb, `presence/${targetUserId}/controlledBy`);
    const currentControllers = (await get(targetPresenceRef)).val() || [];
    const updatedControllers = currentControllers.filter((uid: string) => uid !== user.uid);

    if (updatedControllers.length === 0) {
      await remove(targetPresenceRef);
    } else {
      await set(targetPresenceRef, updatedControllers);
    }

    // Cancel the onDisconnect handler since we're manually releasing
    const disconnectRef = onDisconnect(targetPresenceRef);
    await disconnectRef.cancel();

    console.log('[RealtimeSync] Released control of user:', targetUserId);
  }, [user, viewingAsUserId]);

  // Set which user the admin is viewing as
  const setViewingAsUser = useCallback(async (userId: string | null) => {
    if (!isAdminRef.current) return; // Only admins can view as other users

    setViewingAsUserId(userId);

    // Save to sessionStorage for persistence across navigation
    if (typeof window !== 'undefined') {
      if (userId) {
        sessionStorage.setItem('adminViewingUserId', userId);

        // Navigate admin to user's current page
        const sessionRef = ref(realtimeDb, `sessions/${userId}`);
        const snapshot = await get(sessionRef);
        const userSession = snapshot.val() as SessionState | null;

        if (userSession?.currentPage) {
          console.log('[RealtimeSync] Admin starting control - navigating to user\'s current page:', userSession.currentPage);
          router.push(userSession.currentPage);
        } else {
          console.log('[RealtimeSync] User session has no currentPage, staying on current page');
        }
      } else {
        sessionStorage.removeItem('adminViewingUserId');
      }
    }

    // Update email when user changes
    if (userId) {
      const targetUser = onlineUsers.find(u => u.uid === userId);
      if (targetUser?.email) {
        setViewingAsUserEmail(targetUser.email);
        // Save email to sessionStorage too
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('adminViewingUserEmail', targetUser.email);
        }
      }
    } else {
      setViewingAsUserEmail(null);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('adminViewingUserEmail');
      }
    }
  }, [onlineUsers, router]);

  // Update viewing email when online users update (preserve viewing state)
  useEffect(() => {
    if (viewingAsUserId && isAdminRef.current) {
      const targetUser = onlineUsers.find(u => u.uid === viewingAsUserId);
      if (targetUser?.email && targetUser.email !== viewingAsUserEmail) {
        setViewingAsUserEmail(targetUser.email);
        // Update sessionStorage
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('adminViewingUserEmail', targetUser.email);
        }
      }
    }
  }, [onlineUsers, viewingAsUserId, viewingAsUserEmail]);

  // Restore control state on mount/navigation (admin persistence)
  useEffect(() => {
    if (!user || !isAdminRef.current) return;

    const storedUserId = typeof window !== 'undefined' ? sessionStorage.getItem('adminViewingUserId') : null;

    if (storedUserId && !viewingAsUserId) {
      // Admin was controlling someone - restore the state
      console.log('[RealtimeSync] Restoring admin control state for user:', storedUserId);
      setViewingAsUserId(storedUserId);

      // Try to restore email from storage or online users
      const storedEmail = typeof window !== 'undefined' ? sessionStorage.getItem('adminViewingUserEmail') : null;
      if (storedEmail) {
        setViewingAsUserEmail(storedEmail);
      } else {
        const targetUser = onlineUsers.find(u => u.uid === storedUserId);
        if (targetUser?.email) {
          setViewingAsUserEmail(targetUser.email);
        }
      }
    }
  }, [user, onlineUsers, viewingAsUserId]);

  const value: RealtimeSyncContextType = {
    onlineUsers,
    myPresence,
    isBeingControlled,
    controllersInfo,
    startControlling,
    stopControlling,
    viewingAsUserId,
    viewingAsUserEmail,
    setViewingAsUser,
    cursors,
    updateMyCursor,
    syncSessionState,
    sessionState,
  };

  return (
    <RealtimeSyncContext.Provider value={value}>
      {children}
    </RealtimeSyncContext.Provider>
  );
}

export function useRealtimeSync() {
  const context = useContext(RealtimeSyncContext);
  if (!context) {
    throw new Error("useRealtimeSync must be used within RealtimeSyncProvider");
  }
  return context;
}
