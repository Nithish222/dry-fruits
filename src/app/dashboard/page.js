"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatINR, roundKg, computeProfit, LOW_STOCK_THRESHOLD_KG } from "@/lib/format";
import { getPendingTransactions } from "@/lib/offlineQueue";
import { resolveRangeBounds, buildDateBuckets } from "@/lib/dateRanges";
import { useTheme } from "@/components/ThemeProvider";
import EditProductModal from "@/components/EditProductModal";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import Modal from "@/components/ui/Modal";
import ToggleGroup from "@/components/ui/ToggleGroup";
import RangeGranularityPicker from "@/components/ui/RangeGranularityPicker";
import { Table, THead, Th, Tr, Td } from "@/components/ui/Table";
import { TrendingUp, Package, PackageCheck, Award, Percent, PieChart, Maximize2 } from "@/components/ui/icons";

const TOP_SELLERS_LIMIT = 5;
const TREND_DAYS = 7;
const SKELETON_ROWS = 4;
const PIE_SLICE_LIMIT = 5;
const EXPANDED_CHART_HEIGHT = 320;
const EXPANDED_PIE_SIZE = 300;
const LOW_STOCK_VISIBLE_LIMIT = 4;

// How far below LOW_STOCK_THRESHOLD_KG a product's stock sits, as a 0-1
// fraction (0 = empty, 1 = right at the threshold), bucketed into a
// graduated rust ramp - darkest at true near-empty, lightest for a product
// that's only just dipped under the line. Deliberately hand-picked hexes
// (not the app's existing rust-100/rust-800 pair) since the whole point is
// a third, in-between tier the existing 2-tone badge scale doesn't have.
function getLowStockSeverity(stockKg) {
  const severity = Math.min(Math.max((stockKg ?? 0) / LOW_STOCK_THRESHOLD_KG, 0), 1);
  if (severity < 0.3) return { severity, text: "#8A2E22", bg: "#F7C4BC" };
  if (severity < 0.65) return { severity, text: "#8A2E22", bg: "#FBE9E6" };
  return { severity, text: "#A8815F", bg: "#FBF3EC" };
}

// A long product/category name fades out at the container edge instead of
// being cut with an ellipsis - the mask only touches text that actually
// reaches the last 15% of the box, so short names are unaffected.
const FADE_TEXT_STYLE = {
  maskImage: "linear-gradient(to right, black 85%, transparent 100%)",
  WebkitMaskImage: "linear-gradient(to right, black 85%, transparent 100%)",
};

// Same idea, both edges - for center-aligned labels (a dense bar chart's
// x-axis) that can overflow on either side rather than just the right.
const FADE_TEXT_STYLE_CENTER = {
  maskImage: "linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
  WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)",
};

// Validated categorical palette (dataviz skill reference instance) - fixed
// hue order, only ever assigned slots 1..N in sequence so adjacent slices
// clear the CVD-separation gate. "Other" isn't an identity, so it takes a
// muted gray outside the ramp instead of a 6th hue slot.
const PIE_PALETTE = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
];
const PIE_OTHER_COLOR = { light: "#c3c2b7", dark: "#52514e" };

// Local calendar day, matching how Transactions computes "today" (local
// midnight, no timezone conversion) - see todayStats there.
function getDayBounds(daysAgo) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysAgo);
  const startSeconds = start.getTime() / 1000;
  return { date: start, startSeconds, endSeconds: startSeconds + 86400 };
}

// Rounds a chart's own max value up to a "clean" axis ceiling (1/2/5 x
// 10^n) and returns the evenly-spaced ticks from 0 to that ceiling - the
// standard "nice numbers" approach so a Y-axis reads e.g. 0/2,000/4,000/
// 6,000/8,000 instead of raw fractions of an ugly max like 6,972.50. Runs
// fresh against each chart's own data, so the axis genuinely differs week
// to week rather than assuming a fixed domain.
function getNiceTicks(maxValue, targetCount = 4) {
  if (maxValue <= 0) return { ticks: [0], niceMax: 1 };
  const rawStep = maxValue / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceStep = residual > 5 ? 10 * magnitude : residual > 2 ? 5 * magnitude : residual > 1 ? 2 * magnitude : magnitude;
  const niceMax = Math.ceil(maxValue / niceStep) * niceStep;
  const ticks = [];
  for (let t = 0; t <= niceMax + niceStep * 0.001; t += niceStep) ticks.push(Math.round(t * 100) / 100);
  return { ticks, niceMax };
}

