import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { ColumnFilter } from './ColumnFilter'
import { PaymentCandidates } from './PaymentCandidates'
import { dateLabel, money, searchKey, type PaymentRow } from './paymentsApi'

const pageSize = 50
const columns = [
  ['name', 'Πελάτης Skroutz'],
  ['date', 'Ημερομηνία'],
  ['amount', 'Κόστος προϊόντων'],
  ['code', 'Κωδικός πελάτη ERP'],
  ['erpName', 'Επωνυμία ERP'],
] as const
type Column = typeof columns[number][0]
type Status = 'all' | 'assigned' | 'pending' | 'admin'
const collator = new Intl.Collator('el', { numeric: true, sensitivity: 'base' })

function compareValues(column: Column, left: string, right: string, descending = false) {
  if (!left || !right) return Number(!left) - Number(!right)
  const comparison = column === 'amount' ? Number(left) - Number(right) : collator.compare(left, right)
  return descending ? -comparison : comparison
}

function formatValue(column: Column, value: string) {
  if (column === 'date') return dateLabel(value)
  if (column === 'amount') return money.format(Number(value) / 100)
  return value
}

type Props = {
  rows: PaymentRow[]
  codes: Record<number, string>
  erpNamesByCode: Record<string, string[]>
  busy: boolean
  onCode: (row: number, code: string) => void
}

function erpNameFor(row: PaymentRow, code: string, namesByCode: Props['erpNamesByCode']) {
  if (!code || row.isAdmin) return ''
  if (row.code === code && row.erpName) return row.erpName
  const candidate = row.candidates.find((option) => option.code === code)
  if (candidate) return candidate.name
  return Object.hasOwn(namesByCode, code) ? namesByCode[code].join(' / ') : ''
}

