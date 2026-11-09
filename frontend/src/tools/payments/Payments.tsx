import { ArrowLeft, ArrowRight, CalendarDays, Check, Download, Info } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { ErrorState, LoadingState } from '../../components/ui/feedback'
import { downloadFile } from '../../lib/downloadFile'
import { useTask } from '../../lib/useTask'
import { PaymentReview } from './PaymentReview'
import { UploadBox } from './UploadBox'
import { dateLabel, paymentRequest, readUpload, type MatchResult, type Period } from './paymentsApi'
import './payments.css'

type Payout = { filename: string; content: string; period: Period }
const steps = [['files', 'Αρχεία'], ['review', 'Έλεγχος']] as const
type Step = typeof steps[number][0]

export default function Payments() {
  const [payout, setPayout] = useState<Payout>()
  const [erpName, setErpName] = useState<string>()
  const [result, setResult] = useState<MatchResult>()
  const [reviewRevision, setReviewRevision] = useState(0)
  const [codes, setCodes] = useState<Record<number, string>>({})
  const { busy, error, run, clearError } = useTask()
  const [step, setStep] = useState<Step>('files')
  const stepTitle = useRef<HTMLHeadingElement>(null)
  const partialErp = payout && result && (result.erpFirst > payout.period.erpStart || result.erpLast < payout.period.erpEnd)
  const review = step === 'review'

  useEffect(() => {
    stepTitle.current?.focus()
  }, [step])

  function selectPayout(file: File) {
    void run('Ανάγνωση πληρωμής Skroutz…', 'Η ανάγνωση της πληρωμής απέτυχε', async () => {
      const content = await readUpload(file)
      const period = await paymentRequest<Period>('period', { skroutz: content })
      setPayout({ filename: file.name, content, period })
      setErpName(undefined)
      setResult(undefined)
      setCodes({})
    })
  }

  function selectErp(file: File) {
    if (!payout) return
    void run('Αντιστοίχιση παραγγελιών με το ERP…', 'Η αντιστοίχιση με το ERP απέτυχε', async () => {
      const matched = await paymentRequest<MatchResult>('match', { skroutz: payout.content, erp: await readUpload(file) })
      setCodes(Object.fromEntries(matched.rows.filter((row) => row.code).map((row) => [row.row, row.code])))
      setResult(matched)
      setErpName(file.name)
      setReviewRevision((previous) => previous + 1)
    })
  }

  function download() {
    if (!payout || !result) return
    void run('Προετοιμασία Excel…', 'Η λήψη του Excel απέτυχε', () =>
      downloadFile('/api/payments/export', { skroutz: payout.content, codes, filename: payout.filename }))
  }

  return (
    <section className={`payments-workspace page-enter min-w-0 ${review ? '' : 'mx-auto max-w-4xl'}`} aria-labelledby="payments-heading">
      <header className="mb-5 sm:mb-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 sm:mb-6">
          {review ? (
            <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-primary"
              disabled={!!busy} onClick={() => { clearError(); setStep('files') }}><ArrowLeft size={15} aria-hidden="true" /> Πίσω στα αρχεία</button>
          ) : (
            <a href="#/" className="inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-primary">
              <ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία
            </a>
          )}
          <ol className="flex items-center gap-3 text-sm" aria-label="Βήματα πληρωμών">
            {steps.map(([id, title], index) => (
              <li key={id} aria-current={step === id ? 'step' : undefined}
                className={`flex items-center gap-1.5 ${step === id ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                <span className={`grid size-6 place-items-center rounded-full text-xs tabular-nums ${step === id ? 'bg-primary text-primary-foreground' : 'bg-card/70 text-muted-foreground'}`}>
                  {id === 'files' && review ? <Check size={14} aria-hidden="true" /> : index + 1}
                </span>
                {title}
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <h1 id="payments-heading" ref={stepTitle} tabIndex={-1} className="text-3xl font-semibold tracking-tight outline-none sm:text-4xl">
              {review ? 'Έλεγχος πληρωμής' : 'Πληρωμές'}
            </h1>
            <p className="mt-2 truncate text-sm text-muted-foreground" title={review ? payout?.filename : undefined}>
              {review ? payout?.filename : 'Αντιστοίχιση πληρωμής Skroutz με παραστατικά ERP.'}
            </p>
          </div>
          {review && <Button className="h-11" onClick={download} disabled={!!busy}>
            <Download size={17} aria-hidden="true" /> Λήψη Excel
          </Button>}
        </div>
      </header>
      {step === 'files' && (
        <section className="payments-glass payment-stage rounded-[1.75rem] p-4 sm:p-7" aria-labelledby="files-title">
          <h2 id="files-title" className="px-1 pb-4 text-lg font-semibold">Αρχεία πληρωμής</h2>
          <div className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-card">
            <UploadBox step={1} label="Πληρωμή Skroutz" accept=".xls" filename={payout?.filename} disabled={!!busy} onFile={selectPayout} />
            {payout && (
              <div className="flex min-w-0 items-start gap-3 border-t border-border/45 bg-primary/5 px-4 py-4 sm:px-6">
                <CalendarDays className="mt-0.5 shrink-0 text-primary" size={19} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Ζητούμενο διάστημα ERP</p>
                  <p className="mt-1 font-semibold tabular-nums">{dateLabel(payout.period.erpStart)} έως {dateLabel(payout.period.erpEnd)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{payout.period.count} εγγραφές Skroutz · ±3 ημέρες · ±0,05 €</p>
                </div>
              </div>
            )}
            <div className="border-t border-border/55">
              <UploadBox step={2} label="Export ERP" accept=".xlsx" filename={erpName} disabled={!!busy || !payout} waiting={!payout} onFile={selectErp} />
            </div>
          </div>
          {partialErp && (
            <p className="mt-4 flex items-start gap-2 text-sm leading-relaxed text-amber-950 dark:text-amber-200" role="status">
              <Info size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>Το export ERP περιέχει εγγραφές από {dateLabel(result.erpFirst)} έως {dateLabel(result.erpLast)}. Έλεγξε αν καλύπτει όλο το ζητούμενο διάστημα.</span>
            </p>
          )}
          {busy && <LoadingState className="mt-5" title={busy} />}
          {error && <ErrorState className="mt-5" {...error} />}
          <div className="mt-5 flex justify-end sm:mt-6">
            <Button className="h-11 w-full sm:w-auto" disabled={!result || !!busy} onClick={() => { clearError(); setStep('review') }}>
              Συνέχεια στον έλεγχο <ArrowRight size={17} aria-hidden="true" />
            </Button>
          </div>
        </section>
      )}
      {result && (
        <div hidden={step !== 'review'}>
          {review && partialErp && <p className="mb-4 flex items-start gap-2 text-xs text-amber-950 dark:text-amber-200" role="status">
            <Info size={15} className="shrink-0" aria-hidden="true" /> Το ERP καλύπτει {dateLabel(result.erpFirst)} έως {dateLabel(result.erpLast)}.
          </p>}
          {review && busy && <LoadingState className="mb-4" title={busy} />}
          {review && error && <ErrorState className="mb-4" {...error} retry={download} />}
          <PaymentReview key={reviewRevision} rows={result.rows} codes={codes} erpNamesByCode={result.erpNamesByCode} busy={!!busy}
            onCode={(row, code) => setCodes((previous) => ({ ...previous, [row]: code }))} />
        </div>
      )}
    </section>
  )
}
