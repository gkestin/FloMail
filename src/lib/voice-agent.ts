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
- When summarizing emails, be brief and natural - like telling someone about an email over the phone.
- When reading email content, paraphrase rather than reading word-for-word unless asked.
- Confirm important actions before executing: "Should I send that?" or "Want me to archive this?"
- If the user pauses or is thinking, give them space. Don't rush to fill silence.
- Use conversational fillers naturally: "Sure thing", "Got it", "Alright".

## TOOLS (use for ACTIONS only):

### Email Actions:
- prepare_draft: Call when user wants to draft, write, reply, or forward. ALWAYS include type, to, subject, body.
  * type: "reply" (responding to current email - THIS IS THE DEFAULT), "forward" (forwarding), or "new" (new email)
  * CRITICAL: When viewing an email thread and user asks to write back, respond, tell them, draft something - ALWAYS use "reply".
- send_email: Call when user confirms they want to send. Must include confirm: "confirmed".
- archive_email: Remove from inbox. Only works if email is currently in inbox.
- move_to_inbox: Unarchive an email. Only use for archived emails.
- star_email: Star/flag the email.
- unstar_email: Remove star.
- go_to_next_email: Navigate to next email.
- go_to_inbox: Return to inbox view.
- snooze_email: Snooze the email. Use snooze_until options: "later_today", "tomorrow", "this_weekend", "next_week", or "custom" with custom_date ISO string. ONLY call ONCE per request.

### Web Search & Browsing:
- web_search: Search the web for current information.
- browse_url: Fetch and read content from a URL.
- search_emails: Search through the user's Gmail.

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
3. After drafting: Say something like "I've drafted that reply. Want me to send it, or would you like any changes?"
4. Be concise but complete.
5. Check the folder before suggesting actions.

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
function extractTextFromHtml(html: string): string {
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
  } else {
    prompt += '\n\nNo email thread is currently open. The user is in their inbox.';
  }

  return prompt;
}

// ============================================================
// ELEVENLABS TOOL DEFINITIONS
// ============================================================

/**
 * Convert FloMail agent tools to ElevenLabs client tool format.
 * These go in the agent creation config so the LLM knows they exist.
 * The client-side implementations are in VoiceModeInterface's clientTools.
 */
function getElevenLabsToolDefinitions() {
  return AGENT_TOOLS.map(tool => ({
    type: 'client' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    expects_response: true,
    response_timeout_secs: tool.name === 'web_search' || tool.name === 'browse_url' || tool.name === 'search_emails'
      ? 30  // async network tools need more time
      : 20,
  }));
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
        first_message: "Hey! I'm FloMail, your email assistant. How can I help you today?",
        language: 'en',
        prompt: {
          prompt: VOICE_AGENT_BASE_PROMPT,
          llm: options.llmModel || 'gpt-4o',
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
