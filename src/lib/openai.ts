import OpenAI from 'openai';
import { EmailThread, EmailDraft } from '@/types';
import { getOpenAITools, parseToolCalls, ToolCall } from './agent-tools';

// Initialize OpenAI client (server-side only)
function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return new OpenAI({ apiKey });
}

// Available OpenAI models - Current models with fallbacks
export const OPENAI_MODELS = {
  'gpt-4.1': 'GPT-4.1 (Flagship)',
  'gpt-4.1-mini': 'GPT-4.1 Mini (Fast)',
  'gpt-4.1-nano': 'GPT-4.1 Nano (Fastest)',
  'gpt-4o': 'GPT-4o (Fallback)',
  'gpt-4o-mini': 'GPT-4o Mini (Fallback)',
} as const;

export type OpenAIModel = keyof typeof OPENAI_MODELS;

// System prompt for FloMail agent
const FLOMAIL_AGENT_PROMPT = `You are FloMail, a voice-first email assistant agent. You help users manage their email through natural conversation.

## TOOLS (use for ACTIONS only):

### Email Actions:
- prepare_draft: Call when user wants to draft/write/reply/forward. ALWAYS include:
  * type: "reply" (responding to current email), "forward" (forwarding to someone), or "new" (new email)
  * to: recipient email(s)
  * subject: Use "Re: [subject]" for replies, "Fwd: [subject]" for forwards
  * body: The new message content only. For forwards, just include the user's note (e.g. "FYI, see below") - the original message is added automatically.
- send_email: Call when user confirms they want to send.
- archive_email: Remove from inbox. ONLY works if email is currently in inbox. If viewing archived email, tell user it's already archived.
- move_to_inbox: Move archived email back to inbox. ONLY use when viewing archived email.
- star_email: Star/flag the email for importance.
- unstar_email: Remove star from email.
- go_to_next_email: Call when user says "next", "next email", etc.
- go_to_inbox: Call when user wants to go back to inbox.

### Web Search & Browsing:
- web_search: Search the web for current information. Use when:
  * User asks to look up, search, research, or find information online
  * User asks about current events, news, prices, weather, etc.
  * User needs real-time information not in your training data
  * An email mentions something you should verify or learn more about
- browse_url: Fetch and read content from a specific URL. Use when:
  * User asks to check out, read, or look at a link from the email
  * User pastes a URL and wants you to read it
  * An email contains a link the user wants summarized

## DRAFT TYPE - CRITICAL:
**DEFAULT IS REPLY.** When viewing an email thread, assume user wants to reply unless they explicitly say otherwise.
- Use type="reply" for: "reply", "respond", "answer", "write back", "tell them", "say", "let them know", "draft", "write", or any request to compose a response to the current email
- Use type="forward" ONLY when user explicitly says: "forward", "forward this to", "send this to someone else"
- Use type="new" ONLY when user explicitly says: "new email", "new message", "fresh email", "compose new", "write a new email to" (NOT replying to current thread)

If user says "draft an email saying..." while viewing an email, that's a REPLY (type="reply"), not a new email!

## FOLDER AWARENESS:
The email context will tell you which folder the email is from (Inbox, Sent, Starred, All Mail, or Archive).
- If from Archive: Cannot archive again, but can move_to_inbox
- If from Inbox: Can archive
- If starred: Can unstar. If not starred: Can star.

## DIRECT RESPONSES (NO tools - just respond with text):
- Summarizing: When user asks "what is this about", "summarize", "tldr" → Just write the summary directly!
- Questions about the email: Answer directly in your response.
- Clarifications: Respond conversationally.
- Suggestions: Offer options in text.

## IMPORTANT RULES:
1. For drafts: ALWAYS call prepare_draft tool with complete email (to, subject, body)
2. For summaries/questions: Just respond with the answer - DO NOT use tools
3. After drafting: Ask "Ready to send, or would you like changes?"
4. Be concise but complete. Don't stop mid-sentence.
5. Check the folder before suggesting actions - don't suggest archive for archived emails!

Match the conversation's tone. Be helpful and efficient.`;

// Folder display names
const FOLDER_NAMES: Record<string, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  starred: 'Starred',
  all: 'All Mail',
  archive: 'Archive',
};

