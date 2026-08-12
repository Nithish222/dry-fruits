"use client";

export default function ToggleGroup({ options, value, onChange }) {
  return (
    <div className="inline-flex bg-warmgray-100 dark:bg-warmgray-800 p-0.5 rounded-lg text-[10px] font-bold border border-warmgray-200 dark:border-warmgray-700">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-1.5 py-1 rounded-md transition-all whitespace-nowrap ${
            value === opt.value
              ? "bg-clay-400 text-white shadow-sm"
              : "text-warmgray-600 dark:text-warmgray-400 hover:text-ink-900 dark:hover:text-ink-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
