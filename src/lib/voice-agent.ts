/**
 * Voice Agent Configuration for ElevenLabs Conversational AI
 *
 * Handles:
 * - Building voice-optimized system prompts
 * - Converting FloMail tools to ElevenLabs format
 * - Formatting email thread context
 * - Sound effect generation via Web Audio API
 */

import { EmailThread, AIDraftingPreferences } from '@/types';
import { AGENT_TOOLS } from './agent-tools';

// ============================================================
// VOICE-OPTIMIZED SYSTEM PROMPT
// ============================================================

const VOICE_AGENT_BASE_PROMPT = `You are FloMail, a voice-first email assistant. You are having a natural phone-call-style conversation with the user about their email.

VOICE CONVERSATION GUIDELINES:
- You are SPEAKING, not writing. Keep responses conversational, natural, and concise.
- Never use markdown, bullet points, numbered lists, or formatting symbols.
- Never say "asterisk" or dictate formatting characters.
- Narrate your actions naturally: "Let me draft that reply for you" or "I'll archive that now."
- Confirm important actions before executing: "Should I send that?" or "Want me to archive this?"
- If the user pauses or is thinking, give them space. Don't rush to fill silence.
- Use conversational fillers naturally: "Sure thing", "Got it", "Alright".

## OPENING BEHAVIOR — VERY IMPORTANT:
When you first greet the user about a NEW email thread (one they haven't discussed yet):
1. Keep it very short: mention who it's from and the topic in one sentence.
2. Then offer to read it: "Want me to read it to you?"
3. If the user says yes, call get_email_content to get the verbatim text and read it aloud word-for-word. Do NOT paraphrase — read it exactly as written.
4. After reading, ask how you can help: "How would you like to respond?" or similar.

When RETURNING to a thread the user has already discussed:
- Just say something brief like "How can I help?" — don't re-summarize.

When NO email thread is open (user is in inbox):
- Just say "How can I help?"

## READING EMAILS:
- When the user asks you to read an email, ALWAYS use get_email_content and read the returned text VERBATIM. Do NOT paraphrase or summarize unless explicitly asked.
- For threads with multiple new messages, read them in order.

## AFTER DRAFTING — READ BACK:
After you create a draft with prepare_draft, ALWAYS:
1. Call get_draft_content to get the exact draft text.
2. Read the draft body verbatim to the user.
3. Then ask: "Want me to send it, or would you like any changes?"
Do NOT try to recreate the draft text from memory — always use get_draft_content to get the exact text.

## AFTER EDITING A DRAFT:
When the user asks for changes and you call prepare_draft again:
1. Call get_draft_content to get the updated text.
2. Read the changes back verbatim.
3. Ask if they want to send or make more changes.

## TOOLS:

### Email Actions:
- prepare_draft: Call when user wants to draft, write, reply, or forward. ALWAYS include type, to, subject, body.
  * type: "reply" (responding to current email - THIS IS THE DEFAULT), "forward" (forwarding), or "new" (new email)
  * CRITICAL: When viewing an email thread and user asks to write back, respond, tell them, draft something - ALWAYS use "reply".
- send_email: Call when user confirms they want to send. Must include confirm: "confirmed".
- archive_email: Remove from inbox. Only works if email is currently in inbox.
- move_to_inbox: Unarchive an email. Only use for archived emails.
- star_email: Star/flag the email.
- unstar_email: Remove star.
- go_to_previous_email: Navigate to previous email.
- go_to_next_email: Navigate to next email.
- go_to_inbox: Return to inbox view.
- snooze_email: Snooze the email. Use snooze_until options: "later_today", "tomorrow", "this_weekend", "next_week", or "custom" with custom_date ISO string. ONLY call ONCE per request.

### Web Search & Browsing:
- web_search: Search the web for current information.
- browse_url: Fetch and read content from a URL.
- search_emails: Search through the user's Gmail.

### Reading Content:
- get_email_content: Get the full verbatim text of the current email thread. Use when the user asks to read the email, or when you first greet them about a new email and they want to hear it. Returns exact text — read it word-for-word.
- get_draft_content: Get the exact text of the current draft. ALWAYS call this after creating or editing a draft so you can read it back verbatim to the user.

## DRAFT TYPE - CRITICAL:
DEFAULT IS REPLY. When viewing an email thread, assume the user wants to reply unless they explicitly say "forward" or "new email".

## REPLY ALL (Default):
Replies default to Reply All. The system automatically includes all original recipients. Just set "to" to the sender's email.

## FOLDER AWARENESS:
Check which folder the email is in before suggesting actions. Don't suggest archiving already-archived emails.

## MULTI-STEP WORKFLOWS:
You can call multiple tools in sequence. For example, search the web then draft an email with what you found.

## IMPORTANT RULES:
1. For drafts: ALWAYS call prepare_draft with complete email (to, subject, body).
2. For summaries/questions: Just respond with the answer conversationally.
3. After drafting: ALWAYS call get_draft_content and read the draft back verbatim, then ask about sending or changes.
4. Be concise but complete.
5. Check the folder before suggesting actions.
6. When performing actions (archive, send, snooze, etc.), include relevant context in your response — mention who the email is from or what it's about.

Be helpful, efficient, and sound natural - like a knowledgeable assistant on a phone call.`;

