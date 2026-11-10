import { ArrowLeft, Download, ListChecks } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { jsonOptions, requestJson } from '../../api/request'
import { useApi } from '../../api/useApi'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback'
import { downloadFile } from '../../lib/downloadFile'
import { useTask } from '../../lib/useTask'
import { dateLabel, readUpload } from '../payments/paymentsApi'
import { UploadBox } from '../payments/UploadBox'
import { athensToday } from '../products/dates'
import { CatalogPicker } from './CatalogPicker'
import { OrderBulkDialog, type OrderAction } from './OrderBulkDialog'
import { BulkToolbar } from './OrderSelection'
import { OrderTable } from './OrderTable'
import { bestOffer, effectiveOffers, newDraft, snapshot, withSupplier, type Catalog, type Draft, type Source, type SourceKind, type Sources } from './orderData'

const sourcesList = [
  ['stock', 'Stock ERP'], ['salesRecent', 'Πωλήσεις τριμήνου'], ['salesOther', 'Πωλήσεις δεύτερης περιόδου'],
  ['costs', 'MinBuyPrice και ΤΤΑ'], ['skroutz', 'Ελάχ. Skroutz'],
] as const
const dateClass = 'h-8 min-w-0 rounded-md border border-border/70 bg-background px-2 text-xs'
const pageSize = 30
const invalidRange = (start: string, end: string) => !!(start || end) && (!start || !end || start > end)

function threeMonthsBefore(day: string) {
  const date = new Date(`${day}T00:00:00Z`)
  const wanted = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - 3)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(wanted, lastDay))
  return date.toISOString().slice(0, 10)
}

export default function Orders() {
  const [saved, reload] = useApi<Catalog>('/api/orders/catalog')
  if (saved.status === 'ready') return <OrdersWorkspace initialCatalog={saved.data} />
  return (
    <section className="page-enter" aria-labelledby="orders-title">
      <a href="#/" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"><ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία</a>
      <h1 id="orders-title" className="mb-4 text-3xl font-semibold">Παραγγελίες</h1>
      {saved.status === 'loading' ? <LoadingState title="Φόρτωση προϊόντων ERP…" />
        : <ErrorState title="Η λίστα προϊόντων δεν φορτώθηκε" detail={saved.detail} retry={reload} />}
    </section>
  )
}

