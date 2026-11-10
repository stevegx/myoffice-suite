import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { ErrorState } from '../../components/ui/feedback'
import { editPrice, money, parseAmount, supplierPrice, withOffers, withSupplier, type Draft, type Field, type snapshot } from './orderData'

export type OrderRow = { draft: Draft; line: ReturnType<typeof snapshot> }
export type OrderAction = { type: 'edit' | 'delete' | 'offer'; ids: ReadonlySet<number> }

const fields = [
  ['purchase', 'Τιμή αγοράς', 4], ['offer', 'Τιμή προμηθευτή', 4], ['supplier', 'Προμηθευτής παραγγελίας', null],
  ['quantity', 'Φιάλες', 0], ['vat', 'ΦΠΑ %', 2], ['minBuy', 'MinBuyPrice', 4], ['lastBuy', 'ΤΤΑ', 4],
  ['skroutz', 'Ελάχ. Skroutz', 4], ['stock', 'Stock', 3], ['salesRecent', 'Πωλήσεις τριμήνου', 3],
  ['salesOther', 'Πωλήσεις 2ης περιόδου', 3], ['notes', 'Σημειώσεις', null],
] as const
type BulkField = typeof fields[number]
type Mode = 'set' | 'amount' | 'percent' | 'clear'
const control = 'mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2.5 text-sm'

function bulkChanges(rows: OrderRow[], field: BulkField, mode: Mode, input: string, offerSupplier: string) {
  const [key, , decimals] = field
  const raw = input.trim()
  const changes = new Map<number, Draft>()
  const samples: { id: number; sku: string; before: string; after: string }[] = []
  const fail = (error: string) => ({ changes, samples, error })
  const relative = mode === 'amount' || mode === 'percent'
  const target = offerSupplier.trim()
  if (key === 'offer' && !target) return fail('Συμπλήρωσε τον προμηθευτή που θέλεις να ενημερώσεις.')
  if (mode !== 'clear' && !raw) return fail('Συμπλήρωσε μια τιμή.')
  if (decimals === null && raw.length > (key === 'supplier' ? 80 : 300)) return fail('Το κείμενο είναι πολύ μεγάλο.')
  const signed = decimals === 3
  const number = decimals === null || mode === 'clear' ? null : parseAmount(raw.replace(/^\+/, ''), mode === 'percent' ? 2 : decimals, relative || signed)
  if (decimals !== null && mode !== 'clear' && (number === null || (relative && number === 0)
    || (!relative && decimals === 4 && number === 0) || (key === 'vat' && number > 100))) {
    return fail('Δώσε έγκυρη τιμή για το πεδίο που επέλεξες.')
  }

  for (const { draft, line } of rows) {
    const offer = key === 'offer' ? supplierPrice(draft, target) : null
    const previous = key === 'offer' ? (offer === null ? null : offer / 10_000) : key === 'vat' ? (line.vat === null ? null : line.vat * 100) : line[key]
    let next = mode === 'clear' ? '' : raw
    if (relative) {
      const amount = typeof previous === 'number' && previous > 0 && number !== null
        ? (mode === 'amount' ? previous + number : previous * (1 + number / 100)) : 0
      const units = Math.round(amount * 10_000)
      if (units <= 0 || units >= 100_000_000_000) return fail(`Το SKU ${line.sku} χρειάζεται έγκυρη αρχική και τελική τιμή.`)
      next = editPrice(units)
    } else if (number !== null) next = String(number).replace('.', ',')

    let updated: Draft
    switch (key) {
      case 'offer':
        updated = withOffers(draft, { ...draft.offers, [target]: next ? Math.round(Number(next.replace(',', '.')) * 10_000) : null })
        break
      case 'supplier':
        updated = draft.supplierEdited && draft.supplier.trim() === next ? draft : { ...withSupplier(draft, next), supplierEdited: true }
        break
      case 'purchase': updated = { ...draft, purchase: next, purchaseEdited: true }; break
      case 'quantity': case 'vat': case 'notes': updated = { ...draft, [key]: next }; break
      default: updated = { ...draft, manual: { ...draft.manual, [key satisfies Field]: next } }
    }
    if (updated === draft) continue
    changes.set(draft.id, updated)
    if (samples.length < 3) samples.push({
      id: draft.id, sku: line.sku, before: previous == null || previous === '' ? '---' : String(previous).replace('.', ','),
      after: next || '---',
    })
  }
  return { changes, samples, error: '' }
}