export function PaymentReview({ rows, codes, erpNamesByCode, busy, onCode }: Props) {
  const [status, setStatus] = useState<Status>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ column: Column; descending: boolean }>()
  const [filters, setFilters] = useState<Partial<Record<Column, Set<string>>>>({})
  const [editing, setEditing] = useState<{ row: number; code: string }>()
  const scrollport = useRef<HTMLDivElement>(null)
  const adminCount = rows.filter((row) => row.isAdmin).length
  const completed = rows.filter((row) => !row.isAdmin && codes[row.row]?.trim()).length
  const pending = rows.length - completed - adminCount
  // Keep the focused row in place until the user finishes typing its code.
  const entries = useMemo(() => rows.map((row) => {
    const code = editing?.row === row.row ? editing.code : (codes[row.row]?.trim() ?? '')
    const values: Record<Column, string> = {
      name: row.name.trim(),
      date: row.date,
      amount: row.cents === null ? '' : String(row.cents),
      code,
      erpName: erpNameFor(row, code, erpNamesByCode),
    }
    return { row, values }
  }), [rows, editing, codes, erpNamesByCode])
  const term = searchKey(search.trim())
  const visible = entries.filter(({ row, values }) => {
    const rowStatus = row.isAdmin ? 'admin' : values.code ? 'assigned' : 'pending'
    return (status === 'all' || status === rowStatus)
      && (!term || [values.name, values.code, values.erpName, row.reference].some((value) => searchKey(value).includes(term)))
      && columns.every(([column]) => filters[column]?.has(values[column]) ?? true)
  })
  if (sort) {
    visible.sort((left, right) => compareValues(sort.column, left.values[sort.column], right.values[sort.column], sort.descending))
  }
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  useLayoutEffect(() => {
    if (scrollport.current) scrollport.current.scrollTop = 0
  }, [currentPage, filters, search, sort, status])
  const field = 'h-9 min-w-0 rounded-xl border border-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary'

  return (
    <section className="payments-glass payment-stage min-w-0 rounded-[1.75rem] p-3 sm:p-5" aria-label="Αντιστοιχίσεις πληρωμής">
      <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-2 px-2 pt-1 sm:gap-x-8">
        {([
          [completed, 'Με κωδικό', 'bg-emerald-500'],
          [pending, 'Εκκρεμούν', 'bg-amber-500'],
          [adminCount, 'Skroutz Admin', 'bg-primary'],
        ] as const).map(([count, label, color]) => (
          <div className="flex min-w-0 items-baseline gap-1.5" key={label}>
            <dt className="order-2 flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
              <span className={`size-1.5 shrink-0 rounded-full ${color}`} aria-hidden="true" />
              <span className="min-w-0">{label}</span>
            </dt>
            <dd className="font-semibold tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:px-5">
          <label className="relative min-w-0">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input type="search" className={`${field} w-full pl-9`} aria-label="Αναζήτηση πληρωμών"
              placeholder="Όνομα, κωδικός ή παραγγελία" value={search} onChange={(event) => {
                setSearch(event.target.value)
                setPage(0)
              }} />
          </label>
          <select className={`${field} w-full`} aria-label="Κατάσταση πληρωμής" value={status} onChange={(event) => {
            setStatus(event.target.value as Status)
            setPage(0)
          }}>
            <option value="all">Όλες οι γραμμές</option>
            <option value="assigned">Με κωδικό</option>
            <option value="pending">Χωρίς κωδικό</option>
            <option value="admin">Skroutz Admin</option>
          </select>
        </div>
        {Object.values(filters).some(Boolean) && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 text-sm sm:px-6">
            <span className="text-muted-foreground">Εμφανίζονται {visible.length} από {rows.length} γραμμές</span>
            <Button variant="ghost" className="h-8 text-primary" onClick={() => {
              setFilters({})
              setPage(0)
            }}>Καθαρισμός φίλτρων στηλών</Button>
          </div>
        )}
        <div ref={scrollport} className="max-h-[min(64dvh,44rem)] overflow-auto border-y border-border/60" tabIndex={0}
          role="region" aria-label="Πίνακας πληρωμών">
          <table className="w-full min-w-[64rem] table-fixed border-separate border-spacing-0 text-left text-sm">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[13%]" />
              <col className="w-[17%]" />
              <col className="w-[21%]" />
              <col className="w-[25%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="h-13">
                {columns.map(([column, label]) => {
                  const direction = sort?.column === column ? (sort.descending ? 'descending' : 'ascending') : undefined
                  const Icon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown
                  return (
                    <th key={column} scope="col" aria-sort={direction} className="border-b border-border/65 bg-primary/5 px-3 first:pl-4">
                      <div className="flex min-w-0 items-center gap-0.5">
                        <Button variant="ghost" className="h-8 min-w-0 justify-start gap-1 px-1.5 text-left text-xs font-semibold text-muted-foreground" title={label} onClick={() => {
                          setSort({ column, descending: direction === 'ascending' })
                          setPage(0)
                        }}>
                          <span className="min-w-0 truncate">{label}</span><Icon size={13} className="shrink-0" aria-hidden="true" />
                        </Button>
                        <ColumnFilter title={label} selected={filters[column]}
                          getValues={() => [...new Set(entries.map(({ values }) => values[column]))]
                            .sort((left, right) => compareValues(column, left, right))}
                          label={(value) => formatValue(column, value)} onApply={(selected) => {
                            setFilters((previous) => ({ ...previous, [column]: selected }))
                            setPage(0)
                          }} />
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(({ row }) => {
                const code = codes[row.row]?.trim() ?? ''
                const erpName = erpNameFor(row, code, erpNamesByCode)
                const erpStatus = row.isAdmin ? 'Skroutz Admin' : code ? 'Ο κωδικός δεν βρέθηκε στο export ERP' : 'Εκκρεμεί κωδικός'
                return (
                  <tr key={row.row} className="h-18 align-middle hover:bg-primary/5 [&>td]:border-b [&>td]:border-border/35">
                    <td className="px-4 pl-5">
                      <div className="truncate font-medium" title={row.name}>{row.name.trim() ? row.name : 'Χωρίς όνομα'}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground" title={row.reference}>{row.reference}</div>
                    </td>
                    <td className="px-4 tabular-nums text-muted-foreground"><div className="truncate">{dateLabel(row.date)}</div></td>
                    <td className="px-4 font-medium tabular-nums">
                      <div className="truncate">{row.cents === null ? '—' : money.format(row.cents / 100)}</div>
                    </td>
                    <td className="px-4">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <input type="text" className={`${field} w-full font-mono font-medium read-only:bg-primary/6`} value={codes[row.row] ?? ''}
                          maxLength={100} disabled={busy} readOnly={row.isAdmin} placeholder="Κενός κωδικός"
                          aria-label={`Κωδικός ERP γραμμής ${row.row}`}
                          onFocus={() => setEditing({ row: row.row, code })}
                          onBlur={() => setEditing(undefined)}
                          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                          onChange={(event) => onCode(row.row, event.target.value)} />
                        {row.candidateCount > 1 && (
                          <PaymentCandidates row={row} disabled={busy} onCode={(value) => onCode(row.row, value)} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 pr-5" aria-live="polite">
                      {erpName ? <p className="truncate" title={erpName}>{erpName}</p> : (
                        <p title={erpStatus} className={`truncate text-xs font-medium ${row.isAdmin ? 'text-primary' : 'text-amber-900 dark:text-amber-300'}`}>
                          {erpStatus}
                        </p>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!visible.length && <p className="p-5 text-sm">Δεν υπάρχουν γραμμές σε αυτό το φίλτρο.</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <span className="text-xs tabular-nums text-muted-foreground">
            {visible.length ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, visible.length)} από {visible.length}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" className="size-8" aria-label="Προηγούμενη σελίδα"
              disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></Button>
            <span className="px-1 text-xs tabular-nums text-muted-foreground">{currentPage + 1} / {pageCount}</span>
            <Button variant="outline" size="icon" className="size-8" aria-label="Επόμενη σελίδα"
              disabled={currentPage + 1 === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></Button>
          </div>
        </div>
      </div>
    </section>
  )
}
