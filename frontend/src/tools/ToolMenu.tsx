import { lazy, Suspense } from 'react'
import { useApi } from '../api/useApi'
import { ToolErrorBoundary } from '../components/ToolErrorBoundary'
import { ErrorState, LoadingState } from '../components/ui/feedback'
import { ToolCard, type Tool } from './ToolCard'
import { toolViews } from './toolViews'

const SortableTools = lazy(() => import('./SortableTools'))
const paperTool: Tool = {
  id: 'external-paper-product',
  name: 'Paper Product Tool',
  description: 'Άνοιξε το εξωτερικό εργαλείο Paper Product Tool.',
  externalUrl: 'https://paper-product-tool.onrender.com/',
}

export default function ToolMenu() {
  const [catalog, reload] = useApi<Tool[]>('/api/tools')
  const internal = catalog.status === 'ready' ? catalog.data.filter((tool) => toolViews.has(tool.id)) : []
  const tools = [...internal, paperTool]
  const cards = (
    <ul className="tool-grid">
      {tools.map((tool) => <li key={tool.id}><ToolCard tool={tool} /></li>)}
    </ul>
  )

  return (
    <section className="page-enter" aria-labelledby="tools-heading">
      <div className="mb-7 sm:mb-9">
        <h1 id="tools-heading" className="text-3xl font-semibold tracking-tight sm:text-4xl">Εργαλεία γραφείου</h1>
        <p className="mt-2 text-sm text-muted-foreground">Άνοιξε το εργαλείο που χρειάζεσαι.</p>
      </div>
      {catalog.status === 'loading' && <LoadingState className="mb-4" title="Φόρτωση εργαλείων…" />}
      {catalog.status === 'error' && (
        <ErrorState className="mb-5" title="Δεν ήταν δυνατή η φόρτωση του μενού" detail={catalog.detail} retry={reload}>
          <a className="text-primary underline" href="#/system-status">Κατάσταση συστήματος</a>
        </ErrorState>
      )}
      {tools.length > 1 ? (
        <ToolErrorBoundary fallback={<>
          <ErrorState className="mb-5" title="Η αναδιάταξη καρτών δεν είναι διαθέσιμη" detail="Μπορείς να ανοίξεις τα εργαλεία από τις κάρτες." />
          {cards}
        </>}>
          <Suspense fallback={cards}>
            <SortableTools tools={tools} />
          </Suspense>
        </ToolErrorBoundary>
      ) : cards}
    </section>
  )
}
