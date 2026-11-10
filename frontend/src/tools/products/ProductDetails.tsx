import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useApi } from '../../api/useApi'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/feedback'
import { dateLabel } from '../payments/paymentsApi'
import { PriceChart, type Price } from './PriceChart'
import { salePrice, unitPrice, type ProductDetail } from './productData'

function OfferList({ product }: { product: ProductDetail }) {
  return <section aria-labelledby="product-offers" className="min-w-0">
    <h3 id="product-offers" className="mb-2 text-lg font-semibold">Τιμές αγοράς προμηθευτών</h3>
    <p className="mb-3 text-xs text-muted-foreground">Τρέχουσες τιμές καταλόγου ανά φιάλη.</p>
    {!product.offers.length ? <EmptyState>Δεν υπάρχει καταχωρισμένη προσφορά για αυτό το SKU.</EmptyState> : (
      <div className="overflow-x-auto rounded-xl border border-border/65 bg-card">
        <table className="w-full min-w-[27rem] text-left text-sm">
          <thead className="border-b border-border/55 text-xs text-muted-foreground">
            <tr>{['Προμηθευτής', 'Τιμή', 'Διαθεσιμότητα', 'Κατάλογος'].map((label) => <th key={label} scope="col" className="px-3 py-2.5">{label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border/45">
            {product.offers.map(({ supplier, price, availability, day }) => <tr key={supplier}>
              <td className="px-3 py-2.5 font-medium">{supplier}</td>
              <td className="px-3 py-2.5 font-semibold tabular-nums">{unitPrice(price)}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{availability || '—'}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{day ? dateLabel(day) : 'ERP / catalog merge'}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    )}
  </section>
}

function PriceHistory({ product }: { product: ProductDetail }) {
  const [channel, setChannel] = useState<Price['channel']>('skroutz')
  const prices = product.prices.filter((price) => price.channel === channel)
  return <section aria-labelledby="product-history">
    <h3 id="product-history" className="mb-3 text-lg font-semibold">Ιστορικό τιμών</h3>
    <div className="overflow-hidden rounded-xl border border-border/65 bg-card">
      <div className="flex items-center gap-2 border-b border-border/55 px-3 py-2.5" aria-label="Κανάλι τιμών">
        {(['skroutz', 'site'] as const).map((key) => (
          <Button key={key} variant={channel === key ? 'default' : 'ghost'} className="h-8"
            aria-pressed={channel === key} onClick={() => setChannel(key)}>{key === 'skroutz' ? 'Skroutz' : 'Site'}</Button>
        ))}
      </div>
      <PriceChart prices={prices} />
      {!!prices.length && <div className="max-h-80 overflow-auto border-t border-border/55">
        <table className="w-full min-w-[26rem] text-left text-sm">
          <thead className="sticky top-0 bg-card text-xs text-muted-foreground"><tr>
            {['Ημερομηνία', 'Από', 'Σε', 'Πηγή'].map((label) => <th key={label} scope="col" className="px-3 py-2.5">{label}</th>)}
          </tr></thead>
          <tbody>
            {[...prices].reverse().map((price) => (
              <tr key={price.id} className="border-t border-border/45 tabular-nums">
                <td className="px-3 py-2.5">{dateLabel(price.day)}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{salePrice(price.previous)}</td>
                <td className="px-3 py-2.5 font-medium">{salePrice(price.cents)}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{price.source === 'import' ? 'Αρχείο Repricing' : 'Επιβεβαιωμένη αλλαγή'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
  </section>
}

export function ProductDetails({ sku, onBack }: { sku: string; onBack: () => void }) {
  const [result, retry] = useApi<ProductDetail>(`/api/products/history?sku=${encodeURIComponent(sku)}`)
  const product = result.status === 'ready' ? result.data : undefined
  const nameSource = product?.erpName ? 'ERP' : product?.skroutzName ? 'Skroutz' : product?.legacyName ? 'Παλαιότερη καταχώριση Repricing' : ''
  const metrics = product ? [
    ['Τιμή Skroutz', salePrice(product.skroutz), 'Τελευταία καταγεγραμμένη'],
    ['Ελάχ. δική μας Skroutz', unitPrice(product.minimum), product.minimumDay ? `Repricing · ${dateLabel(product.minimumDay)}` : product.minimumSource === 'erp' ? 'ERP / catalog merge' : ''],
    ['Ελάχ. Skroutz αγοράς', unitPrice(product.optimizer), 'Price Optimizer'],
    ['MinBuyPrice', unitPrice(product.minBuy), 'Ελάχιστη αγορά ERP'],
    ['ΤΤΑ', unitPrice(product.lastBuy), 'Τελευταία αγορά ERP'],
  ] : []

  return <div className="page-enter min-w-0">
    <Button variant="ghost" className="mb-3 h-8 px-0 text-muted-foreground" onClick={onBack}>
      <ArrowLeft size={15} aria-hidden="true" /> Πίσω στα προϊόντα
    </Button>
    <Card className="space-y-5 bg-linear-to-br from-card/85 to-primary/10 p-4 sm:p-6">
      <header>
        <p className="mb-1 wrap-break-word text-xs font-semibold text-primary">SKU · {sku}{nameSource && ` / ${nameSource}`}</p>
        <h2 className="wrap-break-word text-xl font-semibold sm:text-2xl">{product?.name ?? 'Καρτέλα προϊόντος'}</h2>
        {product && (
          <dl className="mt-2 space-y-1 text-sm">
            {!product.erpName && <div><dt className="mr-2 inline text-xs text-muted-foreground">ERP</dt><dd className="inline">—</dd></div>}
            {nameSource !== 'Skroutz' && <div>
              <dt className="mr-2 inline text-xs text-muted-foreground">Skroutz</dt>
              <dd className="inline wrap-break-word">{product.skroutzName ?? '—'}</dd>
            </div>}
            {product.erpName && product.legacyName && <div>
              <dt className="mr-2 inline text-xs text-muted-foreground">Παλαιότερη καταχώριση Repricing</dt>
              <dd className="inline wrap-break-word">{product.legacyName}</dd>
            </div>}
          </dl>
        )}
      </header>
      {result.status === 'loading' && <LoadingState title="Φόρτωση καρτέλας προϊόντος…" rows={3} />}
      {result.status === 'error' && (result.code === 404
        ? <EmptyState>Δεν βρέθηκε προϊόν με αυτό το SKU.</EmptyState>
        : <ErrorState title="Η καρτέλα προϊόντος δεν φορτώθηκε" detail={result.detail} retry={result.code === 403 ? undefined : retry} />)}
      {product && <>
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map(([label, value, source]) => <div key={label} className="min-w-0 rounded-xl border border-border/65 bg-card/90 p-3">
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="mt-1 wrap-break-word text-lg font-semibold tabular-nums">{value}</dd>
            {source && <dd className="mt-1 text-xs text-muted-foreground">{source}</dd>}
          </div>)}
        </dl>
        <PriceHistory product={product} />
        <OfferList product={product} />
      </>}
    </Card>
  </div>
}