// Folder display names
const FOLDER_NAMES: Record<string, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  starred: 'Starred',
  all: 'All Mail',
  archive: 'Archive',
  snoozed: 'Snoozed',
  drafts: 'Drafts',
};

// ============================================================
// CONTEXT BUILDERS
// ============================================================

/**
 * Extract readable text from HTML (mirrors anthropic.ts logic)
 */
export function extractTextFromHtml(html: string): string {
  if (!html) return '';
  let text = html;
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|li|h[1-6]|blockquote|section|article|header|footer)>/gi, '\n');
  text = text.replace(/<\/td>/gi, '\t');
  text = text.replace(/<\/tr>/gi, '\n');
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&zwnj;/gi, '');
  text = text.replace(/&zwj;/gi, '');
  text = text.replace(/\t+/g, ' ');
  text = text.replace(/ +/g, ' ');
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  return text.trim();
}

/**
 * Build email context for the voice agent prompt
 */
export function buildEmailContext(thread: EmailThread, folder: string = 'inbox'): string {
  const messages = thread.messages.map((msg, i) => {
    const fromName = msg.from.name || msg.from.email;
    let bodyText = msg.body || '';
    if (msg.bodyHtml) {
      const htmlText = extractTextFromHtml(msg.bodyHtml);
      if (htmlText.length > bodyText.length * 1.5 || bodyText.length < 50) {
        bodyText = htmlText;
      }
    }
    // Truncate very long messages for voice context (voice doesn't need full body)
    if (bodyText.length > 800) {
      bodyText = bodyText.substring(0, 800) + '... [truncated for voice]';
    }

    const toLine = `To: ${msg.to.map(t => t.email).join(', ')}`;
    const ccLine = msg.cc && msg.cc.length > 0
      ? `\nCC: ${msg.cc.map(c => c.email).join(', ')}`
      : '';

    return `[${i + 1}] From: ${fromName} <${msg.from.email}>
${toLine}${ccLine}
Date: ${new Date(msg.date).toLocaleString()}
Subject: ${msg.subject}

${bodyText}`;
  });

  const folderName = FOLDER_NAMES[folder] || folder;
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
${hasInboxLabel ? '- Has INBOX label - can be archived.' : '- No INBOX label - archive will have no effect, but move_to_inbox will work.'}
${hasStarredLabel ? '- Is STARRED - can be unstarred.' : '- Not starred - can be starred.'}
${folder === 'sent' ? '- This is a SENT email. If user wants to "reply", they mean follow-up to the original recipients.' : ''}`;
}

/**
 * Build user preferences context
 */
function buildUserPreferencesContext(prefs: AIDraftingPreferences): string {
  const parts: string[] = [];

  if (prefs.userName) {
    parts.push(`The user's name is ${prefs.userName}. They are the SENDER of any drafted messages.`);
  }

  const toneDescriptions: Record<string, string> = {
    professional: 'Use a professional, business-appropriate tone.',
    friendly: 'Use a warm, friendly tone.',
    casual: 'Use a casual, relaxed tone.',
    formal: 'Use a formal, respectful tone.',
  };
  if (prefs.tones && prefs.tones.length > 0) {
    const toneInstructions = prefs.tones
      .map(t => toneDescriptions[t])
      .filter(Boolean)
      .join(' ');
    if (toneInstructions) parts.push(toneInstructions);
  }

  const lengthDescriptions: Record<string, string> = {
    brief: 'Keep drafted messages concise. Aim for 2-3 sentences.',
    moderate: 'Write drafted messages of moderate length.',
    detailed: 'Write thorough, detailed drafted messages.',
  };
  if (prefs.length && lengthDescriptions[prefs.length]) {
    parts.push(lengthDescriptions[prefs.length]);
  }

  if (prefs.useExclamations === true) {
    parts.push('You may use exclamation marks in drafts.');
  } else if (prefs.useExclamations === false) {
    parts.push('Avoid exclamation marks in drafts.');
  }

  if (prefs.signOffStyle && prefs.signOffStyle !== 'none') {
    const userName = prefs.userName?.split(' ')[0] || 'User';
    let signOff = '';
    switch (prefs.signOffStyle) {
      case 'best': signOff = `Best, ${userName}`; break;
      case 'thanks': signOff = `Thanks, ${userName}`; break;
      case 'regards': signOff = `Regards, ${userName}`; break;
      case 'cheers': signOff = `Cheers, ${userName}`; break;
      case 'custom': signOff = prefs.customSignOff || `Best, ${userName}`; break;
    }
    parts.push(`End drafted emails with: "${signOff}"`);
  }

  if (prefs.customInstructions?.trim()) {
    parts.push(`Additional instructions: ${prefs.customInstructions.trim()}`);
  }

  return parts.length > 0
    ? `\n\nUSER DRAFTING PREFERENCES:\n${parts.join('\n')}`
    : '';
}

