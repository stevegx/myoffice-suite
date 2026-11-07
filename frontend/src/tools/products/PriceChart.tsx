import { dateLabel, money } from '../payments/paymentsApi'

export type Price = {
  id: number
  channel: 'skroutz' | 'site'
  day: string
  cents: number
  previous: number | null
  source: 'import' | 'confirmed'
}

export function PriceChart({ prices }: { prices: Price[] }) {
  if (!prices.length) return <p className="p-5 text-sm text-muted-foreground">Δεν υπάρχει καταγεγραμμένη τιμή για αυτό το κανάλι.</p>
  const days = prices.map(({ day }) => Date.parse(`${day}T00:00:00Z`))
  const amounts = prices.map(({ cents }) => cents)
  const first = days[0]
  const last = days.at(-1)!
  const minimum = Math.min(...amounts)
  const maximum = Math.max(...amounts)
  const padding = Math.max(1, Math.round((maximum - minimum) * 0.1))
  const low = Math.max(0, minimum - padding)
  const high = maximum + padding
  const x = (index: number) => first === last ? 330 : 88 + (days[index] - first) * 550 / (last - first)
  const y = (cents: number) => 185 - (cents - low) * 159 / (high - low)
  const curve = prices.map((price, index) => index ? `H ${x(index)} V ${y(price.cents)}` : `M ${x(0)} ${y(price.cents)}`).join(' ')
  const ticks = minimum === maximum ? [minimum] : [minimum, Math.round((minimum + maximum) / 2), maximum]

  return (
    <figure className="px-3 pt-2 pb-4 sm:px-5">
      <svg viewBox="0 0 660 218" role="img" aria-label="Γράφημα διαχρονικής τιμής"
        className="block h-auto max-h-64 w-full overflow-visible text-primary">
        {[...new Set(ticks)].map((tick) => (
          <g key={tick}>
            <line x1="88" x2="638" y1={y(tick)} y2={y(tick)} className="stroke-border/75" strokeDasharray="4 4" />
            <text x="76" y={y(tick) + 4} textAnchor="end" className="fill-muted-foreground text-[15px]">{money.format(tick / 100)}</text>
          </g>
        ))}
        <path d={curve} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
        {prices.map((price, index) => (
          <circle key={price.id} cx={x(index)} cy={y(price.cents)} r={index === prices.length - 1 ? 5 : 3}
            fill="currentColor" className="stroke-card" strokeWidth="1.5">
            <title>{dateLabel(price.day)} · {money.format(price.cents / 100)}</title>
          </circle>
        ))}
        <text x={first === last ? x(0) : 88} y="211" textAnchor={first === last ? 'middle' : 'start'}
          className="fill-muted-foreground text-[15px]">{dateLabel(prices[0].day)}</text>
        {first !== last && <text x="638" y="211" textAnchor="end" className="fill-muted-foreground text-[15px]">{dateLabel(prices.at(-1)!.day)}</text>}
      </svg>
    </figure>
  )
}
