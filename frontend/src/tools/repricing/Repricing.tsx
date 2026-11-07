import { ArrowLeft, ArrowRight, Download } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { submitDownload } from '../../lib/submitDownload'
import { readUpload } from '../payments/paymentsApi'
import { UploadBox } from '../payments/UploadBox'
import { athensToday } from '../products/dates'
import { ConfirmPrices, type ExportedPrice } from './ConfirmPrices'
import { RepricingTable } from './RepricingTable'
import { RowEditor } from './RowEditor'
import { createRows, evaluateRows, minimumFields, minimumFor, summarize, type ImportResult, type Row } from './rules'

type ExportKind = 'skroutz' | 'site' | 'summary'

export default function Repricing() {
  const [market, setMarket] = useState<File>()
  const [minimums, setMinimums] = useState<File>()
  const [observedOn, setObservedOn] = useState(athensToday)
  const [exports, setExports] = useState<Partial<Record<'skroutz' | 'site', ExportedPrice[]>>>({})
  const [data, setData] = useState<ImportResult>()
  const [rows, setRows] = useState<Row[]>([])
  const [deleted, setDeleted] = useState<Row>()
  const [review, setReview] = useState(false)
  const [selected, setSelected] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const downloadTarget = `repricing-download-${useId()}`
  const entries = useMemo(() => evaluateRows(rows), [rows])
  const skroutz = entries.filter(({ result }) => result.readySkr)
  const site = entries.filter(({ result }) => result.readySite)
  const deltas = skroutz.map(({ result }) => result.delta)
  const summary = summarize(deltas)
  const active = entries.find(({ row }) => row.id === selected)

  async function load() {
    if (!market || !minimums) return
    if (data) {
      setReview(true)
      return
    }
    setBusy(true)
    setError('')
    try {
      const [marketData, minimumData] = await Promise.all([readUpload(market), readUpload(minimums)])
      const response = await fetch('/api/repricing/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: marketData, minimums: minimumData, observedOn }),
      })
      const imported = await response.json()
      if (!response.ok) throw new Error(typeof imported.detail === 'string' ? imported.detail : 'Αποτυχία εισαγωγής.')
      setData(imported)
      setRows(createRows(imported))
      setReview(true)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Αποτυχία εισαγωγής.')
    } finally {
      setBusy(false)
    }
  }

  function changeFile(setFile: (file: File) => void, file: File) {
    setFile(file)
    setData(undefined)
    setRows([])
    setDeleted(undefined)
    setExports({})
    setSelected(undefined)
    setError('')
  }

  function edit(id: number, values: Partial<Row>) {
    if (!data) return
    setRows((previous) => previous.map((row) => {
      if (row.id !== id) return row
      const updated = values.sku !== undefined && values.sku.trim() !== row.sku.trim()
        ? { ...minimumFields(minimumFor(data.minimums, values.sku)), ...values }
        : values
      return { ...row, ...updated, approvedSkr: false, approvedSite: false }
    }))
  }

  function remove(row: Row) {
    setDeleted(row)
    setRows((previous) => previous.filter((item) => item.id !== row.id))
  }

  function undoDelete() {
    if (!deleted) return
    setRows((previous) => [...previous, deleted].sort((left, right) => left.id - right.id))
    setDeleted(undefined)
  }

  function approve(channel: 'approvedSkr' | 'approvedSite', checked: boolean) {
    setRows((previous) => previous.map((row) => row.id === selected
      ? { ...row, [channel]: checked, ...(!checked && channel === 'approvedSkr' ? { approvedSite: false } : {}) } : row))
  }

  function download(kind: ExportKind) {
    setError('')
    if (kind === 'summary') {
      submitDownload('/api/repricing/export/summary', downloadTarget, { total: rows.length, deltas })
      return
    }
    const exported = (kind === 'site' ? site : skroutz).map(({ row, result }) => ({
        sku: row.sku.trim(), product: row.product.trim(), skr: result.skr, site: result.site,
    }))
    submitDownload(`/api/repricing/export/${kind}`, downloadTarget, { rows: exported })
    setExports((previous) => ({ ...previous, [kind]: exported }))
  }

  return (
    <section className={`page-enter min-w-0 ${review ? 'repricing-workspace' : 'mx-auto max-w-4xl'}`} aria-labelledby="repricing-heading">
      <header className="mb-6">
        {review ? <button type="button" className="mb-3 inline-flex items-center gap-2 text-sm text-primary" onClick={() => { setReview(false); setError('') }}>
          <ArrowLeft size={15} aria-hidden="true" /> Πίσω στα αρχεία
        </button> : <a href="#/" className="mb-3 inline-flex items-center gap-2 text-sm text-primary">
          <ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία
        </a>}
        <h1 id="repricing-heading" className="text-3xl font-semibold sm:text-4xl">{review ? 'Έλεγχος τιμών' : 'Repricing'}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{review ? 'Επεξεργασία στα κελιά · διπλό κλικ για λεπτομέρειες' : 'Πρόσθεσε το CSV του Skroutz και το Excel με τις ελάχιστες τιμές.'}</p>
      </header>
      {error && <p role="alert" className="mb-4 text-sm text-red-800 dark:text-red-300">{error}</p>}
      {!review && (
        <Card className="bg-linear-to-br from-card/80 to-primary/12 p-4 sm:p-7">
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            <UploadBox step={1} label="Repricing Skroutz" accept=".csv" filename={market?.name} disabled={busy} onFile={(file) => {
              changeFile(setMarket, file)
              const day = file.name.match(/\d{4}-\d{2}-\d{2}/)?.[0]
              const date = day ? new Date(`${day}T00:00:00Z`) : null
              setObservedOn(date && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === day ? day! : athensToday())
            }} />
            <div className="border-t border-border/60">
              <UploadBox step={2} label="Αρχείο ελαχίστων" accept=".xlsx" filename={minimums?.name} disabled={busy} onFile={(file) => changeFile(setMinimums, file)} />
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <label className="text-sm text-muted-foreground">
              Ημερομηνία τιμών του CSV
              <input type="date" className="mt-1 block h-10 rounded-lg border border-border bg-card px-2 text-foreground"
                disabled={busy || !!data} value={observedOn} onChange={(event) => setObservedOn(event.target.value)} />
            </label>
            <Button disabled={!market || !minimums || !observedOn || busy} onClick={() => void load()}>
              {busy ? 'Εισαγωγή…' : 'Συνέχεια στον έλεγχο'} <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
        </Card>
      )}
      {data && <div hidden={!review}>
        <Card className="bg-linear-to-br from-card/80 to-primary/12 p-3 sm:p-5">
          <div className="mb-4 flex flex-wrap gap-2">
            <Button disabled={!skroutz.length} onClick={() => download('skroutz')}><Download size={16} aria-hidden="true" /> Skroutz XLS · {skroutz.length}</Button>
            <Button variant="outline" disabled={!site.length} onClick={() => download('site')}>Site CSV · {site.length}</Button>
            <Button variant="outline" onClick={() => download('summary')}>Σύνοψη Excel</Button>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">Τα exports περιλαμβάνουν τις έγκυρες αλλαγές. Πάτησε «Απόρριψη» για να εξαιρέσεις μια γραμμή.</p>
          {data.history?.enabled && (
            <p className="mb-4 text-xs text-muted-foreground">
              Ιστορικό CSV · {data.history.saved} νέες παρατηρήσεις
              {data.history.skipped > 0 && ` · ${data.history.skipped} γραμμές παραλείφθηκαν (διπλό ή ελλιπές SKU/τιμή)`}.
            </p>
          )}
          {deleted && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" role="status">
              <span>Διαγράφηκε το SKU {deleted.sku || deleted.id}.</span>
              <Button variant="outline" className="h-8" onClick={undoDelete}>Αναίρεση διαγραφής</Button>
            </div>
          )}
          <RepricingTable entries={entries} onOpen={setSelected} onEdit={edit} onDelete={remove} />
          {data.history?.enabled && <ConfirmPrices exports={exports} />}
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
      <iframe hidden name={downloadTarget} title="Λήψη αρχείου repricing" onLoad={(event) => {
        const doc = event.currentTarget.contentDocument
        if (!doc?.location.pathname.startsWith('/api/repricing/export/')) return
        const failedExport = doc.location.pathname.split('/').at(-1)
        if (failedExport === 'skroutz' || failedExport === 'site') {
          setExports((previous) => ({ ...previous, [failedExport]: undefined }))
        }
        try {
          const response = JSON.parse(doc.body.textContent ?? '')
          setError(typeof response.detail === 'string' ? response.detail : 'Η εξαγωγή απέτυχε.')
        } catch {
          setError('Η εξαγωγή απέτυχε.')
        }
      }} />
    </section>
  )
}
