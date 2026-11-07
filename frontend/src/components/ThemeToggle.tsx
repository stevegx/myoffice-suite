import { useLayoutEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from './ui/button'

const preferenceKey = 'myoffice.theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(preferenceKey)
    if (saved === 'light' || saved === 'dark') return saved
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const next = theme === 'dark' ? 'light' : 'dark'
  const label = next === 'dark' ? 'Σκούρο θέμα' : 'Φωτεινό θέμα'

  return (
    <Button variant="outline" size="icon" aria-label={label} title={label} onClick={() => {
      localStorage.setItem(preferenceKey, next)
      setTheme(next)
    }}>
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </Button>
  )
}
