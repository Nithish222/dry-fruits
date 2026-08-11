"use client";
import { useEffect, useRef } from "react";
import clsx from "clsx";
import { X } from "./icons";

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  panelClassName = "max-w-md",
  backdropClassName,
  closeOnBackdrop = true,
  showClose = true,
}) {
  const panelRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    triggerRef.current = document.activeElement;

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    panelRef.current?.querySelector(FOCUSABLE_SELECTOR)?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={clsx("fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-[fade-in_0.15s_ease-out]", backdropClassName)}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || undefined}
        className={clsx(
          "bg-white dark:bg-warmgray-900 rounded-2xl shadow-xl w-full flex flex-col overflow-hidden animate-[modal-in_0.15s_ease-out]",
          panelClassName
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex-shrink-0">
            <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50 tracking-wide uppercase">{title}</h2>
            {showClose && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="text-warmgray-400 hover:text-warmgray-600 dark:hover:text-warmgray-200 rounded-lg p-1 -m-1"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 flex flex-col min-h-0">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-warmgray-100 dark:border-warmgray-700 flex-shrink-0">{footer}</div>}
      </div>
    </div>
  );
}