// Build context from email thread
function buildEmailContext(thread: EmailThread, folder: string = 'inbox'): string {
  const messages = thread.messages.map((msg, i) => {
    const fromName = msg.from.name || msg.from.email;
    return `[${i + 1}] From: ${fromName} <${msg.from.email}>
To: ${msg.to.map(t => t.email).join(', ')}
Date: ${new Date(msg.date).toLocaleString()}
Subject: ${msg.subject}

${msg.body}`;
  });

  const folderName = FOLDER_NAMES[folder] || folder;
  
  // Check actual labels for precise guidance
  const hasInboxLabel = thread.labels?.includes('INBOX');
  const hasStarredLabel = thread.labels?.includes('STARRED');
  
  return `<current_email_thread>
Folder: ${folderName}
Labels: ${thread.labels?.join(', ') || 'None'}
Subject: ${thread.subject}
Participants: ${thread.participants.map(p => `${p.name || 'Unknown'} <${p.email}>`).join(', ')}

${messages.join('\n\n---\n\n')}
</current_email_thread>

Note: This email is currently in the "${folderName}" folder.
${hasInboxLabel ? '• Has INBOX label - can be archived.' : '• No INBOX label - archive will have no effect, but move_to_inbox will work.'}
${hasStarredLabel ? '• Is STARRED - star_email will have no effect, but unstar_email will work.' : '• Not starred - can be starred.'}
${folder === 'sent' ? '• This is a SENT email. If user wants to "reply", they mean follow-up to the original recipients, not themselves.' : ''}`;
}

// Agent chat with tool calling
export async function agentChat(
  messages: { role: 'user' | 'assistant'; content: string }[],
  thread?: EmailThread,
  model: OpenAIModel = 'gpt-4.1',
  folder: string = 'inbox'
): Promise<{
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
}> {
  const openai = getOpenAIClient();

  const systemMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: FLOMAIL_AGENT_PROMPT },
  ];

  if (thread) {
    systemMessages.push({
      role: 'system',
      content: buildEmailContext(thread, folder),
    });
  }

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    ...systemMessages,
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: chatMessages,
      tools: getOpenAITools(),
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 2000,
    });

    const message = response.choices[0]?.message;
    let content = message?.content?.trim() || '';
    const toolCalls = parseToolCalls(response, 'openai');
    const finishReason = response.choices[0]?.finish_reason || 'stop';

    console.log('[OpenAI] Response finish_reason:', finishReason);
    console.log('[OpenAI] Tool calls:', toolCalls.length);

    // If there's no text content but there are tool calls, generate a helpful message
    if (!content && toolCalls.length > 0) {
      const toolName = toolCalls[0].name;
      switch (toolName) {
        case 'prepare_draft':
          content = "Here's a draft for you:";
          break;
        case 'archive_email':
          content = "Done! Archived.";
          break;
        case 'go_to_next_email':
          content = "Moving to the next email...";
          break;
        case 'go_to_inbox':
          content = "Back to inbox...";
          break;
        case 'send_email':
          content = "Sending...";
          break;
        default:
          content = "";
      }
    }

    return { content, toolCalls, finishReason };
  } catch (error: any) {
    console.error('[OpenAI] API Error:', error.message);
    // If model doesn't exist, try fallback
    if (error.message?.includes('model') || error.code === 'model_not_found') {
      console.log('[OpenAI] Trying fallback model: gpt-4o');
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: chatMessages,
        tools: getOpenAITools(),
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 2000,
      });

      const message = response.choices[0]?.message;
      const content = message?.content || '';
      const toolCalls = parseToolCalls(response, 'openai');
      const finishReason = response.choices[0]?.finish_reason || 'stop';

      return { content, toolCalls, finishReason };
    }
    throw error;
  }
}

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
};

// Stream event type
interface StreamEvent {
  type: 'status' | 'text' | 'tool_start' | 'tool_args' | 'tool_done' | 'done' | 'error';
  data: any;
}

