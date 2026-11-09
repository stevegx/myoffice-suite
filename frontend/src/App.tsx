import { Suspense, useSyncExternalStore } from 'react'
import ToolMenu from './tools/ToolMenu'
import { ThemeToggle } from './components/ThemeToggle'
import { ToolErrorBoundary } from './components/ToolErrorBoundary'
import { ErrorState, LoadingState } from './components/ui/feedback'
import { toolViews } from './tools/toolViews'

function subscribeToHash(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

function currentToolId() {
  return window.location.hash.replace(/^#\/?/, '').split('?', 1)[0]
}

export default function App() {
  const toolId = useSyncExternalStore(subscribeToHash, currentToolId)
  const toolView = toolViews.get(toolId)

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-icon" aria-hidden="true">M</span>
          MyOffice Suite
        </a>
        <nav className="flex items-center gap-4" aria-label="Κύρια πλοήγηση">
          <a href="#/" aria-current={toolId ? undefined : 'page'}>Εργαλεία</a>
          <ThemeToggle />
        </nav>
      </header>
      <main className="content">
        <ToolErrorBoundary key={toolId} fallback={
          <ErrorState title="Η σελίδα δεν άνοιξε" detail="Φόρτωσε ξανά τη σελίδα για να ανοίξεις το εργαλείο."
            retry={() => window.location.reload()}>
            {toolId && <a className="text-primary underline" href="#/">Επιστροφή στα εργαλεία</a>}
          </ErrorState>
        }>
          {toolView ? (
            <Suspense fallback={<LoadingState title="Φόρτωση εργαλείου…" rows={3} />}>
              {toolView}
            </Suspense>
          ) : toolId ? (
            <ErrorState title="Το εργαλείο δεν βρέθηκε">
              <a className="text-primary underline" href="#/">Επιστροφή στα εργαλεία</a>
            </ErrorState>
          ) : <ToolMenu />}
        </ToolErrorBoundary>
      </main>
    </>
  )
}
