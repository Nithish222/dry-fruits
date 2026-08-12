// Pure date/range math - no Firestore or app-specific knowledge, so it's
// reusable anywhere a page needs "last N days" / "custom range" / bucketed
// trend data (currently: the dashboard's expanded chart views).

// Local midnight N days back from today, matching how the rest of the app
// computes "today" boundaries (local time, no timezone conversion).
export function getDayStart(daysAgo = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

// Resolves a preset ("7day" | "30day" | "custom") - plus "YYYY-MM-DD"
// strings straight from a native <input type="date"> for "custom" - into a
// concrete { start, end } range. `end` is exclusive (the day after the
// last included day) so callers can compare with a plain `< end`.
export function resolveRangeBounds(preset, customStart, customEnd) {
  if (preset === "7day") {
    return { start: getDayStart(6), end: getDayStart(-1) };
  }
  if (preset === "30day") {
    return { start: getDayStart(29), end: getDayStart(-1) };
  }

  // Custom: fall back to a 7-day window if either date hasn't been picked
  // yet, so an incomplete selection still renders something sensible.
  const start = customStart ? new Date(`${customStart}T00:00:00`) : getDayStart(6);
  const endDay = customEnd ? new Date(`${customEnd}T00:00:00`) : getDayStart(0);
  const end = new Date(endDay);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function formatDayLabel(date) {
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function formatMonthLabel(date) {
  return date.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
}

// Splits [start, end) into buckets by granularity. Weekly buckets align to
// Monday and monthly buckets align to the 1st of the calendar month - the
// first/last bucket in a custom range that doesn't land on a boundary is
// clipped to the actual range (a partial week/month at the edges), the same
// way most analytics tools bucket an arbitrary range.
export function buildDateBuckets(start, end, granularity) {
  const buckets = [];

  if (granularity === "weekly") {
    const cursor = new Date(start);
    const mondayOffset = (cursor.getDay() + 6) % 7; // days since the most recent Monday
    cursor.setDate(cursor.getDate() - mondayOffset);
    while (cursor < end) {
      const weekEnd = new Date(cursor);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const bucketStart = cursor > start ? new Date(cursor) : new Date(start);
      const bucketEnd = weekEnd < end ? weekEnd : new Date(end);
      buckets.push({ start: bucketStart, end: bucketEnd, label: formatDayLabel(bucketStart) });
      cursor.setDate(cursor.getDate() + 7);
    }
    return buckets;
  }

  if (granularity === "monthly") {
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor < end) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const bucketStart = cursor > start ? new Date(cursor) : new Date(start);
      const bucketEnd = monthEnd < end ? monthEnd : new Date(end);
      buckets.push({ start: bucketStart, end: bucketEnd, label: formatMonthLabel(cursor) });
      cursor.setFullYear(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return buckets;
  }

  // Daily (default)
  const cursor = new Date(start);
  while (cursor < end) {
    const bucketStart = new Date(cursor);
    const bucketEnd = new Date(cursor);
    bucketEnd.setDate(bucketEnd.getDate() + 1);
    buckets.push({ start: bucketStart, end: bucketEnd, label: formatDayLabel(bucketStart) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}
