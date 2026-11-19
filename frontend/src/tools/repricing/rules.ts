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
  optimizer?: Record<string, { our: string; minimum: string }>
  rows: MarketRow[]
  minimums: Record<string, Minimum[]>
  history?: { enabled: boolean; saved: number; skipped: number }
}
export type Row = MarketRow & {
  repricingOur: string
  officialOur: string
  officialMin: string
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
    ...row, ...minimumFields(minimumFor(data.minimums, row.sku)),
    repricingOur: row.our,
    officialOur: data.optimizer?.[row.sku.trim()]?.our ?? '',
    officialMin: data.optimizer?.[row.sku.trim()]?.minimum ?? '',
    sourceOur: data.optimizer?.[row.sku.trim()]?.our || row.our,
    our: data.optimizer?.[row.sku.trim()]?.our || row.our,
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
  let proposal = our
  let reason = 'Διατήρηση της τιμής Skroutz.'
  let warning = ''

  if (!our) {
    warning = 'Συμπλήρωσε έγκυρη τιμή Our price.'
  } else if (!cheapest) {
    warning = 'Λείπει η τιμή του ανταγωνιστή.'
  } else if (our >= cheapest) {
    const candidate = cheapest - 3
    if (minSkr && candidate >= minSkr) {
      proposal = candidate
      reason = 'Repricing · μείωση 0,03 € κάτω από το Cheapest.'
    } else if (minSkr && cheapest >= minSkr) {
      proposal = cheapest
      reason = 'Repricing · ισοπαλία με τον φθηνότερο, με τήρηση της δικής μας ελάχιστης.'
    } else if (floorCheck(candidate, minSkr) === 'exception') {
      proposal = candidate
      reason = 'Repricing · μείωση έως 1,5% κάτω από τη δική μας ελάχιστη, με έγκριση.'
    } else if (minSkr) {
      proposal = minSkr + 10
      reason = 'Η ανταγωνιστική τιμή είναι κάτω από το επιτρεπόμενο όριο · πρόταση στη δική μας ελάχιστη + 0,10 €.'
    } else {
      warning = 'Λείπει η δική μας ελάχιστη Skroutz. Συμπλήρωσέ τη για να ελεγχθεί η μείωση.'
    }
  } else if (row.competitors.trim() === '0') {
    reason = 'Χωρίς ανταγωνιστές · διατήρηση τιμής.'
  } else if (cheapest - our > 20) {
    const candidate = cheapest - 5
    if (minSkr && candidate >= minSkr) {
      proposal = candidate
      reason = 'Repricing · αύξηση 0,05 € κάτω από τον επόμενο.'
    } else {
      warning = 'Η προτεινόμενη τιμή είναι κάτω από τη δική μας ελάχιστη ή λείπει η ελάχιστη.'
    }
  } else {
    reason = 'Repricing · διαφορά έως 0,20 €, διατήρηση τιμής.'
  }
  const official = cents(row.officialMin)
  const hasOfficial = !!cents(row.officialOur) && !!official
  const priceMismatch = hasOfficial && cents(row.repricingOur) !== cents(row.officialOur)
  let source = hasOfficial ? 'Skroutz' : 'Repricing'
  if (hasOfficial && our) {
    const repricingProposal = proposal
    warning = ''
    proposal = our
    if (our > official) {
      const candidate = official - 3
      reason = 'Skroutz · προτεραιότητα στην ελάχιστη αγοράς.'
      if (minSkr && candidate >= minSkr) proposal = candidate
      else if (minSkr && official >= minSkr) {
        proposal = official
        reason = 'Skroutz · ισοπαλία με την ελάχιστη αγοράς, με τήρηση της δικής μας ελάχιστης.'
      } else if (floorCheck(candidate, minSkr) === 'exception') {
        proposal = candidate
        reason = 'Skroutz · μείωση έως 1,5% κάτω από τη δική μας ελάχιστη, με έγκριση.'
      } else if (minSkr) {
        proposal = minSkr + 10
        reason = 'Η ανταγωνιστική τιμή είναι κάτω από το επιτρεπόμενο όριο · πρόταση στη δική μας ελάχιστη + 0,10 €.'
      } else {
        warning = 'Λείπει η δική μας ελάχιστη Skroutz. Συμπλήρωσέ τη για να ελεγχθεί η μείωση.'
      }
    } else if (our === official) {
      reason = 'Skroutz · η τιμή μας είναι ίση με την ελάχιστη, είμαστε οι φθηνότεροι.'
      if (priceMismatch) {
        warning = 'Χειροκίνητος έλεγχος · η δική μας τιμή διαφέρει μεταξύ Skroutz και Repricing. Συμπλήρωσε νέα τιμή μετά τον έλεγχο.'
      } else if (repricingProposal !== null && repricingProposal > our) {
        proposal = repricingProposal
        source = 'Skroutz + Repricing'
        reason = 'Skroutz · επιβεβαίωση χαμηλότερης τιμής. Repricing · αύξηση 0,05 € κάτω από τον δεύτερο.'
      } else if (!cheapest) {
        warning = 'Λείπει τιμή δεύτερου ανταγωνιστή στο Repricing.'
      }
    } else {
      reason = 'Skroutz · ήδη χαμηλότερα από την ελάχιστη αγοράς, διατήρηση τιμής.'
    }
  } else if (row.officialOur || row.officialMin) {
    warning = [warning, 'Ελλιπή στοιχεία Skroutz · χρησιμοποιείται το Repricing.'].filter(Boolean).join(' ')
  }
  const conflict = hasOfficial && !!our && our > official && !!cheapest && cheapest - our > 20
  if (conflict) warning = [warning, 'Διαφωνία πηγών · το Skroutz έχει προτεραιότητα έναντι αύξησης Repricing.'].filter(Boolean).join(' ')

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
    skr, site, proposal, reason, warning, source, conflict: conflict || priceMismatch, skrCheck, siteCheck, changedSkr, changedSite, canSkr, canSite,
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
