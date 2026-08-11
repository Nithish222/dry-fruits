import clsx from "clsx";
import Card from "./Card";

export default function PageHeader({ title, subtitle, actions, className }) {
  return (
    <Card as="header" padding="p-6" className={clsx("flex justify-between items-center mb-6", className)}>
      <div>
        <h1 className="text-3xl font-black text-gray-900 dark:text-white tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </Card>
  );
}
