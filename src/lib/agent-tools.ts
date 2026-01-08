import { EmailThread, EmailDraft } from '@/types';

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
    description: 'Prepare an email draft for the user to review before sending. Call this when the user wants to draft, compose, write, reply, or forward an email. This will show the draft in a UI card with recipient, subject, and body for user confirmation.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type of email: "reply" (responding to current thread), "forward" (forwarding current thread), or "new" (composing a new email)',
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
          description: 'The full email body text',
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
    description: 'Archive the current email thread, removing it from the inbox. Call when user wants to archive, done with, or move on from current email.',
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
    name: 'go_to_next_email',
    description: 'Navigate to the next unread email in the inbox. Call when user says "next", "next email", "move on", or similar.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'go_to_inbox',
    description: 'Return to the inbox view. Call when user wants to see their inbox, go back, or browse emails.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
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

// Build draft from tool call arguments
export function buildDraftFromToolCall(
  args: Record<string, any>,
  thread?: EmailThread
): EmailDraft {
  const draftType = args.type || 'new';
  const lastMessage = thread?.messages[thread.messages.length - 1];
  
  // For replies and forwards, set up proper threading
  let inReplyTo: string | undefined;
  let references: string | undefined;
  let threadId: string | undefined;
  
  if (draftType === 'reply' && thread && lastMessage) {
    threadId = thread.id;
    // Use the Message-ID header for proper RFC 2822 threading
    inReplyTo = lastMessage.messageId;
    // Build references chain from all messages in thread
    references = thread.messages
      .map(m => m.messageId)
      .filter(Boolean)
      .join(' ');
  } else if (draftType === 'forward' && thread && lastMessage) {
    // Forwards stay in the same thread so you can see the complete history
    threadId = thread.id;
    // For forwards, we reference the original message but don't set In-Reply-To
    // (since we're not replying, we're forwarding)
    references = thread.messages
      .map(m => m.messageId)
      .filter(Boolean)
      .join(' ');
  }
  // For 'new', no threading headers needed
  
  return {
    threadId,
    to: args.to?.split(',').map((e: string) => e.trim()) || [],
    cc: args.cc?.split(',').map((e: string) => e.trim()).filter(Boolean),
    bcc: args.bcc?.split(',').map((e: string) => e.trim()).filter(Boolean),
    subject: args.subject || '',
    body: args.body || '',
    type: draftType,
    inReplyTo,
    references,
  };
}

