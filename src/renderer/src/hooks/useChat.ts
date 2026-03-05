import { useState, useRef, useCallback, useEffect } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  toolsUsed?: string[]
  isLoading?: boolean
}

interface RateLimitState {
  limited: boolean
  retryAfterSeconds: number
  expiresAt?: number
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [activeTools, setActiveTools] = useState<string[]>([])
  const [rateLimit, setRateLimit] = useState<RateLimitState>({ limited: false, retryAfterSeconds: 0 })
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)
  const toolsForCurrentRequest = useRef<string[]>([])
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clean up rate limit timer
  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current) {
        clearInterval(rateLimitTimerRef.current)
      }
    }
  }, [])

  // Listen for tool use events
  useEffect(() => {
    const cleanup = window.electronAPI.onAiToolUse?.((data) => {
      setActiveTools((prev) => [...prev, data.toolName])
      toolsForCurrentRequest.current.push(data.toolName)
    })
    return () => cleanup?.()
  }, [])

  const startRateLimitCountdown = useCallback((seconds: number) => {
    const expiresAt = Date.now() + seconds * 1000
    setRateLimit({ limited: true, retryAfterSeconds: seconds, expiresAt })

    if (rateLimitTimerRef.current) {
      clearInterval(rateLimitTimerRef.current)
    }

    rateLimitTimerRef.current = setInterval(() => {
      const remaining = Math.ceil((expiresAt - Date.now()) / 1000)
      if (remaining <= 0) {
        setRateLimit({ limited: false, retryAfterSeconds: 0 })
        if (rateLimitTimerRef.current) {
          clearInterval(rateLimitTimerRef.current)
          rateLimitTimerRef.current = null
        }
      } else {
        setRateLimit({ limited: true, retryAfterSeconds: remaining, expiresAt })
      }
    }, 1000)
  }, [])

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return

    setError(null)
    const requestId = `chat-${++requestIdRef.current}`
    toolsForCurrentRequest.current = []

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${requestIdRef.current}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    }

    // Add placeholder assistant message
    const assistantId = `assistant-${requestIdRef.current}`
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isLoading: true,
    }

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setIsLoading(true)
    setActiveTools([])

    try {
      // Build conversation history for API (only completed messages, bounded to save tokens)
      const allCompleted = [...messages, userMessage].filter((m) => !m.isLoading)
      const bounded = allCompleted.length > 20 ? allCompleted.slice(-20) : allCompleted
      const history = bounded.map((m) => ({ role: m.role, content: m.content }))

      const result = await window.electronAPI.aiChatMessage({
        messages: history,
        requestId,
      })

      // Update assistant message with response
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: result.text,
                isLoading: false,
                toolsUsed: toolsForCurrentRequest.current.length > 0
                  ? [...new Set(toolsForCurrentRequest.current)]
                  : undefined,
              }
            : m,
        ),
      )
    } catch (err: unknown) {
      const errorObj = err as { error?: string; rateLimited?: boolean; retryAfterSeconds?: number }

      if (errorObj.rateLimited && errorObj.retryAfterSeconds) {
        startRateLimitCountdown(errorObj.retryAfterSeconds)
        setError(`Rate limit reached. Try again in ${errorObj.retryAfterSeconds}s`)
      } else {
        setError(errorObj.error || 'Failed to send message')
      }

      // Remove the placeholder assistant message on error
      setMessages((prev) => prev.filter((m) => m.id !== assistantId))
    } finally {
      setIsLoading(false)
      setActiveTools([])
    }
  }, [isLoading, messages, startRateLimitCountdown])

  const clearHistory = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return {
    messages,
    isLoading,
    activeTools,
    rateLimit,
    error,
    sendMessage,
    clearHistory,
  }
}
