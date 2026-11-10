import { Tags, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { dateLabel } from '../payments/paymentsApi'
import { orderCheckbox, ProductFields, SelectPage } from './OrderSelection'
import { money, withSupplier, type Draft, type snapshot } from './orderData'

type Line = ReturnType<typeof snapshot>
const fields = [
  ['lastBuy', 'ΤΤΑ'], ['minBuy', 'MinBuyPrice'], ['skroutz', 'Ελάχ. Skroutz'],
  ['stock', 'Stock'], ['salesRecent', 'Πωλήσεις τριμήνου'], ['salesOther', 'Πωλήσεις 2ης περιόδου'],
] as const
const headers = ['Προϊόν', 'Προμηθευτής', 'Αγορά', 'Φιάλες', 'ΦΠΑ %', 'Τιμή Amardis', 'ΤΤΑ', 'MinBuyPrice',
  'Ελάχ. δική μας', 'Ελάχ. Skroutz', 'Φθηνότερος Skroutz', 'Stock', 'Πωλήσεις τριμήνου', 'Πωλήσεις 2ης περιόδου',
  'Skroutz', 'Γρηγορίου', 'Σημειώσεις', '']
const control = 'h-8 w-full min-w-0 rounded-md border border-border/65 bg-background px-2 text-xs tabular-nums focus:border-primary aria-invalid:border-red-500'

function EditField({ label, value, onChange, invalid, integer = false }: {
  label: string; value: string; onChange: (value: string) => void; invalid?: boolean; integer?: boolean
}) {
  return <input aria-label={label} inputMode={integer ? 'numeric' : 'decimal'} className={control}
    placeholder="---" maxLength={14} value={value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />
}

function Check({ state, delta }: { state: string; delta: number | null }) {
  const tone = state === 'ΟΚ' ? 'bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'
    : state === 'Έλεγχος' ? 'bg-amber-500/12 text-amber-900 dark:text-amber-200' : 'bg-background text-muted-foreground'
  return <div className="grid justify-items-start gap-1">
    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${tone}`}>{state}</span>
    {delta !== null && <span className="text-xs tabular-nums text-muted-foreground">{delta > 0 ? '+' : ''}{money(delta)}</span>}
  </div>
}

export function OrderTable({ rows, suppliers, checked, onSelect, onChange, onSkuChange, onOffer, onRemove }: {
  rows: { draft: Draft; line: Line }[]
  suppliers: string[]
  checked: ReadonlySet<number>
  onSelect: (ids: number[], checked: boolean) => void
  onChange: (id: number, changes: Partial<Draft>) => void
  onSkuChange: (id: number, value: string) => boolean
  onOffer: (id: number) => void
  onRemove: (id: number) => void
}) {
  return (
    <div className="max-h-[65vh] overflow-auto rounded-xl border border-border/65 bg-card" role="region" aria-label="Γραμμές παραγγελίας" tabIndex={0}>
      <datalist id="order-suppliers">{suppliers.map((name) => <option key={name} value={name} />)}</datalist>
      <table className="w-full min-w-[130rem] table-fixed border-separate border-spacing-0 text-left text-sm [--order-product-width:155px] sm:[--order-product-width:230px]">
        <colgroup>{['var(--order-product-width)', 144, 100, 78, 72, 140, 100, 108, 115, 108, 138, 88, 116, 116, 100, 100, 172, 48].map((width, i) => <col key={i} style={{ width }} />)}</colgroup>
        <thead className="sticky top-0 z-20 bg-card text-xs text-muted-foreground">
          <tr>{headers.map((header, i) => <th key={i} scope="col" className={`border-b border-border/65 bg-card px-2 py-3 ${i === 0 ? 'sticky left-0 z-10 border-r' : ''}`}>
            {i === 0 ? <label className="flex items-center gap-2">
              <SelectPage ids={rows.map(({ draft }) => draft.id)} checked={checked} onSelect={onSelect} />
              {header}
            </label> : header || <span className="sr-only">Ενέργειες</span>}
          </th>)}</tr>
        </thead>
        <tbody>
          {rows.map(({ draft, line }) => {
            const { sku } = line
            const { id } = draft
            const selected = checked.has(id)
            const field = ([key, label]: typeof fields[number]) => {
              const value = draft.manual[key] ?? (line[key] === null ? '' : String(line[key]).replace('.', ','))
              return <td key={key} className="px-2 py-2">
                <EditField label={`${label} ${sku}`} value={value} invalid={!!value.trim() && line[key] === null}
                  onChange={(next) => onChange(id, { manual: { ...draft.manual, [key]: next } })} />
              </td>
            }
            return <tr key={id} className={`[&>td]:border-b [&>td]:border-border/40 ${selected ? 'bg-primary/10' : ''}`}>
              <td className={`sticky left-0 z-10 border-r bg-card px-2 py-3 ${selected ? 'bg-linear-to-r from-primary/10 to-primary/10' : ''}`}>
                <div className="flex min-w-0 items-start gap-2">
                  <input type="checkbox" className={`${orderCheckbox} mt-1.5 shrink-0`} aria-label={`Επιλογή SKU ${sku}`} checked={selected}
                    onChange={(event) => onSelect([id], event.currentTarget.checked)} />
                  <ProductFields draft={draft} onChange={(name) => onChange(id, { name })} onSkuChange={(sku) => onSkuChange(id, sku)} />
                </div>
              </td>
              <td className="px-2">
                <input className={control} aria-label={`Προμηθευτής ${sku}`} list="order-suppliers" placeholder="---"
                  maxLength={80} value={draft.supplier} onChange={(e) => {
                    onChange(id, { ...withSupplier(draft, e.target.value), supplierEdited: true })
                  }} />
              </td>
              <td className="px-2"><EditField label={`Αγορά ${sku}`} value={draft.purchase} invalid={!!draft.purchase.trim() && !line.purchase}
                onChange={(purchase) => onChange(id, { purchase, purchaseEdited: true })} /></td>
              <td className="px-2"><EditField label={`Φιάλες ${sku}`} value={draft.quantity} invalid={!!draft.quantity.trim() && line.quantity === null} integer
                onChange={(quantity) => onChange(id, { quantity })} /></td>
              <td className="px-2"><EditField label={`ΦΠΑ ${sku}`} value={draft.vat} invalid={line.vat === null}
                onChange={(vat) => onChange(id, { vat })} /></td>
              <td className="px-2 py-2 text-xs tabular-nums">
                <span className="block font-medium">{money(line.amardis === null ? null : line.amardis * 10_000)}</span>
                {line.availability && <span className="text-muted-foreground">{line.availability}</span>}
                <Button variant="ghost" className="mt-0.5 h-7 px-1.5 text-xs text-primary" aria-label={`Τιμές προμηθευτών ${sku}`}
                  onClick={() => onOffer(id)}><Tags size={13} aria-hidden="true" /> Τιμές</Button>
              </td>
              {fields.slice(0, 2).map(field)}
              <td className="px-2 font-semibold tabular-nums text-primary">{money(line.ownMin === null ? null : line.ownMin * 10_000)}</td>
              {field(fields[2])}
              <td className="px-2 text-xs tabular-nums">
                <span className="block font-medium">{money(line.competitor === null ? null : line.competitor * 10_000)}</span>
                {line.competitorDay && <span className="block text-muted-foreground" title={line.competitorShop}>{dateLabel(line.competitorDay)}</span>}
              </td>
              {fields.slice(3).map(field)}
              <td className="px-2"><Check state={line.skrCheck}
                delta={line.ownMin === null || line.skroutz === null ? null : Math.round((line.ownMin - line.skroutz) * 10_000)} /></td>
              <td className="px-2"><Check state={line.buyCheck}
                delta={!line.purchase || line.minBuy === null ? null : Math.round((line.purchase - line.minBuy) * 10_000)} /></td>
              <td className="px-2"><input className={control} aria-label={`Σημειώσεις ${sku}`} value={draft.notes} maxLength={300}
                onChange={(e) => onChange(id, { notes: e.target.value })} /></td>
              <td className="px-1"><Button variant="ghost" size="icon" className="size-8 text-red-700 dark:text-red-300"
                aria-label={`Αφαίρεση ${sku}`} onClick={() => onRemove(id)}><Trash2 size={15} aria-hidden="true" /></Button></td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
  )
}
