import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, horizontalListSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, ArrowUpDown, Ban, FileText, GripVertical, RotateCcw, Trash2 } from 'lucide-react'
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '../../components/ui/button'
import { ColumnFilter } from '../payments/ColumnFilter'
import { searchKey } from '../payments/paymentsApi'
import { floorLabels, formatPrice, type Evaluated, type Row } from './rules'

const pageSize = 30
const columns = [
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
type Column = typeof columns[number]
type Key = Column['key']
type Filter = 'all' | 'changes' | 'checks' | 'export' | 'large' | 'rejected'
const collator = new Intl.Collator('el', { numeric: true, sensitivity: 'base' })
const percent = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })
const columnOrderKey = 'myoffice.repricing-column-order'
const defaults = columns.map(({ key }) => key)
const byKey = new Map(columns.map((column) => [column.key, column]))

function readColumnOrder(): Key[] {
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

function SortableHeader({ column, direction, filter, children }: {
  column: Column
  direction?: 'ascending' | 'descending'
  filter: ReactNode
  children: ReactNode
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key })
  return (
    <th ref={setNodeRef} scope="col" aria-sort={direction}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative border-b border-border/60 bg-card px-1 py-1 align-top motion-reduce:transition-none! ${isDragging ? 'z-20 shadow-md' : ''}`}>
      <div className="rounded-lg bg-primary/5 px-1">
        {children}
        <div className="flex items-center justify-between">
          <Button ref={setActivatorNodeRef} {...attributes} {...listeners} variant="ghost" size="icon"
            className="size-7 touch-none cursor-grab active:cursor-grabbing" title="Μετακίνηση στήλης"
            aria-label={`Μετακίνηση στήλης: ${column.label}`}>
            <GripVertical size={15} aria-hidden="true" />
          </Button>
          {filter}
        </div>
      </div>
    </th>
  )
}

function issue({ result }: Evaluated) {
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

function value({ row, result }: Evaluated, key: Key): string {
  if (key === 'status') return status({ row, result })
  if (key === 'delta') return result.skr === null || result.missingOriginal ? '' : formatPrice(result.delta)
  if (key === 'skrOverride') return result.skr === null ? '' : formatPrice(result.skr)
  if (key === 'siteOverride') return result.site === null ? '' : formatPrice(result.site)
  return row[key].trim()
}

function compare(column: Column, left: string, right: string, descending = false) {
  if (!left || !right) return Number(!left) - Number(!right)
  const a = Number(left.replace(',', '.'))
  const b = Number(right.replace(',', '.'))
  const comparison = 'numeric' in column && Number.isFinite(a) && Number.isFinite(b)
    ? a - b : collator.compare(left, right)
  return descending ? -comparison : comparison
}

export function RepricingTable({ entries, onOpen, onEdit, onDelete }: {
  entries: Evaluated[]
  onOpen: (id: number) => void
  onEdit: (id: number, values: Partial<Row>) => void
  onDelete: (row: Row) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [filters, setFilters] = useState<Partial<Record<Key, Set<string>>>>({})
  const [sort, setSort] = useState<{ key: Key; descending: boolean }>()
  const [group, setGroup] = useState<Key>()
  const [order, setOrder] = useState(readColumnOrder)
  const [editing, setEditing] = useState<{ entry: Evaluated; key: Key; draft: string }>()
  const [page, setPage] = useState(0)
  const scrollport = useRef<HTMLDivElement>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const orderedColumns = order.map((key) => byKey.get(key)!)
  const customized = order.some((key, index) => key !== defaults[index])

  function saveOrder(next: Key[]) {
    setOrder(next)
    try {
      localStorage.setItem(columnOrderKey, JSON.stringify(next))
    } catch {
      // The order still applies in this session.
    }
  }

  const term = searchKey(query.trim())
  const activeFilters = columns.filter(({ key }) => filters[key] !== undefined)
  const visible = entries.filter((entry) => {
    const { row, result } = editing?.entry.row.id === entry.row.id ? editing.entry : entry
    const snapshot = { row, result }
    const searchMatch = !term || [row.sku, row.product, row.minName, row.shop].some((field) => searchKey(field).includes(term))
    return searchMatch && activeFilters.every(({ key }) => filters[key]?.has(value(snapshot, key))) && (
      filter === 'all'
      || (filter === 'changes' && (result.changedSkr || result.changedSite))
      || (filter === 'checks' && !!issue(snapshot))
      || (filter === 'export' && (result.readySkr || result.readySite))
      || (filter === 'large' && result.largeChange)
      || (filter === 'rejected' && row.excluded)
    )
  })
  const grouping = columns.find(({ key }) => key === group)
  const sorting = columns.find(({ key }) => key === sort?.key)
  const viewValue = (entry: Evaluated, key: Key) => value(editing?.entry.row.id === entry.row.id ? editing.entry : entry, key)
  if (grouping || sorting) {
    visible.sort((left, right) => {
      if (grouping) {
        const a = viewValue(left, grouping.key)
        const b = viewValue(right, grouping.key)
        if (a !== b) return compare(grouping, a, b, sort?.key === grouping.key && sort.descending) || (a < b ? -1 : 1)
      }
      return sorting ? compare(sorting, viewValue(left, sorting.key), viewValue(right, sorting.key), sort?.descending) : 0
    })
  }
  const groupCounts = new Map<string, number>()
  if (grouping) for (const entry of visible) {
    const key = viewValue(entry, grouping.key)
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1)
  }
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  useLayoutEffect(() => {
    if (scrollport.current) scrollport.current.scrollTop = 0
  }, [current, filters, filter, group, query, sort])
  const control = 'h-10 min-w-0 rounded-xl border border-border bg-background px-3 text-sm'

  return (
    <section aria-label="Πίνακας προϊόντων" className="min-w-0 overflow-hidden rounded-2xl border border-border/65 bg-card">
      <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_17rem] sm:px-5">
        <input type="search" aria-label="Αναζήτηση προϊόντων" placeholder="Αναζήτηση ονόματος, SKU ή καταστήματος"
          className={control} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} />
        <select className={control} aria-label="Φίλτρο γραμμών" value={filter} onChange={(event) => {
          setFilter(event.target.value as Filter)
          setPage(0)
        }}>
          <option value="all">Όλα τα προϊόντα</option>
          <option value="changes">Με αλλαγές</option>
          <option value="checks">Χρειάζονται έλεγχο</option>
          <option value="large">Μεγάλες αλλαγές (≥1 € ή ≥10%)</option>
          <option value="export">Προς εξαγωγή</option>
          <option value="rejected">Απορριφθέντα</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-xs text-muted-foreground sm:px-5">
        <span>Σύρε τη λαβή μιας επικεφαλίδας για να αλλάξεις τη σειρά των στηλών.</span>
        {customized && <Button variant="ghost" className="h-7 text-xs" onClick={() => saveOrder(defaults)}>Επαναφορά σειράς στηλών</Button>}
      </div>
      {(!!activeFilters.length || grouping) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-sm sm:px-5">
          <span>{visible.length} από {entries.length} γραμμές</span>
          <div className="flex flex-wrap items-center gap-2">
            {grouping && <Button variant="outline" className="h-8" onClick={() => { setGroup(undefined); setPage(0) }}>
              Κατάργηση ομαδοποίησης · {grouping.label}
            </Button>}
            {!!activeFilters.length && <Button variant="ghost" className="h-8" onClick={() => { setFilters({}); setPage(0) }}>Καθαρισμός φίλτρων στηλών</Button>}
          </div>
        </div>
      )}
      <div ref={scrollport} className="max-h-[min(62dvh,42rem)] overflow-auto border-y border-border/60"
        role="region" aria-label="Τιμές προϊόντων" tabIndex={0}>
        <DndContext sensors={sensors} collisionDetection={closestCenter}
          modifiers={[({ transform }) => ({ ...transform, y: 0 })]}
          accessibility={{ screenReaderInstructions: { draggable: 'Πάτησε κενό, χρησιμοποίησε τα αριστερό και δεξί βέλος και πάτησε ξανά κενό για τοποθέτηση.' } }}
          onDragEnd={({ active, over }) => {
            if (!over || active.id === over.id) return
            const from = order.indexOf(active.id as Key)
            const to = order.indexOf(over.id as Key)
            if (from >= 0 && to >= 0) saveOrder(arrayMove(order, from, to))
          }}>
        <SortableContext items={order} strategy={horizontalListSortingStrategy}>
        <table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm [--actions-width:42px] [--product-width:260px] sm:[--actions-width:112px] sm:[--product-width:320px]"
          style={{ minWidth: `calc(var(--actions-width) + var(--product-width) + ${columns.filter(({ key }) => key !== 'product').reduce((total, column) => total + column.width, 0)}px)` }}>
          <colgroup><col style={{ width: 'var(--actions-width)' }} />{orderedColumns.map(({ key, width }) => <col key={key} style={{ width: key === 'product' ? 'var(--product-width)' : width }} />)}</colgroup>
          <thead className="sticky top-0 z-10 bg-card text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="border-b border-border/60 bg-primary/5 px-2 py-2"><span className="sr-only sm:not-sr-only">Ενέργειες</span></th>
              {orderedColumns.map((column) => {
                const { key, label } = column
                const direction = sort?.key === key ? (sort.descending ? 'descending' : 'ascending') : undefined
                const Arrow = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown
                return (
                  <SortableHeader key={key} column={column} direction={direction} filter={
                    <ColumnFilter title={label} selected={filters[key]} label={(field) => field}
                      getValues={() => [...new Set(entries.map((entry) => value(entry, key)))].sort((a, b) => compare(column, a, b))}
                      onGroup={() => { setGroup(key); setPage(0) }}
                      onApply={(selection) => { setFilters((previous) => ({ ...previous, [key]: selection })); setPage(0) }} />
                  }>
                      <Button variant="ghost" className="h-8 w-full min-w-0 justify-start gap-0.5 px-1 text-left text-xs font-semibold" title={label} onClick={() => {
                        setSort({ key, descending: direction === 'ascending' })
                        setPage(0)
                      }}>
                        <span className="truncate">{label}</span><Arrow className="shrink-0" size={11} aria-hidden="true" />
                      </Button>
                  </SortableHeader>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.slice(current * pageSize, (current + 1) * pageSize).map((entry, index) => {
              const { row, result } = entry
              const label = row.sku || String(row.id)
              const groupValue = grouping ? viewValue(entry, grouping.key) : ''
              const showGroup = grouping && (index === 0 || viewValue(visible[current * pageSize + index - 1], grouping.key) !== groupValue)
              return (
                <Fragment key={row.id}>
                {showGroup && (
                  <tr className="bg-primary/8">
                    <th colSpan={columns.length + 1} className="px-3 py-2 text-xs font-semibold text-primary">
                      {grouping.label} · {groupValue || '(Κενά)'} · {groupCounts.get(groupValue)}
                    </th>
                  </tr>
                )}
                <tr className={`h-14 hover:bg-primary/5 [&>td]:border-b [&>td]:border-border/45 ${row.excluded ? 'bg-background text-muted-foreground' : ''}`}
                  onDoubleClick={(event) => {
                    if (!(event.target instanceof Element && event.target.closest('button, input, textarea'))) onOpen(row.id)
                  }}>
                  <td className="px-1 sm:px-2">
                    <div className="flex flex-col items-center gap-0.5 sm:flex-row sm:gap-1">
                      <Button variant="ghost" size="icon" className="size-7 sm:size-8" title="Λεπτομέρειες" aria-label={`Λεπτομέρειες ${label}`} onClick={() => onOpen(row.id)}>
                        <FileText size={16} aria-hidden="true" />
                      </Button>
                      <Button variant={row.excluded ? 'outline' : 'ghost'} size="icon" className="size-7 sm:size-8"
                        title={row.excluded ? 'Επαναφορά στο export' : 'Απόρριψη'} aria-label={`${row.excluded ? 'Επαναφορά' : 'Απόρριψη'} ${label}`}
                        onClick={() => onEdit(row.id, { excluded: !row.excluded })}>
                        {row.excluded ? <RotateCcw size={15} aria-hidden="true" /> : <Ban size={15} aria-hidden="true" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7 text-red-700 sm:size-8 dark:text-red-300" title="Διαγραφή"
                        aria-label={`Διαγραφή ${label}`} onClick={() => onDelete(row)}><Trash2 size={15} aria-hidden="true" /></Button>
                    </div>
                  </td>
                  {orderedColumns.map((column) => {
                    const { key, label: title } = column
                    const display = value(entry, key)
                    if (key === 'delta') {
                      return (
                        <td key={key} className={`px-3 tabular-nums ${result.largeChange ? 'bg-amber-500/10 font-semibold text-amber-900 dark:text-amber-200' : ''}`}>
                          <span className="block truncate">{display ? `${result.delta > 0 ? '+' : ''}${display} €` : '—'}</span>
                          {result.deltaPercent !== null && result.delta !== 0 && <span className="block text-xs">{percent.format(result.deltaPercent)}%</span>}
                        </td>
                      )
                    }
                    if (key === 'sourceOur' || key === 'status') return (
                      <td key={key} className={`truncate px-3 ${key === 'status' ? 'text-xs text-muted-foreground' : 'tabular-nums'}`}
                        title={display}>{display || '—'}</td>
                    )
                    const override = key === 'skrOverride' || key === 'siteOverride'
                    const focused = editing?.entry.row.id === row.id && editing.key === key
                    const inputValue = override ? (focused ? editing.draft : (row[key] || display)) : row[key]
                    if (key === 'product') {
                      const titleStyle = 'col-start-1 row-start-1 min-w-0 rounded-lg border border-transparent px-2 py-1.5 text-sm leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]'
                      return (
                        <td key={key} className="px-2 py-1.5">
                          <div className="grid min-w-0">
                            <span aria-hidden="true" className={`${titleStyle} invisible`}>{row.product}{' '}</span>
                            <textarea aria-label={`${title} · ${row.id}`} rows={1} value={row.product} placeholder="—"
                              className={`${titleStyle} w-full resize-none overflow-hidden bg-transparent hover:border-border/70 focus:border-primary focus:bg-background`}
                              onFocus={() => setEditing({ entry, key, draft: row.product })} onBlur={() => setEditing(undefined)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                  event.preventDefault()
                                  event.currentTarget.blur()
                                }
                              }}
                              onChange={(event) => onEdit(row.id, { product: event.target.value })} />
                          </div>
                        </td>
                      )
                    }
                    return (
                      <td key={key} className="px-2">
                        <input aria-label={`${title} · ${row.id}`} value={inputValue} title={inputValue}
                          inputMode={'numeric' in column ? 'decimal' : 'text'}
                          className={`h-9 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-sm hover:border-border/70 focus:border-primary focus:bg-background ${override ? 'font-semibold placeholder:text-foreground' : ''}`}
                          placeholder="—"
                          onFocus={() => setEditing({ entry, key, draft: inputValue })} onBlur={() => setEditing(undefined)}
                          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                          onChange={(event) => {
                            const next = event.target.value
                            if (override) setEditing((previous) => previous && { ...previous, draft: next })
                            onEdit(row.id, { [key]: next })
                          }} />
                        {key === 'minSkr' && (
                          <span className={`block truncate px-2 pb-1 text-[11px] ${result.skrCheck === 'ok' ? 'text-emerald-800 dark:text-emerald-300' : 'text-amber-900 dark:text-amber-200'}`}
                            title={floorLabels[result.skrCheck]}>
                            {result.skrCheck === 'ok' ? 'Όριο ΟΚ' : result.skrCheck === 'missing' ? 'Χωρίς ελάχιστη' : result.skrCheck === 'invalid' ? 'Έλεγχος τιμής' : 'Κάτω από όριο'}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
        </SortableContext>
        </DndContext>
        {!visible.length && <p className="p-5 text-sm text-muted-foreground">Δεν βρέθηκαν γραμμές.</p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted-foreground sm:px-5">
        <span>{visible.length ? current * pageSize + 1 : 0}–{Math.min((current + 1) * pageSize, visible.length)} από {visible.length}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-8" disabled={!current} onClick={() => setPage(current - 1)}>Προηγούμενη</Button>
          <span>{current + 1} / {pageCount}</span>
          <Button variant="outline" className="h-8" disabled={current + 1 === pageCount} onClick={() => setPage(current + 1)}>Επόμενη</Button>
        </div>
      </div>
    </section>
  )
}
