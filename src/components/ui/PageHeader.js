import clsx from "clsx";
import Card from "./Card";

export default function PageHeader({ title, subtitle, actions, className }) {
  return (
    <Card as="header" padding="p-6" className={clsx("flex flex-wrap justify-between items-center gap-4 mb-6", className)}>
      <div>
        <h1 className="text-title font-black text-ink-900 dark:text-ink-50 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-warmgray-500 dark:text-warmgray-400 font-medium mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap min-w-0">{actions}</div>}
    </Card>
  );
}
