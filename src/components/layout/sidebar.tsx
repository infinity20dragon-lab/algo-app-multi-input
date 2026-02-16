"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Speaker,
  Radio,
  Settings,
  LogOut,
  Menu,
  X,
  Map,
  Activity,
  Network,
  Lightbulb,
  FileAudio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { useAudioMonitoring } from "@/contexts/audio-monitoring-context";
import { useSimpleMonitoring } from "@/contexts/simple-monitoring-context";
import { useAuth } from "@/contexts/auth-context";

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  section?: string;
  adminOnly?: boolean;
}

const baseNavItems: NavItem[] = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard, section: "Overview" },
  { title: "Station Zones", href: "/zones", icon: Map, section: "Overview" },
  { title: "Call Routing", href: "/distribute", icon: Activity, section: "Overview" },
  { title: "Live Monitoring", href: "/live-v2", icon: Radio, section: "Audio" },
  { title: "Multi-Input Routing", href: "/input-routing", icon: Network, section: "Audio" },
  { title: "Output & Speakers", href: "/devices", icon: Speaker, section: "Audio" },
  { title: "PoE Devices", href: "/poe-devices", icon: Lightbulb, section: "Audio" },
  { title: "Activity Log", href: "/activity", icon: Activity, section: "System" },
  { title: "Settings", href: "/settings", icon: Settings, section: "System" },
  { title: "Recordings", href: "/recordings", icon: FileAudio, section: "Admin", adminOnly: true },
];

interface SidebarProps {
  onLogout: () => void;
}

export function Sidebar({ onLogout }: SidebarProps) {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Check BOTH monitoring contexts (old /live and new /live-v2)
  const oldContext = useAudioMonitoring();
  const newContext = useSimpleMonitoring();

  // Merge state from both contexts - whichever is active
  const isCapturing = oldContext.isCapturing || newContext.isMonitoring;
  const audioDetected = oldContext.audioDetected || newContext.audioDetected;
  const speakersEnabled = oldContext.speakersEnabled || newContext.speakersEnabled;

  const { user } = useAuth();

  const isAdmin = (user as any)?.role === "admin";

  // Filter nav items based on user role
  const navItems = useMemo(() => {
    return baseNavItems.filter(item => !item.adminOnly || isAdmin);
  }, [isAdmin]);

  // Group items by section
  const sections = navItems.reduce((acc, item) => {
    const section = item.section || "Other";
    if (!acc[section]) acc[section] = [];
    acc[section].push(item);
    return acc;
  }, {} as Record<string, NavItem[]>);

  return (
    <>
      {/* Mobile menu button */}
      <button
        className="fixed left-4 top-4 z-50 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] p-2 shadow-lg lg:hidden"
        onClick={() => setIsMobileOpen(!isMobileOpen)}
      >
        {isMobileOpen ? (
          <X size={24} className="text-[var(--text-primary)]" />
        ) : (
          <Menu size={24} className="text-[var(--text-primary)]" />
        )}
      </button>

      {/* Overlay for mobile */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/70 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen w-[260px] transform border-r border-[var(--border-color)] bg-[var(--bg-secondary)] transition-transform duration-200 ease-in-out lg:translate-x-0 flex flex-col",
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-[72px] items-center border-b border-[var(--border-color)] px-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-fire flex items-center justify-center">
              <Radio className="h-6 w-6 text-white" />
            </div>
            <span className="text-xl font-bold text-[var(--text-primary)]">
              Algo<span className="text-[var(--accent-orange)]">Sound</span>
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {Object.entries(sections).map(([section, items]) => (
            <div key={section}>
              <div className="px-3 py-2 mt-2 first:mt-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {section}
                </span>
              </div>
              {items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setIsMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-all mb-1",
                      isActive
                        ? "bg-gradient-to-r from-[var(--accent-blue)]/15 to-[var(--accent-blue)]/5 text-[var(--accent-blue)] border border-[var(--accent-blue)]/30"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <item.icon className="h-5 w-5" strokeWidth={1.5} />
                    <span>{item.title}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Alert Status */}
        <div className="mx-3 mb-4">
          <div
            className={cn(
              "rounded-xl border p-4 transition-all",
              isCapturing && speakersEnabled
                ? "bg-gradient-to-r from-[var(--accent-red)]/15 to-[var(--accent-orange)]/10 border-[var(--accent-red)]/40 animate-pulse-alert"
                : "bg-[var(--bg-tertiary)] border-[var(--border-color)]"
            )}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              System Status
            </div>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-2 h-2 rounded-full",
                  !isCapturing
                    ? "bg-[var(--text-muted)]"
                    : speakersEnabled
                    ? "bg-[var(--accent-red)] animate-blink"
                    : "bg-[var(--accent-green)]"
                )}
              />
              <span
                className={cn(
                  "text-sm font-semibold",
                  !isCapturing
                    ? "text-[var(--text-muted)]"
                    : speakersEnabled
                    ? "text-[var(--accent-red)]"
                    : "text-[var(--accent-green)]"
                )}
              >
                {!isCapturing
                  ? "Offline"
                  : speakersEnabled
                  ? "Broadcasting"
                  : "Standby"}
              </span>
            </div>
            {isCapturing && (
              <div className="mt-2 text-xs text-[var(--text-muted)]">
                Audio: {audioDetected ? "Detected" : "Silent"}
              </div>
            )}
          </div>
        </div>

        {/* User Section */}
        <div className="border-t border-[var(--border-color)] p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg gradient-medical flex items-center justify-center text-white font-semibold text-sm">
              {user?.email?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {user?.email?.split("@")[0] || "User"}
              </div>
              <div className="text-xs text-[var(--text-muted)]">{isAdmin ? "Administrator" : "User"}</div>
            </div>
            <button
              onClick={onLogout}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
