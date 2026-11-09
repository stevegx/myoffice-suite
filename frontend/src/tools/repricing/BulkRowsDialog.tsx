import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { ErrorState } from '../../components/ui/feedback'
import { cents, formatPrice, type Evaluated, type Row } from './rules'

const fields = [
  { key: 'skrOverride', label: 'Νέα τιμή Skroutz', kind: 'price' },
  { key: 'siteOverride', label: 'Νέα τιμή site', kind: 'price' },
  { key: 'minSkr', label: 'Ελάχιστη Skroutz', kind: 'price' },
  { key: 'minSite', label: 'Ελάχιστη site', kind: 'price' },
  { key: 'our', label: 'Τιμή Skroutz (Our price)', kind: 'price' },
  { key: 'cheapest', label: 'Φθηνότερος', kind: 'price' },
  { key: 'shop', label: 'Κατάστημα', kind: 'text' },
  { key: 'rank', label: 'Rank', kind: 'integer' },
  { key: 'competitors', label: 'Competitors', kind: 'integer' },
] as const
type Field = typeof fields[number]
type Mode = 'set' | 'amount' | 'percent' | 'clear'
const control = 'mt-1 block h-10 w-full rounded-lg border border-border bg-background px-2.5 text-sm'

function currentPrice({ row, result }: Evaluated, field: Field) {
  if (field.key === 'skrOverride') return result.skr
  if (field.key === 'siteOverride') return result.site
  return cents(row[field.key])
}

function signedCents(input: string) {
  const magnitude = cents(input.replace(/^[+-]/, ''))
  return magnitude === null ? null : input.startsWith('-') ? -magnitude : magnitude
}

function buildChanges(entries: Evaluated[], field: Field, mode: Mode, input: string) {
  const changes = new Map<number, Partial<Row>>()
  const examples: { id: number; sku: string; before: string; after: string }[] = []
  const raw = input.trim()
  const adjustment = signedCents(raw)
  if (mode !== 'clear') {
    if (!raw) return { changes, examples, error: 'Συμπλήρωσε μια τιμή.' }
    if (field.kind === 'integer' && (!/^\d{1,7}$/.test(raw) || (field.key === 'rank' && Number(raw) === 0))) {
      return { changes, examples, error: field.key === 'rank' ? 'Το Rank χρειάζεται θετικό ακέραιο.' : 'Ο αριθμός ανταγωνιστών χρειάζεται ακέραιο από 0 και πάνω.' }
    }
    if (field.kind === 'price') {
      if (mode === 'set' && (!cents(raw))) return { changes, examples, error: 'Συμπλήρωσε θετική τιμή με έως δύο δεκαδικά.' }
      if ((mode === 'amount' || mode === 'percent') && (!adjustment || (mode === 'percent' && (adjustment <= -10000 || adjustment > 100000)))) {
        return { changes, examples, error: mode === 'percent'
          ? 'Δώσε ποσοστό διαφορετικό από 0, πάνω από −100% και έως +1000%.'
          : 'Δώσε θετική ή αρνητική μεταβολή με έως δύο δεκαδικά.' }
      }
    }
  }

  let invalid = 0
  for (const entry of entries) {
    const { row } = entry
    const previous = row[field.key]
    const price = field.kind === 'price' ? currentPrice(entry, field) : null
    let next = raw
    if (mode === 'clear') next = ''
    else if (mode === 'amount' || mode === 'percent') {
      const updated = !price || adjustment === null ? 0
        : mode === 'amount' ? price + adjustment : Math.round(price * (10000 + adjustment) / 10000)
      if (updated <= 0 || updated > 999_999_999) {
        invalid += 1
        continue
      }
      if (updated === price) continue
      next = formatPrice(updated)
    } else if (field.kind === 'price') {
      const updated = cents(raw)
      if (previous.trim() && updated === cents(previous)) continue
      next = formatPrice(updated)
    }
    else if (field.kind === 'integer') next = String(Number(raw))
    if (next === previous) continue
    changes.set(row.id, { [field.key]: next })
    if (examples.length < 3) examples.push({
      id: row.id,
      sku: row.sku || String(row.id),
      before: price === null ? previous || '—' : formatPrice(price),
      after: next || (field.key === 'skrOverride' || field.key === 'siteOverride' ? 'Αυτόματος υπολογισμός' : 'Κενό'),
    })
  }
  return {
    changes, examples,
    error: invalid ? `${invalid} γραμμές δεν έχουν έγκυρη τιμή βάσης ή η νέα τιμή είναι εκτός ορίων. Άλλαξε τη μεταβολή ή την επιλογή.` : '',
  }
}

