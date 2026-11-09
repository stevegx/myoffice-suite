import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Percent } from 'lucide-react'
import { useId, useState } from 'react'
import { Card } from '../../components/ui/card'
import { ErrorState } from '../../components/ui/feedback'
import { hundredths, maximumPurchasePrice, minimumSkroutzPrice } from './calculations'

const euro = new Intl.NumberFormat('el-GR', { style: 'currency', currency: 'EUR' })
const control = 'h-11 w-full min-w-0 rounded-xl border border-border/75 bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/25'
const rates = ['17', '9', '4', '0']

function PricePanel({ reverse = false, vat }: { reverse?: boolean; vat: bigint | null }) {
  const [input, setInput] = useState('')
  const id = useId()
  const amount = hundredths(input)
  const invalid = !!input.trim() && amount === null
  const result = amount === null || vat === null ? null
    : reverse ? maximumPurchasePrice(amount, vat) : minimumSkroutzPrice(amount, vat)
  const Icon = reverse ? ArrowDownLeft : ArrowUpRight
  const source = reverse ? 'Τιμή Skroutz με ΦΠΑ' : 'Τιμή αγοράς από κατάλογο'
  const destination = reverse ? 'Μέγιστη τιμή αγοράς' : 'Ελάχιστη τιμή Skroutz'

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border/65 bg-card/85 p-4 sm:p-5" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="flex items-center gap-2 text-base font-semibold">
        <Icon size={18} className="shrink-0 text-primary" aria-hidden="true" />
        {reverse ? 'Από Skroutz σε αγορά' : 'Από αγορά σε Skroutz'}
      </h2>
      <label className="mt-5 grid gap-2 text-sm font-medium">
        {source}
        <input className={control} inputMode="decimal" placeholder="0,00" value={input} maxLength={12}
          aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) => setInput(event.target.value)} />
      </label>
      {invalid && <div id={`${id}-error`}>
        <ErrorState className="mt-3" title="Μη έγκυρο ποσό" detail="Δώσε ποσό από 0 έως 9.999.999,99 € με έως δύο δεκαδικά." />
      </div>}
      <div className="mt-4 flex flex-1 flex-col justify-end rounded-xl border border-primary/20 bg-primary/8 p-4">
        <p id={`${id}-result`} className="text-sm font-medium text-muted-foreground">{destination}</p>
        <output aria-labelledby={`${id}-result`} className="mt-1 block wrap-break-word text-3xl font-semibold tracking-tight text-primary tabular-nums">
          {result === null ? '—' : euro.format(Number(result) / 100)}
        </output>
      </div>
    </section>
  )
}

export default function PriceCalculator() {
  const [rate, setRate] = useState('17')
  const [customVat, setCustomVat] = useState('')
  const candidate = hundredths(rate === 'custom' ? customVat : rate)
  const vat = candidate !== null && candidate <= 10_000n ? candidate : null
  const invalidVat = rate === 'custom' && !!customVat.trim() && vat === null

  return (
    <section className="page-enter mx-auto max-w-4xl" aria-labelledby="price-calculator-heading">
      <a href="#/" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία
      </a>
      <header className="mb-6">
        <h1 id="price-calculator-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Price Calculator</h1>
        <p className="mt-2 text-sm text-muted-foreground">Υπολόγισε την ελάχιστη τιμή Skroutz ή τη μέγιστη τιμή αγοράς.</p>
      </header>
      <Card className="glass bg-linear-to-br from-card/85 to-primary/10 p-4 sm:p-6">
        <div className="mb-4 rounded-xl border border-border/60 bg-background/55 p-4 sm:mb-5">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            <label className="grid min-w-36 flex-1 gap-2 text-sm font-semibold sm:flex-none">
              <span className="flex items-center gap-2"><Percent size={15} className="text-primary" aria-hidden="true" /> ΦΠΑ</span>
              <select className={control} value={rate} onChange={(event) => setRate(event.target.value)}>
                {rates.map((value) => <option key={value} value={value}>{value}%</option>)}
                <option value="custom">Άλλος συντελεστής</option>
              </select>
            </label>
            {rate === 'custom' && <label className="grid min-w-36 flex-1 gap-2 text-sm font-medium sm:flex-none">
              Συντελεστής ΦΠΑ (%)
              <input className={control} inputMode="decimal" value={customVat} placeholder="π.χ. 12,5" maxLength={6}
                aria-invalid={invalidVat || undefined} aria-describedby={invalidVat ? 'calculator-vat-error' : undefined}
                onChange={(event) => setCustomVat(event.target.value)} />
            </label>}
            <p className="pb-1.5 text-xs leading-relaxed text-muted-foreground">Ο ΦΠΑ εφαρμόζεται και στους δύο υπολογισμούς.</p>
          </div>
          {invalidVat && <div id="calculator-vat-error">
            <ErrorState className="mt-3" title="Μη έγκυρος συντελεστής" detail="Δώσε ποσοστό από 0 έως 100 με έως δύο δεκαδικά." />
          </div>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <PricePanel vat={vat} />
          <PricePanel vat={vat} reverse />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Στρογγυλοποίηση προς τα πάνω στα δύο δεκαδικά.</p>
      </Card>
    </section>
  )
}
