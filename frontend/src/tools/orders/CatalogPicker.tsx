import { Check, Plus, Search, Tags, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/feedback'
import { catalogSearch } from './catalogSearch'
import { type OrderAction } from './OrderBulkDialog'
import { BulkToolbar, orderCheckbox, ProductFields, SelectPage } from './OrderSelection'
import { bestOffer, effectiveOffers, money, supplierPrice, type Draft } from './orderData'

const pageSize = 30
const control = 'h-10 min-w-0 rounded-lg border border-border bg-background px-3 text-sm'

export function CatalogPicker({ rows, suppliers, ordered, checked, setChecked, onAdd, onAction, onChange, onSkuChange }: {
  rows: Draft[]
  suppliers: string[]
  ordered: ReadonlySet<number>
  checked: ReadonlySet<number>
  setChecked: (checked: ReadonlySet<number>) => void
  onAdd: (ids: number[], supplier: string) => void
  onAction: (action: OrderAction, hiddenCount: number) => void
  onChange: (id: number, changes: Partial<Draft>) => void
  onSkuChange: (id: number, value: string) => boolean
}) {
  const [query, setQuery] = useState('')
  const [supplier, setSupplier] = useState('')
  const [bestOnly, setBestOnly] = useState(true)
  const [marked, setMarked] = useState(false)
  const [page, setPage] = useState(0)
  const results = useMemo(() => {
    const matchesSearch = catalogSearch(query)
    const matches = rows.flatMap((draft) => {
      const { product } = draft
      if ((marked && !product.marked) || !matchesSearch(`${product.sku} ${draft.name ?? product.name}`)) return []
      const best = bestOffer(effectiveOffers(draft), supplier)
      const price = supplierPrice(draft, supplier)
      const gap = price !== null && best ? price - best[1] : null
      if (supplier && (price === null || (bestOnly && gap !== null && gap > 0))) return []
      return [{ draft, best, price, gap }]
    })
    if (supplier) matches.sort((a, b) => (a.gap ?? Infinity) - (b.gap ?? Infinity))
    return matches
  }, [rows, query, supplier, bestOnly, marked])
  const last = Math.max(0, Math.ceil(results.length / pageSize) - 1)
  const current = Math.min(page, last)
  const visible = results.slice(current * pageSize, (current + 1) * pageSize)
  const displayedUnselected = visible.filter(({ draft }) => !ordered.has(draft.id))
  const selectedVisible = checked.size ? results.filter(({ draft }) => checked.has(draft.id)) : []
  const selectedToAdd = selectedVisible.filter(({ draft }) => !ordered.has(draft.id))

  function select(ids: number[], selected: boolean) {
    const next = new Set(checked)
    for (const id of ids) {
      if (selected) next.add(id)
      else next.delete(id)
    }
    setChecked(next)
  }

  return (
    <section aria-label="Επιλογή προϊόντων" className="min-w-0 space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,17rem)]">
        <label className="relative">
          <span className="sr-only">Αναζήτηση ποτού ή SKU</span>
          <Search size={16} className="absolute top-3 left-3 text-muted-foreground" aria-hidden="true" />
          <input type="search" className={`${control} w-full pl-9`} placeholder="Αναζήτηση ποτού ή SKU · π.χ. *gold* *label*" value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0) }} />
        </label>
        <select aria-label="Προβολή προμηθευτή" className={control} value={supplier} onChange={(e) => { setSupplier(e.target.value); setPage(0) }}>
          <option value="">Όλοι οι προμηθευτές</option>
          {suppliers.map((name) => <option key={name}>{name}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        {supplier && <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-primary" checked={bestOnly} onChange={(e) => { setBestOnly(e.target.checked); setPage(0) }} />
          Μόνο αν είναι ο φθηνότερος (και ισοπαλίες)
        </label>}
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-primary" checked={marked} onChange={(e) => { setMarked(e.target.checked); setPage(0) }} />
          Μόνο όσα έχουν Υ στο Excel
        </label>
        <Button variant="outline" className="h-8 sm:ml-auto" disabled={!displayedUnselected.length}
          onClick={() => onAdd(displayedUnselected.map(({ draft }) => draft.id), supplier)}>
          Προσθήκη σελίδας · {displayedUnselected.length}
        </Button>
      </div>
      <BulkToolbar count={checked.size} visible={results.length} selectedVisible={selectedVisible.length}
        onAll={() => setChecked(new Set(results.map(({ draft }) => draft.id)))} onClear={() => setChecked(new Set())}
        onEdit={() => onAction({ type: 'edit', ids: checked }, checked.size - selectedVisible.length)}
        onDelete={() => onAction({ type: 'delete', ids: checked }, checked.size - selectedVisible.length)}
        onAdd={() => onAdd(selectedToAdd.map(({ draft }) => draft.id), supplier)} addCount={selectedToAdd.length} />
      {!visible.length ? <EmptyState>Δεν βρέθηκαν προϊόντα με αυτά τα φίλτρα.</EmptyState> : (
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-border/65 bg-card" role="region" aria-label="Αποτελέσματα καταλόγου" tabIndex={0}>
          <table className="w-full min-w-[52rem] table-fixed text-left text-sm">
            <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
              <tr>{['Προϊόν', ...(supplier ? [supplier, 'Διαφορά'] : []), supplier ? 'Καλύτερη άλλη τιμή' : 'Καλύτερη τιμή', 'Amardis', 'Παραγγελία'].map((label, i) => (
                <th key={label} scope="col" className={`px-3 py-3 ${i === 0 ? 'w-[30%]' : ''}`}>
                  {i === 0 ? <label className="flex items-center gap-2">
                    <SelectPage ids={visible.map(({ draft }) => draft.id)} checked={checked} onSelect={select} />{label}
                  </label> : label}
                </th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-border/55">
              {visible.map(({ draft, best, price, gap }) => {
                const { product, id } = draft
                const selected = checked.has(id)
                const added = ordered.has(id)
                return (
                <tr key={id} className={selected ? 'bg-primary/10' : 'hover:bg-primary/5'}>
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" className={`${orderCheckbox} mt-1.5 shrink-0`} aria-label={`Επιλογή SKU ${product.sku}`}
                        checked={selected} onChange={(event) => select([id], event.currentTarget.checked)} />
                      <ProductFields draft={draft} onChange={(name) => onChange(id, { name })} onSkuChange={(sku) => onSkuChange(id, sku)} />
                    </div>
                    {product.duplicate && <span className="text-xs text-amber-800 dark:text-amber-200">Διπλό SKU στον κατάλογο</span>}
                  </td>
                  {supplier && <>
                    <td className="px-3 tabular-nums">{money(price)}</td>
                    <td className="px-3 tabular-nums">{gap === null ? '---' : `${gap > 0 ? '+' : ''}${money(gap)}`}</td>
                  </>}
                  <td className="px-3 py-2 tabular-nums">
                    <span className="block font-semibold">{money(best?.[1])}</span>{best && <span className="text-xs text-muted-foreground">{best[0]}</span>}
                    <Button variant="ghost" className="mt-0.5 h-7 px-1.5 text-xs text-primary" aria-label={`Τιμές προμηθευτών ${product.sku}`}
                      onClick={() => onAction({ type: 'offer', ids: new Set([id]) }, 0)}><Tags size={13} aria-hidden="true" /> Τιμές</Button>
                  </td>
                  <td className="px-3 tabular-nums">
                    <span className="block">{money(supplierPrice(draft, 'Amardis'))}</span>
                    {product.availability && <span className="text-xs text-muted-foreground">{product.availability}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <Button variant={added ? 'ghost' : 'outline'} className="h-8 px-2 text-xs"
                        aria-label={`${added ? 'Επιλεγμένο' : 'Προσθήκη'} ${product.sku}`} disabled={added}
                        onClick={() => onAdd([id], supplier)}>
                        {added ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                        {added ? 'Στη λίστα' : 'Προσθήκη'}
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8 text-red-700 dark:text-red-300" aria-label={`Αφαίρεση από επιλογή ${product.sku}`}
                        onClick={() => onAction({ type: 'delete', ids: new Set([id]) }, 0)}><Trash2 size={14} aria-hidden="true" /></Button>
                    </div>
                    {(draft.supplierEdited || draft.purchaseEdited || draft.quantity) && <div className="mt-1.5 wrap-break-word text-xs text-muted-foreground">
                      {[draft.supplier, draft.purchase ? `${draft.purchase} €` : '', draft.quantity ? `${draft.quantity} φιάλες` : ''].filter(Boolean).join(' · ')}
                    </div>}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{results.length} προϊόντα · Σελίδα {current + 1} από {last + 1}</span>
        <div className="flex gap-2">
          <Button variant="outline" className="h-8" disabled={current === 0} onClick={() => setPage(current - 1)}>Προηγούμενη</Button>
          <Button variant="outline" className="h-8" disabled={current === last} onClick={() => setPage(current + 1)}>Επόμενη</Button>
        </div>
      </div>
    </section>
  )
}
