import { useEffect, useRef } from 'react'
import { Button } from '../../components/ui/button'
import { cents, floorLabels, formatPrice, type Evaluated } from './rules'

const percentages = new Intl.NumberFormat('el-GR', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })

function euro(value: number | null) {
  return value === null ? '—' : `${formatPrice(value)} €`
}

export function RowEditor({ entry, minimumCount, historyEnabled, onClose, onApprove }: {
  entry: Evaluated
  minimumCount: number
  historyEnabled?: boolean
  onClose: () => void
  onApprove: (channel: 'approvedSkr' | 'approvedSite', checked: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  const { row, result } = entry
  const change = result.missingOriginal || result.skr === null ? '—'
    : `${result.delta > 0 ? '+' : ''}${euro(result.delta)}${result.deltaPercent === null ? '' : ` · ${percentages.format(result.deltaPercent)}%`}`

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="repricing-editor-title"
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(48rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl backdrop:bg-black/50 sm:p-7">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="repricing-editor-title" className="text-xl font-semibold">Λεπτομέρειες τιμής</h2>
          <p className="mt-2 wrap-break-word text-sm text-muted-foreground">{row.product} · {row.sku}</p>
          {historyEnabled && row.sku.trim() && (
            <a className="mt-2 inline-block text-sm font-medium text-primary underline underline-offset-4"
              href={`#/products?sku=${encodeURIComponent(row.sku.trim())}`} target="_blank" rel="noopener noreferrer">
              Ιστορικό SKU ↗
            </a>
          )}
        </div>
        <Button variant="outline" onClick={() => dialog.current?.close()}>Κλείσιμο</Button>
      </header>
      <dl className="grid gap-3 rounded-xl border border-border/70 bg-background p-4 sm:grid-cols-3">
        {[
          ['Αρχική Skroutz', euro(cents(row.sourceOur))],
          ['Τελική Skroutz', euro(result.skr)],
          ['Μεταβολή', change],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={`mt-1 font-semibold tabular-nums ${label === 'Μεταβολή' && result.largeChange ? 'text-amber-900 dark:text-amber-200' : ''}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="my-5 space-y-2 text-sm">
        <p>{result.reason}</p>
        {result.warning && <p className="text-amber-800 dark:text-amber-200">{result.warning}</p>}
        {row.excluded && <p>Η γραμμή έχει απορριφθεί και μένει εκτός export.</p>}
        {result.duplicate && <p>Διπλό SKU. Διόρθωσε το SKU ή απόρριψε την άλλη γραμμή.</p>}
        {result.missingIdentity && <p>Συμπλήρωσε όνομα και SKU για εξαγωγή.</p>}
        {result.missingOriginal && <p>Λείπει έγκυρη αρχική τιμή CSV. Η γραμμή μένει εκτός export.</p>}
        {minimumCount !== 1 && <p>{minimumCount > 1 ? 'Πολλές εγγραφές ελαχίστων για αυτό το SKU.' : 'Το SKU λείπει από το αρχείο ελαχίστων.'} Έλεγξε τα πεδία ελάχιστης στον πίνακα.</p>}
        <p className="text-muted-foreground wrap-break-word">
          Our price {euro(cents(row.our))} · Cheapest {euro(cents(row.cheapest))} · Rank {row.rank || '—'} · Competitors {row.competitors || '—'}{row.shop && ` · ${row.shop}`}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {([
          ['Skroutz', 'approvedSkr', result.skr, row.minSkr, result.skrCheck, result.canSkr, result.readySkr],
          ['Site', 'approvedSite', result.site, row.minSite, result.siteCheck, result.canSite, result.readySite],
        ] as const).map(([channel, approval, final, minimum, check, allowed, ready]) => (
          <section key={channel} className="min-w-0 rounded-xl border border-border/70 p-4 text-sm">
            <h3 className="font-semibold">{channel}</h3>
            <p className="mt-2">Τελική {euro(final)} · Ελάχιστη {euro(cents(minimum))}</p>
            <p className={`mt-1 ${check === 'ok' ? 'text-muted-foreground' : 'text-amber-800 dark:text-amber-200'}`}>{floorLabels[check]}</p>
            {channel === 'Site' && final !== null && result.skr !== null && final >= result.skr && <p className="mt-1">Η τιμή site πρέπει να είναι χαμηλότερη από τη Skroutz.</p>}
            {channel === 'Site' && result.changedSkr && !result.readySkr && <p className="mt-1">Η νέα τιμή Skroutz πρέπει πρώτα να μπορεί να εξαχθεί.</p>}
            {check === 'exception' && (
              <label className="mt-3 flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" disabled={!allowed} checked={allowed && row[approval]}
                  onChange={(event) => onApprove(approval, event.target.checked)} />
                Επιβεβαιώνω την εξαίρεση {channel}
              </label>
            )}
            <p className="mt-3 font-medium">{ready ? 'Περιλαμβάνεται στο export' : 'Εκτός export'}</p>
          </section>
        ))}
      </div>
    </dialog>
  )
}
