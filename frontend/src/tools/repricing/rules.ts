export type MarketRow = {
  id: number
  product: string
  sku: string
  our: string
  cheapest: string
  shop: string
  rank: string
  competitors: string
}

type Minimum = { name: string; minSkr: string; minSite: string }
export type ImportResult = {
  rows: MarketRow[]
  minimums: Record<string, Minimum[]>
  history?: { enabled: boolean; saved: number; skipped: number }
}
export type Row = MarketRow & {
  sourceOur: string
  minName: string
  minSkr: string
  minSite: string
  skrOverride: string
  siteOverride: string
  approvedSkr: boolean
  approvedSite: boolean
  excluded: boolean
}

export function minimumFor(minimums: ImportResult['minimums'], sku: string): Minimum[] {
  return Object.hasOwn(minimums, sku.trim()) ? minimums[sku.trim()] : []
}

export function minimumFields(matches: Minimum[]) {
  return {
    minName: matches.length === 1 ? matches[0].name : '',
    minSkr: matches.length === 1 ? matches[0].minSkr : '',
    minSite: matches.length === 1 ? matches[0].minSite : '',
  }
}

export function createRows(data: ImportResult): Row[] {
  return data.rows.map((row) => ({
    ...row, ...minimumFields(minimumFor(data.minimums, row.sku)), sourceOur: row.our,
    skrOverride: '', siteOverride: '', approvedSkr: false, approvedSite: false, excluded: false,
  }))
}

export function cents(input: string) {
  const match = /^(\d{1,7})(?:[,.](\d{1,2}))?$/.exec(input.trim())
  return match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : null
}

