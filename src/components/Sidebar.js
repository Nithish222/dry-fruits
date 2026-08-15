"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { ShoppingCart, Tag, Receipt, Sun, Moon, LogOut, LayoutDashboard, Wallet, BookOpen, PackageCheck, History } from "@/components/ui/icons";
import CashewIcon from "@/components/ui/CashewIcon";

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

// Hamburger bars morph into an X in place, rather than swapping icons
// outright, so the toggle reads as one continuous action instead of a hard
// cut. Built as stroked SVG lines (24x24, strokeWidth 2, round caps) to
// match every other icon in the app (all lucide-react, same conventions) -
// an earlier version used plain <div> bars, which came out visibly heavier/
// blockier than lucide's strokes and looked out of place next to them.
// Each line keeps its own static x/y coordinates and animates only via a
// CSS `transform` (translate + rotate around its own center, not the SVG's
// origin) so the morph is a pure transform, not a coordinate tween.
function SidebarToggleIcon({ open }) {
  const lineClass = "origin-center transition-transform duration-300 ease-in-out [transform-box:fill-box]";
  return (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" className={`${lineClass} ${open ? "translate-y-[5px] rotate-45" : ""}`} />
      <line x1="4" y1="12" x2="20" y2="12" className={`transition-opacity duration-200 ease-in-out ${open ? "opacity-0" : "opacity-100"}`} />
      <line x1="4" y1="17" x2="20" y2="17" className={`${lineClass} ${open ? "-translate-y-[5px] -rotate-45" : ""}`} />
    </svg>
  );
}

// Sun and Moon stacked in the same slot, cross-fading with a quarter-turn
// rotate so the swap reads as one icon turning into the other instead of a
// hard cut - the sun rotates out clockwise as it fades, the moon rotates in
// from the same motion, so neither ever pops.
function ThemeIcon({ dark }) {
  return (
    <span className="relative block w-5 h-5">
      <Sun
        className={`absolute inset-0 w-5 h-5 transition-all duration-300 ease-in-out ${
          dark ? "opacity-0 rotate-90 scale-50" : "opacity-100 rotate-0 scale-100"
        }`}
      />
      <Moon
        className={`absolute inset-0 w-5 h-5 transition-all duration-300 ease-in-out ${
          dark ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-50"
        }`}
      />
    </span>
  );
}

// Every icon sits inside one of these instead of taking the hover/press
// scale directly. It's a plain HTML <span> matching the icon's own size (no
// layout/padding changes) - its only job is to be the thing that scales,
// instead of the <svg> itself. Two real bugs come from scaling an <svg>
// directly:
//  - SVG elements' default transform-origin is spec'd separately from
//    HTML's and isn't reliably 50%/50% the way a <span>'s is, so the icon
//    can visibly grow off-center rather than in place - which reads as
//    "not centered" the moment you hover it.
//  - Because it's the `group`-ANCESTOR (Link/button) that triggers :hover
//    while this span (not the ancestor) is what scales, growing it can
//    never shrink or shift the ancestor's own hoverable area and flicker
//    the hover state on/off - which is what caused the jiggle.
// No hover-scale here on purpose - the row already gets a background
// highlight on hover (bg-warmgray-100/800), so growing the icon on top of
// that was a second, redundant position change: even scaled perfectly
// in-place around its own center, an icon's *edges* still move outward as
// it grows, which reads as "the icon moved" the instant you hover it. Only
// press (a real click) gets a brief, momentary shrink - that one's
// expected and doesn't fire just from moving the mouse over it.
function IconSlot({ children, className = "" }) {
  return <span className={`inline-flex flex-shrink-0 transition-transform duration-150 ease-out group-active:scale-90 ${className}`}>{children}</span>;
}

