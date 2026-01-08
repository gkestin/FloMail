import Anthropic from '@anthropic-ai/sdk';
import { EmailThread } from '@/types';
import { getAnthropicTools, parseToolCalls, ToolCall } from './agent-tools';

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
- prepare_draft: Call when user wants to draft/write/reply/forward. ALWAYS include:
  * type: "reply" (responding to current email), "forward" (forwarding to someone), or "new" (new email)
  * to: recipient email(s)
  * subject: Use "Re: [subject]" for replies, "Fwd: [subject]" for forwards
  * body: The email content
- send_email: Call when user confirms they want to send.
- archive_email: Remove from inbox. ONLY works if email is currently in inbox. If viewing archived email, tell user it's already archived.
- move_to_inbox: Move archived email back to inbox. ONLY use when viewing archived email.
- star_email: Star/flag the email for importance.
- unstar_email: Remove star from email.
- go_to_next_email: Call when user says "next", "next email", etc.
- go_to_inbox: Call when user wants to go back to inbox.

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
export async function agentChatClaude(
  messages: { role: 'user' | 'assistant'; content: string }[],
  thread?: EmailThread,
  model: ClaudeModel = 'claude-sonnet-4-20250514',
  folder: string = 'inbox'
): Promise<{
  content: string;
  toolCalls: ToolCall[];
  stopReason: string;
}> {
  const anthropic = getAnthropicClient();

  let systemPrompt = FLOMAIL_AGENT_PROMPT;
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
