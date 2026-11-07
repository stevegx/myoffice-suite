import { lazy, Suspense } from 'react'
import { useApi } from '../api/useApi'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
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
      {catalog.status === 'loading' && <p className="mb-4 text-sm text-muted-foreground" role="status">Φόρτωση εργαλείων…</p>}
      {catalog.status === 'error' && (
        <Card className="panel mb-5">
          <p role="alert">Δεν ήταν δυνατή η φόρτωση του μενού.</p>
          <div className="actions">
            <Button onClick={reload}>Δοκίμασε ξανά</Button>
            <a href="#/system-status">Κατάσταση συστήματος</a>
          </div>
        </Card>
      )}
      {tools.length > 1 ? (
        <Suspense fallback={cards}>
          <SortableTools tools={tools} />
        </Suspense>
      ) : cards}
    </section>
  )
}
