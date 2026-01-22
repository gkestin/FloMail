import Anthropic from '@anthropic-ai/sdk';
import { EmailThread, AIDraftingPreferences } from '@/types';
import { getAnthropicTools, parseToolCalls, ToolCall } from './agent-tools';

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

// Initialize Anthropic client (server-side only)
function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  return new Anthropic({ apiKey });
}

// Available Claude models - Using latest aliases and dated versions
export const CLAUDE_MODELS = {
  'claude-sonnet-4-20250514': 'Claude Sonnet 4 (Recommended)',
  'claude-opus-4-20250514': 'Claude Opus 4 (Most Capable)',  
  'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet (Fallback)',
  'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku (Fast)',
} as const;

export type ClaudeModel = keyof typeof CLAUDE_MODELS;

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
- snooze_email: Propose a snooze time for the current email. IMPORTANT: this does NOT snooze immediately. The UI will ask the user to confirm, cancel, or edit. For any specific time (e.g., "tomorrow at noon"), ALWAYS use snooze_until="custom" and provide custom_date as ISO 8601 with timezone offset (e.g., 2026-01-21T12:00:00-08:00). Use the provided Current date/time to interpret relative dates.

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

## MULTI-STEP WORKFLOWS:
You can call multiple tools in sequence to complete complex tasks. For example:
- Search the web for information, then draft an email with what you found
- Search emails for previous correspondence, then summarize and draft a reply
- Look up a URL from an email, analyze it, then compose a response

After each tool call completes, you'll receive the results and can decide what to do next.
Continue calling tools until you've completed the user's request.

## IMPORTANT RULES:
1. For drafts: ALWAYS call prepare_draft tool with complete email (to, subject, body)
2. For summaries/questions: Just respond with the answer - DO NOT use tools
3. After drafting: Ask "Ready to send, or would you like changes?"
4. Be concise but complete. Don't stop mid-sentence.
5. Check the folder before suggesting actions - don't suggest archive for archived emails!
6. For complex requests: Break them into steps and use tools sequentially

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

// Build user preferences context for drafting
function buildUserPreferencesContext(prefs: AIDraftingPreferences): string {
  const parts: string[] = [];
  
  // User identity
  if (prefs.userName) {
    const identity = `The user's name is ${prefs.userName}. They are the SENDER of any drafted messages.`;
    parts.push(identity);
  }
  
  // Tone guidance - now supports multiple tones
  const toneDescriptions: Record<string, string> = {
    professional: 'Use a professional, business-appropriate tone. Be clear and direct.',
    friendly: 'Use a warm, friendly tone while remaining appropriate. Be personable.',
    casual: 'Use a casual, relaxed tone. Keep it conversational and approachable.',
    formal: 'Use a formal, respectful tone. Be courteous and precise.',
  };
  if (prefs.tones && prefs.tones.length > 0) {
    const toneInstructions = prefs.tones
      .map(t => toneDescriptions[t])
      .filter(Boolean)
      .join(' ');
    if (toneInstructions) {
      parts.push(toneInstructions);
    }
  }
  
  // Length guidance (optional)
  const lengthDescriptions: Record<string, string> = {
    brief: 'Keep messages concise and to the point. Aim for 2-3 sentences when possible.',
    moderate: 'Write messages of moderate length. Include necessary context but avoid being verbose.',
    detailed: 'Write thorough, detailed messages. Include full context and explanation when helpful.',
  };
  if (prefs.length && lengthDescriptions[prefs.length]) {
    parts.push(lengthDescriptions[prefs.length]);
  }
  
  // Exclamation marks (only add if explicitly set)
  if (prefs.useExclamations === true) {
    parts.push('You may use exclamation marks where appropriate to convey enthusiasm or warmth.');
  } else if (prefs.useExclamations === false) {
    parts.push('Avoid using exclamation marks. Keep punctuation understated.');
  }
  // If undefined, don't add anything - let AI decide naturally
  
  // Sign-off
  if (prefs.signOffStyle && prefs.signOffStyle !== 'none') {
    const userName = prefs.userName?.split(' ')[0] || 'User'; // First name
    let signOff = '';
    switch (prefs.signOffStyle) {
      case 'best': signOff = `Best,\n${userName}`; break;
      case 'thanks': signOff = `Thanks,\n${userName}`; break;
      case 'regards': signOff = `Regards,\n${userName}`; break;
      case 'cheers': signOff = `Cheers,\n${userName}`; break;
      case 'custom': signOff = prefs.customSignOff || `Best,\n${userName}`; break;
    }
    parts.push(`End emails with this sign-off: "${signOff}"`);
  }
  // If 'none', don't add instruction - let AI decide
  
  // Custom instructions
  if (prefs.customInstructions && prefs.customInstructions.trim()) {
    parts.push(`Additional user instructions: ${prefs.customInstructions.trim()}`);
  }
  
  if (parts.length === 0) return '';
  
  return `<user_drafting_preferences>
${parts.join('\n\n')}
</user_drafting_preferences>`;
}

