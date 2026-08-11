import clsx from "clsx";

export default function Card({ className, padding = "p-6", as: Component = "div", ...rest }) {
  return (
    <Component
      className={clsx(
        "bg-white dark:bg-warmgray-900 rounded-2xl shadow-sm border border-warmgray-200 dark:border-warmgray-700 transition-colors",
        padding,
        className
      )}
      {...rest}
    />
  );
}
