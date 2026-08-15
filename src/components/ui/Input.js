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

// Left offset for the prefix glyph and the input's own left padding, per
// size - kept as inline styles (not more px-*/pl-* utility classes) since
// Tailwind's cascade order for two classes touching the same padding-left
// property is generation-order-dependent, not source-order, so a pl-* meant
// to override a size's own px-* can silently lose depending on where each
// lands in the generated stylesheet.
const prefixOffset = {
  sm: { glyphLeft: "0.625rem", inputPadding: "1.5rem" },
  md: { glyphLeft: "1rem", inputPadding: "2rem" },
  lg: { glyphLeft: "1.25rem", inputPadding: "2.5rem" },
};

export default function Input({ label, id, size = "md", className, labelClassName, prefix, style, ...rest }) {
  const generatedId = useId();
  const inputId = id || (label ? generatedId : undefined);

  const inputEl = (
    <input
      id={inputId}
      className={clsx(
        "bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 focus:ring-2 focus:ring-clay-400 focus:border-clay-400 outline-none text-ink-900 dark:text-ink-50 transition-colors",
        sizeStyles[size],
        className
      )}
      style={prefix ? { ...style, paddingLeft: prefixOffset[size].inputPadding } : style}
      {...rest}
    />
  );

  const input = prefix ? (
    <div className="relative">
      <span
        className="pointer-events-none absolute inset-y-0 flex items-center font-bold text-warmgray-400 dark:text-warmgray-500"
        style={{ left: prefixOffset[size].glyphLeft }}
        aria-hidden="true"
      >
        {prefix}
      </span>
      {inputEl}
    </div>
  ) : (
    inputEl
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
