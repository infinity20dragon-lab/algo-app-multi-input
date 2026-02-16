"use client";

import { useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRealtimeSync } from "@/contexts/realtime-sync-context";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import {
  Gamepad2,
  Users,
  Monitor,
  Play,
  Square,
  Eye,
  MapPin,
  Clock,
} from "lucide-react";

export default function AdminControlPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { onlineUsers, myPresence, startControlling, stopControlling, setViewingAsUser } = useRealtimeSync();

  // Derive controlling state from actual presence data (not local state)
  const getControllingUsers = (): Set<string> => {
    const controlling = new Set<string>();
    onlineUsers.forEach((u) => {
      if (u.controlledBy?.includes(user?.uid || "")) {
        controlling.add(u.uid);
      }
    });
    return controlling;
  };

  const controllingUsers = getControllingUsers();

  // Redirect if not admin
  useEffect(() => {
    if (user && (user as any).role !== "admin") {
      router.push("/");
    }
  }, [user, router]);

  if (!user || (user as any).role !== "admin") {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <p className="text-[var(--text-muted)]">Access denied. Admin only.</p>
        </div>
      </AppLayout>
    );
  }

  const handleToggleControl = async (userId: string) => {
    if (controllingUsers.has(userId)) {
      // Stop controlling
      await stopControlling(userId);
    } else {
      // Start controlling
      await startControlling(userId);
      // Set viewing as this user so admin sees their devices
      setViewingAsUser(userId);
    }
  };

  const handleNavigateTo = (userId: string, page: string) => {
    // Navigate to user's current page
    router.push(page);
  };

  // Separate online and offline users
  const currentlyOnline = onlineUsers.filter(u => u.isOnline);
  const recentlyOffline = onlineUsers.filter(u => !u.isOnline);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--accent-purple)]/15">
                <Gamepad2 className="h-6 w-6 text-[var(--accent-purple)]" />
              </div>
              Control Center
            </h1>
            <p className="text-[var(--text-secondary)] text-sm mt-1">
              Monitor and control active user sessions
            </p>
          </div>
          <Badge variant="secondary" className="px-3 py-1">
            {currentlyOnline.length} online
          </Badge>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-green)]/15">
                  <Users className="h-5 w-5 text-[var(--accent-green)]" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">
                    {currentlyOnline.length}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">Online Users</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-blue)]/15">
                  <Monitor className="h-5 w-5 text-[var(--accent-blue)]" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">
                    {controllingUsers.size}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">Controlling</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-orange)]/15">
                  <Eye className="h-5 w-5 text-[var(--accent-orange)]" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-[var(--text-primary)]">
                    {myPresence?.displayName || "You"}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">Your Session</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Online Users */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Online Users ({currentlyOnline.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {currentlyOnline.length === 0 ? (
              <div className="text-center py-8">
                <Users className="mx-auto h-12 w-12 text-[var(--text-muted)] mb-3" />
                <p className="text-[var(--text-muted)]">No users online</p>
              </div>
            ) : (
              <div className="space-y-3">
                {currentlyOnline.map((userPresence) => {
                  const isControlling = controllingUsers.has(userPresence.uid);
                  const otherControllersCount = userPresence.controlledBy?.filter(
                    (uid) => uid !== user.uid
                  ).length || 0;

                  return (
                    <div
                      key={userPresence.uid}
                      className={`p-4 rounded-xl border transition-all ${
                        isControlling
                          ? "bg-[var(--accent-blue)]/10 border-[var(--accent-blue)]/50"
                          : "bg-[var(--bg-secondary)] border-[var(--border-color)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        {/* User Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2 h-2 rounded-full bg-[var(--accent-green)] animate-pulse" />
                            <h3 className="font-semibold text-[var(--text-primary)]">
                              {userPresence.displayName}
                            </h3>
                            <Badge variant="secondary" className="text-xs">
                              {userPresence.role}
                            </Badge>
                          </div>

                          <div className="space-y-1 text-sm text-[var(--text-muted)]">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-3 w-3" />
                              <span className="truncate">{userPresence.currentPage}</span>
                              <button
                                onClick={() => handleNavigateTo(userPresence.uid, userPresence.currentPage)}
                                className="text-[var(--accent-blue)] hover:underline text-xs"
                              >
                                Visit
                              </button>
                            </div>
                            <div className="flex items-center gap-2">
                              <Clock className="h-3 w-3" />
                              <span>
                                Online for {Math.floor((Date.now() - userPresence.lastSeen) / 60000)}m
                              </span>
                            </div>
                          </div>

                          {/* Control Status */}
                          {isControlling && (
                            <div className="mt-2 flex items-center gap-2">
                              <Play className="h-3 w-3 text-[var(--accent-blue)]" />
                              <span className="text-xs text-[var(--accent-blue)] font-medium">
                                You are controlling this session
                              </span>
                            </div>
                          )}

                          {otherControllersCount > 0 && (
                            <div className="mt-2 flex items-center gap-2">
                              <Eye className="h-3 w-3 text-[var(--accent-orange)]" />
                              <span className="text-xs text-[var(--accent-orange)]">
                                {otherControllersCount} other admin{otherControllersCount > 1 ? 's' : ''} controlling
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Control Button */}
                        <Button
                          variant={isControlling ? "destructive" : "outline"}
                          size="sm"
                          onClick={() => handleToggleControl(userPresence.uid)}
                          className={
                            isControlling
                              ? ""
                              : "border-[var(--accent-blue)] text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10"
                          }
                        >
                          {isControlling ? (
                            <>
                              <Square className="mr-2 h-4 w-4" />
                              Release
                            </>
                          ) : (
                            <>
                              <Play className="mr-2 h-4 w-4" />
                              Control
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recently Offline */}
        {recentlyOffline.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[var(--text-muted)]">
                <Users className="h-5 w-5" />
                Recently Offline ({recentlyOffline.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {recentlyOffline.slice(0, 5).map((userPresence) => (
                  <div
                    key={userPresence.uid}
                    className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] opacity-60"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
                      <span className="text-sm text-[var(--text-primary)]">
                        {userPresence.displayName}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        Last seen {Math.floor((Date.now() - userPresence.lastSeen) / 60000)}m ago
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
