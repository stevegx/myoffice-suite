import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { EmptyState, ErrorState } from '../../components/ui/feedback'
import { ColumnFilter } from '../payments/ColumnFilter'
import { catalogSearch } from '../orders/catalogSearch'
import { editPrice, money, type Product } from '../orders/orderData'
import { BulkToolbar, orderCheckbox, SelectPage } from '../orders/OrderSelection'
import { CatalogBulkDialog } from './CatalogBulkDialog'
import { editedPrice, priceUnits, type CatalogEdit } from './catalogEdits'
import { suggestedProducts, type SupplierRow } from './matching'

const pageSize = 30
const columns = ['Προϊόν προμηθευτή', 'Φύλλο', 'Προηγούμενη', 'Νέα τιμή', 'Διαθεσιμότητα', 'ERP SKU']
const collator = new Intl.Collator('el', { numeric: true, sensitivity: 'base' })
const filterLabel = (value: string) => value
const control = 'h-9 min-w-0 rounded-lg border border-border/70 bg-background px-2.5 text-sm'
export type Preview = { revision: number; rows: SupplierRow[]; removed: SupplierRow[]; referencesChecked?: boolean }

export function CatalogReview({ preview, products, decisions, edits, disabled, onChange, onRestore }: {
  preview: Preview; products: Product[]; decisions: Record<string, string>; edits: Record<string, CatalogEdit>; disabled: boolean
  onChange: (edits: ReadonlyMap<string, CatalogEdit>) => void; onRestore: (keys: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState<Record<number, Set<string> | undefined>>({})
  const [sort, setSort] = useState<{ index: number; descending: boolean }>()
  const [editing, setEditing] = useState<SupplierRow>()
  const [erpQuery, setErpQuery] = useState('')
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set())
  const [bulk, setBulk] = useState<'edit' | 'exclude'>()
  const [inputError, setInputError] = useState('')
  const bySku = useMemo(() => new Map(products.map((item) => [item.sku, item])), [products])
  const removed = filter === 'removed'
  const candidates = useMemo(() => {
    const match = catalogSearch(query)
    return (filter === 'removed' ? preview.removed : preview.rows).filter((row) => {
      const sku = decisions[row.key] ?? row.erpSku
      if (!match(`${row.code} ${row.name} ${sku}`)) return false
      if (filter === 'unmatched') return !sku
      if (filter === 'unregistered') return !edits[row.key]?.erpSku && !row.erpSku && !row.inReference
      if (filter === 'changed') return row.existing && editedPrice(row, edits[row.key]) !== row.previousPrice
      if (filter === 'new') return !row.existing
      if (filter === 'missing') return editedPrice(row, edits[row.key]) === null
      if (filter === 'edited') return Object.hasOwn(edits, row.key)
      return true
    }).map((row) => {
      const values = [`${row.name}${row.code ? ` · ${row.code}` : ''}`, row.source,
        removed ? row.price : row.previousPrice, removed ? null : editedPrice(row, edits[row.key]),
        removed ? row.availability : edits[row.key]?.availability ?? row.availability,
        (removed ? row.erpSku : decisions[row.key]) || '']
      const labels = values.map((value) => typeof value === 'number' ? money(value) : value ?? '')
      return { row, values, labels }
    })
  }, [preview, query, filter, decisions, edits, removed])
  const rows = useMemo(() => {
    const selected = candidates.filter(({ labels }) => labels.every((value, index) => filters[index]?.has(value) ?? true))
    if (sort) selected.sort((left, right) => {
      const a = left.values[sort.index], b = right.values[sort.index]
      if (a == null || a === '') return b == null || b === '' ? 0 : 1
      if (b == null || b === '') return -1
      const comparison = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b))
      return sort.descending ? -comparison : comparison
    })
    return selected.map(({ row }) => row)
  }, [candidates, filters, sort])
  const results = useMemo(() => {
    if (!editing) return []
    if (!erpQuery.trim()) return suggestedProducts(editing, products)
    const match = catalogSearch(erpQuery)
    return products.filter(({ sku, name }) => match(`${sku} ${name}`)).slice(0, 12)
  }, [editing, erpQuery, products])
  const last = Math.max(0, Math.ceil(rows.length / pageSize) - 1)
  const current = Math.min(page, last)
  const visible = rows.slice(current * pageSize, (current + 1) * pageSize)
  const selectedVisible = checked.size ? rows.filter(({ key }) => checked.has(key)).length : 0

  function select(keys: string[], selected: boolean) {
    setChecked((previous) => {
      const next = new Set(previous)
      for (const key of keys) {
        if (selected) next.add(key)
        else next.delete(key)
      }
      return next
    })
  }

  function change(key: string, edit: CatalogEdit) {
    setInputError('')
    onChange(new Map([[key, edit]]))
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_15rem]">
        <input className={control} type="search" aria-label="Αναζήτηση στον κατάλογο" placeholder="Κωδικός ή όνομα · π.χ. *gold* *label*" value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0) }} />
        <select className={control} aria-label="Φίλτρο καταλόγου" value={filter} onChange={(e) => { setFilter(e.target.value); setFilters({}); setPage(0); setEditing(undefined) }}>
          <option value="all">Όλες οι γραμμές</option><option value="unmatched">Χωρίς αντιστοίχιση</option>
          <option value="unregistered" disabled={!preview.referencesChecked}>
            {preview.referencesChecked ? 'Χωρίς καταχώριση στο DB ή Merge' : 'Χωρίς καταχώριση · απαιτούνται DB και Merge'}
          </option>
          <option value="changed">Αλλαγές τιμών</option><option value="new">Νέες γραμμές</option>
          <option value="missing">Χωρίς τιμή</option><option value="edited">Με χειροκίνητες διορθώσεις</option>
          <option value="removed">Λείπουν από τον νέο κατάλογο</option>
        </select>
      </div>
      {!removed && <BulkToolbar count={checked.size} visible={rows.length} selectedVisible={selectedVisible} disabled={disabled}
        deleteLabel="Μαζική εξαίρεση" onAll={() => setChecked(new Set(rows.map(({ key }) => key)))}
        onEdit={() => setBulk('edit')} onDelete={() => setBulk('exclude')} onClear={() => setChecked(new Set())} />}
      {inputError && <ErrorState title="Η αλλαγή δεν εφαρμόστηκε" detail={inputError} />}
      {editing && <section aria-label="Αντιστοίχιση ERP SKU" className="rounded-xl border border-primary/35 bg-primary/5 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0"><h3 className="font-semibold">Επιλογή ERP SKU</h3><p className="wrap-break-word text-sm text-muted-foreground">{editing.name} · {editing.volume ? `${editing.volume} ml` : 'άγνωστος όγκος'}</p></div>
          <Button variant="ghost" className="h-8" onClick={() => setEditing(undefined)}>Κλείσιμο</Button>
        </div>
        <input type="search" aria-label="Αναζήτηση ERP SKU" placeholder="Αναζήτηση στο ERP" className={`${control} mt-2 w-full`} value={erpQuery} onChange={(e) => setErpQuery(e.target.value)} />
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {results.map((item) => <Button key={item.sku} variant="outline" disabled={disabled}
            className="h-auto min-h-9 justify-start wrap-break-word px-2 py-1.5 text-left text-xs"
            onClick={() => { change(editing.key, { erpSku: item.sku }); setEditing(undefined) }}>{item.sku} · {item.name}</Button>)}
        </div>
        {!results.length && <p className="mt-2 text-sm text-muted-foreground">Δεν βρέθηκαν υποψήφια προϊόντα. Δοκίμασε με τον κωδικό ERP.</p>}
        <Button variant="ghost" className="mt-2 h-8" disabled={disabled}
          onClick={() => { change(editing.key, { erpSku: '' }); setEditing(undefined) }}>Εξαίρεση από αυτόν τον κατάλογο</Button>
      </section>}
      {(candidates.length > 0 || Object.values(filters).some(Boolean)) && (
        <div className="max-h-[62vh] overflow-auto rounded-xl border border-border/65 bg-card" role="region" aria-label="Γραμμές καταλόγου" tabIndex={0}>
          <table className="w-full min-w-[59rem] text-left text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr>{!removed && <th scope="col" className="w-10 px-3">
                <SelectPage ids={visible.map(({ key }) => key)} checked={checked} onSelect={select} disabled={disabled} />
              </th>}
              {columns.map((name, index) => <th key={name} scope="col" className="px-3 py-3"
                aria-sort={sort?.index === index ? sort.descending ? 'descending' : 'ascending' : 'none'}>
                <div className="flex items-center gap-1">
                  <button type="button" className="text-left hover:text-primary" onClick={() => {
                    setSort({ index, descending: sort?.index === index && !sort.descending })
                    setPage(0)
                  }}>{name} {sort?.index === index ? sort.descending ? '↓' : '↑' : '↕'}</button>
                  <ColumnFilter title={name} label={filterLabel} searchMatcher={catalogSearch} selected={filters[index]}
                    getValues={() => [...new Set(candidates.map(({ labels }) => labels[index]))].sort(collator.compare)}
                    onApply={(selection) => { setFilters({ ...filters, [index]: selection }); setPage(0) }} />
                </div>
              </th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {visible.map((row) => {
                const sku = removed ? row.erpSku : decisions[row.key]
                const selected = !removed && checked.has(row.key)
                const label = row.code || row.name
                const price = editPrice(editedPrice(row, edits[row.key]))
                const availability = edits[row.key]?.availability ?? row.availability
                return <tr key={row.key} className={selected ? 'bg-primary/10' : 'hover:bg-primary/5'}>
                  {!removed && <td className="px-3"><input type="checkbox" className={orderCheckbox} aria-label={`Επιλογή ${label}`}
                    checked={selected} disabled={disabled} onChange={(e) => select([row.key], e.target.checked)} /></td>}
                  <td className="max-w-80 px-3 py-2"><span className="block text-xs font-medium text-primary">{[row.code, row.volume && `${row.volume} ml`].filter(Boolean).join(' · ') || '---'}</span><span className="wrap-break-word font-medium">{row.name}</span></td>
                  <td className="px-3 text-xs">{row.source}</td>
                  <td className="px-3 tabular-nums">{money(removed ? row.price : row.previousPrice)}</td>
                  <td className="px-3 py-2 font-semibold tabular-nums">{removed ? '---' : <input key={price} className={`${control} w-28`}
                    aria-label={`Τιμή ${label}`} inputMode="decimal" defaultValue={price} placeholder="---" maxLength={15} disabled={disabled}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    onBlur={(e) => {
                      const text = e.currentTarget.value.trim()
                      if (text === price) return
                      const units = priceUnits(text)
                      if (text && units === null) {
                        e.currentTarget.value = price
                        setInputError(`Στο «${label}» χρειάζεται θετική τιμή με έως τέσσερα δεκαδικά ή κενό.`)
                        return
                      }
                      change(row.key, { price: units })
                    }} />}</td>
                  <td className="px-3 py-2 text-xs">{removed ? row.availability || '---' : <input key={availability} className={`${control} w-36`}
                    aria-label={`Διαθεσιμότητα ${label}`} defaultValue={availability} placeholder="---" maxLength={120} disabled={disabled}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                    onBlur={(e) => {
                      const value = e.currentTarget.value.trim()
                      if (value !== availability) change(row.key, { availability: value })
                    }} />}</td>
                  <td className="max-w-64 px-3 py-2">
                    {removed ? sku || '---' : <div className="flex flex-wrap gap-1">
                      <input key={sku} className={`${control} w-32`} aria-label={`ERP SKU ${label}`}
                        defaultValue={sku || ''} placeholder="ERP SKU" maxLength={80} disabled={disabled}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        onBlur={(e) => {
                          const value = e.currentTarget.value.trim()
                          if (value === (sku || '')) return
                          if (value && !bySku.has(value)) {
                            e.currentTarget.value = sku || ''
                            setInputError(`Το SKU «${value}» δεν υπάρχει στο Catalog Merge.`)
                            return
                          }
                          change(row.key, { erpSku: value })
                        }} />
                      <Button variant="outline" disabled={disabled} className="h-8 px-2 text-xs"
                        aria-label={`Αντιστοίχιση ${row.code || row.name}`} onClick={() => { setEditing(row); setErpQuery('') }}>Εύρεση SKU</Button>
                    </div>}
                    {sku && <span className="mt-1 block wrap-break-word text-xs text-muted-foreground">{bySku.get(sku)?.name}</span>}
                    {!removed && Object.hasOwn(edits, row.key) && <Button variant="ghost" className="mt-1 h-7 px-1 text-xs"
                      disabled={disabled} aria-label={`Επαναφορά ${label}`} onClick={() => { setInputError(''); onRestore([row.key]) }}>Επαναφορά</Button>}
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      )}
      {!rows.length && <EmptyState>Δεν υπάρχουν γραμμές για αυτό το φίλτρο.</EmptyState>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{rows.length} γραμμές · Σελίδα {current + 1} από {last + 1}</span>
        <div className="flex gap-2">
          <Button variant="outline" className="h-8" disabled={!current} onClick={() => setPage(current - 1)}>Προηγούμενη</Button>
          <Button variant="outline" className="h-8" disabled={current === last} onClick={() => setPage(current + 1)}>Επόμενη</Button>
        </div>
      </div>
      {bulk && <CatalogBulkDialog rows={preview.rows.filter(({ key }) => checked.has(key))} hidden={checked.size - selectedVisible}
        excluded={bulk === 'exclude'} edits={edits} products={bySku}
        onApply={(changes) => { setInputError(''); onChange(changes) }}
        onRestore={(keys) => { setInputError(''); onRestore(keys) }} onClose={() => setBulk(undefined)} />}
    </div>
  )
}
