"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";

export default function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { user } = useAuth();
  const { darkMode, toggleTheme } = useTheme();
  const pathname = usePathname();

  const navItems = [
    { name: "Register", path: "/" },
    { name: "Price Setup", path: "/admin" },
    { name: "Transactions", path: "/transactions" },
  ];

  return (
    <aside 
      className={`bg-white dark:bg-gray-900 text-gray-800 dark:text-white flex flex-col transition-all duration-300 z-50 border-r border-gray-200 dark:border-gray-800 h-screen flex-shrink-0 shadow-sm
      ${isExpanded ? "w-64" : "w-20"}`}
    >
      {/* Top Toggle Area */}
      <div className="h-20 flex items-center justify-between px-4 border-b border-gray-100 dark:border-gray-800">
        {isExpanded && <span className="font-black text-lg tracking-wider text-emerald-600 dark:text-emerald-400 pl-2">POS SYSTEM</span>}
        <button 
          onClick={() => setIsExpanded(!isExpanded)} 
          className="p-2.5 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors mx-auto flex-shrink-0"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 mt-6 space-y-3 px-3">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          return (
            <Link 
              key={item.path} 
              href={item.path}
              className={`flex items-center gap-4 p-3.5 rounded-xl transition-all font-semibold ${
                isActive 
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/20" 
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white"
              }`}
              title={!isExpanded ? item.name : ""}
            >
              {/* Text-based abbreviation block instead of emojis */}
              <span className="w-6 h-6 flex items-center justify-center text-xs font-black rounded bg-gray-100 dark:bg-gray-800 flex-shrink-0">
                {item.name.charAt(0)}
              </span>
              {isExpanded && <span className="whitespace-nowrap">{item.name}</span>}
            </Link>
          );
        })}
      </nav>
      
      {/* Theme Switcher & User Profile Bottom Section */}
      <div className="p-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
        {/* Theme Switch Button */}
        <button
          onClick={toggleTheme}
          className={`w-full flex items-center gap-3 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all ${
            !isExpanded ? "justify-center" : "justify-start px-3"
          }`}
          title="Toggle Theme"
        >
          <span className="text-xs font-black uppercase">{darkMode ? "DK" : "LT"}</span>
          {isExpanded && <span className="text-xs font-bold uppercase tracking-wider">{darkMode ? "Dark Mode" : "Light Mode"}</span>}
        </button>

        {/* Profile */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0 text-emerald-700 dark:text-emerald-400 font-bold border border-emerald-200 dark:border-emerald-800 uppercase">
            {user?.email?.[0] || 'U'}
          </div>
          {isExpanded && (
            <div className="overflow-hidden">
              <p className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap truncate">{user?.email || 'User'}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Admin</p>
            </div>
          )}
        </div>
        {/* Sign Out Button */}
        <button
          onClick={() => signOut(auth)}
          className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-red-500 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900 transition-all ${
            !isExpanded ? "justify-center" : "justify-start px-3"
          }`}
        >
          <span className="text-xs font-black uppercase">SO</span>
          {isExpanded && <span className="text-sm font-bold">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}