"use client";

import { useAuth } from "@/contexts/auth-context";
import { LoginForm } from "@/components/auth/login-form";
import { Sidebar } from "@/components/layout/sidebar";
import { RealtimeCursors } from "@/components/realtime-cursors";
import { ControlStatusWidget } from "@/components/control-status-widget";
import { AdminControlWidget } from "@/components/admin-control-widget";
import { AdminCursorSimulator } from "@/components/admin-cursor-simulator";
import { AdminClickInterceptor } from "@/components/admin-click-interceptor";
import { type ReactNode } from "react";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)] border-t-transparent" />
          <span className="text-sm text-[var(--text-secondary)]">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginForm />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <Sidebar onLogout={signOut} />
      <main className="lg:ml-[260px]">
        <div className="p-4 pt-20 lg:p-8 lg:pt-8">{children}</div>
      </main>

      {/* Real-time features */}
      <RealtimeCursors />
      <ControlStatusWidget />
      <AdminControlWidget />
      <AdminCursorSimulator />
      <AdminClickInterceptor />
    </div>
  );
}
