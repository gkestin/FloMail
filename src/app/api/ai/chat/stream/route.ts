import { NextRequest } from 'next/server';
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

// Maximum iterations for the agentic loop
const MAX_ITERATIONS = 10;

// Tools that can be executed server-side (in the loop)
const SERVER_EXECUTABLE_TOOLS = new Set([
  'web_search',
  'browse_url', 
  'search_emails',
  'snooze_email',
  'unsnooze_email',
]);

// Tools that must be returned to the client
const CLIENT_SIDE_TOOLS = new Set([
  'prepare_draft',
  'send_email',
  'archive_email',
  'move_to_inbox',
  'star_email',
  'unstar_email',
  'go_to_next_email',
  'go_to_inbox',
]);

// Status messages for different tool calls
const TOOL_STATUS_MESSAGES: Record<string, string> = {
  'prepare_draft': '✍️ Drafting email...',
  'send_email': '📤 Sending email...',
  'archive_email': '📥 Archiving...',
  'move_to_inbox': '📤 Moving to inbox...',
  'star_email': '⭐ Starring...',
  'unstar_email': '☆ Unstarring...',
  'go_to_next_email': '➡️ Moving to next...',
  'go_to_inbox': '🏠 Going to inbox...',
  'web_search': '🔍 Searching the web...',
  'browse_url': '📄 Reading webpage...',
  'search_emails': '📧 Searching emails...',
  'snooze_email': '⏰ Snoozing email...',
  'unsnooze_email': '🔔 Unsnoozing email...',
};

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

  if (text) return text;
  if (html) {
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

// Execute email search tool
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
    
    const threadDetails: string[] = [];
    const threadsToFetch = threadsData.threads.slice(0, maxResults);
    
    for (const thread of threadsToFetch) {
      try {
        const detailResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        
        if (detailResponse.ok) {
          const detail = await detailResponse.json();
          const messageContents: string[] = [];
          
          for (const message of detail.messages || []) {
            const headers = message.payload?.headers || [];
            const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
            const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
            const date = headers.find((h: any) => h.name === 'Date')?.value || '';
            const body = extractEmailBody(message.payload);
            
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

// Execute a server-side tool and return the result
async function executeServerTool(
  toolName: string, 
  args: Record<string, any>, 
  accessToken?: string
): Promise<{ result: string; success: boolean }> {
  let result: string;
  let success = true;
  
  switch (toolName) {
    case 'web_search':
      result = await executeWebSearch(args.query);
      success = !result.includes('failed');
      break;
      
    case 'browse_url':
      result = await executeBrowseUrl(args.url);
      success = !result.includes('Failed');
      break;
      
    case 'search_emails':
      if (!accessToken) {
        result = 'Email search failed: Not authenticated';
        success = false;
      } else {
        const maxResults = parseInt(args.max_results) || 5;
        result = await executeEmailSearch(args.query, accessToken, maxResults);
        success = !result.includes('failed');
      }
      break;
      
    case 'snooze_email':
    case 'unsnooze_email':
      // These are handled client-side now
      result = `${toolName} will be handled by the client`;
      success = true;
      break;
      
    default:
      result = `Unknown tool: ${toolName}`;
      success = false;
  }
  
  return { result, success };
}

// Interface for collected tool calls
interface CollectedToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

// Make a single agentic call (non-streaming for loop iterations)
async function makeAgentCall(
  messages: any[],
  thread: EmailThread | undefined,
  folder: string,
  provider: 'openai' | 'anthropic',
  model: string
): Promise<{
  content: string;
  toolCalls: CollectedToolCall[];
  stopReason: string;
}> {
  if (provider === 'anthropic') {
    const { agentChatClaude, CLAUDE_MODELS } = await import('@/lib/anthropic');
    const validModel = model && model in CLAUDE_MODELS ? model as keyof typeof CLAUDE_MODELS : 'claude-sonnet-4-20250514';
    const result = await agentChatClaude(messages, thread, validModel, folder);
    return {
      content: result.content,
      toolCalls: result.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      stopReason: result.stopReason,
    };
  } else {
    const { agentChat, OPENAI_MODELS } = await import('@/lib/openai');
    const validModel = model && model in OPENAI_MODELS ? model as keyof typeof OPENAI_MODELS : 'gpt-4.1';
    const result = await agentChat(messages, thread, validModel, folder);
    return {
      content: result.content,
      toolCalls: result.toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      stopReason: result.finishReason === 'tool_calls' ? 'tool_use' : 'end_turn',
    };
  }
}

// Stream a single agentic call
async function* streamAgentCall(
  messages: any[],
  thread: EmailThread | undefined,
  folder: string,
  provider: 'openai' | 'anthropic',
  model: string
): AsyncGenerator<StreamEvent | { _toolCalls: CollectedToolCall[]; _content: string }> {
  const collectedToolCalls: CollectedToolCall[] = [];
  let streamedContent = '';
  
  if (provider === 'anthropic') {
    const { agentChatStreamClaude, CLAUDE_MODELS } = await import('@/lib/anthropic');
    const validModel = model && model in CLAUDE_MODELS ? model as keyof typeof CLAUDE_MODELS : 'claude-sonnet-4-20250514';
    
    for await (const event of agentChatStreamClaude(messages, thread, validModel, folder)) {
      if (event.type === 'text') {
        streamedContent = event.data.fullContent;
      }
      if (event.type === 'tool_done') {
        collectedToolCalls.push({
          id: event.data.id || `tool_${Date.now()}_${Math.random()}`,
          name: event.data.name,
          arguments: event.data.arguments,
        });
      }
      yield event;
    }
  } else {
    const { agentChatStream, OPENAI_MODELS } = await import('@/lib/openai');
    const validModel = model && model in OPENAI_MODELS ? model as keyof typeof OPENAI_MODELS : 'gpt-4.1';
    
    for await (const event of agentChatStream(messages, thread, validModel, folder)) {
      if (event.type === 'text') {
        streamedContent = event.data.fullContent;
      }
      if (event.type === 'tool_done') {
        collectedToolCalls.push({
          id: event.data.id || `tool_${Date.now()}_${Math.random()}`,
          name: event.data.name,
          arguments: event.data.arguments,
        });
      }
      yield event;
    }
  }
  
  // Return collected data for the loop
  yield { _toolCalls: collectedToolCalls, _content: streamedContent };
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
      currentDraft,
    }: {
      messages: { role: 'user' | 'assistant'; content: string }[];
      thread?: EmailThread;
      folder?: string;
      provider?: 'openai' | 'anthropic';
      model?: string;
      accessToken?: string;
      currentDraft?: {
        to: string[];
        subject: string;
        body: string;
        type: 'reply' | 'forward' | 'new';
        gmailDraftId?: string;
      };
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'Messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log(`[FloMail Agent] Starting - Provider: ${provider}, Model: ${model || 'default'}, Max iterations: ${MAX_ITERATIONS}`);

    // Filter out messages with empty content (Anthropic requires non-empty content)
    const validMessages = messages.filter((m: { role: string; content: string }) => 
      m.content && m.content.trim().length > 0
    );

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendEvent = async (event: StreamEvent) => {
      const data = `data: ${JSON.stringify(event)}\n\n`;
      await writer.write(encoder.encode(data));
    };

    // Run the agentic loop in background
    (async () => {
      try {
        let currentMessages = [...validMessages];
        
        // If there's a current draft, add context about it so AI knows to modify instead of create
        if (currentDraft && currentDraft.body) {
          const draftContext = `IMPORTANT: The user has an existing draft for this email thread that you should MODIFY instead of creating a new one.

<current_draft>
Type: ${currentDraft.type}
To: ${currentDraft.to.join(', ')}
Subject: ${currentDraft.subject}
Body:
${currentDraft.body}
</current_draft>

When the user asks to change, edit, or update the draft, use the prepare_draft tool with the modified content. Keep the same type (${currentDraft.type}) unless they specifically ask to change it.`;
          
          // Insert as the first message to give it priority
          currentMessages.unshift({
            role: 'user' as const,
            content: draftContext,
          });
          currentMessages.unshift({
            role: 'assistant' as const,
            content: 'I see you have an existing draft. I\'ll help you modify it. What would you like to change?',
          });
        }
        
        let iteration = 0;
        let clientToolCalls: CollectedToolCall[] = [];
        let finalContent = '';
        
        // AGENTIC LOOP
        while (iteration < MAX_ITERATIONS) {
          iteration++;
          console.log(`[FloMail Agent] Iteration ${iteration}/${MAX_ITERATIONS}`);
          
          let collectedToolCalls: CollectedToolCall[] = [];
          let streamedContent = '';
          
          // First iteration: stream the response
          // Subsequent iterations: don't stream (just execute tools)
          if (iteration === 1) {
            // Stream the first response
            for await (const event of streamAgentCall(currentMessages, thread, folder, provider, model || '')) {
              if ('_toolCalls' in event) {
                // This is our internal data packet
                collectedToolCalls = event._toolCalls;
                streamedContent = event._content;
              } else {
                await sendEvent(event);
              }
            }
          } else {
            // Non-streaming for subsequent iterations
            await sendEvent({ type: 'status', data: { message: '💭 Thinking...' } });
            
            const result = await makeAgentCall(currentMessages, thread, folder, provider, model || '');
            streamedContent = result.content;
            collectedToolCalls = result.toolCalls;
            
            // Stream the text content
            if (streamedContent) {
              await sendEvent({ type: 'text', data: { token: streamedContent, fullContent: streamedContent } });
            }
            
            // Emit tool events
            for (const tc of collectedToolCalls) {
              const statusMessage = TOOL_STATUS_MESSAGES[tc.name] || `Processing ${tc.name}...`;
              await sendEvent({ type: 'status', data: { message: statusMessage, tool: tc.name } });
              await sendEvent({ type: 'tool_start', data: { name: tc.name, id: tc.id } });
              await sendEvent({ type: 'tool_done', data: { name: tc.name, id: tc.id, arguments: tc.arguments } });
            }
          }
          
          finalContent = streamedContent;
          
          // Separate server-side and client-side tool calls
          const serverToolCalls = collectedToolCalls.filter(tc => SERVER_EXECUTABLE_TOOLS.has(tc.name));
          const clientToolCallsThisIteration = collectedToolCalls.filter(tc => CLIENT_SIDE_TOOLS.has(tc.name));
          
          // Collect client-side tools to return at the end
          clientToolCalls.push(...clientToolCallsThisIteration);
          
          // If there are NO tool calls, we're done
          if (collectedToolCalls.length === 0) {
            console.log(`[FloMail Agent] No tool calls, ending loop at iteration ${iteration}`);
            break;
          }
          
          // If there are only client-side tools, we're done (client will handle them)
          if (serverToolCalls.length === 0) {
            console.log(`[FloMail Agent] Only client-side tools, ending loop at iteration ${iteration}`);
            break;
          }
          
          // Execute server-side tools
          const toolResults: { id: string; name: string; result: string }[] = [];
          
          for (let i = 0; i < serverToolCalls.length; i++) {
            const tc = serverToolCalls[i];
            
            // Send status for this tool
            await sendEvent({ 
              type: 'status', 
              data: { 
                message: `${TOOL_STATUS_MESSAGES[tc.name] || 'Processing...'} (${i + 1}/${serverToolCalls.length})`,
                searchInProgress: true,
                searchType: tc.name,
                searchQuery: tc.arguments.query || tc.arguments.url || '',
                searchIndex: i + 1,
                searchTotal: serverToolCalls.length,
              } 
            });
            
            // Execute the tool
            const { result, success } = await executeServerTool(tc.name, tc.arguments, accessToken);
            toolResults.push({ id: tc.id, name: tc.name, result });
            
            // Emit search result event
            await sendEvent({
              type: 'search_result',
              data: {
                type: tc.name,
                query: tc.arguments.query || tc.arguments.url || '',
                success,
                resultPreview: result.slice(0, 200) + (result.length > 200 ? '...' : ''),
              }
            });
          }
          
          // Build messages for next iteration with tool results
          // Add assistant message with the response + tool use
          currentMessages.push({
            role: 'assistant',
            content: streamedContent || 'I\'ll look that up for you.',
          });
          
          // Add tool results as user message (simplified format that works for both providers)
          const toolResultsContent = toolResults.map(tr => 
            `Tool "${tr.name}" result:\n${tr.result}`
          ).join('\n\n---\n\n');
          
          currentMessages.push({
            role: 'user',
            content: `Here are the results from the tools I called:\n\n${toolResultsContent}\n\nPlease continue with your response based on these results. You may call additional tools if needed.`,
          });
          
          await sendEvent({ type: 'status', data: { message: '💭 Analyzing results...' } });
        }
        
        if (iteration >= MAX_ITERATIONS) {
          console.log(`[FloMail Agent] Reached max iterations (${MAX_ITERATIONS})`);
          await sendEvent({ 
            type: 'status', 
            data: { message: '⚠️ Reached maximum steps. Here\'s what I found:' } 
          });
        }
        
        await sendEvent({ type: 'done', data: { iterations: iteration, clientToolCalls } });
        
      } catch (error: any) {
        console.error('[FloMail Agent] Error:', error);
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
    console.error('[FloMail Agent] Setup error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
