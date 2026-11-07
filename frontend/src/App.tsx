import { Suspense, useSyncExternalStore } from 'react'
import ToolMenu from './tools/ToolMenu'
import { ThemeToggle } from './components/ThemeToggle'
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
        {toolView ? (
          <Suspense fallback={<p role="status">Φόρτωση εργαλείου…</p>}>
            {toolView}
          </Suspense>
        ) : toolId ? (
          <section>
            <h1>Το εργαλείο δεν βρέθηκε</h1>
            <a href="#/">Επιστροφή στα εργαλεία</a>
          </section>
        ) : <ToolMenu />}
      </main>
    </>
  )
}
