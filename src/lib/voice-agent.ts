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

const VOICE_AGENT_BASE_PROMPT = `You are FloMail, a voice-first email assistant having a natural phone-call-style conversation.

VOICE RULES:
- You are SPEAKING, not writing. Keep responses conversational, natural, and concise.
- Never use markdown, bullet points, numbered lists, or formatting symbols. Never say "asterisk."
- Narrate actions naturally: "Let me draft that reply for you" or "I'll archive that now."
- Confirm important actions before executing: "Should I send that?"
- Use natural fillers: "Sure thing", "Got it", "Alright".

OPENING BEHAVIOR:
- NEW email thread: Very briefly mention who it's from and the topic, then offer to read it. If they say yes, call get_email_content and read the result VERBATIM — do NOT paraphrase.
- RETURNING to a previously discussed thread: Just say "How can I help?"
- NO email thread open: Just say "How can I help?"

READING & DRAFTING:
- To read emails, ALWAYS call get_email_content and read the text VERBATIM. Never paraphrase unless asked.
- After calling prepare_draft, ALWAYS call get_draft_content and read the draft back VERBATIM. Then ask: "Want me to send it, or would you like any changes?" Do NOT recreate draft text from memory.
- Same after editing — call get_draft_content, read changes verbatim, ask about sending.
- DEFAULT draft type is REPLY when viewing an email thread. Only use "forward" or "new" if explicitly requested.
- Replies default to Reply All. Just set "to" to the sender's email — the system handles the rest.

ACTIONS:
- Check the email's folder/labels before suggesting actions. Don't suggest archiving already-archived emails.
- When performing actions (archive, send, snooze, etc.), mention who the email is from or what it's about.
- snooze_email: ONLY call ONCE per request.
- You can chain multiple tools in sequence (e.g., search web then draft).

Be helpful, efficient, and sound natural — like a knowledgeable assistant on a phone call.`;

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
  // Decode numeric HTML entities (&#NNN; and &#xHHH;)
  text = text.replace(/&#x([0-9a-fA-F]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  text = text.replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)));
  text = text.replace(/\t+/g, ' ');
  text = text.replace(/ +/g, ' ');
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  return text.trim();
}

/**
 * Check if an email address belongs to the user (case-insensitive).
 */
function isUserEmail(email: string, userEmail?: string): boolean {
  if (!userEmail) return false;
  return email.toLowerCase() === userEmail.toLowerCase();
}

/**
 * Build email context for the voice agent prompt.
 *
 * Token optimization: only the most recent 2 messages include full body text.
 * Older messages get a compact metadata line — the agent can call
 * get_email_content to fetch full text if needed.
 */
const FULL_BODY_MESSAGE_COUNT = 2;

export function buildEmailContext(thread: EmailThread, folder: string = 'inbox', userEmail?: string): string {
  const folderName = FOLDER_NAMES[folder] || folder;
  const hasInboxLabel = thread.labels?.includes('INBOX');
  const hasStarredLabel = thread.labels?.includes('STARRED');
  const msgCount = thread.messages.length;

  const messageParts = thread.messages.map((msg, i) => {
    const fromName = msg.from.name || msg.from.email;
    const isFromUser = isUserEmail(msg.from.email, userEmail);
    const fromLabel = isFromUser ? '[YOU] ' : '';
    const toEmails = msg.to.map(t => t.email).join(', ');
    const ccPart = msg.cc && msg.cc.length > 0
      ? ` | CC: ${msg.cc.map(c => c.email).join(', ')}`
      : '';
    const dateStr = new Date(msg.date).toLocaleString();
    const isRecent = i >= msgCount - FULL_BODY_MESSAGE_COUNT;

    if (!isRecent) {
      return `[${i + 1}] ${fromLabel}${fromName} <${msg.from.email}> → ${toEmails}${ccPart} | ${dateStr} | ${msg.subject}`;
    }

    let bodyText = msg.body || '';
    if (msg.bodyHtml) {
      const htmlText = extractTextFromHtml(msg.bodyHtml);
      if (htmlText.length > bodyText.length * 1.5 || bodyText.length < 50) {
        bodyText = htmlText;
      }
    }

    return `[${i + 1}] ${fromLabel}From: ${fromName} <${msg.from.email}>
To: ${toEmails}${ccPart ? `\nCC: ${ccPart.slice(6)}` : ''}
Date: ${dateStr}
Subject: ${msg.subject}

${bodyText}`;
  });

  // Mark user in participants list
  const participantsList = thread.participants.map(p => {
    const label = isUserEmail(p.email, userEmail) ? ' [YOU]' : '';
    return `${p.name || 'Unknown'} <${p.email}>${label}`;
  }).join(', ');

  let status = `Folder: ${folderName}.`;
  if (hasInboxLabel) status += ' Can be archived.';
  else status += ' Not in inbox (move_to_inbox works).';
  if (hasStarredLabel) status += ' Starred.';
  if (folder === 'sent') status += ' SENT email — "reply" means follow-up to original recipients.';

  return `<current_email_thread>
${status}
Subject: ${thread.subject}
Participants: ${participantsList}

${messageParts.join('\n\n---\n\n')}
</current_email_thread>`;
}

