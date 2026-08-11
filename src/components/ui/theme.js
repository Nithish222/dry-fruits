// Semantic status/variant tokens. This app styles dark mode with explicit
// `dark:` utility pairs everywhere (no CSS-variable flipping), so "tokens"
// here means naming the existing emerald/amber/red/blue/gray combos that
// were previously typed by hand in each file, not a new theming mechanism.
// Retheming later means editing these maps once instead of grepping the app.

export const statusStyles = {
  success: "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400",
  warning: "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400",
  danger: "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400",
  info: "bg-blue-100 border-transparent text-blue-800 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-400",
  neutral: "bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400",
};

// Flat pill look (no border) for compact inline badges, e.g. table status cells.
export const softStatusStyles = {
  success: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-400",
  warning: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-400",
  danger: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400",
  info: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-400",
  neutral: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
};

export const dotStyles = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-blue-500",
  neutral: "bg-gray-400",
};

export const buttonVariants = {
  primary: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 disabled:shadow-none disabled:cursor-not-allowed",
  secondary: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed",
  danger: "bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed",
  ghost: "bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed",
};

export const buttonSizes = {
  sm: "px-3 py-1 rounded-md text-xs font-bold",
  md: "py-3 rounded-xl font-semibold text-sm px-4",
  lg: "py-4 rounded-xl font-bold text-lg px-4",
};
