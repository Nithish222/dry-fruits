"use client";
import { createContext, useContext } from "react";
import clsx from "clsx";

// Two skins matching the two table looks already in the app: "compact"
// (admin inventory - no header background, tight padding) and "comfortable"
// (transactions - shaded header, roomier padding, hover rows). Threaded via
// context so Th/Tr/Td don't need the variant passed down at every call site.
const TableVariantContext = createContext("compact");

const theadRowStyles = {
  compact: "border-b border-gray-200 dark:border-gray-800 text-left text-gray-500 dark:text-gray-400 font-semibold",
  comfortable: undefined,
};
const theadStyles = {
  compact: undefined,
  comfortable: "text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-400 text-left",
};
const rowStyles = {
  compact: "border-b border-gray-100 dark:border-gray-800/60",
  comfortable: "bg-white dark:bg-gray-900 border-b dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50",
};
const cellPadding = {
  compact: "py-2 pr-4",
  comfortable: "px-6 py-4",
};
const headPadding = {
  compact: "py-2 pr-4",
  comfortable: "px-6 py-3",
};

export function Table({ variant = "compact", className, children }) {
  return (
    <TableVariantContext.Provider value={variant}>
      <div className="overflow-x-auto">
        <table className={clsx("w-full text-sm", variant === "comfortable" && "text-left text-gray-500 dark:text-gray-400", className)}>
          {children}
        </table>
      </div>
    </TableVariantContext.Provider>
  );
}

export function THead({ children }) {
  const variant = useContext(TableVariantContext);
  return (
    <thead className={theadStyles[variant]}>
      <tr className={theadRowStyles[variant]}>{children}</tr>
    </thead>
  );
}

export function Th({ className, align, children }) {
  const variant = useContext(TableVariantContext);
  return (
    <th scope="col" className={clsx(headPadding[variant], "font-semibold", align === "right" && "text-right", className)}>
      {children}
    </th>
  );
}

export function Tr({ className, children, ...rest }) {
  const variant = useContext(TableVariantContext);
  return (
    <tr className={clsx(rowStyles[variant], className)} {...rest}>
      {children}
    </tr>
  );
}

export function Td({ className, align, children, ...rest }) {
  const variant = useContext(TableVariantContext);
  return (
    <td
      className={clsx(cellPadding[variant], variant === "compact" && "text-gray-700 dark:text-gray-300", align === "right" && "text-right", className)}
      {...rest}
    >
      {children}
    </td>
  );
}
