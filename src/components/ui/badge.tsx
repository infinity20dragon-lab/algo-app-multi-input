import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "success" | "warning" | "outline";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default: "bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] border-[var(--accent-blue)]/30",
    secondary: "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-color)]",
    destructive: "bg-[var(--accent-red)]/15 text-[var(--accent-red)] border-[var(--accent-red)]/30",
    success: "bg-[var(--accent-green)]/15 text-[var(--accent-green)] border-[var(--accent-green)]/30",
    warning: "bg-[var(--accent-orange)]/15 text-[var(--accent-orange)] border-[var(--accent-orange)]/30",
    outline: "bg-transparent border-[var(--border-color)] text-[var(--text-secondary)]",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
