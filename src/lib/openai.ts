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