/**
 * Build user preferences context
 */
function buildUserPreferencesContext(prefs: AIDraftingPreferences, userEmail?: string): string {
  const parts: string[] = [];

  if (prefs.userName || userEmail) {
    let identity = '';
    if (prefs.userName && userEmail) {
      identity = `YOU are assisting ${prefs.userName} (${userEmail}). They are the person using FloMail — the SENDER of any drafted messages. Messages marked [YOU] in the email thread are from this user. All other senders are people the user is corresponding with.`;
    } else if (prefs.userName) {
      identity = `YOU are assisting ${prefs.userName}. They are the person using FloMail — the SENDER of any drafted messages.`;
    } else if (userEmail) {
      identity = `YOU are assisting the user (${userEmail}). They are the person using FloMail — the SENDER of any drafted messages.`;
    }
    parts.push(identity);
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

// ============================================================
// SESSION LEDGER — compact record of actions taken this session
// ============================================================

/**
 * Build a one-line ledger entry for an action taken on a thread.
 * These entries are injected into the new session prompt after a hot-swap
 * so the agent knows what happened earlier without full conversation history.
 */
export function buildSessionLedgerEntry(
  action: 'replied' | 'sent' | 'archived' | 'snoozed' | 'starred' | 'unstarred' | 'forwarded' | 'moved_to_inbox' | 'discarded_draft',
  thread?: { subject?: string; messages?: { from?: { name?: string; email?: string } }[] },
  extra?: string,
): string {
  const lastMsg = thread?.messages?.[thread.messages.length - 1];
  const sender = lastMsg?.from?.name || lastMsg?.from?.email?.split('@')[0] || 'someone';
  const subject = thread?.subject?.replace(/^(Re|Fwd|Fw):\s*/gi, '').slice(0, 50) || 'unknown';

  switch (action) {
    case 'replied': return `Replied to ${sender} re "${subject}"${extra ? ` — ${extra}` : ''}`;
    case 'sent': return `Sent email to ${sender} re "${subject}"`;
    case 'archived': return `Archived email from ${sender} re "${subject}"`;
    case 'snoozed': return `Snoozed email from ${sender} re "${subject}"${extra ? ` until ${extra}` : ''}`;
    case 'starred': return `Starred email from ${sender} re "${subject}"`;
    case 'unstarred': return `Unstarred email from ${sender} re "${subject}"`;
    case 'forwarded': return `Forwarded email from ${sender} re "${subject}"${extra ? ` to ${extra}` : ''}`;
    case 'moved_to_inbox': return `Moved to inbox: email from ${sender} re "${subject}"`;
    case 'discarded_draft': return `Discarded draft for email from ${sender} re "${subject}"`;
    default: return `Action on email from ${sender} re "${subject}"`;
  }
}

/**
 * Build the full voice agent prompt with dynamic email context
 */
export function buildVoiceAgentPrompt(
  thread?: EmailThread,
  folder: string = 'inbox',
  draftingPreferences?: AIDraftingPreferences,
  options?: { isReturningToThread?: boolean; userEmail?: string; sessionLedger?: string },
): string {
  let prompt = VOICE_AGENT_BASE_PROMPT;
  const userEmail = options?.userEmail;

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
    prompt += buildUserPreferencesContext(draftingPreferences, userEmail);
  }

  // Add session ledger (prior actions from this voice session)
  if (options?.sessionLedger) {
    prompt += `\n\nSESSION HISTORY (actions taken earlier in this voice session — you can reference these if the user asks about previous emails):\n${options.sessionLedger}`;
  }

  // Add email context
  if (thread) {
    prompt += `\n\n${buildEmailContext(thread, folder, userEmail)}`;

    if (options?.isReturningToThread) {
      prompt += '\n\n[CONTEXT: Returning to a previously discussed thread. Keep greeting brief.]';
    } else {
      const lastMessage = thread.messages[thread.messages.length - 1];
      const senderName = lastMessage?.from?.name || lastMessage?.from?.email || 'someone';
      prompt += `\n\n[CONTEXT: NEW email from ${senderName} about "${thread.subject}". Briefly introduce it and offer to read.]`;
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
  options?: { isReturningToThread?: boolean; previousAction?: string },
): string {
  if (!thread) {
    return 'How can I help?';
  }

  const lastMessage = thread.messages?.[thread.messages.length - 1];
  const senderName = lastMessage?.from?.name || lastMessage?.from?.email?.split('@')[0] || 'someone';
  const subject = thread.subject?.replace(/^(Re|Fwd|Fw):\s*/gi, '').trim() || 'no subject';

  const actionPrefix = options?.previousAction ? `${options.previousAction}. ` : '';

  if (options?.isReturningToThread) {
    return `${actionPrefix}Back to the email from ${senderName}. How can I help?`;
  }

  // New thread — brief context + offer to read
  return `${actionPrefix}Next up, you have a message from ${senderName} about "${subject}". Want me to read it to you?`;
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
    name: 'discard_draft',
    description: 'Discard the current draft email. Use when the user wants to cancel, discard, delete, or throw away the draft they are working on.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    expects_response: true,
    response_timeout_secs: 10,
  },
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
    turn?: {
      turn_eagerness?: 'patient' | 'normal' | 'eager';
      speculative_turn?: boolean;
      turn_timeout?: number;
      spelling_patience?: 'auto' | 'off';
    };
    conversation?: {
      client_events?: string[];
    };
  };
  platform_settings?: {
    overrides?: {
      conversation_config_override?: {
        agent?: {
          first_message?: boolean;
          language?: boolean;
          prompt?: {
            prompt?: boolean;
            llm?: boolean;
          };
        };
        tts?: {
          voice_id?: boolean;
          speed?: boolean;
          stability?: boolean;
          similarity_boost?: boolean;
        };
        conversation?: {
          text_only?: boolean;
        };
      };
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
        model_id: 'eleven_flash_v2', // ~75ms latency vs turbo_v2's higher latency
        voice_id: options.voiceId || '21m00Tcm4TlvDq8ikWAM', // Rachel
        stability: 0.5,
        similarity_boost: 0.8,
        speed: 1.0,
      },
      asr: {
        quality: 'high',
        provider: 'scribe_realtime',
      },
      turn: {
        turn_eagerness: 'eager',      // Respond ASAP when user pauses
        speculative_turn: true,         // Start LLM generation before full turn confidence
        spelling_patience: 'off',       // Don't wait for entity spelling completion
        turn_timeout: 7,               // Default timeout for re-engagement
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
    // Allow runtime overrides for first_message and prompt so each session
    // can have a contextual greeting based on the current email thread
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: {
            first_message: true,
            prompt: {
              prompt: true,
            },
          },
        },
      },
    },
  };
}

