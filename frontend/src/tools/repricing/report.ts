import { cents, floorLabels, type Evaluated } from './rules'
import { byKey, value, type Key } from './tableColumns'

type ReportCell = string | number | null
type Format = 'text' | 'price' | 'integer' | 'percent'
type ReportColumn = {
  label: string
  format: Format
  width: number
  read: (entry: Evaluated) => ReportCell
}

const priceColumns = new Set<Key>(['our', 'cheapest', 'minSkr', 'minSite', 'sourceOur', 'skrOverride', 'siteOverride', 'delta'])

function asPrice(amount: number | null, fallback = ''): ReportCell {
  return amount === null ? fallback || null : amount / 100
}

function tableColumn(key: Key): ReportColumn {
  const column = byKey.get(key)!
  const format = priceColumns.has(key) ? 'price' : key === 'rank' || key === 'competitors' ? 'integer' : 'text'
  return {
    label: key === 'delta' ? 'Μεταβολή €' : column.label,
    format,
    width: Math.max(15, Math.round(column.width / 6)),
    read(entry) {
      const { row, result } = entry
      if (key === 'delta') return result.skr === null || result.missingOriginal ? null : asPrice(result.delta)
      if (key === 'skrOverride') return asPrice(result.skr, row.skrOverride)
      if (key === 'siteOverride') return asPrice(result.site, row.siteOverride)
      const displayed = value(entry, key)
      if (format === 'price') return asPrice(cents(displayed), displayed)
      if (format === 'integer' && /^\d{1,15}$/.test(displayed)) return Number(displayed)
      return displayed || null
    },
  }
}

const details: ReportColumn[] = [
  { label: 'Μεταβολή %', format: 'percent', width: 15, read: ({ result }) => result.deltaPercent === null ? null : result.deltaPercent / 100 },
  { label: 'Έλεγχος ελαχ. Skroutz', format: 'text', width: 38, read: ({ result }) => floorLabels[result.skrCheck] },
  { label: 'Έλεγχος ελαχ. site', format: 'text', width: 38, read: ({ result }) => floorLabels[result.siteCheck] },
  { label: 'Αιτιολόγηση', format: 'text', width: 48, read: ({ result }) => result.reason },
  { label: 'Προειδοποίηση', format: 'text', width: 44, read: ({ result }) => result.warning || null },
  { label: 'Export Skroutz', format: 'text', width: 18, read: ({ result }) => result.readySkr ? 'Ναι' : 'Όχι' },
  { label: 'Export site', format: 'text', width: 18, read: ({ result }) => result.readySite ? 'Ναι' : 'Όχι' },
]

function sortDelta({ result }: Evaluated) {
  return result.skr === null || result.missingOriginal ? -1_000_000_000 : result.delta
}

export function buildReport(entries: Evaluated[], order: Key[]) {
  const columns = [...order.map(tableColumn), ...details]
  return {
    columns: columns.map(({ label, format, width }) => ({ label, format, width })),
    rows: [...entries].sort((left, right) => sortDelta(right) - sortDelta(left))
      .map((entry) => columns.map(({ read }) => read(entry))),
  }
}
