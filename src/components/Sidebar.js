"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";

function MenuIcon(props) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CartIcon(props) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 1.87-4.788 2.201-7.396a1.125 1.125 0 00-1.11-1.246H4.11M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
    </svg>
  );
}

function TagIcon(props) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 6h.008v.008H6V6z" />
    </svg>
  );
}

function ReceiptIcon(props) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 3.75h6M9 8.25h6M5.25 21V5.25A2.25 2.25 0 017.5 3h9a2.25 2.25 0 012.25 2.25V21l-2.625-1.5-2.25 1.5-2.25-1.5-2.25 1.5-2.25-1.5L5.25 21z" />
    </svg>
  );
}

function SunIcon(props) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
    </svg>
  );
}

function MoonIcon(props) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21.752 15.002A9.72 9.72 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
    </svg>
  );
}

function LogoutIcon(props) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  );
}

function LeafIcon(props) {
  return (
    <svg {...props} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11.25 3.75c-6 0-8.25 4.5-8.25 9 0 4.556 3.694 7.5 8.25 7.5 6 0 8.25-6 8.25-12 0-1.243-.28-2.153-.75-2.85M11.25 3.75c1.243 0 2.153.28 2.85.75M11.25 3.75c-3 3-4.5 6.75-4.5 11.25M20.25 6.9c-2.716.523-5.25 2.006-7.14 3.9" />
    </svg>
  );
}

const NAV_ITEMS = [
  { name: "Register", path: "/", icon: CartIcon },
  { name: "Price Setup", path: "/admin", icon: TagIcon },
  { name: "Transactions", path: "/transactions", icon: ReceiptIcon },
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
              <LeafIcon className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-lg tracking-wide text-gray-900 dark:text-white leading-none">POS System</span>
          </div>
        )}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-2.5 rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
        >
          <MenuIcon className="w-6 h-6" />
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
          className={`w-full flex items-center gap-3 p-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all ${
            !isExpanded ? "justify-center" : "justify-start px-3"
          }`}
          title="Toggle Theme"
        >
          {darkMode ? <MoonIcon className="w-5 h-5 flex-shrink-0" /> : <SunIcon className="w-5 h-5 flex-shrink-0" />}
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
          className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-red-500 bg-red-50 dark:bg-red-950/50 hover:bg-red-100 dark:hover:bg-red-900 transition-all ${
            !isExpanded ? "justify-center" : "justify-start px-3"
          }`}
          title={!isExpanded ? "Sign Out" : ""}
        >
          <LogoutIcon className="w-5 h-5 flex-shrink-0" />
          {isExpanded && <span className="text-sm font-bold">Sign Out</span>}
        </button>
      </div>
    </aside>
  );
}
