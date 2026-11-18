import { useMemo, useState } from 'react'
import { jsonOptions, requestJson } from '../../api/request'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback'
import { useTask } from '../../lib/useTask'
import { downloadFile } from '../../lib/downloadFile'
import { ColumnFilter } from '../payments/ColumnFilter'
import { readUpload } from '../payments/paymentsApi'
import { UploadBox } from '../payments/UploadBox'
import { catalogSearch } from './catalogSearch'
import { bestOffer, editPrice, money, newDraft, snapshot, type Product, type Source, type SourceKind, type Sources } from './orderData'

type Offer = { code: string; name: string; price: number | null; erpSku: string; minimumQuantity?: number | null }
export type OfferedProduct = { product: Product; price: number; minBuy: number | null; lastBuy: number | null; minimumQuantity?: number | null }
const control = 'h-9 min-w-0 rounded-md border border-border bg-background px-2 text-sm'
const pageSize = 30
const headings = ['Προϊόν προσφοράς', 'SKU ERP', 'Προσφορά', 'Καλύτερη εναλλακτική', 'Τιμή ίδιου στο Merge', 'MinBuyPrice', 'Αξιολόγηση',
  'Stock', 'Πωλήσεις 1ης περιόδου', 'Πωλήσεις 2ης περιόδου', 'Ελάχ. Skroutz', 'Ελάχ. δική μας', 'Έλεγχος Skroutz']
const collator = new Intl.Collator('el', { numeric: true, sensitivity: 'base' })
const filterLabel = (value: string) => value

