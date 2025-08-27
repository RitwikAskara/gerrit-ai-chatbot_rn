import 'server-only'
import { StreamingTextResponse } from 'ai'
import { nanoid } from '@/lib/utils'

export const runtime = 'edge'

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const { messages, id } = json

    // For testing - bypass authentication
    const userId = 'test-user'

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
    
    let aiResponse = ''
    
    try {
      // Parse the JSON response from n8n
      const parsedResponse = JSON.parse(n8nData)
      
      // Handle array format: [{ "output": "message" }]
      if (Array.isArray(parsedResponse) && parsedResponse.length > 0) {
        if (parsedResponse[0].output) {
          aiResponse = parsedResponse[0].output
        } else {
          aiResponse = String(parsedResponse[0])
        }
      }
      // Handle object format: { "output": "message" }  
      else if (parsedResponse.output) {
        aiResponse = parsedResponse.output
      }
      // Handle plain string
      else if (typeof parsedResponse === 'string') {
        aiResponse = parsedResponse
      }
      // Fallback
      else {
        aiResponse = JSON.stringify(parsedResponse)
      }
    } catch (e) {
      // If it's not JSON, treat it as plain text
      aiResponse = n8nData.trim()
    }

    // Clean up any extra formatting
    aiResponse = aiResponse.trim()
    console.log('Processed AI response:', aiResponse)

    // Create the exact format that ai@2.1.6 expects
    const encoder = new TextEncoder()
    
    const stream = new ReadableStream({
      start(controller) {
        // Send the response as a single chunk in the exact format the ai library expects
        const chunk = `0:"${aiResponse.replace(/"/g, '\\"')}"\n`
        controller.enqueue(encoder.encode(chunk))
        
        // Send the completion signal
        controller.enqueue(encoder.encode('d:{"finishReason":"stop","usage":{"promptTokens":10,"completionTokens":20}}\n'))
        
        controller.close()
      }
    })

    return new StreamingTextResponse(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      }
    })

  } catch (error) {
    console.error('Chat API error:', error)
    
    const encoder = new TextEncoder()
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('0:"Sorry, I encountered an issue. Please try again."\n'))
        controller.enqueue(encoder.encode('d:{"finishReason":"stop","usage":{"promptTokens":1,"completionTokens":1}}\n'))
        controller.close()
      }
    })
    
    return new StreamingTextResponse(errorStream, {
      status: 500
    })
  }
}
