import 'server-only'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { Database } from '@/lib/db_types'
import { auth } from '@/auth'
import { nanoid } from '@/lib/utils'

export const runtime = 'edge'

// Helper function to create a readable stream from n8n response
function createStreamFromText(text: string) {
  const encoder = new TextEncoder()
  let sent = false

  return new ReadableStream({
    start(controller) {
      if (!sent) {
        // Send the complete response as a single chunk
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
          choices: [{ 
            delta: { content: text } 
          }] 
        })}\n\n`))
        
        // Send done signal
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        sent = true
      }
      controller.close()
    }
  })
}

export async function POST(req: Request) {
  const cookieStore = cookies()
  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })
  
  try {
    const json = await req.json()
    const { messages, id } = json
    const userId = (await auth({ cookieStore }))?.user.id

    if (!userId) {
      return new Response('Unauthorized', {
        status: 401
      })
    }

    // Get the latest user message
    const userMessage = messages[messages.length - 1]?.content || ''
    
    // Generate session ID for n8n (use existing chat ID or create new one)
    const sessionId = id || nanoid()

    console.log('Sending to n8n:', { sessionId, message: userMessage })

    // Call n8n webhook
    const n8nResponse = await fetch(process.env.N8N_WEBHOOK_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: sessionId,
        chatInput: userMessage
      })
    })

    if (!n8nResponse.ok) {
      console.error('n8n webhook error:', await n8nResponse.text())
      throw new Error(`n8n webhook returned ${n8nResponse.status}`)
    }

    // Get response from n8n
    const n8nData = await n8nResponse.text()
    console.log('n8n response:', n8nData)
    
    // Extract the actual response text
    // n8n Chat Trigger returns the AI response directly as text
    const aiResponse = n8nData.trim()

    // Save chat to Supabase
    const chatId = sessionId
    const title = userMessage.substring(0, 100) || 'New Chat'
    const createdAt = Date.now()
    const path = `/chat/${chatId}`
    
    const payload = {
      id: chatId,
      title,
      userId,
      createdAt,
      path,
      messages: [
        ...messages,
        {
          content: aiResponse,
          role: 'assistant'
        }
      ]
    }

    // Save to database
    try {
      await supabase.from('chats').upsert({ 
        id: chatId, 
        user_id: userId,
        payload 
      }).throwOnError()
    } catch (dbError) {
      console.error('Database save error:', dbError)
      // Continue anyway - don't fail the chat because of DB issues
    }

    // Create streaming response for the frontend
    const stream = createStreamFromText(aiResponse)

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })

  } catch (error) {
    console.error('Chat API error:', error)
    
    // Return error response
    const errorMessage = 'Sorry, I encountered an issue. Please try again.'
    const stream = createStreamFromText(errorMessage)
    
    return new Response(stream, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  }
}
