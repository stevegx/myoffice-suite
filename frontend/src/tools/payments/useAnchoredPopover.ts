import { useEffect, useRef } from 'react'

export const popoverSurface = 'fixed inset-auto m-0 box-border w-76 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-3 text-sm font-normal text-card-foreground shadow-xl [&:popover-open]:flex [&:popover-open]:flex-col'

export function useAnchoredPopover() {
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const element = panel.current
    const button = trigger.current
    if (!element || !button) return

    function place() {
      if (!element || !button) return
      const rect = button.getBoundingClientRect()
      const viewport = window.visualViewport
      const top = viewport?.offsetTop ?? 0
      const left = viewport?.offsetLeft ?? 0
      const bottom = top + (viewport?.height ?? document.documentElement.clientHeight)
      const right = left + (viewport?.width ?? document.documentElement.clientWidth)
      if (rect.bottom < top || rect.top > bottom || rect.right < left || rect.left > right) {
        element.hidePopover()
        return
      }
      const below = bottom - rect.bottom - 14
      const above = rect.top - top - 14
      const openBelow = below >= 320 || below >= above
      const width = Math.min(304, right - left - 16)
      element.style.left = `${Math.max(left + 8, Math.min(rect.right - width, right - width - 8))}px`
      element.style.maxHeight = `${Math.max(0, Math.min(420, openBelow ? below : above))}px`
      element.style.top = openBelow ? `${rect.bottom + 6}px` : 'auto'
      element.style.bottom = openBelow ? 'auto' : `${window.innerHeight - rect.top + 6}px`
    }

    function stopTracking() {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }

    function onToggle() {
      stopTracking()
      if (!element?.matches(':popover-open')) return
      place()
      window.addEventListener('scroll', place, true)
      window.addEventListener('resize', place)
      window.visualViewport?.addEventListener('resize', place)
      window.visualViewport?.addEventListener('scroll', place)
    }

    element.addEventListener('toggle', onToggle)
    return () => {
      element.removeEventListener('toggle', onToggle)
      stopTracking()
    }
  }, [])

  function close() {
    panel.current?.hidePopover()
    trigger.current?.focus({ preventScroll: true })
  }

  return { panel, trigger, close }
}