export function OfferReview({ suppliers, onAdd, sources, onSource, sourceBusy, periods }: {
  suppliers: string[]
  onAdd: (supplier: string, products: OfferedProduct[]) => void
  sources: Sources
  onSource: (kind: SourceKind, file: File) => void
  sourceBusy: boolean
  periods: { label: string; start: string; end: string; onStart: (day: string) => void; onEnd: (day: string) => void }[]
}) {
  const [supplier, setSupplier] = useState('')
  const [offer, setOffer] = useState<File>()
  const [merge, setMerge] = useState<File>()
  const [mapping, setMapping] = useState<File>()
  const [costs, setCosts] = useState<File>()
  const [result, setResult] = useState<{ supplier: string; offers: Offer[]; products: Product[]; costs: Source['values'] }>()
  const [overrides, setOverrides] = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [onlyBest, setOnlyBest] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState<Record<number, Set<string> | undefined>>({})
  const [sort, setSort] = useState<{ index: number; descending: boolean }>()
  const [notice, setNotice] = useState('')
  const [retrySave, setRetrySave] = useState<{ file?: File }>()
  const { busy, error, run, clearError } = useTask()
  const rows = useMemo(() => {
    if (!result) return []
    const bySku = new Map(result.products.map((product) => [product.sku, product]))
    const comparisonSupplier = result.supplier.toLocaleLowerCase()
    return result.offers.map((row, id) => {
      const sku = overrides[id] ?? (row.erpSku || (bySku.has(row.code) ? row.code : ''))
      const product = bySku.get(sku.trim())
      const other = product && bestOffer(Object.fromEntries(Object.entries(product.offers)
        .filter(([name]) => name.toLocaleLowerCase() !== comparisonSupplier)))
      const prior = product && Object.entries(product.offers).find(([name]) => name.toLocaleLowerCase() === comparisonSupplier)?.[1]
      const minBuy = product ? result.costs[product.sku]?.minBuy ?? product.minBuy : null
      const lastBuy = product ? result.costs[product.sku]?.lastBuy ?? product.lastBuy : null
      const best = row.price !== null && !!other && row.price <= other[1]
      const status = !product ? 'Έλεγχος SKU' : row.price === null ? 'Λείπει τιμή' : !other ? 'Χωρίς σύγκριση' : best ? 'Φθηνότερη διαθέσιμη' : 'Υπάρχει φθηνότερη'
      const line = product ? snapshot({ ...newDraft(id, product), purchase: editPrice(row.price) }, sources, undefined) : undefined
      const extra = [line?.stock, line?.salesRecent, line?.salesOther, line?.skroutz, line?.ownMin, line?.skrCheck]
      const values = [row.name, sku, row.price, other?.[1], prior, minBuy, status, ...extra]
      const labels = [row.name, sku, row.price == null ? '' : money(row.price),
        other ? `${other[0]} · ${money(other[1])}` : '', prior == null ? '' : money(prior), minBuy == null ? '' : money(minBuy), status,
        ...extra.map((value, index) => value == null ? '' : typeof value === 'number' && (index === 3 || index === 4) ? money(value * 10000) : String(value))]
      return { row, id, sku, product, other, prior, minBuy, lastBuy, best, status, values, labels }
    })
  }, [result, overrides, sources])
  const match = catalogSearch(query)
  const visible = rows.filter(({ row, sku, product, best, labels }) =>
    (!onlyBest || best) && match(`${row.code} ${sku} ${row.name} ${product?.name ?? ''}`)
    && labels.every((value, index) => filters[index]?.has(value) ?? true))
  if (sort) visible.sort((a, b) => {
    const left = a.values[sort.index], right = b.values[sort.index]
    if (left == null || left === '') return right == null || right === '' ? 0 : 1
    if (right == null || right === '') return -1
    const delta = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right))
    return sort.descending ? -delta : delta
  })
  const changes = rows.flatMap(({ id, product, row }) =>
    overrides[id] !== undefined && product && product.sku !== row.erpSku ? [{ code: row.code, sku: product.sku }] : [])
  const lastPage = Math.max(0, Math.ceil(visible.length / pageSize) - 1)
  const current = Math.min(page, lastPage)
  const picked = new Map<string, OfferedProduct>()
  for (const { id, row, product, minBuy, lastBuy } of rows) {
    if (!selected.has(id) || !product || row.price === null) continue
    const previous = picked.get(product.sku)
    if (!previous || row.price < previous.price) picked.set(product.sku, { product, price: row.price, minBuy, lastBuy, minimumQuantity: row.minimumQuantity })
  }

  function reset() {
    setResult(undefined)
    setOverrides({})
    setSelected(new Set())
    setPage(0)
    setFilters({})
    setNotice('')
    setRetrySave(undefined)
    clearError()
  }

  function saveMappings(file?: File) {
    if (!result || !changes.length || busy) return
    const data = { supplier: result.supplier, rows: changes }
    setNotice('')
    setRetrySave({ file })
    void run('Ενημέρωση αντιστοιχίσεων…', 'Η ενημέρωση αντιστοιχίσεων απέτυχε', async () => {
      if (file) {
        await downloadFile('/api/supplier-catalogs/offer-mapping-workbook', { ...data, file: await readUpload(file) })
        setNotice('Δημιουργήθηκε ενημερωμένο αντίγραφο με τις αντιστοιχίσεις.')
      } else {
        const saved = await requestJson<{ saved: number }>('/api/supplier-catalogs/offer-mappings', jsonOptions(data))
        setNotice(`Αποθηκεύτηκαν ${saved.saved} αντιστοιχίσεις στη βάση.`)
      }
    })
  }

  function evaluate() {
    const name = supplier.trim()
    if (!offer || busy) return
    void run('Ανάγνωση αρχείων προσφοράς…', 'Η αξιολόγηση προσφοράς απέτυχε', async () => {
      const [offerFile, mergeFile, costsFile, mappingFile] = await Promise.all([
        readUpload(offer), merge && readUpload(merge), costs && readUpload(costs), mapping && readUpload(mapping),
      ])
      const [preview, products, purchaseCosts] = await Promise.all([
        requestJson<{ supplier: string; rows: Offer[] }>('/api/supplier-catalogs/offer-preview',
          jsonOptions({ supplier: name, file: offerFile, merge: mergeFile, mapping: mappingFile })),
        requestJson<Product[]>('/api/orders/offer-reference', mergeFile ? jsonOptions({ file: mergeFile }) : undefined),
        costsFile ? requestJson<Source>('/api/orders/sources/costs', jsonOptions({ file: costsFile })) : undefined,
      ])
      if (!products.length) throw new Error('Ανέβασε το Catalog Merge για να υπάρχουν προϊόντα και τιμές σύγκρισης.')
      setResult({ supplier: preview.supplier, offers: preview.rows, products, costs: purchaseCosts?.values ?? {} })
    })
  }

  return <Card className="space-y-4 p-4 sm:p-5">
    <label className="grid max-w-sm gap-1 text-sm font-medium">Προμηθευτής προσφοράς
      <input className={control} list="offer-suppliers" value={supplier} placeholder="Αυτόματα για την προσφορά Amardis" maxLength={80} disabled={!!busy}
        onChange={(event) => { setSupplier(event.target.value); reset() }} />
    </label>
    <datalist id="offer-suppliers">{suppliers.map((name) => <option key={name} value={name} />)}</datalist>
    <p className="text-sm text-muted-foreground">Χρησιμοποιούνται τα προϊόντα και οι αντιστοιχίσεις της βάσης. Πρόσθεσε αρχεία αναφοράς αν χρειάζονται για αυτή τη σύγκριση.</p>
    <div className="grid gap-2 lg:grid-cols-2">
      {([[offer, setOffer, 'Excel προσφοράς'], [merge, setMerge, 'Catalog Merge (προαιρετικό)'],
        [mapping, setMapping, 'Catalog DB (προαιρετικό)'], [costs, setCosts, 'Excel MinBuyPrice (προαιρετικό)']] as const)
        .map(([file, setFile, label], index) => <div key={label} className="min-w-0 rounded-xl border border-border bg-card">
          <UploadBox step={index + 1} label={label} accept=".xlsx" filename={file?.name} disabled={!!busy}
            onFile={(input) => { setFile(input); reset() }} />
        </div>)}
    </div>
    <details open className="space-y-3 rounded-xl border border-border p-3">
      <summary className="cursor-pointer text-sm font-semibold">Stock, πωλήσεις και ελάχιστη Skroutz</summary>
      <div className="grid gap-2 lg:grid-cols-2">
        {([['stock', 'Stock ERP'], ['salesRecent', 'Πωλήσεις 1ης περιόδου'], ['salesOther', 'Πωλήσεις 2ης περιόδου'],
          ['skroutz', 'Ελάχ. Skroutz']] as const).map(([kind, label], index) =>
          <div key={kind} className="min-w-0 rounded-xl border border-border bg-card">
            <UploadBox step={index + 1} label={label} accept=".xlsx" filename={sources[kind]?.filename}
              disabled={!!busy || sourceBusy} onFile={(file) => onSource(kind, file)} />
            {!!sources[kind]?.conflicts && <p className="px-4 pb-2 text-xs text-muted-foreground" role="status">
              {sources[kind]?.conflicts} SKU με αντικρουόμενα στοιχεία χρειάζονται έλεγχο.
            </p>}
          </div>)}
      </div>
      <div className="flex flex-wrap gap-4">
        {periods.map((period) => <fieldset key={period.label} className="flex flex-wrap gap-2 text-xs">
          <legend className="mb-1 font-medium">{period.label}</legend>
          <label>Από <input className={control} type="date" value={period.start} disabled={!!busy || sourceBusy}
            onChange={(event) => period.onStart(event.target.value)} /></label>
          <label>Έως <input className={control} type="date" value={period.end} disabled={!!busy || sourceBusy}
            onChange={(event) => period.onEnd(event.target.value)} /></label>
        </fieldset>)}
      </div>
      <p className="text-xs text-muted-foreground">Ανέβασε τις αθροισμένες πωλήσεις για τα δύο διαστήματα. Τα αρχεία και οι ημερομηνίες χρησιμοποιούνται και στην παραγγελία.</p>
    </details>
    <Button onClick={evaluate} disabled={!!busy || !!result || !offer}>Σύγκριση προσφοράς</Button>
    {busy && <LoadingState title={busy} />}
    {error && <ErrorState {...error} retry={retrySave ? () => saveMappings(retrySave.file) : evaluate} />}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {result && <>
      <div className="flex flex-wrap items-center gap-3">
        <input className={control} type="search" aria-label="Αναζήτηση προσφοράς" placeholder="Όνομα ή SKU · π.χ. *gold*"
          value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyBest} onChange={(event) => { setOnlyBest(event.target.checked); setPage(0) }} />
          Μόνο η φθηνότερη διαθέσιμη
        </label>
        <Button variant="outline" disabled={!visible.some(({ best }) => best)} onClick={() =>
          setSelected((previous) => new Set([...previous, ...visible.filter(({ best }) => best).map(({ id }) => id)]))}>
          Επιλογή φθηνότερων στα αποτελέσματα
        </Button>
        <Button disabled={!picked.size} onClick={() => onAdd(result.supplier, [...picked.values()])}>
          Στην παραγγελία · {picked.size}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">Σύγκριση με άλλους προμηθευτές του Merge. Το MinBuyPrice εμφανίζεται ως ξεχωριστός έλεγχος.</p>
      {changes.length > 0 && <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!!busy} onClick={() => saveMappings()}>Αποθήκευση SKU στη βάση · {changes.length}</Button>
        {merge && <Button variant="outline" disabled={!!busy} onClick={() => saveMappings(merge)}>Λήψη ενημερωμένου Merge</Button>}
        {mapping && <Button variant="outline" disabled={!!busy} onClick={() => saveMappings(mapping)}>Λήψη ενημερωμένου Catalog DB</Button>}
        {([[merge, 'Merge'], [mapping, 'Catalog DB']] as const).map(([file, label]) => !file &&
          <label key={label} className="grid gap-1 text-xs text-muted-foreground">
            Επίλεξε {label} για ενημερωμένο αντίγραφο
            <input type="file" accept=".xlsx" disabled={!!busy} onChange={(event) => {
              const source = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (source) saveMappings(source)
            }} />
          </label>)}
      </div>}
      {rows.length > 0 && <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[58rem] text-left text-sm">
          <thead className="bg-primary/8 text-xs text-muted-foreground"><tr>
            <th scope="col" className="px-2 py-3">Επιλογή</th>
            {headings.map((title, index) => <th key={title} scope="col" className="px-2 py-3"
              aria-sort={sort?.index === index ? sort.descending ? 'descending' : 'ascending' : 'none'}>
              <div className="flex items-center gap-1">
                <button type="button" className="text-left hover:text-primary" onClick={() =>
                  setSort({ index, descending: sort?.index === index && !sort.descending })}>
                  {title} {sort?.index === index ? sort.descending ? '↓' : '↑' : '↕'}
                </button>
                <ColumnFilter title={title} selected={filters[index]} label={filterLabel} searchMatcher={catalogSearch}
                  getValues={() => [...new Set(rows.map(({ labels }) => labels[index]))].sort(collator.compare)}
                  onApply={(selection) => { setFilters({ ...filters, [index]: selection }); setPage(0) }} />
              </div>
            </th>)}
          </tr></thead>
          <tbody className="divide-y divide-border/60">
            {visible.slice(current * pageSize, (current + 1) * pageSize).map(({ row, id, sku, product, other, prior, minBuy, best, status, labels }) => <tr key={id}>
              <td className="p-2"><input type="checkbox" aria-label={`Επιλογή προσφοράς ${row.code}`} disabled={!product || row.price === null}
                checked={selected.has(id) && !!product} onChange={(event) => {
                  const checked = event.target.checked
                  setSelected((previous) => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next })
                }} /></td>
              <td className="max-w-64 p-2"><span className="block text-xs text-muted-foreground">{row.code}</span>{row.name}</td>
              <td className="p-2"><input className={`${control} w-28`} aria-label={`SKU ERP για ${row.code}`} value={sku}
                onChange={(event) => setOverrides({ ...overrides, [id]: event.target.value })} />
                {product && <span className="mt-1 block max-w-40 text-xs text-muted-foreground">{product.name}</span>}</td>
              <td className="p-2 font-semibold">{money(row.price)}
                {!!row.minimumQuantity && <span className="block text-xs font-normal text-muted-foreground">Από {row.minimumQuantity} φιάλες</span>}</td>
              <td className="p-2">{other ? <>{other[0]} · {money(other[1])}
                {row.price !== null && <span className="block text-xs text-muted-foreground">
                  Διαφορά · {money(row.price - other[1])}
                </span>}</> : '—'}</td>
              <td className="p-2">{money(prior)}</td>
              <td className="p-2">{money(minBuy)}
                {minBuy !== null && row.price !== null && <span className="block text-xs text-muted-foreground">
                  Διαφορά · {money(row.price - minBuy)}
                </span>}</td>
              <td className={`p-2 font-medium ${best ? 'text-primary' : ''}`}>
                {status}
              </td>
              {labels.slice(7).map((value, index) => <td key={index} className="p-2 tabular-nums">{value || '—'}</td>)}
            </tr>)}
          </tbody>
        </table>
      </div>}
      {!visible.length && <EmptyState>Δεν βρέθηκαν προϊόντα με αυτά τα φίλτρα.</EmptyState>}
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>{visible.length} γραμμές · Σελίδα {current + 1} από {lastPage + 1}</span>
        <Button variant="outline" className="h-8" disabled={!current} onClick={() => setPage(current - 1)}>Προηγούμενη</Button>
        <Button variant="outline" className="h-8" disabled={current === lastPage} onClick={() => setPage(current + 1)}>Επόμενη</Button>
      </div>
    </>}
  </Card>
}
