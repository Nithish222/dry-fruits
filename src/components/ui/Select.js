"use client";
import { useId } from "react";
import clsx from "clsx";

// Mirrors Input.js's structure/styling exactly (see its comment on why width
// and font-weight aren't baked into the size presets).
const sizeStyles = {
  sm: "px-2.5 py-1.5 rounded-md text-sm",
  md: "px-4 py-2.5 rounded-lg",
  lg: "px-5 py-3.5 rounded-xl",
};

export default function Select({ label, id, size = "md", className, labelClassName, children, ...rest }) {
  const generatedId = useId();
  const selectId = id || (label ? generatedId : undefined);

  const select = (
    <select
      id={selectId}
      className={clsx(
        "bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 focus:ring-2 focus:ring-clay-400 focus:border-clay-400 outline-none text-ink-900 dark:text-ink-50 transition-colors",
        sizeStyles[size],
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );

  if (!label) return select;

  return (
    <div>
      <label
        htmlFor={selectId}
        className={clsx("block text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400 mb-2", labelClassName)}
      >
        {label}
      </label>
      {select}
    </div>
  );
}
