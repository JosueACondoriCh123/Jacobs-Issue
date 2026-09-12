import { useCallback, useEffect, useState } from 'react'

const copyStyles = (targetDocument: Document) => {
  for (const styleSheet of Array.from(document.styleSheets)) {
    try {
      const cssText = Array.from(styleSheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n')
      const style = targetDocument.createElement('style')
      style.textContent = cssText
      targetDocument.head.append(style)
    } catch {
      if (!styleSheet.href) continue
      const link = targetDocument.createElement('link')
      link.rel = 'stylesheet'
      link.href = styleSheet.href
      targetDocument.head.append(link)
    }
  }
}

export function useMiniHudWindow() {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [pipWindow, setPipWindow] = useState<Window | null>(null)
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isSupported = Boolean(window.documentPictureInPicture)

  const close = useCallback(() => {
    pipWindow?.close()
    setPipWindow(null)
    setHost(null)
    setFallbackOpen(false)
  }, [pipWindow])

  const open = useCallback(async () => {
    setError(null)

    if (!window.documentPictureInPicture) {
      setFallbackOpen(true)
      return
    }

    const existingWindow = window.documentPictureInPicture.window
    if (existingWindow && !existingWindow.closed) {
      existingWindow.focus()
      return
    }

    try {
      const nextWindow = await window.documentPictureInPicture.requestWindow({
        width: 320,
        height: 390,
        preferInitialWindowPlacement: true,
      })

      nextWindow.document.title = 'EchoVision Mini HUD'
      nextWindow.document.documentElement.className = 'mini-pip-root'
      nextWindow.document.body.className = 'mini-pip-body'
      copyStyles(nextWindow.document)

      const nextHost = nextWindow.document.createElement('div')
      nextHost.id = 'echovision-mini-hud'
      nextWindow.document.body.append(nextHost)
      nextWindow.addEventListener(
        'pagehide',
        () => {
          setPipWindow(null)
          setHost(null)
        },
        { once: true },
      )

      setPipWindow(nextWindow)
      setHost(nextHost)
      setFallbackOpen(false)
    } catch (requestError) {
      setFallbackOpen(true)
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No fue posible abrir la ventana flotante.',
      )
    }
  }, [])

  useEffect(
    () => () => {
      if (pipWindow && !pipWindow.closed) pipWindow.close()
    },
    [pipWindow],
  )

  return {
    host,
    isOpen: Boolean(host) || fallbackOpen,
    isFloating: Boolean(host),
    isSupported,
    fallbackOpen,
    error,
    open,
    close,
  }
}
