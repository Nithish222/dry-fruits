"use client";
import { useEffect, useRef, useState } from "react";

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEARS_PER_PAGE = 12;

function toDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateString(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// Masked DD/MM/YYYY entry - the "type 02042004, it fills in the slashes as
// you go" pattern from most job-application date-of-birth fields. `digits`
// is the raw buffer, always 0-8 numeric characters entered in order
// (day digits, then month digits, then year digits); everything below is
// pure formatting/mapping derived from it, no DOM/caret state of its own.
function digitsToMasked(digits) {
  const day = (digits.slice(0, 2) + "DD").slice(0, 2);
  const month = (digits.slice(2, 4) + "MM").slice(0, 2);
  const year = (digits.slice(4, 8) + "YYYY").slice(0, 4);
  return `${day}/${month}/${year}`;
}

function dateStringToDigits(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return "";
  return `${day}${month}${year}`;
}

// Where the caret should sit after N digits have been entered - jumps past
// each "/" the instant its segment completes (2 digits for day/month, 4 for
// year) so continued typing flows straight into the next segment instead of
// landing right before the separator.
function caretPositionForDigitCount(n) {
  if (n === 2) return 3;
  if (n === 4) return 6;
  if (n <= 2) return n;
  if (n <= 4) return n + 1;
  return Math.min(n + 2, 10);
}

// A popover calendar with drill-down navigation: clicking the month name in
// the day-grid header opens a 12-month picker; clicking the year opens a
// paged year picker, and picking a year there chains into the month picker
// (since choosing a different year almost always means the month needs
// choosing too), which then lands on the day grid. Picking a month directly
// from the day-grid header's month button skips straight to days - only the
// year path chains through months. Built from scratch because a native
// <input type="date"> doesn't expose this interaction (its calendar UI is
// unstyleable browser chrome).
export default function DatePicker({ value, onChange, min, max, "aria-label": ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("days"); // "days" | "months" | "years"
  // Digit buffer for the masked field while the user is typing - only read
  // while isEditing is true (the display falls back to the formatted
  // committed value otherwise), and only ever seeded from `value` at the
  // moment editing starts (onFocus below), so it never needs to be kept in
  // sync via an effect.
  const [isEditing, setIsEditing] = useState(false);
  const [digits, setDigits] = useState("");
  const selected = parseDateString(value);
  const [cursor, setCursor] = useState(() => selected || new Date());
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
        setView("days");
      }
    }
    function handleEscape(event) {
      if (event.key === "Escape") {
        setOpen(false);
        setView("days");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const minDate = parseDateString(min);
  const maxDate = parseDateString(max);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  function isDisabled(date) {
    if (minDate && date < minDate) return true;
    if (maxDate && date > maxDate) return true;
    return false;
  }

  function selectDay(date) {
    if (isDisabled(date)) return;
    onChange(toDateString(date));
    setOpen(false);
    setView("days");
  }

  // Commits the 8-digit buffer (DDMMYYYY) once it's full. An invalid or
  // out-of-range date (e.g. 31/02/2026, or outside min/max) is silently
  // discarded rather than shown as an inline error for a control this
  // small - the field just snaps back to the last committed value.
  function tryCommitDigits(candidateDigits) {
    if (candidateDigits.length !== 8) return false;
    const day = Number(candidateDigits.slice(0, 2));
    const month = Number(candidateDigits.slice(2, 4));
    const year = Number(candidateDigits.slice(4, 8));
    const candidate = new Date(year, month - 1, day);
    const roundTrips = candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day;
    if (!roundTrips || isDisabled(candidate)) return false;
    onChange(toDateString(candidate));
    setCursor(candidate);
    return true;
  }

  function handleMaskedChange(event) {
    const nextDigits = event.target.value.replace(/\D/g, "").slice(0, 8);
    const masked = digitsToMasked(nextDigits);
    const caretPos = caretPositionForDigitCount(nextDigits.length);
    // Written straight to the DOM node (in addition to the state update
    // below) so the caret can be repositioned synchronously in the same
    // event - waiting for the next render would place it after the browser
    // already restored its own (wrong) caret position.
    event.target.value = masked;
    event.target.setSelectionRange(caretPos, caretPos);
    setDigits(nextDigits);
    if (nextDigits.length === 8) tryCommitDigits(nextDigits);
  }

  // An incomplete buffer (some digits typed but not all 8) is simply
  // dropped here - the display falls back to the last committed `value`
  // once isEditing flips false, with no separate "revert" step needed.
  function handleBlur() {
    setIsEditing(false);
  }

  const firstOfMonth = new Date(year, month, 1);
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1))];

  const yearsPageStart = Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE;
  const todayString = toDateString(new Date());

  const navButtonClass = "p-1 rounded hover:bg-warmgray-100 dark:hover:bg-warmgray-800 text-warmgray-500 dark:text-warmgray-400";
  const gridButtonClass = (active, disabled) =>
    `text-[11px] font-semibold rounded-md py-1.5 transition-colors ${
      active
        ? "bg-clay-400 text-white"
        : disabled
        ? "text-warmgray-300 dark:text-warmgray-700 cursor-not-allowed"
        : "text-ink-900 dark:text-ink-50 hover:bg-warmgray-100 dark:hover:bg-warmgray-800"
    }`;

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel}
        placeholder="DD/MM/YYYY"
        value={isEditing ? digitsToMasked(digits) : selected ? selected.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : ""}
        onFocus={(e) => {
          const initialDigits = dateStringToDigits(value);
          setIsEditing(true);
          setDigits(initialDigits);
          setOpen(true);
          // Land the caret at the end of whatever's already filled in,
          // matching where handleMaskedChange would place it mid-typing.
          requestAnimationFrame(() => {
            const pos = caretPositionForDigitCount(initialDigits.length);
            e.target.setSelectionRange(pos, pos);
          });
        }}
        onChange={handleMaskedChange}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={handleBlur}
        className="w-[128px] text-xs font-semibold bg-warmgray-50 dark:bg-warmgray-800 border border-warmgray-200 dark:border-warmgray-700 rounded-md px-1.5 py-1 text-ink-900 dark:text-ink-50 focus:outline-none focus:ring-2 focus:ring-clay-400 whitespace-nowrap"
      />

      {open && (
        <div className="absolute z-20 mt-1 w-60 bg-white dark:bg-warmgray-900 border border-warmgray-200 dark:border-warmgray-700 rounded-xl shadow-lg p-3">
          {view === "days" && (
            <>
              <div className="flex items-center justify-between mb-2">
                <button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(year, month - 1, 1))} className={navButtonClass}>
                  ‹
                </button>
                <div className="flex items-center gap-1 text-xs font-bold text-ink-900 dark:text-ink-50">
                  <button type="button" onClick={() => setView("months")} className="px-1 rounded hover:text-clay-600 dark:hover:text-clay-400">
                    {MONTH_LABELS[month]}
                  </button>
                  <button type="button" onClick={() => setView("years")} className="px-1 rounded hover:text-clay-600 dark:hover:text-clay-400">
                    {year}
                  </button>
                </div>
                <button type="button" aria-label="Next month" onClick={() => setCursor(new Date(year, month + 1, 1))} className={navButtonClass}>
                  ›
                </button>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {WEEKDAY_LABELS.map((label, i) => (
                  <span key={i} className="text-[10px] font-bold text-warmgray-400 py-1">
                    {label}
                  </span>
                ))}
                {cells.map((date, i) => {
                  if (!date) return <span key={i} />;
                  const dateString = toDateString(date);
                  return (
                    <button
                      type="button"
                      key={i}
                      disabled={isDisabled(date)}
                      onClick={() => selectDay(date)}
                      className={gridButtonClass(dateString === value, isDisabled(date))}
                      title={dateString === todayString ? "Today" : undefined}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {view === "months" && (
            <>
              <div className="flex items-center justify-between mb-2">
                <button type="button" aria-label="Previous year" onClick={() => setCursor(new Date(year - 1, month, 1))} className={navButtonClass}>
                  ‹
                </button>
                <button type="button" onClick={() => setView("years")} className="text-xs font-bold text-ink-900 dark:text-ink-50 hover:text-clay-600 dark:hover:text-clay-400">
                  {year}
                </button>
                <button type="button" aria-label="Next year" onClick={() => setCursor(new Date(year + 1, month, 1))} className={navButtonClass}>
                  ›
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {MONTH_LABELS.map((label, i) => (
                  <button
                    type="button"
                    key={label}
                    onClick={() => {
                      setCursor(new Date(year, i, 1));
                      setView("days");
                    }}
                    className={gridButtonClass(i === month, false)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          {view === "years" && (
            <>
              <div className="flex items-center justify-between mb-2">
                <button type="button" aria-label="Previous years" onClick={() => setCursor(new Date(year - YEARS_PER_PAGE, month, 1))} className={navButtonClass}>
                  ‹
                </button>
                <span className="text-xs font-bold text-ink-900 dark:text-ink-50">
                  {yearsPageStart}–{yearsPageStart + YEARS_PER_PAGE - 1}
                </span>
                <button type="button" aria-label="Next years" onClick={() => setCursor(new Date(year + YEARS_PER_PAGE, month, 1))} className={navButtonClass}>
                  ›
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearsPageStart + i).map((y) => (
                  <button
                    type="button"
                    key={y}
                    onClick={() => {
                      setCursor(new Date(y, month, 1));
                      setView("months");
                    }}
                    className={gridButtonClass(y === year, false)}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
