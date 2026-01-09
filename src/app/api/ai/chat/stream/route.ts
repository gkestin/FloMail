import { NextRequest } from 'next/server';
import { agentChatStream, OPENAI_MODELS } from '@/lib/openai';
import { agentChatStreamClaude, CLAUDE_MODELS } from '@/lib/anthropic';
import { EmailThread } from '@/types';

// Stream event types
export type StreamEventType = 
  | 'status'        // Status update (e.g., "Drafting reply...")
  | 'text'          // Text content token
  | 'tool_start'    // Tool call started
  | 'tool_args'     // Tool call arguments (partial)
  | 'tool_done'     // Tool call completed
  | 'search_result' // Web search or browse completed (for UI display)
  | 'done'          // Stream finished
  | 'error';        // Error occurred

export interface StreamEvent {
  type: StreamEventType;
  data: any;
}

// Execute web search tool
async function executeWebSearch(query: string): Promise<string> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    
    if (!response.ok) {
      return `Search failed with status ${response.status}`;
    }
    
    const data = await response.json();
    
    // Format results for the AI
    let resultText = `Web search results for "${query}":\n\n`;
    
    if (data.answer) {
      resultText += `Summary: ${data.answer}\n\n`;
    }
    
    if (data.results && data.results.length > 0) {
      resultText += 'Sources:\n';
      for (const result of data.results) {
        resultText += `\n${result.rank}. ${result.title}\n   URL: ${result.url}\n   ${result.snippet}\n`;
      }
    } else {
      resultText += 'No results found.';
    }
    
    return resultText;
  } catch (error) {
    console.error('[WebSearch Execute] Error:', error);
    return `Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// Execute URL browse tool
async function executeBrowseUrl(url: string): Promise<string> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/browse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    
    if (!response.ok) {
      return `Failed to fetch URL with status ${response.status}`;
    }
    
    const data = await response.json();
    
    if (!data.success) {
      return `Failed to fetch URL: ${data.error || 'Unknown error'}`;
    }
    
    return `Content from ${data.title || url}:\n\n${data.content}`;
  } catch (error) {
    console.error('[Browse Execute] Error:', error);
    return `Failed to browse URL: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
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
        // Track tool calls that need execution
        const pendingToolCalls: { name: string; arguments: any; id?: string }[] = [];
        let streamedContent = '';
        
        // First pass: stream AI response and collect tool calls
        const streamGenerator = provider === 'openai'
          ? agentChatStream(messages, thread, (model && model in OPENAI_MODELS ? model as keyof typeof OPENAI_MODELS : 'gpt-4.1'), folder)
          : agentChatStreamClaude(messages, thread, (model && model in CLAUDE_MODELS ? model as keyof typeof CLAUDE_MODELS : 'claude-sonnet-4-20250514'), folder);
        
        for await (const event of streamGenerator) {
          // Track tool_done events for web tools
          if (event.type === 'tool_done') {
            const toolName = event.data.name;
            if (toolName === 'web_search' || toolName === 'browse_url') {
              pendingToolCalls.push({
                name: toolName,
                arguments: event.data.arguments,
                id: event.data.id,
              });
            }
          }
          
          // Track text content
          if (event.type === 'text') {
            streamedContent = event.data.fullContent;
          }
          
          // Forward all events to client
          await sendEvent(event);
        }
        
        // If there are web tool calls, execute them and get a follow-up response
        if (pendingToolCalls.length > 0) {
          // Execute each tool and collect results
          const toolResults: { name: string; query: string; result: string; success: boolean }[] = [];
          
          for (let i = 0; i < pendingToolCalls.length; i++) {
            const toolCall = pendingToolCalls[i];
            let result: string;
            let query: string;
            let success = true;
            
            if (toolCall.name === 'web_search') {
              query = toolCall.arguments.query;
              await sendEvent({ 
                type: 'status', 
                data: { 
                  message: `🔍 Searching: "${query}"`,
                  searchInProgress: true,
                  searchType: 'web_search',
                  searchQuery: query,
                  searchIndex: i + 1,
                  searchTotal: pendingToolCalls.length
                } 
              });
              result = await executeWebSearch(query);
              success = !result.includes('failed');
            } else if (toolCall.name === 'browse_url') {
              query = toolCall.arguments.url;
              await sendEvent({ 
                type: 'status', 
                data: { 
                  message: `📄 Reading: ${query}`,
                  searchInProgress: true,
                  searchType: 'browse_url',
                  searchQuery: query,
                  searchIndex: i + 1,
                  searchTotal: pendingToolCalls.length
                } 
              });
              result = await executeBrowseUrl(query);
              success = !result.includes('Failed');
            } else {
              continue;
            }
            
            toolResults.push({ name: toolCall.name, query, result, success });
            
            // Emit search_result event for each completed search
            await sendEvent({
              type: 'search_result',
              data: {
                type: toolCall.name,
                query,
                success,
                resultPreview: result.slice(0, 200) + (result.length > 200 ? '...' : ''),
              }
            });
          }
          
          // Build follow-up messages with tool results
          const followUpMessages = [
            ...messages,
            { role: 'assistant' as const, content: streamedContent || 'Let me search for that information.' },
            { 
              role: 'user' as const, 
              content: `Here are the results from your tool calls:\n\n${toolResults.map(r => r.result).join('\n\n---\n\n')}\n\nPlease provide a helpful response based on these results.`
            },
          ];
          
          await sendEvent({ type: 'status', data: { message: '💭 Analyzing results...' } });
          
          // Make a second call to get the AI's response with the tool results
          const followUpGenerator = provider === 'openai'
            ? agentChatStream(followUpMessages, thread, (model && model in OPENAI_MODELS ? model as keyof typeof OPENAI_MODELS : 'gpt-4.1'), folder)
            : agentChatStreamClaude(followUpMessages, thread, (model && model in CLAUDE_MODELS ? model as keyof typeof CLAUDE_MODELS : 'claude-sonnet-4-20250514'), folder);
          
          // Track if we're receiving new content from follow-up
          let followUpStarted = false;
          
          for await (const event of followUpGenerator) {
            // Only forward text events from follow-up
            if (event.type === 'text') {
              // The follow-up response replaces the initial "searching" message
              if (!followUpStarted) {
                followUpStarted = true;
              }
              // Send the full content (search context is already embedded via search_result events)
              await sendEvent({ type: 'text', data: { token: event.data.token, fullContent: event.data.fullContent } });
            } else if (event.type !== 'tool_start' && event.type !== 'tool_args' && event.type !== 'tool_done') {
              // Forward non-tool events
              await sendEvent(event);
            }
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


