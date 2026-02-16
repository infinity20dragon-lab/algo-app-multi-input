import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => {
    return (
      <div className="w-full">
        <select
          className={cn(
            "flex h-10 w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] ring-offset-[var(--bg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            "[&>option]:bg-[var(--bg-secondary)] [&>option]:text-[var(--text-primary)]",
            error && "border-[var(--accent-red)] focus-visible:ring-[var(--accent-red)]",
            className
          )}
          ref={ref}
          {...props}
        >
          {children}
        </select>
        {error && <p className="mt-1 text-sm text-[var(--accent-red)]">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";

export { Select };
