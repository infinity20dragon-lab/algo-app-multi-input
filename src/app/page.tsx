"use client";

import { useEffect, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Speaker,
  Music,
  Radio,
  Activity,
  Map,
  Mic,
  AlertTriangle,
  Flame,
  Heart,
  Bell,
  ArrowRight,
  Zap
} from "lucide-react";
import Link from "next/link";
import { useAudioMonitoring } from "@/contexts/audio-monitoring-context";
import { useAuth } from "@/contexts/auth-context";
import { getDevices, getAudioFiles, getZones } from "@/lib/firebase/firestore";
import type { AlgoDevice, AudioFile, Zone } from "@/lib/algo/types";

export default function DashboardPage() {
  const { user } = useAuth();
  const { isCapturing, speakersEnabled, audioDetected, logs } = useAudioMonitoring();
  const [devices, setDevices] = useState<AlgoDevice[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.email) return;

    const loadData = async () => {
      try {
        const userEmail = user.email || "";
        const [devicesData, audioData, zonesData] = await Promise.all([
          getDevices(userEmail),
          getAudioFiles(userEmail),
          getZones(userEmail),
        ]);
        setDevices(devicesData);
        setAudioFiles(audioData);
        setZones(zonesData);
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [user?.email]); // Only re-run if email changes (more stable)

  // Get recent logs (last 5)
  const recentLogs = logs.slice(-5).reverse();

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Dashboard</h1>
            <p className="text-[var(--text-secondary)] text-sm">
              Fire Station Alerting System Overview
            </p>
          </div>
          {isCapturing && (
            <Badge
              variant={speakersEnabled ? "destructive" : "success"}
              className="px-4 py-1.5"
            >
              <div className={`w-2 h-2 rounded-full mr-2 ${speakersEnabled ? "animate-blink" : ""}`}
                style={{ backgroundColor: speakersEnabled ? "white" : "white" }}
              />
              {speakersEnabled ? "Broadcasting" : "Monitoring Active"}
            </Badge>
          )}
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--text-muted)]">Devices</p>
                  <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">
                    {loading ? "-" : devices.length}
                  </p>
                  <p className="text-xs text-[var(--accent-green)] mt-1">
                    {devices.length} online
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-[var(--accent-blue)]/15">
                  <Speaker className="h-6 w-6 text-[var(--accent-blue)]" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--text-muted)]">Audio Files</p>
                  <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">
                    {loading ? "-" : audioFiles.length}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Ready to distribute</p>
                </div>
                <div className="p-3 rounded-xl bg-[var(--accent-green)]/15">
                  <Music className="h-6 w-6 text-[var(--accent-green)]" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--text-muted)]">Active Zones</p>
                  <p className="text-3xl font-bold text-[var(--text-primary)] mt-1">
                    {loading ? "-" : zones.length}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Configured</p>
                </div>
                <div className="p-3 rounded-xl bg-[var(--accent-purple)]/15">
                  <Map className="h-6 w-6 text-[var(--accent-purple)]" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--text-muted)]">System</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className={`w-2 h-2 rounded-full ${isCapturing ? "bg-[var(--accent-green)]" : "bg-[var(--text-muted)]"}`} />
                    <span className="text-lg font-semibold text-[var(--text-primary)]">
                      {isCapturing ? "Active" : "Standby"}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {isCapturing ? "Monitoring audio" : "System ready"}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-[var(--accent-orange)]/15">
                  <Activity className="h-6 w-6 text-[var(--accent-orange)]" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Test Alerts */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg gradient-fire">
                  <AlertTriangle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle>Test Alerts</CardTitle>
                  <CardDescription>Trigger test tones</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <button className="w-full flex items-center gap-3 p-4 rounded-xl border border-[var(--border-color)] hover:border-[var(--accent-red)]/50 hover:bg-[var(--accent-red)]/5 transition-all group">
                <div className="p-2 rounded-lg gradient-fire">
                  <Flame className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-[var(--text-primary)]">Fire Alert</p>
                  <p className="text-xs text-[var(--text-muted)]">All zones</p>
                </div>
                <Zap className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--accent-red)] transition-colors" />
              </button>

              <button className="w-full flex items-center gap-3 p-4 rounded-xl border border-[var(--border-color)] hover:border-[var(--accent-blue)]/50 hover:bg-[var(--accent-blue)]/5 transition-all group">
                <div className="p-2 rounded-lg gradient-medical">
                  <Heart className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-[var(--text-primary)]">Medical Alert</p>
                  <p className="text-xs text-[var(--text-muted)]">Selected zones</p>
                </div>
                <Zap className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--accent-blue)] transition-colors" />
              </button>

              <button className="w-full flex items-center gap-3 p-4 rounded-xl border border-[var(--border-color)] hover:border-[var(--accent-purple)]/50 hover:bg-[var(--accent-purple)]/5 transition-all group">
                <div className="p-2 rounded-lg gradient-all">
                  <Bell className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-[var(--text-primary)]">All-Call</p>
                  <p className="text-xs text-[var(--text-muted)]">All zones</p>
                </div>
                <Zap className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--accent-purple)] transition-colors" />
              </button>
            </CardContent>
          </Card>

          {/* Floor Plan Preview */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[var(--accent-purple)]/15">
                    <Map className="h-5 w-5 text-[var(--accent-purple)]" />
                  </div>
                  <div>
                    <CardTitle>Station Zones</CardTitle>
                    <CardDescription>Floor plan overview</CardDescription>
                  </div>
                </div>
                <Link
                  href="/zones"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border-color)] bg-transparent px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)]"
                >
                  View All <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {/* Simplified Floor Plan */}
              {zones.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Map className="h-8 w-8 text-[var(--text-muted)] mb-3" />
                  <p className="text-[var(--text-muted)]">No zones configured</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    <Link href="/zones" className="text-[var(--accent-blue)] hover:underline">
                      Create zones
                    </Link>
                    {" "}to organize your devices
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3 min-h-[200px]">
                  {zones.slice(0, 6).map((zone) => {
                    const devicesInZone = devices.filter(d => d.zone === zone.id);
                    // Convert hex color to rgba with opacity
                    const hexToRgba = (hex: string, opacity: number) => {
                      const r = parseInt(hex.slice(1, 3), 16);
                      const g = parseInt(hex.slice(3, 5), 16);
                      const b = parseInt(hex.slice(5, 7), 16);
                      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
                    };

                    return (
                      <div
                        key={zone.id}
                        className="rounded-xl p-4 flex flex-col items-center justify-center text-center"
                        style={{
                          backgroundColor: hexToRgba(zone.color, 0.2),
                          border: `1px solid ${hexToRgba(zone.color, 0.4)}`,
                        }}
                      >
                        <span className="text-xs font-semibold" style={{ color: zone.color }}>
                          {zone.name.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)] mt-1">
                          {devicesInZone.length} speaker{devicesInZone.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions & Activity */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-blue)]/15">
                  <Zap className="h-5 w-5 text-[var(--accent-blue)]" />
                </div>
                <CardTitle>Quick Actions</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link
                href="/live-v2"
                className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] p-4 transition-all hover:border-[var(--accent-blue)]/50 hover:bg-[var(--bg-tertiary)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-blue)]/15">
                  <Mic className="h-5 w-5 text-[var(--accent-blue)]" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-[var(--text-primary)]">Live Monitoring</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    Monitor and broadcast audio live
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
              </Link>
              <Link
                href="/devices"
                className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] p-4 transition-all hover:border-[var(--accent-green)]/50 hover:bg-[var(--bg-tertiary)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-green)]/15">
                  <Speaker className="h-5 w-5 text-[var(--accent-green)]" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-[var(--text-primary)]">Manage Devices</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    Add and configure speakers
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
              </Link>
              <Link
                href="/distribute"
                className="flex items-center gap-3 rounded-xl border border-[var(--border-color)] p-4 transition-all hover:border-[var(--accent-purple)]/50 hover:bg-[var(--bg-tertiary)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-purple)]/15">
                  <Radio className="h-5 w-5 text-[var(--accent-purple)]" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-[var(--text-primary)]">Call Routing</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    Configure audio routing
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--text-muted)]" />
              </Link>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[var(--accent-orange)]/15">
                  <Activity className="h-5 w-5 text-[var(--accent-orange)]" />
                </div>
                <CardTitle>Recent Activity</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {recentLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Activity className="h-8 w-8 text-[var(--text-muted)] mb-3" />
                  <p className="text-[var(--text-muted)]">No recent activity</p>
                  <p className="text-sm text-[var(--text-muted)]">
                    Events will appear here
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentLogs.map((log, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]"
                    >
                      <div className={`w-2 h-2 rounded-full ${
                        log.type === "speakers_enabled" ? "bg-[var(--accent-green)]" :
                        log.type === "speakers_disabled" ? "bg-[var(--text-muted)]" :
                        log.type === "audio_detected" ? "bg-[var(--accent-orange)]" :
                        "bg-[var(--accent-blue)]"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[var(--text-primary)] truncate">{log.message}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
