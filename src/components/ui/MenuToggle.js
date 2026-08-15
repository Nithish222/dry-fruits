"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, MoreVertical } from "./icons";

const MENU_WIDTH = 192;

// A compact icon-only trigger for switching between a small set of options
// (e.g. Products/Categories) in spots too tight for ToggleGroup's pill row -
// a card header sharing space with a title, or a PageHeader with several
// other options already in it. Same portal/positioning approach as SortMenu
// (fixed viewport coordinates so a card/modal with overflow can't clip it),
// just with a kebab-icon trigger instead of a labeled pill.
export default function MenuToggle({ options, value, onChange, "aria-label": ariaLabel, className = "" }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [coords, setCoords] = useState(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event) {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(event.target) &&
        !(menuRef.current && menuRef.current.contains(event.target))
      ) {
        setOpen(false);
      }
    }
    function handleEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeightEstimate = options.length * 38 + 16;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < menuHeightEstimate && rect.top > spaceBelow;
      setCoords({
        left: Math.min(Math.max(rect.right - MENU_WIDTH, 8), window.innerWidth - MENU_WIDTH - 8),
        top: openUpward ? rect.top - 4 : rect.bottom + 4,
        openUpward,
      });
    }
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options.length]);

  return (
    <div className={className}>
      <button
        type="button"
        ref={triggerRef}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex-shrink-0 text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50 hover:bg-warmgray-100 dark:hover:bg-warmgray-800 rounded-md p-1 transition-colors"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {open && coords && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            width: MENU_WIDTH,
            transform: coords.openUpward ? "translateY(-100%)" : undefined,
          }}
          className="z-[60] bg-white dark:bg-warmgray-900 border border-warmgray-200 dark:border-warmgray-700 rounded-xl shadow-lg p-1.5"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-semibold text-left transition-colors ${
                option.value === value
                  ? "bg-clay-50 dark:bg-clay-950/40 text-clay-700 dark:text-clay-400"
                  : "text-ink-900 dark:text-ink-50 hover:bg-warmgray-100 dark:hover:bg-warmgray-800"
              }`}
            >
              {option.label}
              {option.value === value && <Check className="w-4 h-4 flex-shrink-0" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
