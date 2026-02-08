import { EmailThread, EmailDraft, DraftAttachment } from '@/types';

// Tool definitions for the AI agent
export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
}

// Define all available tools
export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'prepare_draft',
    description: 'Prepare an email draft for user review. CRITICAL: When user is viewing an email thread and asks to write/respond/draft/answer/tell them/write back, ALWAYS use type="reply". The word "reply" does NOT need to appear - if they are viewing an email and want to compose something back, it is a REPLY.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'ALWAYS use "reply" unless: (1) user says "forward" → use "forward", or (2) user explicitly says "new email" or "new message" to someone NOT in the current thread → use "new". When in doubt, use "reply".',
          enum: ['reply', 'forward', 'new'],
        },
        to: {
          type: 'string',
          description: 'Comma-separated email addresses of recipients',
        },
        cc: {
          type: 'string',
          description: 'Comma-separated email addresses for CC (optional)',
        },
        bcc: {
          type: 'string',
          description: 'Comma-separated email addresses for BCC (optional)',
        },
        subject: {
          type: 'string',
          description: 'Email subject line. For replies, prefix with "Re: " if not already. For forwards, prefix with "Fwd: "',
        },
        body: {
          type: 'string',
          description: 'The email body text. For forwards, ONLY include the new message (e.g. "FYI, see below") - the forwarded content is added automatically. Do NOT include "---------- Forwarded message ----------" or the original message text.',
        },
      },
      required: ['type', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'send_email',
    description: 'Send the prepared email draft. Only call this after user has confirmed they want to send.',
    parameters: {
      type: 'object',
      properties: {
        confirm: {
          type: 'string',
          description: 'Must be "confirmed" to actually send',
          enum: ['confirmed'],
        },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'archive_email',
    description: 'Archive the current email thread, removing it from the inbox. Only works if email is currently in inbox. If email is already archived (not in inbox), tell the user it is already archived.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Brief reason for archiving (for logging)',
        },
      },
      required: [],
    },
  },
  {
    name: 'move_to_inbox',
    description: 'Move an archived email back to the inbox (unarchive). Only works if email is not currently in inbox. Use when user wants to unarchive or move a message back to inbox.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'snooze_email',
    description: 'Propose a snooze time for the current email (UI will ask user to confirm). ONLY call this ONCE per snooze request - if you already called it, do NOT call again.',
    parameters: {
      type: 'object',
      properties: {
        snooze_until: {
          type: 'string',
          description: 'CRITICAL: "later_today"=6pm today, "tomorrow"=8am tomorrow, "this_weekend"=Saturday 8am, "next_week"=Monday 8am. For ANY specific time like "tomorrow at noon", "Friday 3pm", etc., you MUST use "custom" with custom_date.',
          enum: ['later_today', 'tomorrow', 'this_weekend', 'next_week', 'custom'],
        },
        custom_date: {
          type: 'string',
          description: 'REQUIRED when snooze_until is "custom". Full ISO 8601 datetime with timezone, e.g., "2026-01-22T12:00:00-08:00". Calculate from the Current date/time provided in system context.',
        },
      },
      required: ['snooze_until'],
    },
  },
  {
    name: 'star_email',
    description: 'Star the current email thread. Use when user wants to star, mark as important, or flag the email.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'unstar_email',
    description: 'Remove star from the current email thread. Use when user wants to unstar or remove the star/flag.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'go_to_previous_email',
    description: 'Navigate to the previous email in the current folder. Call when user says "previous", "previous email", "go back", "last one", or similar.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'go_to_next_email',
    description: 'Navigate to the next email in the current folder. Call when user says "next", "next email", "move on", or similar.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'go_to_inbox',
    description: 'Return to the inbox/folder list view. Call when user wants to see their inbox, go back, or browse emails.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for current information. Use when user asks to look up, search, find, or research something on the internet. Also use when you need current/real-time information that may not be in your training data (e.g., recent news, current events, latest updates, prices, weather, etc.).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to look up on the web. Be specific and include relevant context.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'browse_url',
    description: 'Fetch and read the content of a specific URL. Use when user asks to check out, read, open, or look at a specific link or URL (e.g., from an email). Returns the main text content of the webpage.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to fetch (including https://)',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'search_emails',
    description: 'Search through the user\'s emails using Gmail search. Use when user asks about previous emails, messages from a specific person, emails about a topic, or wants to find something in their mailbox. Uses Gmail search syntax - supports from:, to:, subject:, has:attachment, before:, after:, etc.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query. Examples: "from:john@example.com", "subject:invoice", "from:alice has:attachment", "order confirmation after:2024/01/01". Keep it focused - don\'t over-specify unless needed.',
        },
        max_results: {
          type: 'string',
          description: 'Maximum number of results to return (default: 5, max: 10)',
        },
      },
      required: ['query'],
    },
  },
];

// Tool result types
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: any;
  uiComponent?: 'draft_card' | 'confirmation' | 'navigation' | 'summary';
}

