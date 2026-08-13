import * as XLSX from "xlsx";

const CATEGORY_LABEL = "category";
const ITEM_NAME_LABEL = "item name";

// Local-date parts, not toISOString() - a UTC-based ISO string can shift a
// date backward by one day for timezones ahead of UTC (exactly the case
// here, IST is UTC+5:30), silently recording the wrong "as of" date.
function toDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCell(value) {
  if (value == null) return "";
  return String(value).trim();
}

// Locates data by header label text rather than fixed column letters, so
// the parser isn't fragile to a future version of the sheet reordering
// columns - only the label text itself needs to stay stable.
export function parsePriceSheetWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("The spreadsheet has no sheets.");

  // raw: true (the default) returns each cell's actual typed value - numbers
  // as numbers, and (since XLSX.read above set cellDates: true) date cells
  // as real JS Date objects. raw: false would instead return every cell's
  // *formatted display text* per its own number format, which for a date
  // cell is whatever Excel's default date format produced (not ISO), so the
  // "yyyy-mm-dd" regex below would never match - silently dropping every
  // date rather than just the genuinely blank ones.
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  let category = "";
  let headerRowIndex = -1;
  const columnIndexByLabel = {};

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const label = normalizeCell(row[c]).toLowerCase();
      if (label === CATEGORY_LABEL && !category) {
        // Value is the next non-empty cell in the same row.
        for (let c2 = c + 1; c2 < row.length; c2++) {
          const value = normalizeCell(row[c2]);
          if (value) {
            category = value;
            break;
          }
        }
      }
      if (label === ITEM_NAME_LABEL) headerRowIndex = r;
    }
    if (headerRowIndex !== -1 && category) break;
  }

  if (headerRowIndex === -1) {
    throw new Error('Could not find the item table - no column labeled "Item Name" was found.');
  }
  if (!category) {
    throw new Error('Could not find a "Category" label with a value.');
  }

  const headerRow = rows[headerRowIndex] || [];
  headerRow.forEach((cell, c) => {
    const label = normalizeCell(cell).toLowerCase();
    if (label) columnIndexByLabel[label] = c;
  });

  const col = (label) => columnIndexByLabel[label];
  const nameCol = col(ITEM_NAME_LABEL);
  const tamilCol = col("tamil name");
  const costCol = col("purchase price");
  const wholesaleCol = col("ws");
  const retailCol = col("r");
  const asPerCol = col("as per");

  const items = [];
  const skipped = [];

  for (let r = headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = normalizeCell(row[nameCol]);
    if (!name) continue; // blank trailing rows - not an error, just end of data

    const rowNumber = r + 1; // 1-indexed, matching what a spreadsheet user sees
    const costPrice = Number(row[costCol]);
    const wholesalePrice = Number(row[wholesaleCol]);
    const retailPrice = Number(row[retailCol]);

    if (!Number.isFinite(costPrice) || !Number.isFinite(wholesalePrice) || !Number.isFinite(retailPrice)) {
      skipped.push({ rowNumber, reason: `"${name}" has a missing or non-numeric price.` });
      continue;
    }

    const rawDate = row[asPerCol];
    let priceEffectiveDate = null;
    if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) {
      priceEffectiveDate = toDateString(rawDate);
    } else if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
      priceEffectiveDate = rawDate.trim();
    }

    items.push({
      name,
      tamilName: normalizeCell(row[tamilCol]) || null,
      costPrice,
      wholesalePrice,
      retailPrice,
      priceEffectiveDate,
    });
  }

  return { category, items, skipped };
}
