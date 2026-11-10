import { lazy, Suspense } from 'react'
import { Activity, ArrowRight, LoaderCircle } from 'lucide-react'
import { useApi } from '../api/useApi'
import { ToolErrorBoundary } from '../components/ToolErrorBoundary'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/feedback'
import { ToolCard, type Tool, type ToolCardVariant } from './ToolCard'
import { toolViews } from './toolViews'
import './tool-menu.css'

const SortableTools = lazy(() => import('./SortableTools'))
const paperTool: Tool = {
  id: 'external-paper-product',
  name: 'Paper Product Tool',
  description: 'Εργαλείο για προϊόντα χαρτιού.',
  externalUrl: 'https://paper-product-tool.onrender.com/',
}

const dailyIds = ['payments', 'repricing', 'products', 'orders', 'supplier-catalogs']
const utilityIds = ['price-calculator', 'converter']
const descriptions: Record<string, string> = {
  payments: 'Αντιστοίχισε πληρωμές Skroutz με παραστατικά ERP.',
  repricing: 'Έλεγξε, επεξεργάσου και εξήγαγε αλλαγές τιμών.',
  products: 'Βρες προϊόντα ανά SKU, τιμές ERP, προσφορές και ιστορικό.',
  orders: 'Σύγκρινε προσφορές και ετοίμασε παραγγελία ανά προμηθευτή.',
  'price-calculator': 'Ελάχιστη τιμή Skroutz ή μέγιστη τιμή αγοράς.',
  converter: 'Μετατροπή αρχείων και επιλογή διαχωριστικού.',
}

function ToolSection({ title, tools, variant }: { title: string; tools: Tool[]; variant: ToolCardVariant }) {
  const headingId = `tool-section-${variant}`
  const cards = (
    <ul className="tool-grid">
      {tools.map((tool) => <li key={tool.id}><ToolCard tool={tool} variant={variant} /></li>)}
    </ul>
  )
  return (
    <section aria-labelledby={headingId} className="tool-section">
      <h2 id={headingId} className="tool-section-title">{title}</h2>
      {tools.length > 1 ? (
        <ToolErrorBoundary fallback={<>
          <ErrorState className="mb-3" title="Η αναδιάταξη καρτών δεν είναι διαθέσιμη" detail="Μπορείς να ανοίξεις τα εργαλεία από τις κάρτες." />
          {cards}
        </>}>
          <Suspense fallback={cards}>
            <SortableTools tools={tools} variant={variant} />
          </Suspense>
        </ToolErrorBoundary>
      ) : cards}
    </section>
  )
}

function SystemStrip() {
  const [status] = useApi<{ databaseAvailable: boolean }>('/api/status')
  const health = status.status === 'ready' && status.data.databaseAvailable ? 'healthy' : status.status
  const labels = {
    loading: 'Γίνεται έλεγχος…',
    error: 'Το API δεν ανταποκρίνεται',
    ready: 'Η βάση δεν είναι διαθέσιμη',
    healthy: 'Όλα λειτουργούν',
  }
  return (
    <aside className="tool-system-strip" aria-label="Κατάσταση συστήματος">
      <span className="inline-flex items-center gap-2 font-semibold">
        <Activity size={17} className="text-muted-foreground" aria-hidden="true" /> Κατάσταση συστήματος
      </span>
      <span role="status" className="tool-system-health" data-health={health}>
        {health === 'loading'
          ? <LoaderCircle size={14} className="motion-safe:animate-spin" aria-hidden="true" />
          : <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
        {labels[health]}
      </span>
      <a href="#/system-status" className="tool-system-link">
        Λεπτομέρειες <span className="sr-only">κατάστασης συστήματος</span><ArrowRight size={15} aria-hidden="true" />
      </a>
    </aside>
  )
}

export default function ToolMenu() {
  const [catalog, reload] = useApi<Tool[]>('/api/tools')
  const internal = catalog.status === 'ready' ? catalog.data.filter((tool) => tool.id !== 'system-status' && toolViews.has(tool.id)) : []
  const byId = new Map(internal.map((tool) => [tool.id, { ...tool, description: descriptions[tool.id] ?? tool.description }]))
  const daily = dailyIds.flatMap((id) => byId.get(id) ?? [])
  const utilities = [
    ...utilityIds.flatMap((id) => byId.get(id) ?? []),
    ...internal.filter(({ id }) => !dailyIds.includes(id) && !utilityIds.includes(id)),
    paperTool,
  ]

  return (
    <section className="tool-menu page-enter" aria-labelledby="tools-heading">
      <div className="mb-7">
        <h1 id="tools-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Εργαλεία γραφείου</h1>
        <p className="mt-2 text-sm text-muted-foreground">Άνοιξε το εργαλείο που χρειάζεσαι.</p>
      </div>
      {catalog.status === 'loading' && <LoadingState className="mb-4" title="Φόρτωση εργαλείων…" />}
      {catalog.status === 'error' && (
        <ErrorState className="mb-5" title="Δεν ήταν δυνατή η φόρτωση του μενού" detail={catalog.detail} retry={reload}>
          <a className="text-primary underline" href="#/system-status">Κατάσταση συστήματος</a>
        </ErrorState>
      )}
      {catalog.status === 'ready' && !internal.length && <EmptyState>Δεν υπάρχουν διαθέσιμα εργαλεία γραφείου.</EmptyState>}
      {daily.length > 0 && <ToolSection title="Καθημερινή εργασία" tools={daily} variant="featured" />}
      <ToolSection title="Βοηθητικά εργαλεία" tools={utilities} variant="compact" />
      <SystemStrip />
    </section>
  )
}
