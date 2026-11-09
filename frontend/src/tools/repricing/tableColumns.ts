import { floorLabels, formatPrice, type Evaluated } from './rules'

export const columns = [
  { key: 'product', label: 'Προϊόν', width: 320 },
  { key: 'sku', label: 'SKU', width: 105 },
  { key: 'our', label: 'Τιμή Skroutz', width: 105, numeric: true },
  { key: 'cheapest', label: 'Φθηνότερος', width: 105, numeric: true },
  { key: 'minSkr', label: 'Ελαχ. Skroutz', width: 121, numeric: true },
  { key: 'skrOverride', label: 'Νέα Skroutz', width: 116, numeric: true },
  { key: 'status', label: 'Έλεγχος', width: 190 },
  { key: 'delta', label: 'Μεταβολή', width: 108, numeric: true },
  { key: 'siteOverride', label: 'Νέα site', width: 105, numeric: true },
  { key: 'sourceOur', label: 'Αρχική Skroutz', width: 132, numeric: true },
  { key: 'minSite', label: 'Ελαχ. site', width: 118, numeric: true },
  { key: 'shop', label: 'Shop', width: 138 },
  { key: 'rank', label: 'Rank', width: 91, numeric: true },
  { key: 'competitors', label: 'Competitors', width: 128, numeric: true },
  { key: 'minName', label: 'Όνομα ελαχίστων', width: 215 },
] as const
export type Column = typeof columns[number]
export type Key = Column['key']
export const columnOrderKey = 'myoffice.repricing-column-order'
export const defaults = columns.map(({ key }) => key)
export const byKey = new Map(columns.map((column) => [column.key, column]))

export function readColumnOrder(): Key[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(columnOrderKey) ?? 'null')
    if (Array.isArray(stored)) {
      const valid = stored.filter((key): key is Key => byKey.has(key))
      return [...new Set([...valid, ...defaults])]
    }
  } catch {
    // A blocked or stale preference should not prevent editing.
  }
  return defaults
}

export function issue({ result }: Evaluated) {
  return result.duplicate ? 'Διπλό SKU'
    : result.missingIdentity ? 'Λείπει όνομα ή SKU'
      : result.missingOriginal ? 'Μη έγκυρη αρχική τιμή'
        : result.warning ? 'Έλεγχος κατάταξης / τιμής'
          : result.skrCheck !== 'ok' ? floorLabels[result.skrCheck]
            : result.siteCheck !== 'ok' ? `Site · ${floorLabels[result.siteCheck]}`
              : result.site !== null && result.skr !== null && result.site >= result.skr ? 'Site ≥ Skroutz' : ''
}

function status(entry: Evaluated) {
  const { row, result } = entry
  if (row.excluded) return 'Απορρίφθηκε'
  if (result.readySkr || result.readySite) return issue(entry) || 'Προς έγκριση'
  return issue(entry) || (result.changedSkr || result.changedSite ? 'Εκτός export' : 'Χωρίς αλλαγή')
}

export function value({ row, result }: Evaluated, key: Key): string {
  if (key === 'status') return status({ row, result })
  if (key === 'delta') return result.skr === null || result.missingOriginal ? '' : formatPrice(result.delta)
  if (key === 'skrOverride') return result.skr === null ? '' : formatPrice(result.skr)
  if (key === 'siteOverride') return result.site === null ? '' : formatPrice(result.site)
  return row[key].trim()
}
