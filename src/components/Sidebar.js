"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { Menu, ShoppingCart, Tag, Receipt, Sun, Moon, LogOut, Leaf } from "@/components/ui/icons";

const NAV_ITEMS = [
  { name: "Register", path: "/", icon: ShoppingCart },
  { name: "Price Setup", path: "/admin", icon: Tag },
  { name: "Transactions", path: "/transactions", icon: Receipt },
];

export default function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { user } = useAuth();
  const { darkMode, toggleTheme } = useTheme();
  const pathname = usePathname();

  return (
    <aside
      className={`bg-white dark:bg-gray-900 text-gray-800 dark:text-white flex flex-col transition-all duration-300 z-50 border-r border-gray-200 dark:border-gray-800 h-screen flex-shrink-0 shadow-sm
      ${isExpanded ? "w-64" : "w-20"}`}
    >
      {/* Brand / Toggle Area */}
      <div className={`h-20 flex items-center border-b border-gray-100 dark:border-gray-800 ${isExpanded ? "justify-between px-4" : "justify-center px-2"}`}>
        {isExpanded && (
          <div className="flex items-center gap-2.5 pl-1">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0 shadow-sm shadow-emerald-600/30">
              <Leaf className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-lg tracking-wide text-gray-900 dark:text-white leading-none">POS System</span>
          </div>
        )}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
          className="p-2.5 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
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
              className={`group flex items-center gap-4 p-3.5 rounded-xl transition-all font-semibold ${
                isActive
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
              } ${!isExpanded ? "justify-center" : ""}`}
              title={!isExpanded ? item.name : ""}
              aria-label={item.name}
            >
              <Icon
                className={`w-5 h-5 flex-shrink-0 transition-colors ${
                  isActive ? "text-white" : "text-gray-400 dark:text-gray-500 group-hover:text-gray-700 dark:group-hover:text-gray-200"
                }`}
              />
              {isExpanded && <span className="whitespace-nowrap text-sm">{item.name}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Theme Switcher & User Profile Bottom Section */}
      <div className="p-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
        {/* Theme Switch Button */}
        <button
          onClick={toggleTheme}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          className={`w-full flex items-center gap-3 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all ${
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
            <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-800 uppercase">
              {user?.email?.[0] || "U"}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-gray-900" />
          </div>
          {isExpanded && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap truncate">{user?.email || "User"}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Admin</p>
            </div>
          )}
        </div>

        {/* Sign Out Button */}
        <button
          onClick={() => signOut(auth)}
          aria-label="Sign Out"
          className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-red-500 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900 transition-all ${
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