// Top sellers by revenue within [startSeconds, endSeconds) (pass Infinity
// for endSeconds to mean "through now"), grouped by product or category and
// netted against returns in the same window - shared by the compact pie
// card's fixed "today" view and the expanded modal's range-driven view so
// the aggregation logic (and the top-N + "Other" fold) has one definition.
function aggregateTopSellers({ transactions, returns, startSeconds, endSeconds, groupMode, productCategoryById }) {
  const rangeTx = transactions.filter((tx) => {
    const seconds = tx.createdAt?.seconds || 0;
    return seconds >= startSeconds && seconds < endSeconds;
  });
  const rangeReturns = returns.filter((ret) => {
    const seconds = ret.createdAt?.seconds || 0;
    return seconds >= startSeconds && seconds < endSeconds;
  });

  const netByProduct = new Map();
  for (const tx of rangeTx) {
    for (const item of tx.items || []) {
      const revenue = item.subtotal ?? (item.billedPrice || 0) * (item.weight_kg || 0);
      const existing = netByProduct.get(item.id) || { name: item.name, value: 0 };
      existing.value += revenue;
      netByProduct.set(item.id, existing);
    }
  }
  for (const ret of rangeReturns) {
    for (const item of ret.items || []) {
      const existing = netByProduct.get(item.id);
      if (!existing) continue;
      existing.value -= item.subtotal ?? (item.billedPrice || 0) * (item.weight_kg || 0);
    }
  }

  const byKey = new Map();
  for (const [id, { name, value }] of netByProduct) {
    if (value <= 0) continue;
    const isCategory = groupMode === "categories";
    const key = isCategory ? productCategoryById.get(id) || "Uncategorized" : id;
    const label = isCategory ? productCategoryById.get(id) || "Uncategorized" : name;
    const existing = byKey.get(key) || { id: key, name: label, value: 0 };
    existing.value += value;
    byKey.set(key, existing);
  }

  const sorted = Array.from(byKey.values()).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, PIE_SLICE_LIMIT);
  const otherTotal = sorted.slice(PIE_SLICE_LIMIT).reduce((sum, e) => sum + e.value, 0);
  if (otherTotal > 0) top.push({ id: "other", name: "Other", value: otherTotal, isOther: true });
  return top;
}

function ExpandButton({ label, onExpand }) {
  if (!onExpand) return null;
  return (
    <button
      onClick={onExpand}
      aria-label={`Expand ${label}`}
      className="text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50 rounded-md p-1 transition-colors flex-shrink-0"
    >
      <Maximize2 className="w-3.5 h-3.5" />
    </button>
  );
}

// Shared bar-chart rendering for the trend charts. Both Revenue and Margin
// are a single series (one hue, no legend needed), so only the color and
// value formatter change between them. Values are no longer direct-labeled
// on every bar - a real Y-axis (see getNiceTicks) gives the reader scale,
// and the exact value for a given bucket comes from hovering/focusing that
// bar, consistent with how the pie's slices work below.
//
// `days` items are `{ label, tooltipLabel, isCurrent, value }` - a plain
// display label rather than a raw Date, since a bucket can represent a day,
// a week, or a month depending on the caller's granularity. `isCurrent`
// marks whichever bucket contains "now" (the accent bar), generalizing the
// old day-chart's "isToday".
//
// `height`, if passed (used by the expanded modal view), fixes the chart to
// that many px; left undefined (the compact in-grid card), the chart region
// is `flex-1` so it stretches to fill whatever height the grid row actually
// gives the card - the fix for bars looking short next to a taller sibling
// card, since blank space no longer gets reserved below the axis.
//
// A 30-day daily view can be 30 bars in the same width that comfortably
// fits 7 - past DENSE_THRESHOLD bars, bars/gaps shrink and the x-axis labels
// thin out to roughly one per LABEL_TARGET_COUNT bars (always including the
// last bucket) so text doesn't overlap; the bars and hover tooltips still
// work per-bar regardless of which labels are visible, so no data is hidden.
const DENSE_THRESHOLD = 10;
const LABEL_TARGET_COUNT = 8;