// Parse tool calls from AI response
export function parseToolCalls(response: any, provider: 'openai' | 'anthropic'): ToolCall[] {
  if (provider === 'openai') {
    const toolCalls = response.choices?.[0]?.message?.tool_calls || [];
    return toolCalls.map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments || '{}'),
    }));
  } else {
    // Anthropic format - look for tool_use blocks
    const content = response.content || [];
    return content
      .filter((block: any) => block.type === 'tool_use')
      .map((block: any) => ({
        id: block.id,
        name: block.name,
        arguments: block.input || {},
      }));
  }
}

// Convert our tools to OpenAI format
export function getOpenAITools() {
  return AGENT_TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

// Convert our tools to Anthropic format
export function getAnthropicTools() {
  return AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

// Format date for email quoting
function formatQuoteDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
      weekday: 'short', 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

// Build quoted content for replies
// Returns HTML content of the message being replied to, for inclusion in a blockquote
export function buildReplyQuote(thread: EmailThread): string {
  if (thread.messages.length === 0) return '';
  
  // Get the most recent message to quote
  const lastMessage = thread.messages[thread.messages.length - 1];
  const senderName = lastMessage.from.name || lastMessage.from.email;
  const date = formatQuoteDate(lastMessage.date);
  
  // Build the quote header like Gmail does
  const quoteHeader = `On ${date}, ${senderName} wrote:`;
  
  // Use HTML body if available, otherwise convert plain text to simple HTML
  let messageContent: string;
  if (lastMessage.bodyHtml) {
    // Use the original HTML - this preserves formatting
    messageContent = lastMessage.bodyHtml;
  } else {
    // Convert plain text to simple HTML
    const escaped = lastMessage.body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    messageContent = `<div>${escaped}</div>`;
  }
  
  return `<div style="color: #777;">${quoteHeader}</div>\n${messageContent}`;
}

// Clean HTML from text for forwarding
function cleanTextForForward(text: string): string {
  let clean = text;
  // Remove HTML tags
  clean = clean.replace(/<[^>]*>/g, '');
  // Decode common HTML entities
  clean = clean.replace(/&nbsp;/gi, ' ');
  clean = clean.replace(/&amp;/gi, '&');
  clean = clean.replace(/&lt;/gi, '<');
  clean = clean.replace(/&gt;/gi, '>');
  clean = clean.replace(/&quot;/gi, '"');
  clean = clean.replace(/&zwnj;/gi, ''); // Zero-width non-joiner
  clean = clean.replace(/&zwj;/gi, '');  // Zero-width joiner
  clean = clean.replace(/&#\d+;/gi, ''); // Numeric entities
  clean = clean.replace(/&#x[0-9a-f]+;/gi, ''); // Hex entities
  // Clean up whitespace
  clean = clean.replace(/\s+/g, ' ');
  clean = clean.replace(/\n\s*\n/g, '\n\n');
  return clean.trim();
}

// Build quoted content for forwards - includes conversation info
function buildForwardQuote(thread: EmailThread): string {
  if (thread.messages.length === 0) return '';
  
  const parts: string[] = [];
  
  // Include all messages in the thread (oldest to newest for forwards)
  for (const msg of thread.messages) {
    const from = msg.from.name 
      ? `${msg.from.name} <${msg.from.email}>` 
      : msg.from.email;
    const to = msg.to.map(t => t.name ? `${t.name} <${t.email}>` : t.email).join(', ');
    const date = formatQuoteDate(msg.date);
    
    // Clean the body - remove HTML tags and entities
    const cleanBody = cleanTextForForward(msg.body);
    // Take first 500 chars to avoid huge forwards
    const truncatedBody = cleanBody.length > 500 
      ? cleanBody.substring(0, 500) + '...' 
      : cleanBody;
    
    parts.push(`---------- Forwarded message ----------
From: ${from}
Date: ${date}
Subject: ${msg.subject}
To: ${to}

${truncatedBody}`);
  }
  
  return '\n\n' + parts.join('\n\n');
}

// Build draft from tool call arguments
// Helper to compute Reply All recipients following Gmail conventions:
// - "To" = sender of the last message + all original "To" recipients (minus the current user)
// - "CC" = all original CC recipients (minus the current user)
// The current user's email is identified by looking at thread participants who sent messages
export function computeReplyAllRecipients(
  thread: EmailThread,
  lastMessage: { from: { email: string }; to: { email: string }[]; cc?: { email: string }[]; replyTo?: string },
  userEmail?: string
): { to: string[]; cc: string[] } {
  // Build set of current user's email addresses
  const currentUserEmails = new Set<string>();

  // Primary: use explicitly passed user email (most reliable)
  if (userEmail) {
    currentUserEmails.add(userEmail.toLowerCase());
  }

  // Secondary: find messages with SENT label (user sent them)
  for (const msg of thread.messages) {
    if (msg.labels?.includes('SENT')) {
      currentUserEmails.add(msg.from.email.toLowerCase());
    }
  }

  // Tertiary: if still no user identified, check thread recipients who also sent messages
  if (currentUserEmails.size === 0) {
    for (const msg of thread.messages) {
      for (const recipient of lastMessage.to) {
        if (msg.from.email.toLowerCase() === recipient.email.toLowerCase() &&
            msg.from.email.toLowerCase() !== lastMessage.from.email.toLowerCase()) {
          currentUserEmails.add(recipient.email.toLowerCase());
        }
      }
    }
  }

  const isCurrentUser = (email: string) => currentUserEmails.has(email.toLowerCase());

  // Use Reply-To address if present (e.g., noreply@company.com → support@company.com)
  const replyAddress = lastMessage.replyTo || lastMessage.from.email;

  // Build "To" list: reply address + all original "To" recipients (minus current user)
  const toSet = new Set<string>();
  toSet.add(replyAddress);
  for (const t of lastMessage.to) {
    if (!isCurrentUser(t.email)) {
      toSet.add(t.email);
    }
  }
  // Also exclude current user from To if they ended up there (e.g., via replyAddress matching)
  for (const email of currentUserEmails) {
    // Don't remove if it's the only recipient (replying to self)
    if (toSet.size > 1) {
      toSet.delete(email);
    }
  }

  // Build "CC" list: all original CC recipients (minus current user and To recipients)
  const ccSet = new Set<string>();
  if (lastMessage.cc) {
    for (const c of lastMessage.cc) {
      if (!isCurrentUser(c.email) && !toSet.has(c.email)) {
        ccSet.add(c.email);
      }
    }
  }

  return {
    to: Array.from(toSet),
    cc: Array.from(ccSet),
  };
}

export function buildDraftFromToolCall(
  args: Record<string, any>,
  thread?: EmailThread,
  userEmail?: string
): EmailDraft {
  // Log what the AI chose
  console.log('[buildDraftFromToolCall] AI args.type:', args.type, '| Has thread:', !!thread);

  // Default to 'reply' if viewing a thread, otherwise 'new'
  const draftType = args.type || (thread ? 'reply' : 'new');
  console.log('[buildDraftFromToolCall] Final draftType:', draftType);

  const lastMessage = thread?.messages[thread.messages.length - 1];

  // For replies and forwards, set up proper threading
  let inReplyTo: string | undefined;
  let references: string | undefined;
  let threadId: string | undefined;
  let quotedContent: string | undefined;
  let attachments: DraftAttachment[] | undefined;

  if (draftType === 'reply' && thread && lastMessage) {
    threadId = thread.id;
    // Use the Message-ID header for proper RFC 2822 threading
    inReplyTo = lastMessage.messageId;
    // Build references chain from all messages in thread
    references = thread.messages
      .map(m => m.messageId)
      .filter(Boolean)
      .join(' ');
    // Build quoted content
    quotedContent = buildReplyQuote(thread);
  } else if (draftType === 'forward' && thread && lastMessage) {
    // Forwards stay in the same thread so you can see the complete history
    threadId = thread.id;
    // For forwards, we reference the original message but don't set In-Reply-To
    references = thread.messages
      .map(m => m.messageId)
      .filter(Boolean)
      .join(' ');
    // Build forward quote
    quotedContent = buildForwardQuote(thread);
    
    // For forwards, include all attachments from the thread
    // These are marked as "from original" and will need to be fetched before sending
    attachments = [];
    for (const msg of thread.messages) {
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          attachments.push({
            messageId: msg.id,
            attachmentId: att.id,
            filename: att.filename,
            mimeType: att.mimeType,
            size: att.size,
            isFromOriginal: true,
          });
        }
      }
    }
    // Only set if there are attachments
    if (attachments.length === 0) {
      attachments = undefined;
    }
  }
  // For 'new', no threading or quoted content
  
  // Sanitize body - remove any forwarded message headers the AI might have included
  // (we add these automatically via quotedContent)
  let body = args.body || '';
  if (draftType === 'forward') {
    // Remove forwarded message header patterns that the AI might have included
    const forwardHeaderPattern = /\n*-{5,}\s*Forwarded message\s*-{5,}[\s\S]*$/i;
    body = body.replace(forwardHeaderPattern, '').trim();
  }

  // For replies, default to Reply All (Gmail convention)
  // Use AI-provided recipients if explicitly set, otherwise compute Reply All
  let toList = args.to?.split(',').map((e: string) => e.trim()).filter(Boolean) || [];
  let ccList = args.cc?.split(',').map((e: string) => e.trim()).filter(Boolean) || [];

  if (draftType === 'reply' && thread && lastMessage) {
    // Check if AI explicitly provided CC (even empty string = intentional override)
    const aiExplicitlySetCc = 'cc' in args && args.cc !== undefined;
    const replyAll = computeReplyAllRecipients(thread, lastMessage, userEmail);
    // If AI only provided the sender (or nothing) in "to" and didn't explicitly set CC,
    // use Reply All recipients
    if (toList.length <= 1 && !aiExplicitlySetCc) {
      toList = replyAll.to;
      ccList = replyAll.cc;
    }
  }

  return {
    threadId,
    to: toList,
    cc: ccList.length > 0 ? ccList : undefined,
    bcc: args.bcc?.split(',').map((e: string) => e.trim()).filter(Boolean),
    subject: args.subject || '',
    body,
    quotedContent,
    type: draftType,
    inReplyTo,
    references,
    attachments,
  };
}

