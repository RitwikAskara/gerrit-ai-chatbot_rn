import 'server-only'
import { nanoid } from '@/lib/utils'

export const runtime = 'edge'

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const { messages, id } = json

    const userId = 'test-user'
    const userMessage = messages[messages.length - 1]?.content || ''
    const sessionId = id || nanoid()

    console.log('Sending to n8n:', { sessionId, message: userMessage })

    // Call your n8n webhook
    const n8nResponse = await fetch(process.env.N8N_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        chatInput: userMessage
      })
    })

    if (!n8nResponse.ok) {
      console.error('n8n webhook error:', await n8nResponse.text())
      throw new Error(`n8n webhook returned ${n8nResponse.status}`)
    }

    const n8nData = await n8nResponse.text()
    console.log('n8n response:', n8nData)

    let aiResponse = ''

    try {
      const parsed = JSON.parse(n8nData)
      if (Array.isArray(parsed) && parsed[0]?.output) aiResponse = parsed[0].output
      else if (parsed.output) aiResponse = parsed.output
      else if (typeof parsed === 'string') aiResponse = parsed
      else aiResponse = JSON.stringify(parsed)
    } catch {
      aiResponse = n8nData.trim()
    }

    aiResponse = aiResponse.trim()

    console.log('Processed AI response:', aiResponse)

    // ✅ Return plain JSON instead of fake SSE
    return new Response(JSON.stringify({ reply: aiResponse }), {
      headers: {
        'Content-Type': 'application/json',
      },
    })

  } catch (error) {
    console.error('Chat API error:', error)
    return new Response(
      JSON.stringify({ reply: 'Sorry, I encountered an issue. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
