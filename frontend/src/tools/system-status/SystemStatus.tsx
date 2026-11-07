import { ArrowLeft, CircleAlert, CircleCheck, Database, RefreshCw, Server } from 'lucide-react'
import { useApi } from '../../api/useApi'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'

type SystemStatus = { databaseAvailable: boolean }
type CheckStatus = 'checking' | 'available' | 'unavailable' | 'unknown'

const checkLabels: Record<CheckStatus, string> = {
  checking: 'Σε εξέλιξη',
  available: 'Διαθέσιμο',
  unavailable: 'Μη διαθέσιμο',
  unknown: 'Άγνωστο',
}

const statusDot: Record<CheckStatus, string> = {
  checking: 'bg-primary',
  available: 'bg-emerald-500',
  unavailable: 'bg-amber-500',
  unknown: 'bg-muted-foreground',
}

export default function SystemStatus() {
  const [result, reload] = useApi<SystemStatus>('/api/status')
  const checking = result.status === 'loading'
  const healthy = result.status === 'ready' && result.data.databaseAvailable
  const summary = checking
    ? { title: 'Έλεγχος σε εξέλιξη', detail: 'Γίνεται έλεγχος του API και της βάσης.', icon: RefreshCw }
    : healthy
      ? { title: 'Όλα λειτουργούν', detail: 'Το API και η βάση δεδομένων ανταποκρίνονται.', icon: CircleCheck }
      : {
        title: 'Χρειάζεται έλεγχος',
        detail: result.status === 'error' ? 'Δεν ήταν δυνατή η σύνδεση με το API.' : 'Το API ανταποκρίνεται, αλλά η βάση δεδομένων δεν είναι διαθέσιμη.',
        icon: CircleAlert,
      }
  const checks: { name: string; detail: string; icon: typeof Server; status: CheckStatus }[] = [
    { name: 'API', detail: 'Επικοινωνία με την εφαρμογή', icon: Server, status: checking ? 'checking' : result.status === 'ready' ? 'available' : 'unavailable' },
    { name: 'Βάση δεδομένων', detail: 'Σύνδεση SQLite', icon: Database, status: checking ? 'checking' : result.status === 'error' ? 'unknown' : healthy ? 'available' : 'unavailable' },
  ]
  const SummaryIcon = summary.icon

  return (
    <section className="page-enter mx-auto max-w-4xl" aria-labelledby="status-heading">
      <a href="#/" className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft size={15} aria-hidden="true" /> Όλα τα εργαλεία
      </a>
      <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <h1 id="status-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Κατάσταση συστήματος</h1>
        <Button variant="outline" onClick={reload} disabled={checking}>
          <RefreshCw size={16} className={checking ? 'motion-safe:animate-spin' : undefined} aria-hidden="true" />
          {checking ? 'Έλεγχος…' : 'Νέος έλεγχος'}
        </Button>
      </header>
      <Card className="bg-linear-to-br from-card/85 to-primary/10 p-4 sm:p-7">
        <div className="mb-5 flex items-start gap-3 px-1 sm:mb-6 sm:gap-4" role="status">
          <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${checking ? 'bg-primary/10 text-primary' : healthy ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-900 dark:text-amber-200'}`}>
            <SummaryIcon size={22} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight">{summary.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{summary.detail}</p>
          </div>
        </div>
        <dl className="divide-y divide-border/55 rounded-xl border border-border/65 bg-card">
          {checks.map(({ name, detail, icon: Icon, status }) => (
            <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-4 sm:gap-4 sm:px-5">
              <dt className="flex min-w-0 items-center gap-3">
                <Icon size={18} className="shrink-0 text-primary" aria-hidden="true" />
                <span>
                  <span className="block font-medium">{name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
                </span>
              </dt>
              <dd className="inline-flex items-center gap-2 rounded-full bg-background px-2.5 py-1 text-xs font-medium">
                <span className={`size-2 rounded-full ${statusDot[status]}`} aria-hidden="true" />
                {checkLabels[status]}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  )
}