const decimal = new Intl.NumberFormat('el-GR', { useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function formatPrice(value: number | null) {
  return value === null ? '—' : decimal.format(value / 100)
}

function floorCheck(value: number | null, minimum: number | null) {
  if (!minimum) return 'missing' as const
  if (!value) return 'invalid' as const
  if (value >= minimum) return 'ok' as const
  return value * 1000 >= minimum * 985 ? 'exception' as const : 'below' as const
}

export const floorLabels = {
  missing: 'Λείπει έγκυρη ελάχιστη τιμή',
  invalid: 'Μη έγκυρη τελική τιμή',
  ok: 'Στην ελάχιστη ή πάνω',
  exception: 'Κάτω από την ελάχιστη έως 1,5% · απαιτείται έγκριση',
  below: 'Κάτω από την ελάχιστη πάνω από 1,5% · διόρθωσε την τιμή',
}

export function evaluate(row: Row, duplicate: boolean) {
  const our = cents(row.our)
  const original = cents(row.sourceOur)
  const cheapest = cents(row.cheapest)
  const minSkr = cents(row.minSkr)
  const minSite = cents(row.minSite)
  const rank = /^\d+$/.test(row.rank.trim()) ? Number(row.rank) : null
  const hasCompetitors = /^\d+$/.test(row.competitors.trim()) ? Number(row.competitors) > 0 : null
  let proposal = our
  let reason = 'Διατήρηση της τιμής Skroutz.'
  let warning = ''

  if (!our) {
    warning = 'Συμπλήρωσε έγκυρη τιμή Our price.'
  } else if (rank === 1) {
    if (cheapest && our && cheapest < our) {
      warning = 'Rank 1 με φθηνότερο ανταγωνιστή. Έλεγξε την κατάταξη.'
    } else if (hasCompetitors === false) {
      reason = 'Rank 1 χωρίς ανταγωνιστές. Έλεγχος ελάχιστης.'
    } else if (hasCompetitors === null) {
      warning = 'Λείπει έγκυρος αριθμός ανταγωνιστών.'
    } else if (our && cheapest && cheapest - our > 20) {
      const candidate = cheapest - 5
      if (minSkr && candidate >= minSkr) {
        proposal = candidate
        reason = 'Rank 1 · αύξηση έως 0,05 € κάτω από τον επόμενο.'
      } else {
        reason = 'Η αύξηση δεν φτάνει την ελάχιστη Skroutz.'
      }
    } else if (!cheapest) {
      warning = 'Λείπει η τιμή του ανταγωνιστή.'
    } else {
      reason = 'Rank 1 · διαφορά έως 0,20 €, διατήρηση τιμής.'
    }
  } else if (rank !== null && rank >= 2) {
    if (our && cheapest && our >= cheapest) {
      const candidate = cheapest - 3
      if (minSkr && candidate >= minSkr) {
        proposal = candidate
        reason = 'Rank 2+ · μείωση 0,03 € κάτω από το Cheapest.'
      } else {
        reason = 'Η μείωση παραβιάζει την ελάχιστη Skroutz ή λείπει η ελάχιστη.'
      }
    } else if (!cheapest) {
      warning = 'Λείπει η τιμή Cheapest.'
    } else {
      reason = 'Rank 2+ · η τιμή μας είναι ήδη χαμηλότερη από το Cheapest.'
    }
  } else if (!row.rank.trim()) {
    reason = 'Χωρίς κατάταξη · έλεγχος ελάχιστης χωρίς αλλαγή.'
  } else {
    warning = 'Μη έγκυρη κατάταξη.'
  }

  const skr = row.skrOverride.trim() ? cents(row.skrOverride) : proposal
  const site = row.siteOverride.trim() ? cents(row.siteOverride) : skr === null ? null : Math.floor((skr * 97 + 50) / 100)
  const skrCheck = floorCheck(skr, minSkr)
  const siteCheck = floorCheck(site, minSite)
  const identity = !row.excluded && !duplicate && !!row.sku.trim() && !!row.product.trim()
  const changedSkr = skr !== null && original !== null && skr !== original
  const changedSite = changedSkr || !!row.siteOverride.trim()
  const validSkr = skrCheck === 'ok' || skrCheck === 'exception'
  const canSkr = identity && validSkr && changedSkr
  const readySkr = canSkr && (skrCheck === 'ok' || row.approvedSkr)
  const canSite = identity && original !== null && changedSite && !!site && !!skr && site < skr
    && (siteCheck === 'ok' || siteCheck === 'exception') && (changedSkr ? readySkr : skrCheck === 'ok')
  const delta = skr !== null && original !== null ? skr - original : 0
  const deltaPercent = original && skr !== null ? delta * 100 / original : null

  return {
    skr, site, proposal, reason, warning, skrCheck, siteCheck, changedSkr, changedSite, canSkr, canSite,
    duplicate, missingIdentity: !row.sku.trim() || !row.product.trim(), missingOriginal: original === null,
    delta, deltaPercent, largeChange: Math.abs(delta) >= 100 || Math.abs(deltaPercent ?? 0) >= 10,
    readySkr, readySite: canSite && (siteCheck === 'ok' || row.approvedSite),
  }
}

export function evaluateRows(rows: Row[]) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const sku = row.sku.trim()
    if (sku && !row.excluded) counts.set(sku, (counts.get(sku) ?? 0) + 1)
  }
  return rows.map((row) => ({ row, result: evaluate(row, !row.excluded && (counts.get(row.sku.trim()) ?? 0) > 1) }))
}

export type Evaluated = ReturnType<typeof evaluateRows>[number]

export const bucketLabels = ['0,01–0,10 €', '0,11–0,50 €', '0,51–1,00 €', 'Πάνω από 1,00 €']
export function summarize(deltas: number[]) {
  const counts = bucketLabels.map((label) => ({ label, increases: 0, decreases: 0 }))
  for (const delta of deltas) {
    if (!delta) continue
    const magnitude = Math.abs(delta)
    counts[magnitude <= 10 ? 0 : magnitude <= 50 ? 1 : magnitude <= 100 ? 2 : 3][delta > 0 ? 'increases' : 'decreases']++
  }
  return counts
}
