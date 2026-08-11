"use client";
import { useId } from "react";
import clsx from "clsx";

// Width and font-weight are intentionally not part of the base styles -
// callers set those via className ("w-full", "font-bold", etc). Baking
// either into a preset would fight with a caller override: both classes
// land in the generated stylesheet and Tailwind's cascade order (not
// source order) decides which wins, so mixing two utilities for the same
// CSS property on one element is unreliable.
const sizeStyles = {
  sm: "px-2.5 py-1.5 rounded-md text-sm",
  md: "px-4 py-2.5 rounded-lg",
  lg: "px-5 py-3.5 rounded-xl",
};

export default function Input({ label, id, size = "md", className, labelClassName, ...rest }) {
  const generatedId = useId();
  const inputId = id || (label ? generatedId : undefined);

  const input = (
    <input
      id={inputId}
      className={clsx(
        "bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 focus:ring-2 focus:ring-clay-400 focus:border-clay-400 outline-none text-ink-900 dark:text-ink-50 transition-colors",
        sizeStyles[size],
        className
      )}
      {...rest}
    />
  );

  if (!label) return input;

  return (
    <div>
      <label
        htmlFor={inputId}
        className={clsx("block text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400 mb-2", labelClassName)}
      >
        {label}
      </label>
      {input}
    </div>
  );
}
