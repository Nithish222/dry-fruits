import clsx from "clsx";

export default function Skeleton({ className }) {
  return <div className={clsx("animate-pulse rounded-md bg-warmgray-200 dark:bg-warmgray-800", className)} />;
}
