'use client'

import { type Message } from 'ai/react'
import { useCallback, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { ChatList } from '@/components/chat-list'
import { ChatPanel } from '@/components/chat-panel'
import { EmptyScreen } from '@/components/empty-screen'
import { ChatScrollAnchor } from '@/components/chat-scroll-anchor'
import { useLocalStorage } from '@/lib/hooks/use-local-storage'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { toast } from 'react-hot-toast'
import { nanoid } from '@/lib/utils'

const IS_PREVIEW = process.env.VERCEL_ENV === 'preview'

export interface ChatProps extends React.ComponentProps<'div'> {
  initialMessages?: Message[]
  id?: string
}

// Type for CreateMessage to match what ChatPanel expects
type CreateMessage = {
  id?: string
  role: 'user' | 'assistant'
  content: string
}

export function Chat({ id: initialId, initialMessages, className }: ChatProps) {
  const [previewToken, setPreviewToken] = useLocalStorage<string | null>(
    'ai-token',
    null
  )
  const [previewTokenDialog, setPreviewTokenDialog] = useState(IS_PREVIEW)
  const [previewTokenInput, setPreviewTokenInput] = useState(previewToken ?? '')
  
  // Custom state management instead of useChat
  const [messages, setMessages] = useState<Message[]>(initialMessages || [])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [id] = useState(initialId || nanoid())
  const abortControllerRef = useRef<AbortController | null>(null)

  // Custom append function that returns Promise<string | null | undefined> as expected by ChatPanel
  const append = useCallback(async (message: Message | CreateMessage): Promise<string | null | undefined> => {
    setIsLoading(true)
    
    // Add user message
    const messageId = message.id || nanoid()
    const userMessage: Message = {
      id: messageId,
      role: 'user',
      content: message.content
    }
    
    setMessages(prev => [...prev, userMessage])
    
    try {
      // Create abort controller for this request
      abortControllerRef.current = new AbortController()
      
      // Call the API
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id,
          messages: [...messages, userMessage],
          previewToken
        }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // Read the response as text
      const responseText = await response.text()
      console.log('Raw response:', responseText)
      
      let assistantContent = ''
      
      // Try to extract content from various possible formats
      if (responseText.startsWith('data: ')) {
        // It's SSE format, extract the content
        const lines = responseText.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const data = JSON.parse(line.substring(6))
              if (data.choices?.[0]?.delta?.content) {
                assistantContent += data.choices[0].delta.content
              } else if (data.choices?.[0]?.message?.content) {
                assistantContent += data.choices[0].message.content
              }
            } catch (e) {
              // Not JSON, might be plain text
              if (!line.includes('[DONE]')) {
                assistantContent += line.substring(6)
              }
            }
          }
        }
      } else {
        // Try to parse as JSON
        try {
          const jsonResponse = JSON.parse(responseText)
          if (jsonResponse.choices?.[0]?.message?.content) {
            assistantContent = jsonResponse.choices[0].message.content
          } else if (jsonResponse.choices?.[0]?.delta?.content) {
            assistantContent = jsonResponse.choices[0].delta.content
          } else if (jsonResponse.output) {
            assistantContent = jsonResponse.output
          } else if (typeof jsonResponse === 'string') {
            assistantContent = jsonResponse
          }
        } catch (e) {
          // It's plain text
          assistantContent = responseText
        }
      }
      
      // Clean up the content
      assistantContent = assistantContent.trim()
      
      if (assistantContent) {
        // Add assistant message
        const assistantId = nanoid()
        const assistantMessage: Message = {
          id: assistantId,
          role: 'assistant',
          content: assistantContent
        }
        
        setMessages(prev => [...prev, assistantMessage])
        
        // Return the message ID as expected by ChatPanel
        return assistantId
      } else {
        throw new Error('No content received from API')
      }
      
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Chat error:', error)
        toast.error(error.message || 'Failed to send message')
      }
      return null
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [id, messages, previewToken])

  // Stop function
  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsLoading(false)
    }
  }, [])

  // Reload function
  const reload = useCallback(async () => {
    if (messages.length > 0) {
      const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')
      if (lastUserMessage) {
        // Remove the last assistant message if it exists
        setMessages(prev => {
          const newMessages = [...prev]
          if (newMessages.length > 0 && newMessages[newMessages.length - 1].role === 'assistant') {
            newMessages.pop()
          }
          return newMessages
        })
        // Resend the last user message
        await append(lastUserMessage)
      }
    }
  }, [messages, append])

  return (
    <>
      <div className={cn('pb-[200px] pt-4 md:pt-10', className)}>
        {messages.length ? (
          <>
            <ChatList messages={messages} />
            <ChatScrollAnchor trackVisibility={isLoading} />
          </>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div>
      <ChatPanel
        id={id}
        isLoading={isLoading}
        stop={stop}
        append={append}
        reload={reload}
        messages={messages}
        input={input}
        setInput={setInput}
      />

      <Dialog open={previewTokenDialog} onOpenChange={setPreviewTokenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter your OpenAI Key</DialogTitle>
            <DialogDescription>
              If you have not obtained your OpenAI API key, you can do so by{' '}
              <a
                href="https://platform.openai.com/signup/"
                className="underline"
              >
                signing up
              </a>{' '}
              on the OpenAI website. This is only necessary for preview
              environments so that the open source community can test the app.
              The token will be saved to your browser&apos;s local storage under
              the name <code className="font-mono">ai-token</code>.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={previewTokenInput}
            placeholder="OpenAI API key"
            onChange={e => setPreviewTokenInput(e.target.value)}
          />
          <DialogFooter className="items-center">
            <Button
              onClick={() => {
                setPreviewToken(previewTokenInput)
                setPreviewTokenDialog(false)
              }}
            >
              Save Token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
