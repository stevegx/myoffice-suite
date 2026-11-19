import { useState } from 'react'
import { ColumnFilter } from '../payments/ColumnFilter'
import { catalogSearch } from './catalogSearch'

type Cell = string | number | null | undefined
const collator = new Intl.Collator('el', { numeric: true, sensitivity: 'base' })
const label = (value: Cell) => value == null ? '' : String(value)

export function useTableView<T>(items: T[], values: (item: T) => Cell[]) {
  const [filters, setFilters] = useState<Record<number, Set<string> | undefined>>({})
  const [sort, setSort] = useState<{ index: number; descending: boolean }>()
  const rows = items.filter((item) => values(item).every((value, index) => filters[index]?.has(label(value)) ?? true))
  if (sort) rows.sort((left, right) => {
    const a = values(left)[sort.index], b = values(right)[sort.index]
    if (a == null || a === '') return b == null || b === '' ? 0 : 1
    if (b == null || b === '') return -1
    const delta = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b))
    return sort.descending ? -delta : delta
  })
  const header = (title: string, index: number) => <div className="flex items-center gap-1">
    <button type="button" className="text-left hover:text-primary" onClick={() =>
      setSort({ index, descending: sort?.index === index && !sort.descending })}>
      {title} {sort?.index === index ? sort.descending ? '↓' : '↑' : '↕'}
    </button>
    <ColumnFilter title={title} label={(value) => value} searchMatcher={catalogSearch} selected={filters[index]}
      getValues={() => [...new Set(items.map((item) => label(values(item)[index])))].sort(collator.compare)}
      onApply={(selection) => setFilters({ ...filters, [index]: selection })} />
  </div>
  return { rows, header, clear: () => { setFilters({}); setSort(undefined) } }
}