export default function Sidebar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { user } = useAuth();
  const { darkMode, toggleTheme } = useTheme();
  const pathname = usePathname();

  // Below `lg` the aside is an off-canvas drawer rather than a collapsible
  // column, so it's always rendered at full width/labels-visible whenever
  // it's open - `isExpanded` (the desktop collapse toggle) is irrelevant
  // there. `showLabels` is what every label/max-width toggle below reacts
  // to; `isExpanded` alone still gates the desktop-only column width.
  const showLabels = isExpanded || isMobileOpen;

  const handleToggleClick = () => {
    if (isMobileOpen) {
      setIsMobileOpen(false);
    } else {
      setIsExpanded((e) => !e);
    }
  };

  return (
    <>
      {/* Mobile top bar - the aside is off-canvas by default below `lg`, so
          this fixed bar is what stays reachable to open it. Hidden at `lg+`
          where the aside is always part of the layout. */}
      <div className="lg:hidden fixed top-0 inset-x-0 h-16 z-30 bg-white dark:bg-warmgray-900 border-b border-warmgray-200 dark:border-warmgray-700 flex items-center gap-3 px-4">
        <button
          onClick={() => setIsMobileOpen(true)}
          aria-label="Open menu"
          className="group flex items-center justify-center p-2.5 -ml-2.5 rounded-xl text-warmgray-500 dark:text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-warmgray-100 dark:hover:bg-warmgray-800 transition-colors flex-shrink-0"
        >
          <IconSlot>
            <SidebarToggleIcon open={false} />
          </IconSlot>
        </button>
        <div className="w-8 h-8 rounded-lg bg-clay-400 flex items-center justify-center flex-shrink-0 shadow-sm shadow-clay-400/30">
          <CashewIcon className="w-4 h-4 text-white animate-[spin-twice_1.2s_ease-out_forwards]" />
        </div>
        <span className="font-black text-base tracking-wide text-ink-900 dark:text-ink-50 leading-none">Southern Traders</span>
      </div>

      {/* Backdrop - closes the drawer on tap, only present while it's open. */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-ink-900/50 z-40" onClick={() => setIsMobileOpen(false)} aria-hidden="true" />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 bg-white dark:bg-warmgray-900 text-ink-900 dark:text-ink-50 flex flex-col transition-all duration-300 z-50 border-r border-warmgray-200 dark:border-warmgray-700 h-screen flex-shrink-0 shadow-sm
        w-64 ${isExpanded ? "lg:w-64" : "lg:w-20"}
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        {/* Brand / Toggle Area - the toggle button always sits at the same
            offset regardless of expanded state (first in the row, fixed
            padding); only the brand text grows/fades in beside it, so the
            button itself never shifts position when clicked. */}
        <div className="h-20 flex items-center gap-2.5 px-4 border-b border-warmgray-100 dark:border-warmgray-700">
          <button
            onClick={handleToggleClick}
            aria-label={isMobileOpen ? "Close menu" : isExpanded ? "Collapse sidebar" : "Expand sidebar"}
            className="group flex items-center justify-center p-2.5 rounded-xl text-warmgray-500 dark:text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-warmgray-100 dark:hover:bg-warmgray-800 transition-colors flex-shrink-0"
          >
            <IconSlot>
              <SidebarToggleIcon open={showLabels} />
            </IconSlot>
          </button>

          <div
            className={`flex items-center gap-2.5 overflow-hidden lg:transition-all lg:duration-300 lg:ease-in-out ${
              showLabels ? "max-w-[200px] opacity-100" : "max-w-0 opacity-0"
            }`}
          >
            <div className="w-9 h-9 rounded-xl bg-clay-400 flex items-center justify-center flex-shrink-0 shadow-sm shadow-clay-400/30">
              <CashewIcon className="w-5 h-5 text-white animate-[spin-twice_1.2s_ease-out_forwards]" />
            </div>
            <span className="font-black text-sm tracking-wide text-ink-900 dark:text-ink-50 leading-tight">Southern Traders</span>
          </div>
        </div>

      {/* Navigation Links - icons sit at a fixed offset (p-3.5, no
          justify-center toggle); only the label's max-width/opacity
          animates, so collapsing never snaps an icon sideways mid-transition
          the way toggling justify-content instantly would. */}
      <nav className="flex-1 mt-6 space-y-1.5 px-3">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.path;
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              href={item.path}
              onClick={() => setIsMobileOpen(false)}
              className={`group flex items-center gap-4 p-3.5 rounded-xl transition-colors font-semibold border-l-[3px] ${
                isActive
                  ? "bg-clay-50 dark:bg-clay-950/40 border-clay-600 text-clay-800 dark:text-clay-300"
                  : "border-transparent text-warmgray-600 dark:text-warmgray-400 hover:bg-warmgray-100 dark:hover:bg-warmgray-800 hover:text-ink-900 dark:hover:text-ink-50"
              }`}
              title={!showLabels ? item.name : ""}
              aria-label={item.name}
            >
              <IconSlot>
                <Icon
                  className={`w-5 h-5 transition-colors ${
                    isActive ? "text-clay-600 dark:text-clay-400" : "text-warmgray-400 dark:text-warmgray-500 group-hover:text-warmgray-700 dark:group-hover:text-warmgray-200"
                  }`}
                />
              </IconSlot>
              <span
                className={`whitespace-nowrap text-sm overflow-hidden lg:transition-all lg:duration-300 lg:ease-in-out ${
                  showLabels ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
                }`}
              >
                {item.name}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Theme Switcher & User Profile Bottom Section */}
      <div className="p-4 border-t border-warmgray-100 dark:border-warmgray-700 space-y-3">
        {/* Theme Switch Button - icon sits at a fixed left offset like the
            nav links above (no justify-center/justify-start toggle), so
            collapsing/expanding never snaps it sideways; only the label's
            max-width/opacity animates. */}
        <button
          onClick={() => {
            toggleTheme();
            setIsMobileOpen(false);
          }}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          className="group w-full flex items-center gap-3 p-2.5 rounded-xl border border-warmgray-200 dark:border-warmgray-700 bg-warmgray-50 dark:bg-warmgray-800 text-warmgray-700 dark:text-warmgray-300 hover:bg-warmgray-100 dark:hover:bg-warmgray-700 transition-colors"
          title="Toggle Theme"
        >
          <IconSlot>
            <ThemeIcon dark={darkMode} />
          </IconSlot>
          <span
            className={`text-xs font-bold uppercase tracking-wider whitespace-nowrap overflow-hidden lg:transition-all lg:duration-300 lg:ease-in-out ${
              showLabels ? "max-w-[120px] opacity-100" : "max-w-0 opacity-0"
            }`}
          >
            {darkMode ? "Dark Mode" : "Light Mode"}
          </span>
        </button>

        {/* Profile - same fixed-left-icon rule as above. */}
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-clay-50 dark:bg-clay-950/40 flex items-center justify-center text-clay-800 dark:text-clay-300 font-bold border border-clay-200 dark:border-clay-800 uppercase">
              {user?.email?.[0] || "U"}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-sage-500 border-2 border-white dark:border-warmgray-900 animate-pulse" />
          </div>
          <div
            className={`overflow-hidden lg:transition-all lg:duration-300 lg:ease-in-out ${
              showLabels ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
            }`}
          >
            <p className="text-sm font-bold text-ink-900 dark:text-ink-50 whitespace-nowrap truncate">{user?.email || "User"}</p>
            <p className="text-xs text-warmgray-500 dark:text-warmgray-400 whitespace-nowrap">Admin</p>
          </div>
        </div>

        {/* Sign Out Button - same fixed-left-icon rule as above. */}
        <button
          onClick={() => {
            signOut(auth);
            setIsMobileOpen(false);
          }}
          aria-label="Sign Out"
          className="group w-full flex items-center gap-3 p-2.5 rounded-xl text-rust-500 bg-rust-50 dark:bg-rust-950/50 hover:bg-rust-100 dark:hover:bg-rust-900 transition-colors"
          title={!showLabels ? "Sign Out" : ""}
        >
          <IconSlot>
            <LogOut className="w-5 h-5" />
          </IconSlot>
          <span
            className={`text-sm font-bold whitespace-nowrap overflow-hidden lg:transition-all lg:duration-300 lg:ease-in-out ${
              showLabels ? "max-w-[120px] opacity-100" : "max-w-0 opacity-0"
            }`}
          >
            Sign Out
          </span>
        </button>
      </div>
      </aside>
    </>
  );
}

