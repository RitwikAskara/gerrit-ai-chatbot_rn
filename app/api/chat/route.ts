import 'server-only'
import { nanoid } from '@/lib/utils'

export const runtime = 'edge'

export async function POST(req: Request) {
  console.log('=== API ROUTE DEBUGGING START ===')
  
  try {
    const json = await req.json()
    console.log('1. Request received:', { 
      messagesCount: json.messages?.length,
      id: json.id,
      lastMessage: json.messages?.[json.messages.length - 1]?.content 
    })

    const { messages, id } = json
    const userId = 'test-user'
    const userMessage = messages[messages.length - 1]?.content || ''
    const sessionId = id || nanoid()

    console.log('2. Processed request:', { sessionId, userMessage })

    // Call n8n webhook
    console.log('3. Calling n8n webhook...')
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

    console.log('4. n8n response status:', n8nResponse.status, n8nResponse.statusText)

    if (!n8nResponse.ok) {
      const errorText = await n8nResponse.text()
      console.error('5. n8n webhook error:', errorText)
      throw new Error(`n8n webhook returned ${n8nResponse.status}: ${errorText}`)
    }

    // Get response from n8n
    const n8nData = await n8nResponse.text()
    console.log('6. Raw n8n response:', n8nData)
    console.log('7. n8n response type:', typeof n8nData)
    console.log('8. n8n response length:', n8nData.length)
    
    let aiResponse = ''
    
    try {
      const parsedResponse = JSON.parse(n8nData)
      console.log('9. Parsed n8n response:', parsedResponse)
      console.log('10. Parsed response type:', typeof parsedResponse)
      console.log('11. Is array?', Array.isArray(parsedResponse))
      
      // Handle array format: [{ "output": "message" }]
      if (Array.isArray(parsedResponse) && parsedResponse.length > 0) {
        console.log('12. Processing as array, first item:', parsedResponse[0])
        if (parsedResponse[0].output) {
          aiResponse = parsedResponse[0].output
          console.log('13. Extracted from array.output:', aiResponse)
        } else {
          aiResponse = String(parsedResponse[0])
          console.log('14. Extracted from array[0]:', aiResponse)
        }
      }
      // Handle object format: { "output": "message" }  
      else if (parsedResponse.output) {
        aiResponse = parsedResponse.output
        console.log('15. Extracted from object.output:', aiResponse)
      }
      // Handle plain string
      else if (typeof parsedResponse === 'string') {
        aiResponse = parsedResponse
        console.log('16. Using as plain string:', aiResponse)
      }
      // Fallback
      else {
        aiResponse = JSON.stringify(parsedResponse)
        console.log('17. Fallback stringify:', aiResponse)
      }
    } catch (e) {
      console.log('18. JSON parse failed, using as plain text')
      console.log('19. Parse error:', e.message)
      aiResponse = n8nData.trim()
    }

    aiResponse = aiResponse.trim()
    console.log('20. Final AI response:', aiResponse)
    console.log('21. Final response length:', aiResponse.length)

    // Create simple response for debugging
    console.log('22. Creating response stream...')
    
    // Return as simple text first to debug
    const debugResponse = `DEBUG INFO:
n8n Status: ${n8nResponse.status}
Raw n8n Data: ${n8nData}
Parsed Response: ${aiResponse}
Message Length: ${aiResponse.length}

ACTUAL MESSAGE:
${aiResponse}`

    console.log('23. Debug response created:', debugResponse.substring(0, 100) + '...')
    console.log('=== API ROUTE DEBUGGING END ===')

    return new Response(debugResponse, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })

  } catch (error) {
    console.error('=== ERROR IN API ROUTE ===')
    console.error('Error type:', error.constructor.name)
    console.error('Error message:', error.message)
    console.error('Error stack:', error.stack)
    console.error('=== END ERROR ===')
    
    return new Response(`ERROR DEBUG:
Type: ${error.constructor.name}
Message: ${error.message}
Stack: ${error.stack}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    })
  }
}