export function BulkRowsDialog({ action, entries, hiddenCount, onClose, onEdit, onDelete }: {
  action: 'edit' | 'delete'
  entries: Evaluated[]
  hiddenCount: number
  onClose: () => void
  onEdit: (changes: ReadonlyMap<number, Partial<Row>>) => void
  onDelete: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [field, setField] = useState<Field>(fields[0])
  const [mode, setMode] = useState<Mode>('set')
  const [value, setValue] = useState('')
  const [attempted, setAttempted] = useState(false)
  const edit = action === 'edit'
  const preview = edit ? buildChanges(entries, field, mode, value) : undefined

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="bulk-rows-title"
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl backdrop:bg-black/50 sm:p-7">
      <form onSubmit={(event) => {
        event.preventDefault()
        if (preview) {
          setAttempted(true)
          if (preview.error || !preview.changes.size) return
          onEdit(preview.changes)
        } else {
          onDelete()
        }
        dialog.current?.close()
      }}>
        <h2 id="bulk-rows-title" className="text-xl font-semibold">{edit ? 'Μαζική επεξεργασία' : 'Μαζική διαγραφή'}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {edit ? `Εφάρμοσε μία αλλαγή σε ${entries.length} επιλεγμένες γραμμές. Οι έλεγχοι τιμών θα υπολογιστούν ξανά.`
            : `Θα αφαιρεθούν ${entries.length} γραμμές από τον τρέχοντα πίνακα και τις επόμενες εξαγωγές. Μπορείς να αναιρέσεις τη διαγραφή.`}
        </p>
        {hiddenCount > 0 && <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-200">
          Η ενέργεια περιλαμβάνει {hiddenCount} επιλεγμένες γραμμές εκτός φίλτρων.
        </p>}
        {edit && preview && <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium">Στήλη
              <select className={control} value={field.key} onChange={(event) => {
                setField(fields.find(({ key }) => key === event.target.value) ?? fields[0])
                setMode('set')
                setValue('')
                setAttempted(false)
              }}>
                {fields.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">Ενέργεια
              <select className={control} value={mode} onChange={(event) => { setMode(event.target.value as Mode); setAttempted(false) }}>
                <option value="set">Ορισμός τιμής</option>
                {field.kind === 'price' && <>
                  <option value="amount">Μεταβολή σε €</option>
                  <option value="percent">Μεταβολή σε %</option>
                </>}
                {field.key !== 'our' && <option value="clear">
                  {field.key === 'skrOverride' || field.key === 'siteOverride' ? 'Αυτόματος υπολογισμός' : 'Εκκαθάριση πεδίου'}
                </option>}
              </select>
            </label>
            {mode !== 'clear' && <label className="text-sm font-medium sm:col-span-2">
              {mode === 'set' ? 'Νέα τιμή πεδίου' : mode === 'amount' ? 'Μεταβολή σε ευρώ' : 'Ποσοστό μεταβολής'}
              <input className={control} value={value} maxLength={field.kind === 'text' ? 1024 : 16}
                inputMode={mode !== 'set' || field.kind === 'text' ? 'text' : field.kind === 'integer' ? 'numeric' : 'decimal'}
                placeholder={mode === 'amount' ? 'π.χ. -0,10 ή +0,10' : mode === 'percent' ? 'π.χ. -5 ή +5' : undefined}
                onChange={(event) => { setValue(event.target.value); setAttempted(false) }} />
            </label>}
          </div>
          {preview.error && (attempted || !!preview.changes.size) && <ErrorState className="mt-4" title="Η αλλαγή δεν μπορεί να εφαρμοστεί" detail={preview.error} />}
          {!preview.error && <div className="mt-4 rounded-xl border border-border/70 bg-primary/5 p-3 text-sm">
            <p className="font-semibold">{preview.changes.size ? `Αλλάζουν ${preview.changes.size} από ${entries.length} γραμμές` : 'Δεν προκύπτει αλλαγή.'}</p>
            {!!preview.examples.length && <ul className="mt-2 space-y-1 text-muted-foreground">
              {preview.examples.map(({ id, sku, before, after }) => <li key={id} className="wrap-break-word tabular-nums">
                <strong className="font-medium text-foreground">{sku}</strong> · {before} → {after}
              </li>)}
            </ul>}
          </div>}
        </>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => dialog.current?.close()}>{edit ? 'Ακύρωση' : 'Ακύρωση διαγραφής'}</Button>
          <Button type="submit" disabled={!entries.length || (!!preview && !preview.error && !preview.changes.size)}
            className={edit ? undefined : 'bg-red-700 text-white hover:bg-red-800'}>
            {edit ? 'Εφαρμογή αλλαγών' : `Διαγραφή ${entries.length} γραμμών`}
          </Button>
        </div>
      </form>
    </dialog>
  )
}
