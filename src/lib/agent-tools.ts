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

// Build quoted content for replies - includes the full conversation chain
export function buildReplyQuote(thread: EmailThread): string {
  if (thread.messages.length === 0) return '';
  
  // Build quotes from most recent to oldest (reverse order for display)
  // But in email convention, the most recent is at top with older nested below
  const quotes: string[] = [];
  
  // Start from the most recent message and go backwards
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const msg = thread.messages[i];
    const senderName = msg.from.name || msg.from.email;
    const date = formatQuoteDate(msg.date);
    
    // Add header and quoted body
    const quotedBody = msg.body
      .split('\n')
      .map(line => `> ${line}`)
      .join('\n');
    
    quotes.push(`On ${date}, ${senderName} wrote:\n${quotedBody}`);
  }
  
  // Join all quotes - most recent first
  return '\n\n' + quotes.join('\n\n');
}

// Build quoted content for forwards - includes full conversation chain
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
    
    parts.push(`---------- Forwarded message ----------
From: ${from}
Date: ${date}
Subject: ${msg.subject}
To: ${to}

${msg.body}`);
  }
  
  return '\n\n' + parts.join('\n\n');
}

// Build draft from tool call arguments
export function buildDraftFromToolCall(
  args: Record<string, any>,
  thread?: EmailThread
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
  
  return {
    threadId,
    to: args.to?.split(',').map((e: string) => e.trim()) || [],
    cc: args.cc?.split(',').map((e: string) => e.trim()).filter(Boolean),
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

