import { ArrowLeft, ArrowRight, Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { jsonOptions, RequestError, requestJson } from '../../api/request'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ErrorState, LoadingState } from '../../components/ui/feedback'
import { downloadFile } from '../../lib/downloadFile'
import { useTask } from '../../lib/useTask'
import { readUpload } from '../payments/paymentsApi'
import { UploadBox } from '../payments/UploadBox'
import { athensToday } from '../products/dates'
import { ConfirmPrices, type ExportedPrice } from './ConfirmPrices'
import { RepricingTable } from './RepricingTable'
import { buildReport } from './report'
import { RowEditor } from './RowEditor'
import { createRows, evaluateRows, minimumFields, minimumFor, summarize, type ImportResult, type Row } from './rules'
import { readColumnOrder } from './tableColumns'

type ExportKind = 'skroutz' | 'site' | 'summary'
type PriceExport = { rowIds: number[]; prices: ExportedPrice[] }
const exportLabels: Record<ExportKind, string> = { skroutz: 'Skroutz XLS', site: 'Site CSV', summary: 'Σύνοψη και αναφορά Excel' }

export default function Repricing() {
  const [market, setMarket] = useState<File>()
  const [minimums, setMinimums] = useState<File>()
  const [observedOn, setObservedOn] = useState(athensToday)
  const [exports, setExports] = useState<Partial<Record<'skroutz' | 'site', PriceExport>>>({})
  const [data, setData] = useState<ImportResult>()
  const [rows, setRows] = useState<Row[]>([])
  const [columnOrder, setColumnOrder] = useState(readColumnOrder)
  const [deleted, setDeleted] = useState<Row[]>([])
  const [review, setReview] = useState(false)
  const [selected, setSelected] = useState<number>()
  const { busy, error, run, clearError } = useTask()
  const [lastExport, setLastExport] = useState<ExportKind>()
  const entries = useMemo(() => evaluateRows(rows), [rows])
  const skroutz = entries.filter(({ result }) => result.readySkr)
  const site = entries.filter(({ result }) => result.readySite)
  const deltas = skroutz.map(({ result }) => result.delta)
  const summary = summarize(deltas)
  const active = entries.find(({ row }) => row.id === selected)

  function load() {
    if (!market || !minimums || !observedOn || busy) return
    if (data) {
      setReview(true)
      return
    }
    void run('Ανάγνωση αρχείων και έλεγχος τιμών…', 'Η εισαγωγή απέτυχε', async () => {
      const [marketData, minimumData] = await Promise.all([readUpload(market), readUpload(minimums)])
      const imported = await requestJson<ImportResult>('/api/repricing/import', jsonOptions({
        market: marketData, minimums: minimumData, observedOn, minimumsOn: athensToday(),
      }))
      const importedRows = createRows(imported)
      setData(imported)
      setRows(importedRows)
      setReview(true)
    })
  }

  function changeFile(setFile: (file: File) => void, file: File) {
    setFile(file)
    setData(undefined)
    setRows([])
    setDeleted([])
    setExports({})
    setSelected(undefined)
    clearError()
  }

  function editRows(changes: ReadonlyMap<number, Partial<Row>>) {
    if (!data) return
    setRows((previous) => previous.map((row) => {
      const values = changes.get(row.id)
      if (!values) return row
      const updated = values.sku !== undefined && values.sku.trim() !== row.sku.trim()
        ? { ...minimumFields(minimumFor(data.minimums, values.sku)), ...values }
        : values
      return { ...row, ...updated, approvedSkr: false, approvedSite: false }
    }))
  }

  function edit(id: number, values: Partial<Row>) {
    editRows(new Map([[id, values]]))
  }

  function remove(ids: ReadonlySet<number>) {
    if (busy) return
    setDeleted(rows.filter((row) => ids.has(row.id)))
    setRows((previous) => previous.filter((row) => !ids.has(row.id)))
    setExports((previous) => ({
      skroutz: previous.skroutz?.rowIds.some((id) => ids.has(id)) ? undefined : previous.skroutz,
      site: previous.site?.rowIds.some((id) => ids.has(id)) ? undefined : previous.site,
    }))
  }

  function undoDelete() {
    setRows((previous) => [...previous, ...deleted].sort((left, right) => left.id - right.id))
    setDeleted([])
  }

  function approve(channel: 'approvedSkr' | 'approvedSite', checked: boolean) {
    setRows((previous) => previous.map((row) => row.id === selected
      ? { ...row, [channel]: checked, ...(!checked && channel === 'approvedSkr' ? { approvedSite: false } : {}) } : row))
  }

  function download(kind: ExportKind) {
    if (busy || (kind === 'skroutz' && !skroutz.length) || (kind === 'site' && !site.length)) return
    setLastExport(kind)
    void run(`Προετοιμασία αρχείου · ${exportLabels[kind]}…`, `Η εξαγωγή απέτυχε · ${exportLabels[kind]}`, async () => {
      if (kind === 'summary') {
        try {
          await downloadFile('/api/repricing/export/report', { total: entries.length, deltas, report: buildReport(entries, columnOrder) })
        } catch (failure) {
          if (failure instanceof RequestError && failure.status === 404) {
            throw new Error('Ο server χρειάζεται επανεκκίνηση με τη νέα έκδοση για να δημιουργήσει την αναλυτική αναφορά.')
          }
          throw failure
        }
        return
      }
      const candidates = kind === 'site' ? site : skroutz
      const prices = candidates.map(({ row, result }) => ({
        sku: row.sku.trim(), product: row.product.trim(), skr: result.skr, site: result.site,
      }))
      await downloadFile(`/api/repricing/export/${kind}`, { rows: prices })
      setExports((previous) => ({ ...previous, [kind]: { rowIds: candidates.map(({ row }) => row.id), prices } }))
    })
  }

  return (
    <section className={`page-enter min-w-0 ${review ? 'repricing-workspace' : 'mx-auto max-w-4xl'}`} aria-labelledby="repricing-heading">
      <header className="mb-6">
        {review ? <button type="button" className="mb-3 inline-flex items-center gap-2 text-sm text-primary" disabled={!!busy} onClick={() => { setReview(false); clearError() }}>
          <ArrowLeft size={15} aria-hidden="true" /> Πίσω στα αρχεία
        </button> : <a href="#/" className="mb-3 inline-flex items-center gap-2 text-sm text-primary">
          <ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία
        </a>}
        <h1 id="repricing-heading" className="text-3xl font-semibold sm:text-4xl">{review ? 'Έλεγχος τιμών' : 'Repricing'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{review ? 'Επεξεργασία στα κελιά · διπλό κλικ για λεπτομέρειες' : 'Πρόσθεσε το CSV του Skroutz και το Excel με τις ελάχιστες τιμές.'}</p>
      </header>
      {!review && (
        <Card className="bg-linear-to-br from-card/80 to-primary/12 p-4 sm:p-7">
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            <UploadBox step={1} label="Repricing Skroutz" accept=".csv" filename={market?.name} disabled={!!busy} onFile={(file) => {
              changeFile(setMarket, file)
              const day = file.name.match(/\d{4}-\d{2}-\d{2}/)?.[0]
              const date = day ? new Date(`${day}T00:00:00Z`) : null
              setObservedOn(date && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === day ? day! : athensToday())
            }} />
            <div className="border-t border-border/60">
              <UploadBox step={2} label="Αρχείο ελαχίστων" accept=".xlsx" filename={minimums?.name} disabled={!!busy} onFile={(file) => changeFile(setMinimums, file)} />
            </div>
          </div>
          {busy && <LoadingState className="mt-4" title={busy} />}
          {error && <ErrorState className="mt-4" {...error} />}
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <label className="text-sm text-muted-foreground">
              Ημερομηνία τιμών του CSV
              <input type="date" className="mt-1 block h-10 rounded-lg border border-border bg-card px-2 text-foreground"
                disabled={!!busy || !!data} value={observedOn} onChange={(event) => setObservedOn(event.target.value)} />
            </label>
            <Button disabled={!market || !minimums || !observedOn || !!busy} onClick={load}>
              {busy ? 'Εισαγωγή…' : 'Συνέχεια στον έλεγχο'} <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        </Card>
      )}
      {data && <div hidden={!review}>
        <Card className="bg-linear-to-br from-card/80 to-primary/12 p-3 sm:p-5">
          <div className="mb-4 flex flex-wrap gap-2">
            <Button disabled={!!busy || !skroutz.length} onClick={() => download('skroutz')}><Download size={16} aria-hidden="true" /> Skroutz XLS · {skroutz.length}</Button>
            <Button variant="outline" disabled={!!busy || !site.length} onClick={() => download('site')}>Site CSV · {site.length}</Button>
            <Button variant="outline" disabled={!!busy} onClick={() => download('summary')}>Σύνοψη και αναφορά Excel</Button>
          </div>
          {review && busy && <LoadingState className="mb-4" title={busy} />}
          {review && error && <ErrorState className="mb-4" {...error}
            retry={lastExport === 'summary' || (lastExport === 'skroutz' && skroutz.length) || (lastExport === 'site' && site.length)
              ? () => download(lastExport) : undefined} />}
          <p className="mb-4 text-sm text-muted-foreground">Τα exports περιλαμβάνουν τις έγκυρες αλλαγές. Πάτησε «Απόρριψη» για να εξαιρέσεις μια γραμμή.</p>
          {data.history?.enabled && (
            <p className="mb-4 text-xs text-muted-foreground">
              Ιστορικό CSV · {data.history.saved} νέες παρατηρήσεις
              {data.history.skipped > 0 && ` · ${data.history.skipped} γραμμές χωρίς καταγραφή τιμής (διπλό ή ελλιπές SKU, όνομα ή τιμή)`}.
            </p>
          )}
          {deleted.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" role="status">
              <span>{deleted.length === 1 ? `Διαγράφηκε το SKU ${deleted[0].sku || deleted[0].id}.` : `Διαγράφηκαν ${deleted.length} γραμμές.`}</span>
              <Button variant="outline" className="h-8" disabled={!!busy} onClick={undoDelete}>Αναίρεση διαγραφής</Button>
              <p className="basis-full text-muted-foreground">
                Οι γραμμές εξαιρούνται από όλες τις επόμενες εξαγωγές της τρέχουσας επεξεργασίας.
                {data.history?.enabled && ' Για επιβεβαίωση τιμών, κάνε ξανά τις εξαγωγές που τις περιείχαν.'}
              </p>
            </div>
          )}
          <RepricingTable entries={entries} order={columnOrder} onOrderChange={setColumnOrder}
            onOpen={setSelected} onEdit={edit} onEditRows={editRows} onDelete={remove} deleteDisabled={!!busy} />
          {data.history?.enabled && <ConfirmPrices exports={{ skroutz: exports.skroutz?.prices, site: exports.site?.prices }} />}
          <details className="mt-4 rounded-xl border border-border/70 bg-card p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Σύνοψη Skroutz · {skroutz.length} αλλαγές προς εξαγωγή</summary>
            <table className="mt-3 w-full max-w-xl text-left">
              <thead><tr><th scope="col" className="py-2">Εύρος μεταβολής</th><th scope="col">Αυξήσεις</th><th scope="col">Μειώσεις</th></tr></thead>
              <tbody>{summary.map(({ label, increases, decreases }) => (
                <tr key={label} className="border-t border-border/60"><td className="py-1.5">{label}</td><td>{increases}</td><td>{decreases}</td></tr>
              ))}</tbody>
              <tfoot className="border-t border-border font-semibold">
                <tr><th scope="row" className="py-2">Σύνολο αλλαγών</th>
                  <td>{deltas.filter((delta) => delta > 0).length}</td>
                  <td>{deltas.filter((delta) => delta < 0).length}</td></tr>
              </tfoot>
            </table>
            <p className="mt-3 text-muted-foreground">{rows.length - skroutz.length} χωρίς αλλαγή προς εξαγωγή · {rows.length} προϊόντα συνολικά</p>
          </details>
        </Card>
      </div>}
      {review && active && data && (
        <RowEditor entry={active} minimumCount={minimumFor(data.minimums, active.row.sku).length}
          historyEnabled={data.history?.enabled} onClose={() => setSelected(undefined)} onApprove={approve} />
      )}
    </section>
  )
}