// Streaming agent chat with tool calling
export async function* agentChatStream(
  messages: { role: 'user' | 'assistant'; content: string }[],
  thread?: EmailThread,
  model: OpenAIModel = 'gpt-4.1',
  folder: string = 'inbox'
): AsyncGenerator<StreamEvent> {
  const openai = getOpenAIClient();

  const systemMessages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: FLOMAIL_AGENT_PROMPT },
  ];

  if (thread) {
    systemMessages.push({
      role: 'system',
      content: buildEmailContext(thread, folder),
    });
  }

  const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
    ...systemMessages,
    ...messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  try {
    const stream = await openai.chat.completions.create({
      model,
      messages: chatMessages,
      tools: getOpenAITools(),
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 2000,
      stream: true,
    });

    let currentContent = '';
    let toolCalls: Map<number, { name: string; arguments: string }> = new Map();
    let announcedTools: Set<number> = new Set();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      
      // Handle text content
      if (delta?.content) {
        currentContent += delta.content;
        yield { type: 'text', data: { token: delta.content, fullContent: currentContent } };
      }

      // Handle tool calls
      if (delta?.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index;
          
          if (!toolCalls.has(index)) {
            toolCalls.set(index, { name: '', arguments: '' });
          }
          
          const current = toolCalls.get(index)!;
          
          // Tool name
          if (toolCall.function?.name) {
            current.name = toolCall.function.name;
            
            // Announce tool start with status message
            if (!announcedTools.has(index)) {
              announcedTools.add(index);
              const statusMessage = TOOL_STATUS_MESSAGES[current.name] || `Processing ${current.name}...`;
              yield { type: 'status', data: { message: statusMessage, tool: current.name } };
              yield { type: 'tool_start', data: { name: current.name, index } };
            }
          }
          
          // Tool arguments (streaming)
          if (toolCall.function?.arguments) {
            current.arguments += toolCall.function.arguments;
            
            // Try to parse partial JSON for draft preview
            if (current.name === 'prepare_draft') {
              try {
                // Try to extract partial fields from incomplete JSON
                const partialArgs = tryParsePartialJSON(current.arguments);
                if (partialArgs) {
                  yield { type: 'tool_args', data: { name: current.name, index, partial: partialArgs } };
                }
              } catch {
                // Ignore parse errors for partial JSON
              }
            }
          }
        }
      }
    }

    // Emit completed tool calls
    for (const [index, call] of toolCalls.entries()) {
      try {
        const args = JSON.parse(call.arguments);
        yield { type: 'tool_done', data: { name: call.name, index, arguments: args } };
      } catch (e) {
        console.error(`Failed to parse tool arguments for ${call.name}:`, e);
      }
    }

  } catch (error: any) {
    console.error('[OpenAI Stream] Error:', error.message);
    
    // Try fallback model
    if (error.message?.includes('model') || error.code === 'model_not_found') {
      console.log('[OpenAI Stream] Trying fallback model: gpt-4o');
      yield { type: 'status', data: { message: 'Switching to fallback model...' } };
      
      // Recursively call with fallback model
      yield* agentChatStream(messages, thread, 'gpt-4o', folder);
      return;
    }
    
    yield { type: 'error', data: { message: error.message } };
  }
}

// Helper to try parsing partial JSON (for streaming tool arguments)
function tryParsePartialJSON(str: string): Record<string, any> | null {
  // Try to extract key-value pairs from partial JSON
  const result: Record<string, any> = {};
  
  // Match "key": "value" patterns
  const stringPattern = /"(\w+)":\s*"([^"]*)"?/g;
  let match;
  while ((match = stringPattern.exec(str)) !== null) {
    result[match[1]] = match[2];
  }
  
  // Match "key": [...] patterns for arrays
  const arrayPattern = /"(\w+)":\s*\[([^\]]*)\]?/g;
  while ((match = arrayPattern.exec(str)) !== null) {
    try {
      // Try to parse the array content
      const arrayContent = match[2];
      const items = arrayContent.match(/"([^"]*)"/g);
      if (items) {
        result[match[1]] = items.map(item => item.replace(/"/g, ''));
      }
    } catch {
      // Ignore parse errors
    }
  }
  
  return Object.keys(result).length > 0 ? result : null;
}

// Transcribe audio using Whisper
export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const openai = getOpenAIClient();

  const file = new File([audioBlob], 'audio.webm', { type: audioBlob.type });

  const response = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en',
  });

  return response.text;
}
