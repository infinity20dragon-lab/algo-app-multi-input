"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  showValue?: boolean;
}

const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, showValue = false, value, ...props }, ref) => {
    return (
      <div className="flex items-center gap-3">
        <input
          type="range"
          className={cn(
            "h-2 w-full cursor-pointer appearance-none rounded-lg bg-[var(--bg-tertiary)] accent-[var(--accent-blue)]",
            "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent-blue)] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-lg",
            "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--accent-blue)] [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer",
            className
          )}
          ref={ref}
          value={value}
          {...props}
        />
        {showValue && (
          <span className="w-12 text-right text-sm font-semibold font-mono text-[var(--accent-blue)]">
            {value}%
          </span>
        )}
      </div>
    );
  }
);

Slider.displayName = "Slider";

export { Slider };