export function OrderBulkDialog({ action, rows, suppliers, hiddenCount, catalog, onClose, onEdit, onDelete }: {
  action: OrderAction; rows: OrderRow[]; suppliers: string[]; hiddenCount: number; onClose: () => void
  catalog: boolean
  onEdit: (changes: ReadonlyMap<number, Draft>) => void; onDelete: (ids: ReadonlySet<number>) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [field, setField] = useState<BulkField>(action.type === 'offer' ? fields[1] : fields[0])
  const [mode, setMode] = useState<Mode>('set')
  const [value, setValue] = useState('')
  const [supplier, setSupplier] = useState(action.type === 'offer' ? rows[0]?.line.supplier || 'Amardis' : 'Amardis')
  const [attempt, setAttempt] = useState(false)
  const removing = action.type === 'delete'
  const preview = removing ? null : bulkChanges(rows, field, mode, value, supplier)
  const offerRow = action.type === 'offer' ? rows[0]?.draft : undefined
  const offerSuppliers = offerRow ? [...new Set([...suppliers, ...Object.keys(offerRow.offers)])] : suppliers
  const title = removing ? 'Μαζική διαγραφή' : action.type === 'offer' ? 'Τιμή προμηθευτή' : 'Μαζική επεξεργασία'
  useEffect(() => { ref.current?.showModal() }, [])

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="order-bulk-title"
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl backdrop:bg-black/50">
      <form onSubmit={(event) => {
        event.preventDefault()
        setAttempt(true)
        if (removing) onDelete(action.ids)
        else if (preview && !preview.error && preview.changes.size) onEdit(preview.changes)
        else return
        ref.current?.close()
      }}>
        <h2 id="order-bulk-title" className="text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {removing ? `Θα αφαιρεθούν ${rows.length} γραμμές από ${catalog ? 'την επιλογή προϊόντων' : 'την παραγγελία'}. Η τελευταία διαγραφή μπορεί να αναιρεθεί.` : `Επιλεγμένες γραμμές · ${rows.length}`}
        </p>
        {hiddenCount > 0 && <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">{hiddenCount} από αυτές είναι εκτός του φίλτρου.</p>}
        {!removing && <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {action.type !== 'offer' && <label className="text-sm font-medium">Πεδίο
              <select className={control} aria-label="Πεδίο μαζικής αλλαγής" value={field[0]} onChange={(e) => {
                setField(fields.find(([key]) => key === e.target.value) ?? fields[0])
                setMode('set')
                setValue('')
                setAttempt(false)
              }}>{fields.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>
            </label>}
            <label className="text-sm font-medium">Ενέργεια
              <select className={control} aria-label="Ενέργεια μαζικής αλλαγής" value={mode} onChange={(e) => { setMode(e.target.value as Mode); setAttempt(false) }}>
                <option value="set">Ορισμός τιμής</option>
                {field[2] === 4 && <><option value="amount">Μεταβολή σε €</option><option value="percent">Μεταβολή σε %</option></>}
                {field[0] !== 'vat' && <option value="clear">Εκκαθάριση</option>}
              </select>
            </label>
            {field[0] === 'offer' && <label className="text-sm font-medium">Προμηθευτής τιμής
              <input className={control} list="bulk-offer-suppliers" maxLength={80} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              <datalist id="bulk-offer-suppliers">{offerSuppliers.map((name) => <option key={name} value={name} />)}</datalist>
            </label>}
            {mode !== 'clear' && <label className="text-sm font-medium sm:col-span-2">
              {mode === 'amount' ? 'Μεταβολή σε €' : mode === 'percent' ? 'Μεταβολή σε %' : 'Νέα τιμή'}
              <input className={control} value={value} maxLength={field[2] === null ? 300 : 14} onChange={(e) => { setValue(e.target.value); setAttempt(false) }} />
            </label>}
          </div>
          {offerRow && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Τρέχουσες τιμές ανά προμηθευτή" role="group">
            {offerSuppliers.map((name) => (
              <button key={name} type="button" aria-pressed={supplier.trim() === name}
                className="min-w-0 rounded-lg border border-border/65 bg-background px-2 py-1.5 text-left text-xs hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary/10"
                onClick={() => { setSupplier(name); setAttempt(false) }}>
                <span className="block truncate font-medium" title={name}>{name}</span>
                <span className="tabular-nums text-muted-foreground">{money(supplierPrice(offerRow, name))}</span>
              </button>
            ))}
          </div>}
          {field[0] === 'offer' && <p className="mt-3 text-xs text-muted-foreground">Η αλλαγή αφορά την τρέχουσα παραγγελία. Αν έχεις ήδη γράψει χειροκίνητη τιμή αγοράς, αυτή διατηρείται.</p>}
          {preview?.error && attempt && <ErrorState className="mt-4" title="Η αλλαγή δεν εφαρμόστηκε" detail={preview.error} />}
          {preview && !preview.error && <div className="mt-4 rounded-lg border border-border/65 bg-primary/5 p-3 text-sm">
            <p className="font-semibold">Προεπισκόπηση · {preview.changes.size} γραμμές</p>
            {preview.samples.map(({ id, sku, before, after }) => <p key={id} className="mt-1 wrap-break-word text-muted-foreground">{sku} · {before} → {after}</p>)}
          </div>}
        </>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => ref.current?.close()}>Ακύρωση</Button>
          <Button type="submit" disabled={!rows.length} className={removing ? 'bg-red-700 text-white hover:bg-red-800' : undefined}>
            {removing ? `Διαγραφή ${rows.length} γραμμών` : 'Εφαρμογή αλλαγών'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
