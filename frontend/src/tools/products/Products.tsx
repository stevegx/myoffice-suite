import { ArrowLeft, ChevronRight, Search } from 'lucide-react'
import { useRef, useState } from 'react'
import { useApi } from '../../api/useApi'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback'
import { ProductDetails } from './ProductDetails'
import { salePrice, unitPrice, type Catalog } from './productData'

const columns = 'lg:grid-cols-[minmax(0,1fr)_5.5rem_6.75rem_5.5rem_5.5rem_7.5rem]'
const labels = ['Τιμή Skroutz', 'Ελάχ. δική μας', 'MinBuyPrice', 'ΤΤΑ', 'Καλύτερη προσφορά']

function ProductList({ query, page, onPage, onOpen }: {
  query: string; page: number; onPage: (page: number) => void; onOpen: (sku: string) => void
}) {
  const [result, retry] = useApi<Catalog>(`/api/products?q=${encodeURIComponent(query)}&page=${page}`)
  if (result.status === 'loading') return <LoadingState title="Φόρτωση προϊόντων…" rows={4} />
  if (result.status === 'error') return <ErrorState title="Δεν ήταν δυνατή η φόρτωση του καταλόγου" detail={result.detail} retry={retry} />
  if (!result.data.enabled) return <EmptyState>Η κεντρική λίστα προϊόντων είναι διαθέσιμη στην προσωπική εγκατάσταση.</EmptyState>
  if (!result.data.items.length) return <EmptyState>{query ? 'Δεν βρέθηκε προϊόν Repricing για αυτή την αναζήτηση.' : 'Ανέβασε το CSV στο Repricing για να εμφανιστούν τα προϊόντα εδώ.'}</EmptyState>
  const { items, total, pageSize } = result.data
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border/65 bg-card">
      <div aria-hidden="true" className={`hidden gap-2.5 border-b border-border/55 bg-primary/6 px-3 py-2 text-xs font-semibold text-muted-foreground lg:grid ${columns}`}>
        <span>SKU / Ονομασίες</span>
        {labels.map((label) => <span key={label}>{label}</span>)}
      </div>
      <ul className="divide-y divide-border/50">
        {items.map((item) => {
          const values = [salePrice(item.skroutz), unitPrice(item.minimum), unitPrice(item.minBuy), unitPrice(item.lastBuy), unitPrice(item.bestOffer?.price)]
          const names = [['ERP', item.erpName], ['Skroutz', item.skroutzName], ['Repricing', item.legacyName]]
          return (
            <li key={item.sku}>
              <button type="button" onClick={() => onOpen(item.sku)}
                className={`grid w-full min-w-0 cursor-pointer grid-cols-3 gap-x-2.5 gap-y-1.5 px-3 py-2 text-left hover:bg-primary/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-safe:transition-colors sm:grid-cols-5 lg:items-center ${columns}`}>
                <span className="col-span-full flex min-w-0 items-center gap-2 lg:col-span-1">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] leading-tight font-semibold text-primary">{item.sku}</span>
                    {names.map(([source, name]) => name && (
                      <span key={source} className="mt-0.5 block wrap-anywhere text-sm leading-tight font-medium">
                        <span className="mr-1.5 text-[11px] font-normal text-muted-foreground">{source}</span>{name}
                      </span>
                    ))}
                    {names.every(([, name]) => !name) && <span className="mt-0.5 block wrap-anywhere text-sm font-medium">{item.name}</span>}
                  </span>
                  <ChevronRight size={14} className="shrink-0 text-primary/65" aria-hidden="true" />
                </span>
                {values.map((value, index) => (
                  <span key={labels[index]} className="min-w-0 text-xs leading-tight tabular-nums md:text-sm md:leading-tight">
                    <span className="block text-[11px] text-muted-foreground lg:sr-only">{index === 4 ? 'Προσφορά' : labels[index]}</span>
                    <span className="block wrap-break-word font-medium">{value}</span>
                    {index === 1 && item.optimizer != null && <span className="block wrap-break-word text-[11px] text-muted-foreground">Αγορά · {unitPrice(item.optimizer)}</span>}
                    {index === 4 && item.bestOffer && <span className="block truncate text-[11px] text-muted-foreground" title={item.bestOffer.supplier}>{item.bestOffer.supplier}</span>}
                  </span>
                ))}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/55 px-4 py-3 text-sm text-muted-foreground">
        <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} από {total}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="h-8" disabled={page === 1} onClick={() => onPage(page - 1)}>Προηγούμενη</Button>
          <Button variant="outline" className="h-8" disabled={page * pageSize >= total} onClick={() => onPage(page + 1)}>Επόμενη</Button>
        </div>
      </div>
    </div>
  )
}

export default function Products() {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [sku, setSku] = useState(() => new URLSearchParams(window.location.hash.split('?')[1]).get('sku') ?? '')
  const listRef = useRef<HTMLDivElement>(null)

  function returnToListStart() {
    const list = listRef.current
    if (list && list.getBoundingClientRect().top < 0) list.scrollIntoView()
  }

  return (
    <section className={`page-enter mx-auto ${sku ? 'max-w-6xl' : 'products-workspace'}`} aria-labelledby="products-heading">
      <a href="#/" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία
      </a>
      <header className="mb-5">
        <h1 id="products-heading" className="text-3xl font-semibold sm:text-4xl">Προϊόντα</h1>
        <p className="mt-2 text-sm text-muted-foreground">Προϊόντα από το πιο πρόσφατο Repricing, με αντιστοίχιση ERP και ιστορικό ανά SKU.</p>
      </header>
      {sku ? <ProductDetails key={sku} sku={sku} onBack={() => setSku('')} /> : (
        <Card ref={listRef} className="scroll-mt-2 bg-linear-to-br from-card/85 to-primary/10 p-3 sm:p-4">
          <form className="sticky top-2 z-10 mb-3 flex gap-2 rounded-xl border border-border bg-card p-1.5 shadow-sm" onSubmit={(event) => {
            event.preventDefault()
            returnToListStart()
            setQuery(draft.trim())
            setPage(1)
          }}>
            <input type="search" aria-label="Αναζήτηση με SKU ή όνομα ERP ή Skroutz" value={draft} maxLength={150}
              onChange={(event) => setDraft(event.target.value)} placeholder="SKU ή όνομα · π.χ. *gold*"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background/45 px-2.5 text-sm" />
            <Button type="submit" className="h-9 gap-1.5 rounded-lg px-2.5"><Search size={15} aria-hidden="true" /> Αναζήτηση</Button>
          </form>
          <ProductList key={`${page}:${query}`} query={query} page={page} onPage={(nextPage) => {
            returnToListStart()
            setPage(nextPage)
          }} onOpen={setSku} />
        </Card>
      )}
    </section>
  )
}
