import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { ErrorState } from '../../components/ui/feedback'
import { money, parseAmount, type Product } from '../orders/orderData'
import { editedPrice, priceUnits, type CatalogEdit } from './catalogEdits'
import type { SupplierRow } from './matching'

type Field = 'price' | 'availability' | 'sku' | 'restore' | 'exclude'
type Mode = 'set' | 'amount' | 'percent' | 'clear'
const control = 'mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2.5 text-sm'

function buildEdits(rows: SupplierRow[], field: Field, mode: Mode, input: string, erp: ReadonlyMap<string, Product>, existing: Record<string, CatalogEdit>) {
  const edits = new Map<string, CatalogEdit>()
  const value = input.trim()
  let price: number | null = null
  let adjustment = 0
  let factor = 10_000n
  if (field === 'price' && mode === 'set') {
    price = priceUnits(value)
    if (price === null) return { error: 'Δώσε θετική τιμή με έως τέσσερα δεκαδικά.' }
  } else if (field === 'price' && (mode === 'amount' || mode === 'percent')) {
    const parsed = parseAmount(value.replace(/^\+/, ''), mode === 'amount' ? 4 : 2, true)
    if (!parsed) return { error: 'Δώσε θετική ή αρνητική μεταβολή διαφορετική από το μηδέν.' }
    adjustment = parsed
    if (mode === 'percent') factor += BigInt(Math.round(adjustment * 100))
  } else if (field === 'sku' && !erp.has(value)) {
    return { error: 'Δώσε έναν κωδικό ERP από το συγκεντρωτικό αρχείο.' }
  } else if (field === 'availability' && value.length > 120) {
    return { error: 'Η διαθεσιμότητα μπορεί να έχει έως 120 χαρακτήρες.' }
  }
  if (field === 'restore') return { restore: true, edits }
  for (const row of rows) {
    if (field === 'exclude' || field === 'sku') {
      edits.set(row.key, { erpSku: field === 'exclude' ? '' : value })
    } else if (field === 'availability') {
      edits.set(row.key, { availability: value })
    } else if (mode === 'amount' || mode === 'percent') {
      const current = editedPrice(row, existing[row.key])
      const next = current === null || factor <= 0n ? 0 : mode === 'amount'
        ? current + Math.round(adjustment * 10_000)
        : Number((BigInt(current) * factor + 5_000n) / 10_000n)
      if (next <= 0 || next >= 100_000_000_000) return { error: `Το «${row.code || row.name}» χρειάζεται έγκυρη αρχική και τελική τιμή.` }
      edits.set(row.key, { price: next })
    } else {
      edits.set(row.key, { price })
    }
  }
  return { edits }
}

export function CatalogBulkDialog({ rows, excluded, hidden, edits, products, onApply, onRestore, onClose }: {
  rows: SupplierRow[]; excluded: boolean; hidden: number; edits: Record<string, CatalogEdit>; products: ReadonlyMap<string, Product>
  onApply: (edits: ReadonlyMap<string, CatalogEdit>) => void; onRestore: (keys: string[]) => void; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [field, setField] = useState<Field>(excluded ? 'exclude' : 'price')
  const [mode, setMode] = useState<Mode>('set')
  const [value, setValue] = useState('')
  const [attempted, setAttempted] = useState(false)
  const preview = buildEdits(rows, field, mode, value, products, edits)
  useEffect(() => { dialog.current?.showModal() }, [])

  return <dialog ref={dialog} onClose={onClose} aria-labelledby="catalog-bulk-title"
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl backdrop:bg-black/50">
    <form onSubmit={(event) => {
      event.preventDefault()
      setAttempted(true)
      if (!rows.length || preview.error) return
      if (preview.restore) onRestore(rows.map(({ key }) => key))
      else if (preview.edits) onApply(preview.edits)
      dialog.current?.close()
    }}>
      <h2 id="catalog-bulk-title" className="text-xl font-semibold">{excluded ? 'Μαζική εξαίρεση' : 'Μαζική επεξεργασία'}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{rows.length} επιλεγμένες γραμμές{hidden ? ` · ${hidden} εκτός του φίλτρου` : ''}.</p>
      {excluded ? <p className="mt-3 text-sm">Οι επιλεγμένες γραμμές θα μείνουν εκτός των Παραγγελιών για αυτόν τον κατάλογο. Οι ήδη αποθηκευμένες αντιστοιχίσεις τους διατηρούνται.</p> : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Πεδίο
            <select aria-label="Πεδίο μαζικής αλλαγής" className={control} value={field} onChange={(event) => {
              setField(event.target.value as Field); setMode('set'); setValue(''); setAttempted(false)
            }}>
              <option value="price">Τιμή προμηθευτή</option><option value="availability">Διαθεσιμότητα</option>
              <option value="sku">ERP SKU</option><option value="restore">Επαναφορά αρχικών στοιχείων</option>
            </select>
          </label>
          {field === 'price' && <label className="text-sm font-medium">Ενέργεια
            <select aria-label="Ενέργεια τιμής" className={control} value={mode} onChange={(e) => { setMode(e.target.value as Mode); setValue(''); setAttempted(false) }}>
              <option value="set">Ορισμός κοινής τιμής</option><option value="amount">Μεταβολή σε €</option>
              <option value="percent">Μεταβολή σε %</option><option value="clear">Χωρίς τιμή (---)</option>
            </select>
          </label>}
          {field !== 'restore' && mode !== 'clear' && <label className="text-sm font-medium sm:col-span-2">
            {field === 'sku' ? 'Κωδικός ERP' : field === 'availability' ? 'Νέα διαθεσιμότητα' : mode === 'amount' ? 'Μεταβολή σε €' : mode === 'percent' ? 'Μεταβολή σε %' : 'Νέα τιμή'}
            <input className={control} value={value} maxLength={field === 'availability' ? 120 : field === 'sku' ? 80 : 15}
              placeholder={field === 'availability' ? 'π.χ. Stock ή ETA - 2 Weeks' : undefined}
              onChange={(e) => { setValue(e.target.value); setAttempted(false) }} />
          </label>}
        </div>
      )}
      {preview.error && attempted && <ErrorState className="mt-3" title="Η αλλαγή δεν εφαρμόστηκε" detail={preview.error} />}
      {!excluded && !preview.error && <div className="mt-4 rounded-lg border border-border/65 bg-primary/5 p-3 text-sm">
        <p className="font-semibold">Προεπισκόπηση · {rows.length} γραμμές</p>
        {field === 'price' && rows.slice(0, 3).map((row) => <p key={row.key} className="mt-1 wrap-break-word text-muted-foreground">
          {row.code || row.name} · {money(editedPrice(row, edits[row.key]))} → {money(preview.edits?.get(row.key)?.price)}
        </p>)}
        {field === 'sku' && <p className="mt-1 text-muted-foreground">Ίδιο SKU σε όλες τις επιλεγμένες γραμμές · {products.get(value.trim())?.name}</p>}
      </div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => dialog.current?.close()}>Ακύρωση</Button>
        <Button type="submit" disabled={!rows.length}>{excluded ? 'Εξαίρεση επιλεγμένων' : 'Εφαρμογή αλλαγών'}</Button>
      </div>
    </form>
  </dialog>
}
