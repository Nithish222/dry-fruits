import clsx from "clsx";

export default function Card({ className, padding = "p-6", as: Component = "div", ...rest }) {
  return (
    <Component
      className={clsx(
        "bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 transition-colors",
        padding,
        className
      )}
      {...rest}
    />
  );
}
