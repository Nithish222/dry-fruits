import clsx from "clsx";
import { buttonSizes, buttonVariants } from "./theme";

export default function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      className={clsx(
        "inline-flex items-center justify-center gap-2 transition-all",
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
