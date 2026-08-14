"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { ShoppingCart, Tag, Receipt, Sun, Moon, LogOut, Leaf, LayoutDashboard, Wallet, BookOpen, PackageCheck, History } from "@/components/ui/icons";

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
  const { user } = useAuth();
  const { darkMode, toggleTheme } = useTheme();
  const pathname = usePathname();

  return (
    <aside
      className={`bg-white dark:bg-warmgray-900 text-ink-900 dark:text-ink-50 flex flex-col transition-all duration-300 z-50 border-r border-warmgray-200 dark:border-warmgray-700 h-screen flex-shrink-0 shadow-sm
      ${isExpanded ? "w-64" : "w-20"}`}
    >
      {/* Brand / Toggle Area - the toggle button always sits at the same
          offset regardless of expanded state (first in the row, fixed
          padding); only the brand text grows/fades in beside it, so the
          button itself never shifts position when clicked. */}
      <div className="h-20 flex items-center gap-2.5 px-4 border-b border-warmgray-100 dark:border-warmgray-700">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
          className="group p-2.5 rounded-xl text-warmgray-500 dark:text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-warmgray-100 dark:hover:bg-warmgray-800 transition-colors flex-shrink-0"
        >
          <IconSlot>
            <SidebarToggleIcon open={isExpanded} />
          </IconSlot>
        </button>

        <div
          className={`flex items-center gap-2.5 overflow-hidden transition-all duration-300 ease-in-out ${
            isExpanded ? "max-w-[180px] opacity-100" : "max-w-0 opacity-0"
          }`}
        >
          <div className="w-9 h-9 rounded-xl bg-clay-400 flex items-center justify-center flex-shrink-0 shadow-sm shadow-clay-400/30">
            <Leaf className="w-5 h-5 text-white" />
          </div>
          <span className="font-black text-lg tracking-wide text-ink-900 dark:text-ink-50 leading-none whitespace-nowrap">POS System</span>
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
              className={`group flex items-center gap-4 p-3.5 rounded-xl transition-colors font-semibold border-l-[3px] ${
                isActive
                  ? "bg-clay-50 dark:bg-clay-950/40 border-clay-600 text-clay-800 dark:text-clay-300"
                  : "border-transparent text-warmgray-600 dark:text-warmgray-400 hover:bg-warmgray-100 dark:hover:bg-warmgray-800 hover:text-ink-900 dark:hover:text-ink-50"
              }`}
              title={!isExpanded ? item.name : ""}
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
                className={`whitespace-nowrap text-sm overflow-hidden transition-all duration-300 ease-in-out ${
                  isExpanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
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
        {/* Theme Switch Button */}
        <button
          onClick={toggleTheme}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          className={`group w-full flex items-center p-2.5 rounded-xl border border-warmgray-200 dark:border-warmgray-700 bg-warmgray-50 dark:bg-warmgray-800 text-warmgray-700 dark:text-warmgray-300 hover:bg-warmgray-100 dark:hover:bg-warmgray-700 transition-colors ${
            isExpanded ? "justify-start gap-3" : "justify-center gap-0"
          }`}
          title="Toggle Theme"
        >
          <IconSlot>
            <ThemeIcon dark={darkMode} />
          </IconSlot>
          <span
            className={`text-xs font-bold uppercase tracking-wider whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out ${
              isExpanded ? "max-w-[120px] opacity-100" : "max-w-0 opacity-0"
            }`}
          >
            {darkMode ? "Dark Mode" : "Light Mode"}
          </span>
        </button>

        {/* Profile */}
        <div className={`flex items-center ${isExpanded ? "justify-start gap-3" : "justify-center gap-0"}`}>
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-clay-50 dark:bg-clay-950/40 flex items-center justify-center text-clay-800 dark:text-clay-300 font-bold border border-clay-200 dark:border-clay-800 uppercase">
              {user?.email?.[0] || "U"}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-sage-500 border-2 border-white dark:border-warmgray-900 animate-pulse" />
          </div>
          <div
            className={`overflow-hidden transition-all duration-300 ease-in-out ${
              isExpanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
            }`}
          >
            <p className="text-sm font-bold text-ink-900 dark:text-ink-50 whitespace-nowrap truncate">{user?.email || "User"}</p>
            <p className="text-xs text-warmgray-500 dark:text-warmgray-400 whitespace-nowrap">Admin</p>
          </div>
        </div>

        {/* Sign Out Button */}
        <button
          onClick={() => signOut(auth)}
          aria-label="Sign Out"
          className={`group w-full flex items-center p-2.5 rounded-xl text-rust-500 bg-rust-50 dark:bg-rust-950/50 hover:bg-rust-100 dark:hover:bg-rust-900 transition-colors ${
            isExpanded ? "justify-start gap-3" : "justify-center gap-0"
          }`}
          title={!isExpanded ? "Sign Out" : ""}
        >
          <IconSlot>
            <LogOut className="w-5 h-5" />
          </IconSlot>
          <span
            className={`text-sm font-bold whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out ${
              isExpanded ? "max-w-[120px] opacity-100" : "max-w-0 opacity-0"
            }`}
          >
            Sign Out
          </span>
        </button>
      </div>
    </aside>
  );
}

