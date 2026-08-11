import clsx from "clsx";
import { statusStyles, softStatusStyles, dotStyles } from "./theme";

const sizeStyles = {
  lg: "px-4 py-2 rounded-xl border shadow-sm text-sm font-bold gap-2",
  sm: "px-2.5 py-1 rounded-full text-xs font-semibold gap-1.5",
};

export default function Badge({ variant = "neutral", size = "lg", dot = false, pulse = false, className, children, ...rest }) {
  const colorStyles = size === "sm" ? softStatusStyles[variant] : statusStyles[variant];
  return (
    <span className={clsx("inline-flex items-center", sizeStyles[size], colorStyles, className)} {...rest}>
      {dot && <span className={clsx("w-2.5 h-2.5 rounded-full flex-shrink-0", dotStyles[variant], pulse && "animate-pulse")} />}
      {children}
    </span>
  );
}