// Agent chat with tool calling
export async function agentChatClaude(
  messages: { role: 'user' | 'assistant'; content: string }[],
  thread?: EmailThread,
  model: ClaudeModel = 'claude-sonnet-4-20250514',
  folder: string = 'inbox',
  draftingPreferences?: AIDraftingPreferences
): Promise<{
  content: string;
  toolCalls: ToolCall[];
  stopReason: string;
}> {
  const anthropic = getAnthropicClient();

  // Inject current date/time for snooze calculations
  const now = new Date();
  const dateContext = `Current date and time: ${now.toLocaleString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  })}`;

  let systemPrompt = FLOMAIL_AGENT_PROMPT + '\n\n' + dateContext;
  
  // Add user drafting preferences
  if (draftingPreferences) {
    const prefsContext = buildUserPreferencesContext(draftingPreferences);
    if (prefsContext) {
      systemPrompt += `\n\n${prefsContext}`;
    }
  }
  
  if (thread) {
    systemPrompt += `\n\n${buildEmailContext(thread, folder)}`;
  }

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2000,
      system: systemPrompt,
      tools: getAnthropicTools() as any,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    console.log('[Claude] Response stop_reason:', response.stop_reason);
    console.log('[Claude] Content blocks:', response.content.length);
    console.log('[Claude] Content types:', response.content.map(b => b.type));

    // Extract text content
    const textBlocks = response.content.filter((block) => block.type === 'text');
    let content = textBlocks.map((block) => (block as any).text).join('\n').trim();

    // Extract tool calls
    const toolCalls = parseToolCalls(response, 'anthropic');

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

    console.log('[Claude] Final content length:', content.length);
    console.log('[Claude] Tool calls:', toolCalls.map(tc => tc.name));

    return {
      content,
      toolCalls,
      stopReason: response.stop_reason || 'end_turn',
    };
  } catch (error: any) {
    console.error('[Claude] API Error:', error.message);
    // If the model doesn't exist, try fallback
    if (error.message?.includes('model') || error.status === 404) {
      console.log('[Claude] Trying fallback model: claude-3-5-sonnet-20241022');
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        system: systemPrompt,
        tools: getAnthropicTools() as any,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      const textBlocks = response.content.filter((block) => block.type === 'text');
      const content = textBlocks.map((block) => (block as any).text).join('\n');
      const toolCalls = parseToolCalls(response, 'anthropic');

      return {
        content,
        toolCalls,
        stopReason: response.stop_reason || 'end_turn',
      };
    }
    throw error;
  }
}

// Helper to try parsing partial JSON (for streaming tool arguments)
function tryParsePartialJSON(str: string): Record<string, any> | null {
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

// Streaming agent chat with tool calling
export async function* agentChatStreamClaude(
  messages: { role: 'user' | 'assistant'; content: string }[],
  thread?: EmailThread,
  model: ClaudeModel = 'claude-sonnet-4-20250514',
  folder: string = 'inbox',
  draftingPreferences?: AIDraftingPreferences
): AsyncGenerator<StreamEvent> {
  const anthropic = getAnthropicClient();

  // Inject current date/time for snooze calculations
  const now = new Date();
  const dateContext = `Current date and time: ${now.toLocaleString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  })}`;

  let systemPrompt = FLOMAIL_AGENT_PROMPT + '\n\n' + dateContext;
  
  // Add user drafting preferences
  if (draftingPreferences) {
    const prefsContext = buildUserPreferencesContext(draftingPreferences);
    if (prefsContext) {
      systemPrompt += `\n\n${prefsContext}`;
    }
  }
  
  if (thread) {
    systemPrompt += `\n\n${buildEmailContext(thread, folder)}`;
  }

  try {
    const stream = await anthropic.messages.stream({
      model,
      max_tokens: 2000,
      system: systemPrompt,
      tools: getAnthropicTools() as any,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    let currentContent = '';
    let currentToolName = '';
    let currentToolInput = '';
    let toolAnnounced = false;

    for await (const event of stream) {
      // Handle different event types from Anthropic's streaming API
      if (event.type === 'content_block_start') {
        const block = (event as any).content_block;
        
        if (block?.type === 'tool_use') {
          currentToolName = block.name;
          currentToolInput = '';
          toolAnnounced = false;
          
          // Announce tool start with status message
          const statusMessage = TOOL_STATUS_MESSAGES[currentToolName] || `Processing ${currentToolName}...`;
          yield { type: 'status', data: { message: statusMessage, tool: currentToolName } };
          yield { type: 'tool_start', data: { name: currentToolName, id: block.id } };
          toolAnnounced = true;
        }
      } else if (event.type === 'content_block_delta') {
        const delta = (event as any).delta;
        
        // Handle text delta
        if (delta?.type === 'text_delta' && delta.text) {
          currentContent += delta.text;
          yield { type: 'text', data: { token: delta.text, fullContent: currentContent } };
        }
        
        // Handle tool input delta
        if (delta?.type === 'input_json_delta' && delta.partial_json) {
          currentToolInput += delta.partial_json;
          
          // Try to parse partial JSON for draft preview
          if (currentToolName === 'prepare_draft') {
            const partialArgs = tryParsePartialJSON(currentToolInput);
            if (partialArgs) {
              yield { type: 'tool_args', data: { name: currentToolName, partial: partialArgs } };
            }
          }
        }
      } else if (event.type === 'content_block_stop') {
        // Tool call completed
        if (currentToolName && currentToolInput) {
          try {
            const args = JSON.parse(currentToolInput);
            yield { type: 'tool_done', data: { name: currentToolName, arguments: args } };
          } catch (e) {
            console.error(`Failed to parse tool arguments for ${currentToolName}:`, e);
          }
          currentToolName = '';
          currentToolInput = '';
        }
      }
    }

  } catch (error: any) {
    console.error('[Claude Stream] Error:', error.message);
    
    // Try fallback model
    if (error.message?.includes('model') || error.status === 404) {
      console.log('[Claude Stream] Trying fallback model: claude-3-5-sonnet-20241022');
      yield { type: 'status', data: { message: 'Switching to fallback model...' } };
      
      yield* agentChatStreamClaude(messages, thread, 'claude-3-5-sonnet-20241022', folder);
      return;
    }
    
    yield { type: 'error', data: { message: error.message } };
  }
}
