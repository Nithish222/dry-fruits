// Semantic status/variant tokens. This app styles dark mode with explicit
// `dark:` utility pairs everywhere (no CSS-variable flipping), so "tokens"
// here means naming the existing color combos that were previously typed by
// hand in each file, not a new theming mechanism. Retheming later means
// editing these maps once instead of grepping the app.
//
// Brand (clay) and status (sage/rust) are deliberately different hues - see
// Visual-Redesign.md #1. "warning" renders identically to "danger" (both
// rust): the redesign collapses the old amber/red split into one
// attention color, e.g. "pending sync" moved from amber to rust.

export const statusStyles = {
  success: "bg-sage-50 dark:bg-sage-950/50 border-sage-200 dark:border-sage-800 text-sage-800 dark:text-sage-400",
  warning: "bg-rust-50 dark:bg-rust-950/50 border-rust-200 dark:border-rust-800 text-rust-800 dark:text-rust-400",
  danger: "bg-rust-50 dark:bg-rust-950/50 border-rust-200 dark:border-rust-800 text-rust-800 dark:text-rust-400",
  info: "bg-blue-100 border-transparent text-blue-800 dark:bg-blue-950/50 dark:border-blue-800 dark:text-blue-400",
  neutral: "bg-warmgray-100 dark:bg-warmgray-800 border-warmgray-200 dark:border-warmgray-700 text-warmgray-600 dark:text-warmgray-400",
};

// Flat pill look (no border) for compact inline badges, e.g. table status cells.
export const softStatusStyles = {
  success: "bg-sage-100 dark:bg-sage-900/40 text-sage-800 dark:text-sage-400",
  warning: "bg-rust-100 dark:bg-rust-900/40 text-rust-800 dark:text-rust-400",
  danger: "bg-rust-100 dark:bg-rust-900/40 text-rust-800 dark:text-rust-400",
  info: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-400",
  neutral: "bg-warmgray-100 dark:bg-warmgray-800 text-warmgray-600 dark:text-warmgray-400",
};

export const dotStyles = {
  success: "bg-sage-500",
  warning: "bg-rust-500",
  danger: "bg-rust-500",
  info: "bg-blue-500",
  neutral: "bg-warmgray-400",
};

export const buttonVariants = {
  primary: "bg-clay-400 text-white hover:bg-clay-600 shadow-sm disabled:bg-warmgray-200 dark:disabled:bg-warmgray-800 disabled:text-warmgray-400 disabled:shadow-none disabled:cursor-not-allowed",
  secondary: "bg-warmgray-100 dark:bg-warmgray-800 text-warmgray-600 dark:text-warmgray-300 hover:bg-warmgray-200 dark:hover:bg-warmgray-700 disabled:opacity-50 disabled:cursor-not-allowed",
  danger: "bg-rust-50 dark:bg-rust-950/50 text-rust-600 dark:text-rust-400 hover:bg-rust-100 dark:hover:bg-rust-900 disabled:opacity-50 disabled:cursor-not-allowed",
  ghost: "bg-transparent text-warmgray-600 dark:text-warmgray-400 hover:bg-warmgray-100 dark:hover:bg-warmgray-800 disabled:opacity-50 disabled:cursor-not-allowed",
};

export const buttonSizes = {
  sm: "px-3 py-1 rounded-md text-xs font-bold",
  md: "py-3 rounded-xl font-semibold text-sm px-4",
  lg: "py-4 rounded-xl font-bold text-lg px-4",
};
