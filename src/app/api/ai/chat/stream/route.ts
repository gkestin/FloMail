import { NextRequest } from 'next/server';
import { agentChatStream, OPENAI_MODELS } from '@/lib/openai';
import { agentChatStreamClaude, CLAUDE_MODELS } from '@/lib/anthropic';
import { EmailThread } from '@/types';

// Stream event types
export type StreamEventType = 
  | 'status'      // Status update (e.g., "Drafting reply...")
  | 'text'        // Text content token
  | 'tool_start'  // Tool call started
  | 'tool_args'   // Tool call arguments (partial)
  | 'tool_done'   // Tool call completed
  | 'done'        // Stream finished
  | 'error';      // Error occurred

export interface StreamEvent {
  type: StreamEventType;
  data: any;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      messages, 
      thread, 
      folder = 'inbox',
      provider = 'anthropic', 
      model 
    }: {
      messages: { role: 'user' | 'assistant'; content: string }[];
      thread?: EmailThread;
      folder?: string;
      provider?: 'openai' | 'anthropic';
      model?: string;
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[FloMail Stream] Chat request - Provider: ${provider}, Model: ${model || 'default'}`);

    // Create a TransformStream for SSE
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Helper to send SSE events
    const sendEvent = async (event: StreamEvent) => {
      const data = `data: ${JSON.stringify(event)}\n\n`;
      await writer.write(encoder.encode(data));
    };

    // Process in background
    (async () => {
      try {
        if (provider === 'openai') {
          const openaiModel = model && model in OPENAI_MODELS 
            ? model as keyof typeof OPENAI_MODELS 
            : 'gpt-4.1';
          
          for await (const event of agentChatStream(messages, thread, openaiModel, folder)) {
            await sendEvent(event);
          }
        } else {
          const claudeModel = model && model in CLAUDE_MODELS 
            ? model as keyof typeof CLAUDE_MODELS 
            : 'claude-sonnet-4-20250514';
          
          for await (const event of agentChatStreamClaude(messages, thread, claudeModel, folder)) {
            await sendEvent(event);
          }
        }
        
        await sendEvent({ type: 'done', data: {} });
      } catch (error: any) {
        console.error('[FloMail Stream] Error:', error);
        await sendEvent({ type: 'error', data: { message: error.message } });
      } finally {
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('[FloMail Stream] Setup error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}