/**
 * Build the full voice agent prompt with dynamic email context
 */
export function buildVoiceAgentPrompt(
  thread?: EmailThread,
  folder: string = 'inbox',
  draftingPreferences?: AIDraftingPreferences,
  options?: { isReturningToThread?: boolean },
): string {
  let prompt = VOICE_AGENT_BASE_PROMPT;

  // Add current date/time
  const now = new Date();
  prompt += `\n\nCurrent date/time: ${now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })}`;

  // Add user preferences
  if (draftingPreferences) {
    prompt += buildUserPreferencesContext(draftingPreferences);
  }

  // Add email context
  if (thread) {
    prompt += `\n\n${buildEmailContext(thread, folder)}`;

    // Guide the AI's opening behavior based on whether user has discussed this thread before
    if (options?.isReturningToThread) {
      prompt += '\n\n[CONTEXT: The user has previously discussed this email thread. Keep your greeting brief — just ask how you can help.]';
    } else {
      // New thread — give a brief intro and offer to read
      const lastMessage = thread.messages[thread.messages.length - 1];
      const senderName = lastMessage?.from?.name || lastMessage?.from?.email || 'someone';
      prompt += `\n\n[CONTEXT: This is a NEW email the user hasn't discussed yet. Your first message should be very brief: mention it's from ${senderName} about "${thread.subject}", then offer to read it. Example: "You have a message from ${senderName} about ${thread.subject}. Want me to read it to you?"]`;
    }
  } else {
    prompt += '\n\nNo email thread is currently open. The user is in their inbox. Just ask how you can help.';
  }

  return prompt;
}

/**
 * Build a dynamic first message for the agent to speak when the session starts.
 * This is passed via overrides.agent.firstMessage so the greeting is contextual
 * instead of a generic "How can I help?"
 */
export function buildDynamicFirstMessage(
  thread?: EmailThread,
  options?: { isReturningToThread?: boolean },
): string {
  if (!thread) {
    return 'How can I help?';
  }

  const lastMessage = thread.messages?.[thread.messages.length - 1];
  const senderName = lastMessage?.from?.name || lastMessage?.from?.email?.split('@')[0] || 'someone';
  const subject = thread.subject?.replace(/^(Re|Fwd|Fw):\s*/gi, '').trim() || 'no subject';

  if (options?.isReturningToThread) {
    return `Back to the email from ${senderName}. How can I help?`;
  }

  // New thread — brief context + offer to read
  return `You have a message from ${senderName} about "${subject}". Want me to read it to you?`;
}

// ============================================================
// ELEVENLABS TOOL DEFINITIONS
// ============================================================

/**
 * Convert FloMail agent tools to ElevenLabs client tool format.
 * These go in the agent creation config so the LLM knows they exist.
 * The client-side implementations are in VoiceModeInterface's clientTools.
 */
