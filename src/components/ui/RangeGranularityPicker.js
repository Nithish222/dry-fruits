"use client";
import ToggleGroup from "./ToggleGroup";
import DatePicker from "./DatePicker";

const RANGE_OPTIONS = [
  { value: "7day", label: "7 Days" },
  { value: "30day", label: "30 Days" },
  { value: "custom", label: "Custom" },
];

const GRANULARITY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

// Granularity (when present) reads first, range preset + custom dates
// second - granularity answers "how is it bucketed," which the reader
// naturally wants framed before "over what span," so it leads. Pass
// `granularity`/`onGranularityChange` to show that switch, omit both to
// hide it (e.g. a pie chart that only needs a single aggregated total for
// the whole range, not sub-buckets) - it just falls away and the range
// switch is the only thing shown.
export default function RangeGranularityPicker({
  preset,
  onPresetChange,
  customStart,
  onCustomStartChange,
  customEnd,
  onCustomEndChange,
  granularity,
  onGranularityChange,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {granularity && onGranularityChange && (
        <ToggleGroup options={GRANULARITY_OPTIONS} value={granularity} onChange={onGranularityChange} />
      )}

      <ToggleGroup options={RANGE_OPTIONS} value={preset} onChange={onPresetChange} />

      {preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <DatePicker aria-label="Range start date" value={customStart} max={customEnd || undefined} onChange={onCustomStartChange} />
          <span className="text-xs text-warmgray-400">to</span>
          <DatePicker aria-label="Range end date" value={customEnd} min={customStart || undefined} onChange={onCustomEndChange} />
        </div>
      )}
    </div>
  );
}