function TrendChart({ title, icon: Icon, days, formatValue, barClass, barTodayClass, emptyMessage, onExpand, height }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const maxValue = Math.max(...days.map((d) => d.value), 0);
  const hasData = days.some((d) => d.value > 0);
  const { ticks, niceMax } = getNiceTicks(maxValue);
  const reversedTicks = [...ticks].reverse();
  const dense = days.length > DENSE_THRESHOLD;
  const labelInterval = Math.max(1, Math.ceil(days.length / LABEL_TARGET_COUNT));
  const barMaxWidthClass = dense ? "max-w-3" : "max-w-6";
  const barGapClass = dense ? "gap-0.5" : "gap-1 sm:gap-2";

  return (
    <Card padding="p-5" className={`min-w-0 flex flex-col ${height ? "flex-shrink-0" : "h-full"}`}>
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 text-warmgray-400 flex-shrink-0" />
          <h2 className="text-xs font-bold text-ink-900 dark:text-ink-50 tracking-wide uppercase truncate">{title}</h2>
        </div>
        <ExpandButton label={title} onExpand={onExpand} />
      </div>

      {!hasData && <p className="text-xs font-semibold text-warmgray-400 mb-3">{emptyMessage}</p>}

      <div className={`flex gap-2 ${height ? "" : "flex-1 min-h-[140px]"}`} style={height ? { height } : undefined}>
        <div className="flex flex-col justify-between flex-shrink-0 w-14 text-right">
          {reversedTicks.map((tick, i) => (
            <span key={i} className="text-[9px] font-semibold text-warmgray-400 tabular-nums leading-none truncate">
              {formatValue(tick)}
            </span>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {reversedTicks.map((_, i) => (
              <div key={i} className="border-t border-warmgray-100 dark:border-warmgray-800" />
            ))}
          </div>
          <div className={`relative h-full flex items-end justify-between ${barGapClass}`}>
            {days.map((day, i) => {
              const pct = Math.max((day.value / niceMax) * 100, day.value > 0 ? 3 : 0);
              return (
                <div
                  key={i}
                  className="relative flex-1 h-full flex flex-col justify-end items-center min-w-0"
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                >
                  <div
                    tabIndex={0}
                    onFocus={() => setHoverIndex(i)}
                    onBlur={() => setHoverIndex(null)}
                    aria-label={`${day.tooltipLabel}: ${formatValue(day.value)}`}
                    style={{ height: `${pct}%` }}
                    className={`relative w-full ${barMaxWidthClass} rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-clay-400 transition-all ${
                      day.isCurrent ? barTodayClass : barClass
                    }`}
                  >
                    {hoverIndex === i && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-10 bg-ink-900 dark:bg-warmgray-700 text-white text-[11px] font-semibold rounded-md px-2 py-1 whitespace-nowrap pointer-events-none shadow-sm">
                        {day.tooltipLabel} &middot; {formatValue(day.value)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={`flex items-center justify-between ${barGapClass} mt-2 pl-16`}>
        {days.map((day, i) => (
          <span
            key={i}
            className={`flex-1 text-center text-[10px] font-semibold whitespace-nowrap overflow-hidden ${
              day.isCurrent ? "text-ink-900 dark:text-ink-50" : "text-warmgray-400"
            }`}
            style={dense ? FADE_TEXT_STYLE_CENTER : undefined}
          >
            {i % labelInterval === 0 || i === days.length - 1 ? day.label : ""}
          </span>
        ))}
      </div>
    </Card>
  );
}

// A solid pie, not a donut - built with the same stroke-dasharray technique
// a donut would use, just with the radius shrunk to the point the stroke
// band spans center-to-edge (radius = size/4, strokeWidth = size/2) so
// there's no hole to put a center label in. Caps at PIE_SLICE_LIMIT +
// "Other" (6 segments), the ceiling past which part-to-whole stops reading
// at a glance. Slices are assigned the fixed categorical order by rank
// (rank 1 -> slot 1, etc.) each render - the entities behind "top seller"
// reshuffle daily, so persisting a name -> color mapping across visits
// isn't meaningful the way it would be for a fixed taxonomy. No value is
// shown in the chart itself - hovering a slice (or its legend row) is the
// only way to see the name/amount/share, all three surfaced together in one
// fixed-position readout so there's no per-slice tooltip-positioning math.
function BreakdownPieChart({
  entries,
  formatValue,
  darkMode,
  groupMode,
  onGroupChange,
  emptyMessage,
  onExpand,
  size = 210,
}) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const strokeWidth = size / 2;
  const radius = size / 4;
  const circumference = 2 * Math.PI * radius;
  const total = entries.reduce((sum, e) => sum + e.value, 0);

  // Dash length per slice, then each slice's start offset as the sum of the
  // lengths before it - a pure prefix sum (via slice+reduce) rather than a
  // running total mutated across map iterations.
  const dashLengths = entries.map((entry) => (total > 0 ? entry.value / total : 0) * circumference);
  const segments = entries.map((entry, i) => {
    const dash = dashLengths[i];
    const priorLength = dashLengths.slice(0, i).reduce((sum, v) => sum + v, 0);
    const palette = entry.isOther ? PIE_OTHER_COLOR : PIE_PALETTE[i];
    return {
      ...entry,
      color: darkMode ? palette.dark : palette.light,
      pct: total > 0 ? (entry.value / total) * 100 : 0,
      dasharray: `${dash} ${circumference - dash}`,
      dashoffset: -priorLength,
    };
  });

  const hovered = hoverIndex !== null ? segments[hoverIndex] : null;

  return (
    <Card padding="p-5" className="min-w-0 flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <PieChart className="w-4 h-4 text-warmgray-400 flex-shrink-0" />
          <h2 className="text-xs font-bold text-ink-900 dark:text-ink-50 tracking-wide uppercase truncate">Top Sellers</h2>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ToggleGroup
            options={[{ value: "products", label: "Products" }, { value: "categories", label: "Categories" }]}
            value={groupMode}
            onChange={onGroupChange}
          />
          <ExpandButton label="Top Sellers" onExpand={onExpand} />
        </div>
      </div>

      {segments.length === 0 ? (
        <p className="text-xs font-semibold text-warmgray-400 text-center py-8 flex-1">{emptyMessage}</p>
      ) : (
        <div className="flex-1 flex items-center gap-4 min-h-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 flex-shrink-0">
            {segments.map((seg, i) => (
              <circle
                key={seg.id}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={seg.dasharray}
                strokeDashoffset={seg.dashoffset}
                tabIndex={0}
                aria-label={`${seg.name}: ${formatValue(seg.value)} (${seg.pct.toFixed(0)}%)`}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
                onFocus={() => setHoverIndex(i)}
                onBlur={() => setHoverIndex(null)}
                className="outline-none cursor-pointer transition-opacity"
                style={{ opacity: hoverIndex === null || hoverIndex === i ? 1 : 0.35 }}
              />
            ))}
          </svg>

          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div className="h-9 flex flex-col justify-center">
              {hovered ? (
                <>
                  <span className="block text-xs font-bold text-ink-900 dark:text-ink-50 whitespace-nowrap overflow-hidden" style={FADE_TEXT_STYLE}>
                    {hovered.name}
                  </span>
                  <span className="text-[11px] font-semibold text-warmgray-500 dark:text-warmgray-400 tabular-nums">
                    {formatValue(hovered.value)} &middot; {hovered.pct.toFixed(0)}%
                  </span>
                </>
              ) : (
                <span className="text-[11px] font-medium text-warmgray-300 dark:text-warmgray-600">Hover a slice for details</span>
              )}
            </div>

            <ul className="w-full space-y-1.5 overflow-y-auto">
              {segments.map((seg, i) => (
                <li
                  key={seg.id}
                  className="flex items-center gap-2 text-xs cursor-default"
                  onMouseEnter={() => setHoverIndex(i)}
                  onMouseLeave={() => setHoverIndex(null)}
                >
                  <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: seg.color }} />
                  <span
                    className="flex-1 min-w-0 whitespace-nowrap overflow-hidden font-medium text-ink-900 dark:text-ink-50"
                    style={FADE_TEXT_STYLE}
                  >
                    {seg.name}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const { darkMode } = useTheme();
  const [transactions, setTransactions] = useState([]);
  const [returns, setReturns] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(() => getPendingTransactions().length);
  const [pieRange, setPieRange] = useState("today");
  const [pieGroup, setPieGroup] = useState("products");
  const [expandedChart, setExpandedChart] = useState(null); // "revenue" | "margin" | "mix" | null
  const [restockProduct, setRestockProduct] = useState(null);

  // Range/granularity controls for the expanded modal only - the compact
  // cards keep their fixed views untouched. Revenue and Margin share one
  // slot since only one chart is ever expanded at a time; the pie's range
  // has no granularity (a pie is one aggregated total for the whole range,
  // not sub-buckets).
  const [expandedTrendRange, setExpandedTrendRange] = useState({
    preset: "7day",
    customStart: "",
    customEnd: "",
    granularity: "daily",
  });
  const [expandedPieRange, setExpandedPieRange] = useState({ preset: "7day", customStart: "", customEnd: "" });

  // Real-time listeners instead of one-shot fetches, matching Transactions/
  // Register - Firestore serves the cached snapshot instantly on
  // (re)subscribe, so opening this page doesn't cause a visible reload.
  useEffect(() => {
    const q = query(collection(db, "transactions"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setTransactions(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching transactions: ", error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "returns"),
      (snapshot) => setReturns(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))),
      (error) => console.error("Error fetching returns: ", error)
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "products"),
      (snapshot) => {
        setProducts(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
        setProductsLoading(false);
      },
      (error) => {
        console.error("Error fetching products: ", error);
        setProductsLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // The initial useState already reads the queue as of navigation time, so
  // this only needs to catch a queue write from another tab (e.g. a sale
  // rung up on Register in a second window) - "storage" fires in every tab
  // except the one that made the change.
  useEffect(() => {
    function handleStorage() {
      setPendingCount(getPendingTransactions().length);
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // "Today" is the cashier's local day, matching Transactions page's
  // todayStats. Revenue and profit are netted against today's processed
  // returns (same rule as Transactions) so the two pages never disagree;
  // transaction count, average basket, and top sellers are left gross -
  // they describe what was sold today, not the day's net cash movement.
  const today = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startSeconds = startOfToday.getTime() / 1000;

    const todaysTx = transactions.filter((tx) => (tx.createdAt?.seconds || 0) >= startSeconds);
    const todaysReturns = returns.filter((ret) => (ret.createdAt?.seconds || 0) >= startSeconds);

    const grossRevenue = todaysTx.reduce((sum, tx) => sum + (tx.grandTotal || 0), 0);
    const returnedRevenue = todaysReturns.reduce((sum, ret) => sum + (ret.refundAmount || 0), 0);

    const sales = computeProfit(todaysTx);
    const returnedProfit = computeProfit(todaysReturns).profit;

    const byProduct = new Map();
    for (const tx of todaysTx) {
      for (const item of tx.items || []) {
        const revenue = item.subtotal ?? (item.billedPrice || 0) * (item.weight_kg || 0);
        const existing = byProduct.get(item.id) || { id: item.id, name: item.name, revenue: 0, weight_kg: 0 };
        existing.revenue += revenue;
        existing.weight_kg += item.weight_kg || 0;
        byProduct.set(item.id, existing);
      }
    }
    const topSellers = Array.from(byProduct.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, TOP_SELLERS_LIMIT);

    return {
      count: todaysTx.length,
      netRevenue: grossRevenue - returnedRevenue,
      netProfit: sales.profit - returnedProfit,
      missingCostCount: sales.missingCostCount,
      avgBasket: todaysTx.length > 0 ? grossRevenue / todaysTx.length : 0,
      topSellers,
    };
  }, [transactions, returns]);

  // One pass over the last 7 local days, computing both revenue and margin
  // per day so the two trend charts below always describe the same slice
  // of data (and today's bar always matches the stat tiles above).
  const weeklyTrend = useMemo(() => {
    const days = [];
    for (let i = TREND_DAYS - 1; i >= 0; i--) {
      const { date, startSeconds, endSeconds } = getDayBounds(i);
      const dayTx = transactions.filter((tx) => {
        const seconds = tx.createdAt?.seconds || 0;
        return seconds >= startSeconds && seconds < endSeconds;
      });
      const dayReturns = returns.filter((ret) => {
        const seconds = ret.createdAt?.seconds || 0;
        return seconds >= startSeconds && seconds < endSeconds;
      });

      const gross = dayTx.reduce((sum, tx) => sum + (tx.grandTotal || 0), 0);
      const returnedRevenue = dayReturns.reduce((sum, ret) => sum + (ret.refundAmount || 0), 0);
      const revenue = Math.max(gross - returnedRevenue, 0);

      const profit = computeProfit(dayTx).profit - computeProfit(dayReturns).profit;
      const marginPct = revenue > 0 ? Math.max((profit / revenue) * 100, 0) : 0;

      days.push({ date, isToday: i === 0, revenue, marginPct });
    }
    return days;
  }, [transactions, returns]);

  // Live catalog category for each product id, used only to group the pie
  // by category - not snapshotted on the item at sale time (unlike price/
  // cost), so this reflects the product's *current* category, which is fine
  // for a merchandising breakdown (not a financial figure that must match
  // what was true at the moment of sale).
  const productCategoryById = useMemo(() => {
    const map = new Map();
    for (const product of products) map.set(product.id, product.category || "Uncategorized");
    return map;
  }, [products]);

  // Top sellers, by revenue, over "today" or the last 7 days (the compact
  // card's own fixed view - see aggregateTopSellers for the shared logic
  // reused by the expanded modal's range-driven view below).
  const pieEntries = useMemo(() => {
    const daysBack = pieRange === "today" ? 0 : TREND_DAYS - 1;
    const { startSeconds } = getDayBounds(daysBack);
    return aggregateTopSellers({
      transactions,
      returns,
      startSeconds,
      endSeconds: Infinity,
      groupMode: pieGroup,
      productCategoryById,
    });
  }, [transactions, returns, pieRange, pieGroup, productCategoryById]);

  const pieTotal = pieEntries.reduce((sum, e) => sum + e.value, 0);

  // Expanded-modal trend data: resolves the range picker's preset (or
  // custom start/end) into concrete bounds, splits it into buckets at the
  // chosen granularity, and aggregates each bucket the same way the compact
  // card's fixed 7-day weeklyTrend does. "Today" as a bar label only makes
  // sense at daily granularity - weekly/monthly buckets keep their own
  // label but still get the accent color when they contain "now".
  const expandedTrendBuckets = useMemo(() => {
    const { start, end } = resolveRangeBounds(
      expandedTrendRange.preset,
      expandedTrendRange.customStart,
      expandedTrendRange.customEnd
    );
    const buckets = buildDateBuckets(start, end, expandedTrendRange.granularity);
    const now = new Date().getTime();

    return buckets.map((bucket) => {
      const startSeconds = bucket.start.getTime() / 1000;
      const endSeconds = bucket.end.getTime() / 1000;
      const bucketTx = transactions.filter((tx) => {
        const seconds = tx.createdAt?.seconds || 0;
        return seconds >= startSeconds && seconds < endSeconds;
      });
      const bucketReturns = returns.filter((ret) => {
        const seconds = ret.createdAt?.seconds || 0;
        return seconds >= startSeconds && seconds < endSeconds;
      });

      const gross = bucketTx.reduce((sum, tx) => sum + (tx.grandTotal || 0), 0);
      const returnedRevenue = bucketReturns.reduce((sum, ret) => sum + (ret.refundAmount || 0), 0);
      const revenue = Math.max(gross - returnedRevenue, 0);

      const profit = computeProfit(bucketTx).profit - computeProfit(bucketReturns).profit;
      const marginPct = revenue > 0 ? Math.max((profit / revenue) * 100, 0) : 0;

      const isCurrent = bucket.start.getTime() <= now && now < bucket.end.getTime();
      const label = expandedTrendRange.granularity === "daily" && isCurrent ? "Today" : bucket.label;

      return { label, tooltipLabel: bucket.label, isCurrent, revenue, marginPct };
    });
  }, [transactions, returns, expandedTrendRange]);

  // Expanded-modal pie data: same aggregateTopSellers logic as the compact
  // card, driven by the range picker instead of the fixed "today"/"7 days"
  // choice - this is where the Today/7 Days toggle that was pulled out of
  // the compact pie card ended up living, per the range picker covering
  // 7/30/custom (no bare "Today" option here - "7 Days" is the finer-
  // grained equivalent once a real range picker exists).
  const expandedPieEntries = useMemo(() => {
    const { start, end } = resolveRangeBounds(expandedPieRange.preset, expandedPieRange.customStart, expandedPieRange.customEnd);
    return aggregateTopSellers({
      transactions,
      returns,
      startSeconds: start.getTime() / 1000,
      endSeconds: end.getTime() / 1000,
      groupMode: pieGroup,
      productCategoryById,
    });
  }, [transactions, returns, expandedPieRange, pieGroup, productCategoryById]);

  const expandedPieTotal = expandedPieEntries.reduce((sum, e) => sum + e.value, 0);

  const lowStockProducts = useMemo(
    () =>
      products
        .filter((p) => (p.stock_kg ?? 0) < LOW_STOCK_THRESHOLD_KG)
        .sort((a, b) => (a.stock_kg ?? 0) - (b.stock_kg ?? 0)),
    [products]
  );
  const visibleLowStockProducts = lowStockProducts.slice(0, LOW_STOCK_VISIBLE_LIMIT);
  const hiddenLowStockCount = lowStockProducts.length - visibleLowStockProducts.length;

  const revenueDays = weeklyTrend.map((d) => ({
    label: d.isToday ? "Today" : d.date.toLocaleDateString("en-IN", { weekday: "short" }),
    tooltipLabel: d.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    isCurrent: d.isToday,
    value: d.revenue,
  }));
  const marginDays = weeklyTrend.map((d) => ({
    label: d.isToday ? "Today" : d.date.toLocaleDateString("en-IN", { weekday: "short" }),
    tooltipLabel: d.date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    isCurrent: d.isToday,
    value: d.marginPct,
  }));

  const expandedRevenueDays = expandedTrendBuckets.map((b) => ({
    label: b.label,
    tooltipLabel: b.tooltipLabel,
    isCurrent: b.isCurrent,
    value: b.revenue,
  }));
  const expandedMarginDays = expandedTrendBuckets.map((b) => ({
    label: b.label,
    tooltipLabel: b.tooltipLabel,
    isCurrent: b.isCurrent,
    value: b.marginPct,
  }));

  const formatRupee = (v) => `₹${formatINR(v)}`;
  const formatPercent = (v) => `${v.toFixed(1)}%`;

  const expandedTitle =
    expandedChart === "revenue" ? "Revenue Trend" : expandedChart === "margin" ? "Profit Margin" : "Top Sellers";

  return (
    <main className="p-6 md:p-8 h-full flex flex-col w-full bg-cream-50 dark:bg-cream-950 min-h-screen transition-colors duration-300">
      <PageHeader title="Owner Dashboard" subtitle="Today's performance at a glance" className="flex-shrink-0" />

      <div className="mb-6 flex-shrink-0 grid grid-cols-2 lg:grid-cols-5 gap-px rounded-xl bg-warmgray-200 dark:bg-warmgray-700 overflow-hidden">
        <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Today&apos;s Revenue</p>
          {loading ? (
            <Skeleton className="h-8 w-24 mt-1.5" />
          ) : (
            <p className="text-2xl font-black text-clay-600 dark:text-clay-400 mt-1.5">₹{formatINR(today.netRevenue)}</p>
          )}
        </div>
        <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Today&apos;s Profit</p>
          {loading ? (
            <Skeleton className="h-8 w-20 mt-1.5" />
          ) : (
            <p className="text-2xl font-black text-sage-600 dark:text-sage-400 mt-1.5">₹{formatINR(today.netProfit)}</p>
          )}
          {!loading && today.missingCostCount > 0 && (
            <p className="text-[10px] font-semibold text-rust-600 dark:text-rust-400 mt-1">
              {today.missingCostCount} item{today.missingCostCount === 1 ? "" : "s"} missing cost price
            </p>
          )}
        </div>
        <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Today&apos;s Transactions</p>
          {loading ? (
            <Skeleton className="h-8 w-12 mt-1.5" />
          ) : (
            <p className="text-2xl font-black text-ink-900 dark:text-ink-50 mt-1.5">{today.count}</p>
          )}
        </div>
        <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Avg Basket Size</p>
          {loading ? (
            <Skeleton className="h-8 w-20 mt-1.5" />
          ) : (
            <p className="text-2xl font-black text-ink-900 dark:text-ink-50 mt-1.5">₹{formatINR(today.avgBasket)}</p>
          )}
        </div>
        <div className="bg-warmgray-50 dark:bg-warmgray-800/50 px-5 py-5">
          <p className="text-xs font-bold uppercase tracking-wide text-warmgray-500 dark:text-warmgray-400">Pending Sync</p>
          <p
            className={`text-2xl font-black mt-1.5 ${
              pendingCount > 0 ? "text-rust-600 dark:text-rust-400" : "text-sage-600 dark:text-sage-400"
            }`}
          >
            {pendingCount}
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {loading ? (
          <>
            <Card padding="p-5" className="flex-shrink-0">
              <Skeleton className="h-5 w-32 mb-4" />
              <Skeleton className="w-full h-40" />
            </Card>
            <Card padding="p-5" className="flex-shrink-0">
              <Skeleton className="h-5 w-32 mb-4" />
              <Skeleton className="w-full h-40" />
            </Card>
            <Card padding="p-5" className="flex-shrink-0">
              <Skeleton className="h-5 w-32 mb-4" />
              <Skeleton className="w-full h-40" />
            </Card>
          </>
        ) : (
          <>
            <TrendChart
              title="7-Day Revenue Trend"
              icon={TrendingUp}
              days={revenueDays}
              formatValue={formatRupee}
              barClass="bg-clay-300 dark:bg-clay-800"
              barTodayClass="bg-clay-600 dark:bg-clay-400"
              emptyMessage="No sales in the last 7 days."
              onExpand={() => setExpandedChart("revenue")}
            />
            <TrendChart
              title="7-Day Profit Margin"
              icon={Percent}
              days={marginDays}
              formatValue={formatPercent}
              barClass="bg-sage-300 dark:bg-sage-800"
              barTodayClass="bg-sage-600 dark:bg-sage-400"
              emptyMessage="No sales in the last 7 days."
              onExpand={() => setExpandedChart("margin")}
            />
            <BreakdownPieChart
              entries={pieEntries}
              formatValue={formatRupee}
              darkMode={darkMode}
              groupMode={pieGroup}
              onGroupChange={setPieGroup}
              emptyMessage={pieRange === "today" ? "No sales yet today." : "No sales in the last 7 days."}
              onExpand={() => setExpandedChart("mix")}
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card padding="p-0" className="overflow-hidden">
          <div className="px-6 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex items-center gap-2">
            <Award className="w-4 h-4 text-warmgray-400" />
            <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50 tracking-wide uppercase">Top Sellers Today</h2>
          </div>
          <Table variant="comfortable">
            <THead>
              <Th>Product</Th>
              <Th align="right">Kg Sold</Th>
              <Th align="right">Revenue</Th>
            </THead>
            <tbody>
              {loading ? (
                Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <Tr key={i}>
                    <Td><Skeleton className="h-4 w-32" /></Td>
                    <Td align="right"><Skeleton className="h-4 w-12 ml-auto" /></Td>
                    <Td align="right"><Skeleton className="h-4 w-16 ml-auto" /></Td>
                  </Tr>
                ))
              ) : today.topSellers.length === 0 ? (
                <tr>
                  <td colSpan="3" className="text-center py-10 text-warmgray-500 dark:text-warmgray-400">
                    No sales yet today.
                  </td>
                </tr>
              ) : (
                today.topSellers.map((product) => (
                  <Tr key={product.id}>
                    <Td className="font-medium text-ink-900 dark:text-ink-50">{product.name}</Td>
                    <Td align="right">{roundKg(product.weight_kg)}kg</Td>
                    <Td align="right" className="font-bold text-ink-900 dark:text-ink-50">
                      ₹{formatINR(product.revenue)}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>

        <Card padding="p-0" className="overflow-hidden">
          <div className="px-6 py-4 border-b border-warmgray-100 dark:border-warmgray-700 flex items-center gap-2">
            <Package className="w-4 h-4 text-warmgray-400" />
            <h2 className="text-sm font-bold text-ink-900 dark:text-ink-50 tracking-wide uppercase">Low Stock Alerts</h2>
          </div>
          {productsLoading ? (
            <Table variant="comfortable">
              <THead>
                <Th>Product</Th>
                <Th align="right">Stock</Th>
                <Th align="right">Restock</Th>
              </THead>
              <tbody>
                {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <Tr key={i}>
                    <Td><Skeleton className="h-4 w-32" /></Td>
                    <Td align="right"><Skeleton className="h-5 w-16 ml-auto rounded-full" /></Td>
                    <Td align="right"><Skeleton className="h-7 w-20 ml-auto rounded-lg" /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : lowStockProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 px-6">
              <PackageCheck className="w-8 h-8 text-sage-400 dark:text-sage-600" strokeWidth={1.5} />
              <p className="text-sm font-semibold text-warmgray-400 dark:text-warmgray-500">Everything&apos;s stocked up</p>
            </div>
          ) : (
            <>
              <Table variant="comfortable">
                <THead>
                  <Th>Product</Th>
                  <Th align="right">Stock</Th>
                  <Th align="right">Restock</Th>
                </THead>
                <tbody>
                  {visibleLowStockProducts.map((product) => {
                    const { text, bg } = getLowStockSeverity(product.stock_kg);
                    return (
                      <Tr key={product.id}>
                        <Td className="font-medium text-ink-900 dark:text-ink-50">{product.name}</Td>
                        <Td align="right">
                          <span
                            className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap"
                            style={{ color: text, backgroundColor: bg }}
                          >
                            ⚠ {product.stock_kg ?? 0}kg
                          </span>
                        </Td>
                        <Td align="right">
                          <button
                            type="button"
                            onClick={() => setRestockProduct(product)}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg text-clay-700 dark:text-clay-400 bg-clay-50 dark:bg-clay-950/40 border border-clay-200 dark:border-clay-800 hover:bg-clay-100 dark:hover:bg-clay-900 transition-colors"
                          >
                            Restock
                          </button>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
              {hiddenLowStockCount > 0 && (
                <Link
                  href="/admin?filter=low-stock"
                  className="block text-center text-xs font-bold text-clay-600 dark:text-clay-400 hover:underline px-6 py-3 border-t border-warmgray-100 dark:border-warmgray-700"
                >
                  +{hiddenLowStockCount} more · View all in Price Setup
                </Link>
              )}
            </>
          )}
        </Card>
      </div>

      <Modal
        isOpen={!!expandedChart}
        onClose={() => setExpandedChart(null)}
        title={expandedTitle}
        panelClassName="max-w-3xl max-h-[85vh]"
      >
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {expandedChart === "revenue" && (
            <>
              <div className="mb-4">
                <RangeGranularityPicker
                  preset={expandedTrendRange.preset}
                  onPresetChange={(preset) => setExpandedTrendRange((prev) => ({ ...prev, preset }))}
                  customStart={expandedTrendRange.customStart}
                  onCustomStartChange={(customStart) => setExpandedTrendRange((prev) => ({ ...prev, customStart }))}
                  customEnd={expandedTrendRange.customEnd}
                  onCustomEndChange={(customEnd) => setExpandedTrendRange((prev) => ({ ...prev, customEnd }))}
                  granularity={expandedTrendRange.granularity}
                  onGranularityChange={(granularity) => setExpandedTrendRange((prev) => ({ ...prev, granularity }))}
                />
              </div>
              <TrendChart
                title="Revenue Trend"
                icon={TrendingUp}
                days={expandedRevenueDays}
                formatValue={formatRupee}
                barClass="bg-clay-300 dark:bg-clay-800"
                barTodayClass="bg-clay-600 dark:bg-clay-400"
                emptyMessage="No sales in the selected range."
                height={EXPANDED_CHART_HEIGHT}
              />
              <div className="mt-6">
                <Table variant="comfortable">
                  <THead>
                    <Th>Date</Th>
                    <Th align="right">Revenue</Th>
                  </THead>
                  <tbody>
                    {expandedRevenueDays.map((day, i) => (
                      <Tr key={i}>
                        <Td className="font-medium text-ink-900 dark:text-ink-50">{day.tooltipLabel}</Td>
                        <Td align="right" className="font-bold text-ink-900 dark:text-ink-50">₹{formatINR(day.value)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}

          {expandedChart === "margin" && (
            <>
              <div className="mb-4">
                <RangeGranularityPicker
                  preset={expandedTrendRange.preset}
                  onPresetChange={(preset) => setExpandedTrendRange((prev) => ({ ...prev, preset }))}
                  customStart={expandedTrendRange.customStart}
                  onCustomStartChange={(customStart) => setExpandedTrendRange((prev) => ({ ...prev, customStart }))}
                  customEnd={expandedTrendRange.customEnd}
                  onCustomEndChange={(customEnd) => setExpandedTrendRange((prev) => ({ ...prev, customEnd }))}
                  granularity={expandedTrendRange.granularity}
                  onGranularityChange={(granularity) => setExpandedTrendRange((prev) => ({ ...prev, granularity }))}
                />
              </div>
              <TrendChart
                title="Profit Margin"
                icon={Percent}
                days={expandedMarginDays}
                formatValue={formatPercent}
                barClass="bg-sage-300 dark:bg-sage-800"
                barTodayClass="bg-sage-600 dark:bg-sage-400"
                emptyMessage="No sales in the selected range."
                height={EXPANDED_CHART_HEIGHT}
              />
              <div className="mt-6">
                <Table variant="comfortable">
                  <THead>
                    <Th>Date</Th>
                    <Th align="right">Margin</Th>
                  </THead>
                  <tbody>
                    {expandedMarginDays.map((day, i) => (
                      <Tr key={i}>
                        <Td className="font-medium text-ink-900 dark:text-ink-50">{day.tooltipLabel}</Td>
                        <Td align="right" className="font-bold text-ink-900 dark:text-ink-50">{day.value.toFixed(1)}%</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}

          {expandedChart === "mix" && (
            <>
              <div className="mb-4">
                <RangeGranularityPicker
                  preset={expandedPieRange.preset}
                  onPresetChange={(preset) => setExpandedPieRange((prev) => ({ ...prev, preset }))}
                  customStart={expandedPieRange.customStart}
                  onCustomStartChange={(customStart) => setExpandedPieRange((prev) => ({ ...prev, customStart }))}
                  customEnd={expandedPieRange.customEnd}
                  onCustomEndChange={(customEnd) => setExpandedPieRange((prev) => ({ ...prev, customEnd }))}
                />
              </div>
              <BreakdownPieChart
                entries={expandedPieEntries}
                formatValue={formatRupee}
                darkMode={darkMode}
                groupMode={pieGroup}
                onGroupChange={setPieGroup}
                emptyMessage="No sales in the selected range."
                size={EXPANDED_PIE_SIZE}
              />
              <div className="mt-6">
                <Table variant="comfortable">
                  <THead>
                    <Th>{pieGroup === "categories" ? "Category" : "Product"}</Th>
                    <Th align="right">Revenue</Th>
                    <Th align="right">Share</Th>
                  </THead>
                  <tbody>
                    {expandedPieEntries.map((entry) => (
                      <Tr key={entry.id}>
                        <Td className="font-medium text-ink-900 dark:text-ink-50">{entry.name}</Td>
                        <Td align="right" className="font-bold text-ink-900 dark:text-ink-50">₹{formatINR(entry.value)}</Td>
                        <Td align="right">{expandedPieTotal > 0 ? ((entry.value / expandedPieTotal) * 100).toFixed(0) : 0}%</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </div>
      </Modal>

      <EditProductModal
        key={restockProduct?.id || "none"}
        product={restockProduct}
        onClose={() => setRestockProduct(null)}
        restockMode
      />
    </main>
  );
}