// Voice-specific tools not in the standard AGENT_TOOLS
const VOICE_SPECIFIC_TOOLS: ElevenLabsClientTool[] = [
  {
    type: 'client',
    name: 'get_email_content',
    description: 'Get the full verbatim text of messages in the current email thread. Use this when the user asks you to read the email, or when first greeting the user about a new thread and they want to hear it. Read the returned text word-for-word.',
    parameters: {
      type: 'object',
      properties: {
        message_number: {
          type: 'string',
          description: 'Which message to read: "1" for oldest, "2" for second, "last" for most recent. Omit to get all messages.',
        },
      },
      required: [],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
  {
    type: 'client',
    name: 'get_draft_content',
    description: 'Get the exact text of the current draft email. ALWAYS call this after creating or editing a draft with prepare_draft, so you can read it back verbatim to the user. Returns the draft body text.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
];

function getElevenLabsToolDefinitions() {
  const standardTools = AGENT_TOOLS.map(tool => ({
    type: 'client' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    expects_response: true,
    response_timeout_secs: tool.name === 'web_search' || tool.name === 'browse_url' || tool.name === 'search_emails'
      ? 30  // async network tools need more time
      : 20,
  }));

  return [...standardTools, ...VOICE_SPECIFIC_TOOLS];
}

// ============================================================
// MODEL ID MAPPING (FloMail → ElevenLabs)
// ============================================================

/**
 * Map FloMail's model IDs to ElevenLabs Conversational AI model IDs.
 * OpenAI model IDs are the same; Claude IDs use different formatting.
 */
export function mapToElevenLabsModelId(floMailModelId: string): string {
  const mapping: Record<string, string> = {
    // Anthropic Claude models
    'claude-sonnet-4-20250514': 'claude-sonnet-4@20250514',
    'claude-opus-4-20250514': 'claude-sonnet-4-5',  // Opus not available on ElevenLabs; use Sonnet 4.5
    'claude-3-5-sonnet-20241022': 'claude-3-5-sonnet',
    'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
    // OpenAI GPT models — same IDs work directly
    'gpt-4.1': 'gpt-4.1',
    'gpt-4.1-mini': 'gpt-4.1-mini',
    'gpt-4.1-nano': 'gpt-4.1-nano',
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
  };
  return mapping[floMailModelId] || floMailModelId;
}

// ============================================================
// ELEVENLABS AGENT CONFIGURATION
// ============================================================

export interface ElevenLabsClientTool {
  type: 'client';
  name: string;
  description: string;
  parameters: Record<string, any>;
  expects_response: boolean;
  response_timeout_secs?: number;
}

export interface ElevenLabsAgentConfig {
  conversation_config: {
    agent: {
      name?: string;
      first_message: string;
      language: string;
      prompt: {
        prompt: string;
        llm: string;
        temperature?: number;
        max_tokens?: number;
        tools?: ElevenLabsClientTool[];
      };
    };
    tts?: {
      model_id?: string;
      voice_id?: string;
      stability?: number;
      similarity_boost?: number;
      speed?: number;
    };
    asr?: {
      quality?: 'high';
      provider?: 'elevenlabs' | 'scribe_realtime';
    };
    conversation?: {
      client_events?: string[];
    };
  };
}

/**
 * Build the ElevenLabs agent creation config.
 * Tool DEFINITIONS are included here so the LLM knows they exist.
 * Tool IMPLEMENTATIONS are provided client-side via clientTools in useConversation.
 */
export function buildAgentConfig(options: {
  voiceId?: string;
  llmModel?: string;
}): ElevenLabsAgentConfig {
  return {
    conversation_config: {
      agent: {
        first_message: "How can I help?",
        language: 'en',
        prompt: {
          prompt: VOICE_AGENT_BASE_PROMPT,
          llm: options.llmModel ? mapToElevenLabsModelId(options.llmModel) : 'gpt-4o',
          temperature: 0.7,
          tools: getElevenLabsToolDefinitions(),
        },
      },
      tts: {
        model_id: 'eleven_turbo_v2',
        voice_id: options.voiceId || '21m00Tcm4TlvDq8ikWAM', // Rachel
        stability: 0.5,
        similarity_boost: 0.8,
        speed: 1.0,
      },
      asr: {
        quality: 'high',
        provider: 'scribe_realtime',
      },
      conversation: {
        client_events: [
          'audio',
          'agent_response',
          'agent_response_correction',
          'user_transcript',
          'tentative_user_transcript',
          'interruption',
          'client_tool_call',
          'conversation_initiation_metadata',
          'ping',
          'vad_score',
        ],
      },
    },
  };
}

// ============================================================
// SOUND EFFECTS (Web Audio API)
// ============================================================

export class VoiceSoundEffects {
  private audioContext: AudioContext | null = null;

  private getContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new AudioContext();
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    return this.audioContext;
  }

  /** Subtle connection established sound */
  playConnect() {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(523, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.08); // E5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch {}
  }

  /** Soft processing/thinking sound */
  playToolStart() {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch {}
  }

  /** Gentle chime for draft ready */
  playDraftReady() {
    try {
      const ctx = this.getContext();
      const notes = [523, 659, 784]; // C5, E5, G5 chord
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gain.gain.setValueAtTime(0.04, ctx.currentTime + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4 + i * 0.05);
        osc.start(ctx.currentTime + i * 0.05);
        osc.stop(ctx.currentTime + 0.5);
      });
    } catch {}
  }

  /** Whoosh sound for send/archive */
  playSend() {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    } catch {}
  }

  /** Disconnect/end call sound */
  playDisconnect() {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(330, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } catch {}
  }

  /** Error alert sound */
  playError() {
    try {
      const ctx = this.getContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.setValueAtTime(185, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } catch {}
  }

  dispose() {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
  }
}
