import 'server-only'
import { nanoid } from '@/lib/utils'
import { StreamingTextResponse } from 'ai'

export const runtime = 'edge'

// Helper to create a TransformStream that converts text to the expected format
function createTransformStream() {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk)
    }
  })
}

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const { messages, id } = json

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

    // Create a ReadableStream with the response text
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        // Send the entire response as one chunk
        controller.enqueue(encoder.encode(aiResponse))
        controller.close()
      }
    })

    // Use StreamingTextResponse from the Vercel AI SDK
    // This should handle the formatting correctly for useChat
    return new StreamingTextResponse(stream)

  } catch (error) {
    console.error('Chat API error:', error)
    
    // Return error as a stream using StreamingTextResponse
    const errorStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode('Sorry, I encountered an issue. Please try again.'))
        controller.close()
      }
    })
    
    return new StreamingTextResponse(errorStream)
  }
}