function OrdersWorkspace({ initialCatalog }: { initialCatalog: Catalog }) {
  const [view, setView] = useState<'catalog' | 'order'>('catalog')
  const [catalog, setCatalog] = useState(initialCatalog)
  const [catalogName, setCatalogName] = useState('')
  const [costsName, setCostsName] = useState('')
  const [sources, setSources] = useState<Sources>({})
  const [drafts, setDrafts] = useState(() => initialCatalog.products.map((product, index) => newDraft(index + 1, product)))
  const nextId = useRef(initialCatalog.products.length)
  const [ordered, setOrdered] = useState<ReadonlySet<number>>(() => new Set())
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set())
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set())
  const [catalogChecked, setCatalogChecked] = useState<ReadonlySet<number>>(() => new Set())
  const [action, setAction] = useState<{ action: OrderAction; hiddenCount: number }>()
  const [removed, setRemoved] = useState<number[]>([])
  const [removedCatalog, setRemovedCatalog] = useState<number[]>([])
  const [editError, setEditError] = useState('')
  const [page, setPage] = useState(0)
  const [supplierFilter, setSupplierFilter] = useState('')
  const [today] = useState(athensToday)
  const [recentStart, setRecentStart] = useState(() => threeMonthsBefore(today))
  const [recentEnd, setRecentEnd] = useState(today)
  const [otherStart, setOtherStart] = useState('')
  const [otherEnd, setOtherEnd] = useState('')
  const [notice, setNotice] = useState('')
  const { busy, error, run, clearError } = useTask()
  const catalogRows = useMemo(() => drafts.filter((row) => row.listed && !hidden.has(row.id)), [drafts, hidden])
  const byId = useMemo(() => new Map(drafts.map((draft) => [draft.id, draft])), [drafts])
  const rows = useMemo(() => [...ordered].flatMap((id) => {
    const draft = byId.get(id)
    return draft ? [{ draft, line: snapshot(draft, sources, catalog.market[draft.product.sku], catalog.optimizer?.[draft.product.sku]) }] : []
  }), [byId, ordered, sources, catalog])
  const actionRows = useMemo(() => action ? drafts.filter(({ id }) => action.action.ids.has(id)).map((draft) => ({
    draft, line: snapshot(draft, sources, catalog.market[draft.product.sku], catalog.optimizer?.[draft.product.sku]),
  })) : [], [action, drafts, sources, catalog])
  const orderSuppliers = [...new Set(rows.map(({ line }) => line.supplier).filter(Boolean))]
  if (supplierFilter && !orderSuppliers.includes(supplierFilter)) orderSuppliers.push(supplierFilter)
  const displayed = supplierFilter ? rows.filter(({ line }) => line.supplier === supplierFilter) : rows
  const last = Math.max(0, Math.ceil(displayed.length / pageSize) - 1)
  const current = Math.min(page, last)
  const pageRows = displayed.slice(current * pageSize, (current + 1) * pageSize)
  const displayedSelected = checked.size ? displayed.filter(({ draft }) => checked.has(draft.id)).length : 0
  const checks = displayed.filter(({ line }) => line.buyCheck === 'Έλεγχος' || line.skrCheck === 'Έλεγχος').length
  const missing = displayed.filter(({ line }) => !line.supplier || !line.purchase || line.buyCheck === 'Εκκρεμεί' || line.skrCheck === 'Εκκρεμεί').length
  const invalidPeriods = invalidRange(recentStart, recentEnd) || invalidRange(otherStart, otherEnd)
  const periods = [
    { label: 'Πωλήσεις τριμήνου', start: recentStart, end: recentEnd, onStart: setRecentStart, onEnd: setRecentEnd },
    { label: 'Πωλήσεις δεύτερης περιόδου', start: otherStart, end: otherEnd, onStart: setOtherStart, onEnd: setOtherEnd },
  ]

  function refreshCatalog(data: Catalog) {
    const products = new Map(data.products.map((product) => [product.sku, product]))
    const additions = data.products.map((product) => newDraft(++nextId.current, product))
    setDrafts((previous) => {
      const existing = new Set(previous.map(({ product }) => product.sku))
      const updated = previous.map((row) => {
        const fresh = products.get(row.product.sku)
        const product = fresh ?? { ...row.product, offers: {}, availability: '', minBuy: null, lastBuy: null }
        const next = { ...row, product, listed: !!fresh }
        return row.purchaseEdited ? next : withSupplier(next, row.supplier)
      })
      return [...updated, ...additions.filter(({ product }) => !existing.has(product.sku))]
    })
    setCatalog(data)
  }

  function loadCatalog(file: File) {
    setNotice('')
    void run('Ανάγνωση προϊόντων ERP…', 'Η εισαγωγή προϊόντων απέτυχε', async () => {
      const data = await requestJson<Catalog>('/api/orders/catalog', jsonOptions({ file: await readUpload(file) }))
      refreshCatalog(data)
      setCatalogChecked(new Set())
      setCatalogName(file.name)
      setNotice(`${data.persistent ? 'Αποθηκευμένα' : 'Διαθέσιμα'} προϊόντα · ${data.products.length}`)
    })
  }

  function loadMasterCosts(file: File) {
    setNotice('')
    void run('Ενημέρωση τιμών αγοράς στη βάση…', 'Η ενημέρωση τιμών αγοράς απέτυχε', async () => {
      const result = await requestJson<{ catalog: Catalog; updated: number; unknown: number; conflicts: number }>(
        '/api/orders/master-costs', jsonOptions({ file: await readUpload(file) }))
      refreshCatalog(result.catalog)
      setCostsName(file.name)
      setNotice(`Ενημερώθηκαν οι τιμές αγοράς σε ${result.updated} προϊόντα.${result.unknown ? ` ${result.unknown} άγνωστα SKU παραλείφθηκαν.` : ''}${result.conflicts ? ` ${result.conflicts} διπλά SKU με αντικρουόμενες τιμές παραλείφθηκαν.` : ''}`)
    })
  }

  function loadSource(kind: SourceKind, file: File) {
    setNotice('')
    const label = sourcesList.find(([key]) => key === kind)?.[1]
    void run(`Ανάγνωση αρχείου · ${label}…`, 'Η εισαγωγή στοιχείων απέτυχε', async () => {
      const data = await requestJson<Omit<Source, 'filename'>>(`/api/orders/sources/${kind}`, jsonOptions({ file: await readUpload(file) }))
      setSources((previous) => ({ ...previous, [kind]: { ...data, filename: file.name } }))
      setNotice(`Ενημερώθηκε το αρχείο «${label}».`)
    })
  }

  function add(ids: number[], supplier: string) {
    const added = new Set(ids.filter((id) => !ordered.has(id)))
    setDrafts((previous) => previous.map((row) => {
      if (!added.has(row.id) || row.supplierEdited || row.purchaseEdited) return row
      return withSupplier(row, supplier || bestOffer(effectiveOffers(row))?.[0] || '')
    }))
    setOrdered((previous) => new Set([...previous, ...added]))
  }

  function change(id: number, changes: Partial<Draft>) {
    setDrafts((previous) => previous.map((row) => row.id === id ? { ...row, ...changes } : row))
  }

  function changeSku(id: number, input: string) {
    const sku = input.trim()
    setEditError('')
    if (!sku || sku === '---' || sku === '#N/A') {
      setEditError('Ο κωδικός SKU χρειάζεται έγκυρη τιμή.')
      return false
    }
    const target = drafts.find((row) => row.id !== id && row.product.sku === sku)
    if (target && (view === 'catalog' || ordered.has(target.id))) {
      setEditError(`Το SKU ${sku} υπάρχει ήδη ${view === 'catalog' ? 'στον κατάλογο' : 'στην παραγγελία'}.`)
      return false
    }
    const source = byId.get(id)
    if (!source) return false
    if (target) {
      const next = target.supplier === source.supplier ? target : withSupplier(target, source.supplier)
      change(target.id, { ...next, quantity: source.quantity, vat: source.vat, notes: source.notes,
        supplierEdited: source.supplierEdited || target.supplierEdited })
      setOrdered((previous) => new Set([...previous].map((key) => key === id ? target.id : key)))
      setChecked((previous) => new Set([...previous].map((key) => key === id ? target.id : key)))
      return true
    }
    setDrafts((previous) => previous.map((row) => {
      if (row.id !== id || row.product.sku === sku) return row
      const replacement = { sku, name: row.name ?? row.product.name, offers: {}, availability: '', minBuy: null, lastBuy: null, marked: false }
      // Keep order choices. Prices and ERP overrides belonged to the previous SKU.
      return withSupplier({ ...row, product: replacement, name: undefined, offers: {}, manual: {} }, row.supplier)
    }))
    return true
  }

  function selectRows(ids: number[], selected: boolean) {
    setChecked((previous) => {
      const next = new Set(previous)
      for (const id of ids) {
        if (selected) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function remove(ids: ReadonlySet<number>) {
    if (view === 'catalog') {
      setRemovedCatalog([...ids])
      setHidden((previous) => new Set([...previous, ...ids]))
      setCatalogChecked((previous) => new Set([...previous].filter((id) => !ids.has(id))))
      return
    }
    setRemoved([...ids])
    setOrdered((previous) => new Set([...previous].filter((id) => !ids.has(id))))
    selectRows([...ids], false)
  }

  function undoRemove() {
    setOrdered((previous) => new Set([...previous, ...removed]))
    setRemoved([])
  }

  function download() {
    if (!displayed.length || invalidPeriods) return
    setNotice('')
    void run('Δημιουργία εκτυπώσιμου Excel…', 'Η εξαγωγή παραγγελίας απέτυχε', async () => {
      const invalid = displayed.filter(({ draft, line }) =>
        !line.name || (draft.purchase.trim() && !line.purchase) || (draft.quantity.trim() && line.quantity === null)
        || line.vat === null || Object.entries(draft.manual).some(([key, value]) =>
          value.trim() && line[key as keyof typeof draft.manual] === null))
      if (invalid.length) throw new Error(`Διόρθωσε την περιγραφή ή τα αριθμητικά πεδία σε ${invalid.length} γραμμές πριν την εξαγωγή.`)
      await downloadFile('/api/orders/export', {
        rows: displayed.map(({ line }) => line),
        periods: periods.map(({ start, end }) => start && end ? `${dateLabel(start)} – ${dateLabel(end)}` : ''),
      })
      setNotice('Η παραγγελία είναι έτοιμη για λήψη.')
    })
  }

  return (
    <section className="orders-workspace page-enter min-w-0" aria-labelledby="orders-title">
      <a href="#/" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία
      </a>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="orders-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Παραγγελίες</h1>
          <p className="mt-2 text-sm text-muted-foreground">Σύγκρινε προσφορές ανά φιάλη και ετοίμασε το εκτυπώσιμο φύλλο.</p>
        </div>
        {view === 'order' && <Button disabled={!displayed.length || !!busy || invalidPeriods} onClick={download}>
          <Download size={16} aria-hidden="true" /> {supplierFilter ? `Λήψη Excel · ${supplierFilter}` : 'Λήψη παραγγελίας Excel'}
        </Button>}
      </header>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Βήμα παραγγελίας">
        <Button variant={view === 'catalog' ? 'default' : 'outline'} aria-pressed={view === 'catalog'} onClick={() => { clearError(); setView('catalog') }} disabled={!!busy}>Επιλογή προϊόντων</Button>
        <Button variant={view === 'order' ? 'default' : 'outline'} aria-pressed={view === 'order'} onClick={() => { clearError(); setView('order') }} disabled={!!busy}>
          <ListChecks size={16} aria-hidden="true" /> Παραγγελία · {rows.length}
        </Button>
      </div>
      {busy && <LoadingState className="mb-4" title={busy} />}
      {error && <ErrorState className="mb-4" {...error} />}
      {editError && <ErrorState className="mb-4" title="Η αλλαγή SKU δεν εφαρμόστηκε" detail={editError} />}
      {notice && <p role="status" className="mb-3 text-sm text-muted-foreground">{notice}</p>}
      <div hidden={view !== 'catalog'}>
        <Card className="space-y-4 bg-linear-to-br from-card/85 to-primary/10 p-4 sm:p-5">
          {catalog.products.length > 0 && <p className="text-sm font-medium text-muted-foreground">
            {catalog.products.length} προϊόντα {catalog.persistent ? 'από τη βάση ERP' : 'από το αρχείο ERP'}
          </p>}
          <details className="rounded-xl border border-border/70 bg-card p-3" open={!catalog.products.length || undefined}>
            <summary className="cursor-pointer text-sm font-semibold">{catalog.products.length ? 'Ενημέρωση προϊόντων ERP' : 'Αρχική εισαγωγή προϊόντων ERP'}</summary>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              <div className="min-w-0 overflow-hidden rounded-lg border border-border/65">
                <UploadBox step={1} label="Προϊόντα ERP (catalog merge ή export)" accept=".xlsx" filename={catalogName} disabled={!!busy} onFile={loadCatalog} />
              </div>
              {catalog.persistent && !!catalog.products.length && <div className="min-w-0 overflow-hidden rounded-lg border border-border/65">
                <UploadBox step={2} label="Μόνιμη ενημέρωση ΤΤΑ / MinBuyPrice" accept=".xlsx" filename={costsName} disabled={!!busy} onFile={loadMasterCosts} />
              </div>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Για νέα προϊόντα χρησιμοποίησε αρχείο με SKU και περιγραφή. Για τιμές αγοράς αρκούν το SKU και η ΤΤΑ ή το MinBuyPrice.</p>
          </details>
          {catalog.duplicates ? <p className="text-sm text-amber-800 dark:text-amber-200" role="status">
            {catalog.duplicates} διπλά SKU χρειάζονται έλεγχο. Οι προσφορές τους παραλείφθηκαν από τη σύγκριση.
          </p> : null}
          {!!removedCatalog.length && <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
            Αφαιρέθηκαν {removedCatalog.length} προϊόντα από την επιλογή.
            <Button variant="outline" className="h-8" onClick={() => {
              const ids = new Set(removedCatalog)
              setHidden((previous) => new Set([...previous].filter((id) => !ids.has(id))))
              setRemovedCatalog([])
            }}>Αναίρεση διαγραφής</Button>
          </div>}
          {catalog.products.length ? <CatalogPicker rows={catalogRows} suppliers={catalog.suppliers} ordered={ordered} checked={catalogChecked} setChecked={setCatalogChecked}
            onAdd={add} onAction={(action, hiddenCount) => setAction({ action, hiddenCount })} onChange={change} onSkuChange={changeSku} /> :
            <EmptyState>Ανέβασε ένα αρχείο προϊόντων ERP για να ξεκινήσεις.</EmptyState>}
        </Card>
      </div>
      {view === 'order' && (
        <Card className="space-y-4 bg-linear-to-br from-card/85 to-primary/10 p-3 sm:p-5">
          <details className="rounded-xl border border-border/65 bg-card px-3 py-2.5" open={!rows.length || undefined}>
            <summary className="cursor-pointer text-sm font-semibold">Αρχεία ERP και Skroutz · {Object.keys(sources).length}/{sourcesList.length}</summary>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {sourcesList.map(([kind, label], index) => (
                <div key={kind} className="min-w-0 overflow-hidden rounded-lg border border-border/65">
                  <UploadBox step={index + 1} label={kind === 'costs' ? 'MinBuyPrice και ΤΤΑ · μόνο για αυτή την παραγγελία' : label} accept=".xlsx" filename={sources[kind]?.filename} disabled={!!busy}
                    onFile={(file) => loadSource(kind, file)} />
                  {sources[kind]?.conflicts ? <p role="status" className="px-4 pb-2 text-xs text-amber-800 dark:text-amber-200">
                    {sources[kind].conflicts} SKU με διαφορετικές τιμές στο ίδιο αρχείο χρειάζονται χειροκίνητο έλεγχο.
                  </p> : null}
                </div>
              ))}
            </div>
            <div className="my-3 flex flex-wrap gap-x-6 gap-y-3">
              {periods.map(({ label, start, end, onStart, onEnd }) => (
                <fieldset key={label} className="flex min-w-0 flex-wrap items-center gap-2">
                  <legend className="mb-1 text-xs font-medium">{label}</legend>
                  <input type="date" className={dateClass} aria-label={`Από · ${label}`} value={start}
                    onChange={(e) => onStart(e.target.value)} />
                  <input type="date" className={dateClass} aria-label={`Έως · ${label}`} value={end}
                    onChange={(e) => onEnd(e.target.value)} />
                </fieldset>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Οι ημερομηνίες μπαίνουν στις επικεφαλίδες. Ανέβασε τις ήδη αθροισμένες πωλήσεις για κάθε περίοδο.</p>
            {catalog.persistent && <p className="mt-1 text-xs text-muted-foreground">Το αρχείο Price Optimizer ενημερώνει και τις αποθηκευμένες τιμές στις καρτέλες Προϊόντων.</p>}
          </details>
          {invalidPeriods && <ErrorState title="Μη έγκυρο διάστημα" detail="Συμπλήρωσε και τις δύο ημερομηνίες της περιόδου, με την έναρξη πριν από ή ίδια με τη λήξη." />}
          {!!rows.length && <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
            Προμηθευτής παραγγελίας
            <select aria-label="Προμηθευτής παραγγελίας" className={dateClass} value={supplierFilter} disabled={!!busy}
              onChange={(e) => { setSupplierFilter(e.target.value); setPage(0) }}>
              <option value="">Όλοι οι προμηθευτές</option>
              {orderSuppliers.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>}
          {!!removed.length && <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
            Αφαιρέθηκαν {removed.length} γραμμές.
            <Button variant="outline" className="h-8" onClick={undoRemove}>Αναίρεση διαγραφής</Button>
          </div>}
          <BulkToolbar count={checked.size} visible={displayed.length} selectedVisible={displayedSelected}
            onAll={() => setChecked(new Set(displayed.map(({ draft }) => draft.id)))} onClear={() => setChecked(new Set())}
            onEdit={() => setAction({ action: { type: 'edit', ids: checked }, hiddenCount: checked.size - displayedSelected })}
            onDelete={() => setAction({ action: { type: 'delete', ids: checked }, hiddenCount: checked.size - displayedSelected })} />
          {displayed.length ? <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <strong>{displayed.length} προϊόντα</strong>
              <span className="text-amber-800 dark:text-amber-200">{checks} με έλεγχο τιμής</span>
              <span className="text-muted-foreground">{missing} με εκκρεμότητες</span>
            </div>
            <OrderTable rows={pageRows} suppliers={catalog?.suppliers ?? []} checked={checked} onSelect={selectRows}
              onChange={change} onSkuChange={changeSku} onRemove={(id) => remove(new Set([id]))}
              onOffer={(id) => setAction({ action: { type: 'offer', ids: new Set([id]) }, hiddenCount: 0 })} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Σελίδα {current + 1} από {last + 1}</span>
              <div className="flex gap-2">
                <Button variant="outline" className="h-8" disabled={current === 0} onClick={() => setPage(current - 1)}>Προηγούμενη</Button>
                <Button variant="outline" className="h-8" disabled={current === last} onClick={() => setPage(current + 1)}>Επόμενη</Button>
              </div>
            </div>
          </> : <EmptyState>{rows.length ? 'Δεν υπάρχουν γραμμές για αυτόν τον προμηθευτή.' : 'Πρόσθεσε προϊόντα από την επιλογή προϊόντων για να ξεκινήσεις την παραγγελία.'}</EmptyState>}
        </Card>
      )}
      {action && <OrderBulkDialog action={action.action} rows={actionRows} suppliers={catalog?.suppliers ?? []} catalog={view === 'catalog'}
        hiddenCount={action.hiddenCount}
        onClose={() => setAction(undefined)} onDelete={remove} onEdit={(changes) => {
          setDrafts((previous) => previous.map((row) => changes.get(row.id) ?? row))
          setNotice(`Ενημερώθηκαν ${changes.size} γραμμές.`)
        }} />}
    </section>
  )
}
