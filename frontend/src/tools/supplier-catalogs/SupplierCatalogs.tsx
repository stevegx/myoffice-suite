import { ArrowLeft, Check, ClipboardCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { jsonOptions, requestJson } from '../../api/request'
import { useApi } from '../../api/useApi'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback'
import { useTask } from '../../lib/useTask'
import { dateLabel, readUpload } from '../payments/paymentsApi'
import { UploadBox } from '../payments/UploadBox'
import { athensToday } from '../products/dates'
import type { Catalog, Product } from '../orders/orderData'
import { CatalogReview, type Preview } from './CatalogReview'
import { editedPrice, type CatalogEdit } from './catalogEdits'
import { preferredProducts, preferredSku } from './matching'

const suppliers = ['Cosmodrink', 'Diageo', 'Spirit Hall', 'Pernod', 'Amardis'] as const
type Supplier = typeof suppliers[number]
type Published = { supplier: Supplier; revision: number; day: string; filename: string; rows: number; mapped: number }
type Loaded = { preview: Preview; content: string; filename: string }
const control = 'h-10 min-w-0 rounded-lg border border-border bg-background px-2.5 text-sm'
const emptyProducts: Product[] = []

export default function SupplierCatalogs() {
  const [published, reload] = useApi<{ enabled: boolean; catalogs: Published[] }>('/api/supplier-catalogs')
  const [saved, reloadProducts] = useApi<Catalog>('/api/orders/catalog')
  const [importedProducts, setImportedProducts] = useState<Product[]>()
  const [masterName, setMasterName] = useState('')
  const [mappingName, setMappingName] = useState('')
  const [supplier, setSupplier] = useState<Supplier>('Cosmodrink')
  const [day, setDay] = useState(athensToday)
  const [loaded, setLoaded] = useState<Loaded>()
  const [initialDecisions, setInitialDecisions] = useState<Record<string, string>>({})
  const [edits, setEdits] = useState<Record<string, CatalogEdit>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [notice, setNotice] = useState('')
  const { busy, error, run, clearError } = useTask()
  const enabled = published.status === 'ready' && published.data.enabled
  const products = importedProducts ?? (saved.status === 'ready' ? saved.data.products : emptyProducts)
  const preferred = useMemo(() => preferredProducts(products), [products])
  const erpSkus = useMemo(() => new Set(products.map(({ sku }) => sku)), [products])
  const publishedForSupplier = published.status === 'ready' ? published.data.catalogs.find((item) => item.supplier === supplier) : undefined
  const decisions = useMemo(() => Object.fromEntries(Object.entries(initialDecisions).map(([key, sku]) =>
    [key, edits[key]?.erpSku ?? sku])), [initialDecisions, edits])
  const pending = loaded?.preview.rows.filter((row) => !decisions[row.key]).length ?? 0
  const priced = loaded?.preview.rows.filter((row) => editedPrice(row, edits[row.key]) !== null && decisions[row.key]).length ?? 0
  const changed = loaded?.preview.rows.filter((row) => row.existing && editedPrice(row, edits[row.key]) !== row.previousPrice).length ?? 0
  const firstTime = loaded?.preview.rows.filter((row) => !row.existing).length ?? 0
  const endpoint = `/api/supplier-catalogs/${encodeURIComponent(supplier)}`

  function loadMaster(file: File) {
    setNotice('')
    void run('Ανάγνωση προϊόντων ERP…', 'Η ανάγνωση του συγκεντρωτικού απέτυχε', async () => {
      const result = await requestJson<Catalog>('/api/orders/catalog', jsonOptions({ file: await readUpload(file) }))
      setImportedProducts(result.products)
      setMasterName(file.name)
      setNotice(`Αποθηκευμένα ERP SKU · ${result.products.length}`)
    })
  }

  function loadMappings(file: File) {
    setNotice('')
    void run('Εισαγωγή γνωστών αντιστοιχίσεων…', 'Η εισαγωγή αντιστοιχίσεων απέτυχε', async () => {
      const result = await requestJson<{ saved: number; conflicts: number }>('/api/supplier-catalogs/mappings', jsonOptions({ file: await readUpload(file) }))
      setMappingName(file.name)
      setNotice(`Προστέθηκαν ${result.saved} αντιστοιχίσεις. ${result.conflicts} αντικρουόμενοι κωδικοί χρειάζονται έλεγχο.`)
    })
  }

  function loadSupplier(file: File) {
    setNotice('')
    void run(`Έλεγχος καταλόγου ${supplier}…`, 'Η ανάγνωση του καταλόγου απέτυχε', async () => {
      const content = await readUpload(file)
      const preview = await requestJson<Preview>(`${endpoint}/preview`, jsonOptions({ file: content }))
      const decisions = preview.rows.map((row) => {
        const priority = preferredSku(row, preferred)
        return [row.key, priority ?? (erpSkus.has(row.erpSku) ? row.erpSku : '')]
      })
      setInitialDecisions(Object.fromEntries(decisions))
      setEdits({})
      setLoaded({ preview, content, filename: file.name })
      setConfirmed(false)
    })
  }

  function discard() {
    setLoaded(undefined)
    setInitialDecisions({})
    setEdits({})
    setConfirmed(false)
    clearError()
  }

  function change(changes: ReadonlyMap<string, CatalogEdit>) {
    setEdits((previous) => {
      const next: Record<string, CatalogEdit> = Object.assign(Object.create(null), previous)
      for (const [key, edit] of changes) next[key] = { ...next[key], ...edit }
      return next
    })
    setConfirmed(false)
  }

  function restore(keys: string[]) {
    setEdits((previous) => {
      const next = { ...previous }
      for (const key of keys) delete next[key]
      return next
    })
    setConfirmed(false)
  }

  function approve() {
    if (!loaded || !priced || !day || (pending && !confirmed)) return
    void run('Αποθήκευση εγκεκριμένου καταλόγου…', 'Η έγκριση απέτυχε', async () => {
      const result = await requestJson<{ rows: number; mapped: number }>(`${endpoint}/approve`, jsonOptions({
        file: loaded.content, filename: loaded.filename, revision: loaded.preview.revision, decisions, day,
        edits: Object.fromEntries(Object.entries(edits).flatMap(([key, { price, availability }]) =>
          price === undefined && availability === undefined ? [] : [[key, { price, availability }]])),
      }))
      discard()
      setNotice(`Εγκρίθηκε ο κατάλογος ${supplier} · ${result.mapped} από ${result.rows} γραμμές με ERP SKU.`)
      reload()
    })
  }

  return (
    <section className="page-enter min-w-0" aria-labelledby="supplier-catalog-title">
      <a href="#/" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία</a>
      <header className="mb-5">
        <h1 id="supplier-catalog-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Κατάλογοι προμηθευτών</h1>
        <p className="mt-2 text-sm text-muted-foreground">Έλεγξε τις αντιστοιχίσεις και τις τιμές πριν ενημερώσεις τις Παραγγελίες.</p>
      </header>
      {published.status === 'loading' && !busy && <LoadingState className="mb-4" title="Φόρτωση εγκεκριμένων καταλόγων…" />}
      {published.status === 'error' && <ErrorState className="mb-4" title="Οι εγκεκριμένοι κατάλογοι δεν φορτώθηκαν" detail={published.detail} retry={reload} />}
      {published.status === 'ready' && !enabled && <EmptyState>Η αποθήκευση καταλόγων είναι διαθέσιμη στην προσωπική εγκατάσταση.</EmptyState>}
      {busy && <LoadingState className="mb-4" title={busy} />}
      {error && <ErrorState className="mb-4" {...error} />}
      {notice && <p role="status" className="mb-3 text-sm font-medium text-primary">{notice}</p>}
      {enabled && <Card className="space-y-4 bg-linear-to-br from-card/85 to-primary/10 p-3 sm:p-5">
        {saved.status === 'loading' && !importedProducts && <LoadingState title="Φόρτωση προϊόντων ERP από τη βάση…" />}
        {saved.status === 'error' && !importedProducts && <ErrorState title="Τα προϊόντα ERP δεν φορτώθηκαν" detail={saved.detail} retry={reloadProducts} />}
        {!!products.length && <p className="text-sm font-medium text-muted-foreground">{products.length} ERP SKU από τη βάση</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-border/65 bg-card">
            <UploadBox step={1} label={products.length ? 'Ενημέρωση ή προσθήκη προϊόντων ERP' : 'Αρχική εισαγωγή προϊόντων ERP'}
              accept=".xlsx" filename={masterName} disabled={!!busy || !!loaded || saved.status === 'loading'} onFile={loadMaster} />
          </div>
          <div className="overflow-hidden rounded-xl border border-border/65 bg-card">
            <UploadBox step={2} label="Γνωστές αντιστοιχίσεις (catalog DB)" accept=".xlsx" filename={mappingName} disabled={!!busy || !!loaded} onFile={loadMappings} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Το catalog DB είναι προαιρετικό. Προσθέτει γνωστούς κωδικούς Cosmodrink, Spirit Hall και Amardis.</p>
        <p className="text-xs text-muted-foreground">Οι διορθώσεις της προεπισκόπησης αποθηκεύονται στην τοπική βάση με την έγκριση του καταλόγου.</p>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <label className="grid gap-1 text-sm font-medium">Προμηθευτής
            <select aria-label="Προμηθευτής καταλόγου" className={control} value={supplier} disabled={!!busy || !!loaded}
              onChange={(e) => { setSupplier(e.target.value as Supplier); setNotice(''); clearError() }}>
              {suppliers.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Ημερομηνία καταλόγου
            <input type="date" className={control} value={day} disabled={!!busy} onChange={(e) => setDay(e.target.value)} />
          </label>
        </div>
        {publishedForSupplier && <p className="wrap-break-word text-xs text-muted-foreground">
          Τελευταίος εγκεκριμένος · {dateLabel(publishedForSupplier.day)} · {publishedForSupplier.filename} · {publishedForSupplier.mapped}/{publishedForSupplier.rows} αντιστοιχίσεις
        </p>}
        <div className="overflow-hidden rounded-xl border border-border/65 bg-card">
          <UploadBox step={3} label="Νέος κατάλογος προμηθευτή" accept=".xlsx" filename={loaded?.filename}
            disabled={!!busy || !products.length || !!loaded} onFile={loadSupplier} />
        </div>
        {!products.length && saved.status === 'ready' && <EmptyState>Κάνε την αρχική εισαγωγή προϊόντων ERP μία φορά για να επιλέγεις SKU και στις επόμενες εισαγωγές προμηθευτών.</EmptyState>}
        {loaded && <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/65 bg-card px-3 py-2.5">
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <strong className="inline-flex items-center gap-2"><ClipboardCheck size={16} aria-hidden="true" /> {loaded.preview.rows.length} γραμμές</strong>
              <span>{firstTime} νέες · {changed} αλλαγές τιμών</span><span>{loaded.preview.removed.length} λείπουν</span><span>{pending} χωρίς ERP SKU</span>
              {!!Object.keys(edits).length && <span className="text-primary">{Object.keys(edits).length} γραμμές με διορθώσεις</span>}
            </p>
            <Button variant="ghost" className="h-8" disabled={!!busy} onClick={discard}>Ακύρωση προεπισκόπησης</Button>
          </div>
          <CatalogReview key={loaded.filename} preview={loaded.preview} products={products} decisions={decisions} edits={edits} disabled={!!busy}
            onChange={change} onRestore={restore} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/65 pt-4">
            {pending > 0 ? <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-primary" disabled={!!busy} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              Οι γραμμές χωρίς ERP SKU μένουν εκτός Παραγγελιών.
            </label> : <p className="text-sm text-muted-foreground">Η έγκριση αντικαθιστά τις προηγούμενες τιμές αυτού του προμηθευτή.</p>}
            <Button disabled={!!busy || !day || !priced || (!!pending && !confirmed)} onClick={approve}><Check size={16} aria-hidden="true" /> Έγκριση καταλόγου</Button>
          </div>
        </>}
      </Card>}
    </section>
  )
}