// ============================================================
// SOUND EFFECTS (Web Audio API)
// ============================================================

export class VoiceSoundEffects {
  private audioContext: AudioContext | null = null;
  private processingLoop: { osc1: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null;
  private processingLoopTimer: number | null = null;

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

  /** Start a gentle ambient chime loop for ongoing operations (search, browse, etc.)
   *  Plays soft, musical arpeggiated notes like wind chimes — warm and friendly */
  startProcessingLoop() {
    this.stopProcessingLoop(); // Clean up any existing loop
    try {
      const ctx = this.getContext();

      // Master gain for the whole loop
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.5); // Gentle fade in

      // Warm pentatonic notes (C major pentatonic, octave 5-6 range — bright but soft)
      const notes = [523, 587, 659, 784, 880, 1047, 784, 659]; // C5 D5 E5 G5 A5 C6 G5 E5
      let noteIndex = 0;
      let timeOffset = 0.3; // Initial delay

      // Schedule a sequence of soft chime notes
      const scheduleChime = () => {
        if (!this.processingLoop) return;
        try {
          const osc = ctx.createOscillator();
          const noteGain = ctx.createGain();

          osc.type = 'triangle'; // Warmer than sine
          osc.connect(noteGain);
          noteGain.connect(gain);

          const freq = notes[noteIndex % notes.length];
          // Slight random detuning for organic feel
          osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 4, ctx.currentTime);

          // Soft attack, gentle decay (like a wind chime)
          noteGain.gain.setValueAtTime(0, ctx.currentTime);
          noteGain.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 0.04);
          noteGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);

          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.85);

          noteIndex++;
          // Vary timing: 400-700ms between notes for natural rhythm
          const nextDelay = 400 + Math.random() * 300;
          this.processingLoopTimer = window.setTimeout(scheduleChime, nextDelay);
        } catch {}
      };

      // Use a dummy oscillator pair to satisfy the type (they produce no sound)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.connect(gain);
      osc2.connect(gain);
      osc1.type = 'triangle';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(0, ctx.currentTime);
      osc2.frequency.setValueAtTime(0, ctx.currentTime);
      const silentGain = ctx.createGain();
      silentGain.gain.setValueAtTime(0, ctx.currentTime);
      osc1.disconnect();
      osc2.disconnect();
      osc1.connect(silentGain);
      osc2.connect(silentGain);
      silentGain.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc2.start(ctx.currentTime);

      this.processingLoop = { osc1, osc2, gain };
      // Start the chime sequence after a brief initial delay
      this.processingLoopTimer = window.setTimeout(scheduleChime, timeOffset * 1000);
    } catch {}
  }

  /** Stop the processing loop with a gentle fade-out */
  stopProcessingLoop() {
    if (this.processingLoopTimer) {
      clearTimeout(this.processingLoopTimer);
      this.processingLoopTimer = null;
    }
    if (!this.processingLoop) return;
    try {
      const ctx = this.getContext();
      const { osc1, osc2, gain } = this.processingLoop;
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc1.stop(ctx.currentTime + 0.35);
      osc2.stop(ctx.currentTime + 0.35);
    } catch {}
    this.processingLoop = null;
  }

  dispose() {
    this.stopProcessingLoop();
    if (this.processingLoopTimer) {
      clearTimeout(this.processingLoopTimer);
      this.processingLoopTimer = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
  }
}
