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
- archive_email: Call when user says "archive", "done with this", etc.
- go_to_next_email: Call when user says "next", "next email", etc.
- go_to_inbox: Call when user wants to go back to inbox.

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

Match the conversation's tone. Be helpful and efficient.`;

// Build context from email thread
function buildEmailContext(thread: EmailThread): string {
  const messages = thread.messages.map((msg, i) => {
    const fromName = msg.from.name || msg.from.email;
    return `[${i + 1}] From: ${fromName} <${msg.from.email}>
To: ${msg.to.map(t => t.email).join(', ')}
Date: ${new Date(msg.date).toLocaleString()}
Subject: ${msg.subject}

${msg.body}`;
  });

  return `<current_email_thread>
Subject: ${thread.subject}
Participants: ${thread.participants.map(p => `${p.name || 'Unknown'} <${p.email}>`).join(', ')}

${messages.join('\n\n---\n\n')}
</current_email_thread>`;
}

// Agent chat with tool calling
export async function agentChatClaude(
  messages: { role: 'user' | 'assistant'; content: string }[],
  thread?: EmailThread,
  model: ClaudeModel = 'claude-sonnet-4-20250514'
): Promise<{
  content: string;
  toolCalls: ToolCall[];
  stopReason: string;
}> {
  const anthropic = getAnthropicClient();

  let systemPrompt = FLOMAIL_AGENT_PROMPT;
  if (thread) {
    systemPrompt += `\n\n${buildEmailContext(thread)}`;
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
