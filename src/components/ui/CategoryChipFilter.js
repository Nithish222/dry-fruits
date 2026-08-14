"use client";
import { useEffect, useRef, useState } from "react";

// Horizontal category filter: a pinned "All" chip plus a scrollable strip of
// category chips with item counts. Trackpad swipes and shift+wheel already
// work natively on the overflow-x-auto strip - the mouse handlers below only
// add click-and-drag scrolling for plain mice, which browsers don't give a
// generic <div> the way they do e.g. <input type="range">.
export default function CategoryChipFilter({ categories, counts, totalCount, value, onChange, allLabel = "All", className = "", stripClassName = "max-w-xs" }) {
  const chipStripRef = useRef(null);
  const dragState = useRef({ isDown: false, startX: 0, startScrollLeft: 0, moved: false });
  // Fades only signal real overflow - without this, a strip barely wider
  // than its own content (a narrow slot, or few categories) shows a right
  // fade immediately on top of the first chip's text instead of only
  // appearing once there's actually more to scroll to.
  const [scrollState, setScrollState] = useState({ canScrollLeft: false, canScrollRight: false });

  useEffect(() => {
    const el = chipStripRef.current;
    if (!el) return;
    function updateScrollState() {
      setScrollState({
        canScrollLeft: el.scrollLeft > 1,
        canScrollRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      });
    }
    updateScrollState();
    el.addEventListener("scroll", updateScrollState);
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [categories]);

  const handleMouseDown = (e) => {
    dragState.current = { isDown: true, startX: e.pageX, startScrollLeft: chipStripRef.current?.scrollLeft ?? 0, moved: false };
  };
  const handleMouseMove = (e) => {
    const el = chipStripRef.current;
    if (!el || !dragState.current.isDown) return;
    const dx = e.pageX - dragState.current.startX;
    if (Math.abs(dx) > 3) dragState.current.moved = true;
    el.scrollLeft = dragState.current.startScrollLeft - dx;
  };
  const handleMouseUpOrLeave = () => {
    dragState.current.isDown = false;
  };
  const handleChipClick = (chipValue) => {
    if (dragState.current.moved) return; // was a drag, not a click
    onChange(chipValue);
  };

  if (categories.length === 0) return null;

  const chipClass = (active) =>
    `flex-shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-bold transition-colors ${
      active ? "bg-clay-800 text-white" : "bg-clay-50 dark:bg-clay-950/40 text-clay-800 dark:text-clay-300"
    }`;

  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      {/* Pinned - always visible, not part of the scrollable strip. */}
      <button type="button" onClick={() => handleChipClick("")} className={chipClass(value === "")}>
        {allLabel} ({totalCount})
      </button>

      {/* Scrollable, with a fade on each edge signaling more chips off-screen. */}
      <div className={`relative min-w-0 flex-1 ${stripClassName}`}>
        <div
          ref={chipStripRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          className="flex gap-2 overflow-x-auto scrollbar-none py-1 cursor-grab active:cursor-grabbing select-none"
        >
          {categories.map((category) => (
            <button key={category} type="button" onClick={() => handleChipClick(category)} className={chipClass(value === category)}>
              {category} ({counts[category] ?? 0})
            </button>
          ))}
        </div>
        {scrollState.canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-white dark:from-warmgray-900 to-transparent pointer-events-none" />
        )}
        {scrollState.canScrollRight && (
          <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-white dark:from-warmgray-900 to-transparent pointer-events-none" />
        )}
      </div>
    </div>
  );
}
