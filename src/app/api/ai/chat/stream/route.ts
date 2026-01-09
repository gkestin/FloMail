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

// Helper to decode base64url encoded content
function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    try {
      return atob(base64);
    } catch {
      return str;
    }
  }
}

// Helper to extract body from Gmail message payload
function extractEmailBody(payload: any): string {
  let text = '';
  let html = '';

  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') {
      html = decoded;
    } else {
      text = decoded;
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        text = decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        html = decodeBase64Url(part.body.data);
      } else if (part.parts) {
        const nested = extractEmailBody(part);
        if (!text && nested) text = nested;
      }
    }
  }

  // Prefer plain text, fall back to HTML (stripped of tags)
  if (text) return text;
  if (html) {
    // Basic HTML to text conversion
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

// Execute email search tool using Gmail API - fetches FULL content
async function executeEmailSearch(query: string, accessToken: string, maxResults: number = 5): Promise<string> {
  try {
    const params = new URLSearchParams({
      maxResults: String(Math.min(maxResults, 10)),
      q: query,
    });
    
    const threadsResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!threadsResponse.ok) {
      const error = await threadsResponse.text();
      console.error('[EmailSearch] Gmail API error:', error);
      return `Email search failed: ${threadsResponse.statusText}`;
    }
    
    const threadsData = await threadsResponse.json();
    
    if (!threadsData.threads || threadsData.threads.length === 0) {
      return `No emails found matching: "${query}"`;
    }
    
    // Fetch FULL details for each thread
    const threadDetails: string[] = [];
    const threadsToFetch = threadsData.threads.slice(0, maxResults);
    
    for (const thread of threadsToFetch) {
      try {
        // Use format=full to get complete message content
        const detailResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        
        if (detailResponse.ok) {
          const detail = await detailResponse.json();
          
          // Process each message in the thread
          const messageContents: string[] = [];
          for (const message of detail.messages || []) {
            const headers = message.payload?.headers || [];
            const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
            const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
            const date = headers.find((h: any) => h.name === 'Date')?.value || '';
            
            // Extract full body content
            const body = extractEmailBody(message.payload);
            
            // Limit body length per message to avoid token overflow
            const maxBodyLength = 2000;
            const truncatedBody = body.length > maxBodyLength 
              ? body.slice(0, maxBodyLength) + '... [truncated]'
              : body;
            
            messageContents.push(
              `--- Message ---\nFrom: ${from}\nDate: ${date}\nSubject: ${subject}\n\nContent:\n${truncatedBody}`
            );
          }
          
          threadDetails.push(messageContents.join('\n\n'));
        }
      } catch (e) {
        console.error('[EmailSearch] Error fetching thread details:', e);
      }
    }
    
    const totalFound = threadsData.resultSizeEstimate || threadsData.threads.length;
    let resultText = `Email search results for "${query}" (showing ${threadDetails.length} of ${totalFound} threads with full content):\n\n`;
    resultText += threadDetails.join('\n\n========== NEXT THREAD ==========\n\n');
    
    return resultText;
  } catch (error) {
    console.error('[EmailSearch Execute] Error:', error);
    return `Email search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
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
      model,
      accessToken,
    }: {
      messages: { role: 'user' | 'assistant'; content: string }[];
      thread?: EmailThread;
      folder?: string;
      provider?: 'openai' | 'anthropic';
      model?: string;
      accessToken?: string;
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
          // Track tool_done events for tools that need execution (web search, browse, email search)
          if (event.type === 'tool_done') {
            const toolName = event.data.name;
            if (toolName === 'web_search' || toolName === 'browse_url' || toolName === 'search_emails') {
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
                  message: `🔍 Searching web: "${query}"`,
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
            } else if (toolCall.name === 'search_emails') {
              query = toolCall.arguments.query;
              const maxResults = parseInt(toolCall.arguments.max_results) || 5;
              
              if (!accessToken) {
                result = 'Email search failed: Not authenticated';
                success = false;
              } else {
                await sendEvent({ 
                  type: 'status', 
                  data: { 
                    message: `📧 Searching emails: "${query}"`,
                    searchInProgress: true,
                    searchType: 'search_emails',
                    searchQuery: query,
                    searchIndex: i + 1,
                    searchTotal: pendingToolCalls.length
                  } 
                });
                result = await executeEmailSearch(query, accessToken, maxResults);
                success = !result.includes('failed');
              }
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


