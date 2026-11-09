import { ArrowLeft, Search } from 'lucide-react'
import { useState } from 'react'
import { useApi } from '../../api/useApi'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback'
import { dateLabel, money } from '../payments/paymentsApi'
import { PriceChart, type Price } from './PriceChart'

type Product = { sku: string; name: string; skroutz: number | null; site: number | null }
type Catalog = { enabled: boolean; items: Product[]; total: number; pageSize: number }
type History = { sku: string; name: string; prices: Price[] }
type Channel = Price['channel']

function displayPrice(cents: number | null) {
  return cents === null ? '—' : money.format(cents / 100)
}

function ProductHistory({ sku, onBack }: { sku: string; onBack: () => void }) {
  const [result, retry] = useApi<History>(`/api/products/history?sku=${encodeURIComponent(sku)}`)
  const [channel, setChannel] = useState<Channel>('skroutz')
  const prices = result.status === 'ready' ? result.data.prices.filter((price) => price.channel === channel) : []
  const latest = prices.at(-1)

  return (
    <div className="page-enter min-w-0">
      <Button variant="ghost" className="mb-3 h-8 px-0 text-muted-foreground" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" /> Πίσω στα προϊόντα
      </Button>
      <Card className="bg-linear-to-br from-card/85 to-primary/10 p-3 sm:p-5">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4 px-2 pt-1">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium text-primary">SKU · {sku}</p>
            <h2 className="wrap-break-word text-lg font-semibold sm:text-xl">{result.status === 'ready' ? result.data.name : 'Ιστορικό τιμών'}</h2>
          </div>
          {latest && <p className="text-sm text-muted-foreground">Τελευταία τιμή <strong className="ml-1 text-lg text-foreground">{displayPrice(latest.cents)}</strong></p>}
        </header>
        {result.status === 'loading' && <LoadingState title="Φόρτωση ιστορικού τιμών…" rows={3} />}
        {result.status === 'error' && (result.code === 404
          ? <EmptyState>Δεν βρέθηκε προϊόν με αυτό το SKU.</EmptyState>
          : <ErrorState title="Δεν ήταν δυνατή η φόρτωση του ιστορικού" detail={result.detail}
            retry={result.code === 403 ? undefined : retry} />)}
        {result.status === 'ready' && (
          <div className="overflow-hidden rounded-xl border border-border/65 bg-card">
            <div className="flex items-center gap-2 border-b border-border/55 px-4 py-3" aria-label="Κανάλι τιμών">
              {(['skroutz', 'site'] as const).map((key) => (
                <Button key={key} variant={channel === key ? 'default' : 'ghost'} className="h-8"
                  aria-pressed={channel === key} onClick={() => setChannel(key)}>{key === 'skroutz' ? 'Skroutz' : 'Site'}</Button>
              ))}
            </div>
            <PriceChart prices={prices} />
            {!!prices.length && (
              <div className="max-h-80 overflow-auto border-t border-border/55">
                <table className="w-full min-w-[29rem] text-left text-sm">
                  <thead className="sticky top-0 bg-card text-xs text-muted-foreground"><tr>
                    {['Ημερομηνία', 'Από', 'Σε', 'Πηγή'].map((label) => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}
                  </tr></thead>
                  <tbody>
                    {[...prices].reverse().map((price) => (
                      <tr key={price.id} className="border-t border-border/45 tabular-nums">
                        <td className="px-4 py-3">{dateLabel(price.day)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{displayPrice(price.previous)}</td>
                        <td className="px-4 py-3 font-medium">{displayPrice(price.cents)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{price.source === 'import' ? 'Αρχείο Repricing' : 'Επιβεβαιωμένη αλλαγή'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function ProductList({ query, page, onPage, onOpen }: {
  query: string; page: number; onPage: (page: number) => void; onOpen: (sku: string) => void
}) {
  const [result, retry] = useApi<Catalog>(`/api/products?q=${encodeURIComponent(query)}&page=${page}`)
  if (result.status === 'loading') return <LoadingState title="Φόρτωση προϊόντων…" rows={4} />
  if (result.status === 'error') return <ErrorState title="Δεν ήταν δυνατή η φόρτωση του καταλόγου" detail={result.detail} retry={retry} />
  if (!result.data.enabled) return <EmptyState>Το ιστορικό είναι απενεργοποιημένο σε αυτή την εγκατάσταση.</EmptyState>
  if (!result.data.items.length) return <EmptyState>{query ? 'Δεν βρέθηκε προϊόν για αυτή την αναζήτηση.' : 'Ο κατάλογος γεμίζει όταν εισάγεις ένα αρχείο στο Repricing.'}</EmptyState>
  const { items, total, pageSize } = result.data
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border/65 bg-card">
      <ul className="divide-y divide-border/50">
        {items.map((item) => (
          <li key={item.sku}>
            <button type="button" onClick={() => onOpen(item.sku)}
              className="grid w-full min-w-0 cursor-pointer gap-2 px-4 py-4 text-left hover:bg-primary/5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-safe:transition-colors sm:grid-cols-[minmax(0,1fr)_9rem_8rem] sm:items-center">
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-primary">{item.sku}</span>
                <span className="mt-1 block wrap-break-word font-medium">{item.name}</span>
              </span>
              <span className="text-sm"><span className="text-muted-foreground">Skroutz </span>{displayPrice(item.skroutz)}</span>
              <span className="text-sm"><span className="text-muted-foreground">Site </span>{displayPrice(item.site)}</span>
            </button>
          </li>
        ))}
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
  return (
    <section className="page-enter mx-auto max-w-5xl" aria-labelledby="products-heading">
      <a href="#/" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία
      </a>
      <h1 id="products-heading" className="mb-6 text-3xl font-semibold sm:text-4xl">Προϊόντα</h1>
      {sku ? <ProductHistory key={sku} sku={sku} onBack={() => setSku('')} /> : (
        <Card className="bg-linear-to-br from-card/85 to-primary/10 p-4 sm:p-6">
          <form className="mb-5 flex gap-2" onSubmit={(event) => {
            event.preventDefault()
            setQuery(draft.trim())
            setPage(1)
          }}>
            <input type="search" aria-label="Αναζήτηση SKU ή προϊόντος" value={draft} maxLength={150}
              onChange={(event) => setDraft(event.target.value)} placeholder="SKU ή όνομα προϊόντος"
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-sm" />
            <Button type="submit"><Search size={16} aria-hidden="true" /> Αναζήτηση</Button>
          </form>
          <ProductList key={`${page}:${query}`} query={query} page={page} onPage={setPage} onOpen={setSku} />
        </Card>
      )}
    </section>
  )
}
