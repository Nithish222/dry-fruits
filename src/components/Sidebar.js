"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { Menu, ShoppingCart, Tag, Receipt, Sun, Moon, LogOut, Leaf, LayoutDashboard, Wallet, BookOpen, PackageCheck, History } from "@/components/ui/icons";

const NAV_ITEMS = [
  { name: "Register", path: "/", icon: ShoppingCart },
  { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { name: "Price Setup", path: "/admin", icon: Tag },
  { name: "Transactions", path: "/transactions", icon: Receipt },
  { name: "Purchases", path: "/purchases/receive", icon: PackageCheck },
  { name: "Purchase History", path: "/purchases", icon: History },
  { name: "Tally", path: "/tally", icon: Wallet },
  { name: "Accounting", path: "/accounts", icon: BookOpen },
];

export default function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { user } = useAuth();
  const { darkMode, toggleTheme } = useTheme();
  const pathname = usePathname();

  return (
    <aside
      className={`bg-white dark:bg-warmgray-900 text-ink-900 dark:text-ink-50 flex flex-col transition-all duration-300 z-50 border-r border-warmgray-200 dark:border-warmgray-700 h-screen flex-shrink-0 shadow-sm
      ${isExpanded ? "w-64" : "w-20"}`}
    >
      {/* Brand / Toggle Area */}
      <div className={`h-20 flex items-center border-b border-warmgray-100 dark:border-warmgray-700 ${isExpanded ? "justify-between px-4" : "justify-center px-2"}`}>
        {isExpanded && (
          <div className="flex items-center gap-2.5 pl-1">
            <div className="w-9 h-9 rounded-xl bg-clay-400 flex items-center justify-center flex-shrink-0 shadow-sm shadow-clay-400/30">
              <Leaf className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-lg tracking-wide text-ink-900 dark:text-ink-50 leading-none">POS System</span>
          </div>
        )}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
          className="p-2.5 rounded-xl text-warmgray-500 dark:text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-warmgray-100 dark:hover:bg-warmgray-800 transition-colors flex-shrink-0"
        >
          <Menu className="w-6 h-6" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 mt-6 space-y-1.5 px-3">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.path;
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`group flex items-center gap-4 p-3.5 rounded-xl transition-all font-semibold border-l-[3px] ${
                isActive
                  ? "bg-clay-50 dark:bg-clay-950/40 border-clay-600 text-clay-800 dark:text-clay-300"
                  : "border-transparent text-warmgray-600 dark:text-warmgray-400 hover:bg-warmgray-100 dark:hover:bg-warmgray-800 hover:text-ink-900 dark:hover:text-ink-50"
              } ${!isExpanded ? "justify-center" : ""}`}
              title={!isExpanded ? item.name : ""}
              aria-label={item.name}
            >
              <Icon
                className={`w-5 h-5 flex-shrink-0 transition-colors ${
                  isActive ? "text-clay-600 dark:text-clay-400" : "text-warmgray-400 dark:text-warmgray-500 group-hover:text-warmgray-700 dark:group-hover:text-warmgray-200"
                }`}
              />
              {isExpanded && <span className="whitespace-nowrap text-sm">{item.name}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Theme Switcher & User Profile Bottom Section */}
      <div className="p-4 border-t border-warmgray-100 dark:border-warmgray-700 space-y-3">
        {/* Theme Switch Button */}
        <button
          onClick={toggleTheme}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          className={`w-full flex items-center gap-3 p-2.5 rounded-xl border border-warmgray-200 dark:border-warmgray-700 bg-warmgray-50 dark:bg-warmgray-800 text-warmgray-700 dark:text-warmgray-300 hover:bg-warmgray-100 dark:hover:bg-warmgray-700 transition-all ${
            !isExpanded ? "justify-center" : "justify-start px-3"
          }`}
          title="Toggle Theme"
        >
          {darkMode ? <Moon className="w-5 h-5 flex-shrink-0" /> : <Sun className="w-5 h-5 flex-shrink-0" />}
          {isExpanded && <span className="text-xs font-bold uppercase tracking-wider">{darkMode ? "Dark Mode" : "Light Mode"}</span>}
        </button>

        {/* Profile */}
        <div className={`flex items-center gap-3 ${!isExpanded ? "justify-center" : "px-1"}`}>
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-clay-50 dark:bg-clay-950/40 flex items-center justify-center text-clay-800 dark:text-clay-300 font-bold border border-clay-200 dark:border-clay-800 uppercase">
              {user?.email?.[0] || "U"}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-sage-500 border-2 border-white dark:border-warmgray-900" />
          </div>
          {isExpanded && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-ink-900 dark:text-ink-50 whitespace-nowrap truncate">{user?.email || "User"}</p>
              <p className="text-xs text-warmgray-500 dark:text-warmgray-400 whitespace-nowrap">Admin</p>
            </div>
          )}
        </div>

        {/* Sign Out Button */}
        <button
          onClick={() => signOut(auth)}
          aria-label="Sign Out"
          className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-rust-500 bg-rust-50 dark:bg-rust-950/50 hover:bg-rust-100 dark:hover:bg-rust-900 transition-all ${
            !isExpanded ? "justify-center" : "justify-start px-3"
          }`}
          title={!isExpanded ? "Sign Out" : ""}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {isExpanded && <span className="text-sm font-bold">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}

