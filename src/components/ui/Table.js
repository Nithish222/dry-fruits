"use client";
import { createContext, useContext } from "react";
import clsx from "clsx";

// Two skins matching the two table looks already in the app: "compact"
// (admin inventory - no header background, tight padding) and "comfortable"
// (transactions - shaded header, roomier padding, hover rows). Threaded via
// context so Th/Tr/Td don't need the variant passed down at every call site.
const TableVariantContext = createContext("compact");

const theadRowStyles = {
  compact: "border-b border-warmgray-200 dark:border-warmgray-700 text-left text-warmgray-500 dark:text-warmgray-400 font-semibold",
  comfortable: undefined,
};
const theadStyles = {
  compact: undefined,
  comfortable: "text-xs text-warmgray-700 uppercase bg-warmgray-50 dark:bg-warmgray-800 dark:text-warmgray-400 text-left",
};
const rowStyles = {
  compact: "border-b border-warmgray-100 dark:border-warmgray-800/60",
  comfortable: "bg-white dark:bg-warmgray-900 border-b dark:border-warmgray-700 hover:bg-warmgray-50/50 dark:hover:bg-warmgray-800/50",
};
const cellPadding = {
  compact: "py-2 pr-4",
  comfortable: "px-6 py-4",
};
const headPadding = {
  compact: "py-2 pr-4",
  comfortable: "px-6 py-3",
};

// The header sticks relative to the nearest scrolling ancestor - here
// AppShell's <main> - so this works without an extra max-height wrapper.
const theadStickyBg = {
  compact: "bg-white dark:bg-warmgray-900",
  comfortable: "bg-warmgray-50 dark:bg-warmgray-800",
};

export function Table({ variant = "compact", className, children }) {
  return (
    <TableVariantContext.Provider value={variant}>
      <div className="overflow-x-auto">
        <table className={clsx("w-full text-sm", variant === "comfortable" && "text-left text-warmgray-500 dark:text-warmgray-400", className)}>
          {children}
        </table>
      </div>
    </TableVariantContext.Provider>
  );
}

export function THead({ children }) {
  const variant = useContext(TableVariantContext);
  return (
    <thead className={clsx("sticky top-0 z-10", theadStickyBg[variant], theadStyles[variant])}>
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
      className={clsx(cellPadding[variant], variant === "compact" && "text-warmgray-700 dark:text-warmgray-300", align === "right" && "text-right", className)}
      {...rest}
    >
      {children}
    </td>
  );
}
