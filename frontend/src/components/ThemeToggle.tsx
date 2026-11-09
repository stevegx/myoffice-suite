import { useLayoutEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'

const preferenceKey = 'myoffice.theme'

function initialTheme() {
  try {
    const saved = localStorage.getItem(preferenceKey)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // The system preference is available when storage is blocked.
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(initialTheme)

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const next = theme === 'dark' ? 'light' : 'dark'
  const label = next === 'dark' ? 'Σκούρο θέμα' : 'Φωτεινό θέμα'

  return (
    <Button variant="outline" size="icon" aria-label={label} title={label} onClick={() => {
      setTheme(next)
      try {
        localStorage.setItem(preferenceKey, next)
      } catch {
        // Keep the selected theme for the current session.
      }
    }}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </Button>
  )
}
