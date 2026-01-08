// Email Types
export interface EmailMessage {
  id: string;
  threadId: string;
  messageId?: string; // RFC Message-ID header (for threading)
  snippet: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  date: string;
  body: string;
  bodyHtml?: string;
  isRead: boolean;
  labels: string[];
  hasAttachments?: boolean;
  attachments?: Attachment[];
}

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface EmailThread {
  id: string;
  messages: EmailMessage[];
  subject: string;
  snippet: string;
  lastMessageDate: string;
  participants: EmailAddress[];
  isRead: boolean;
  labels: string[];
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

// Draft attachment - can be from original email or newly added
export interface DraftAttachment {
  // For existing attachments (from Gmail)
  messageId?: string;       // The message this attachment came from
  attachmentId?: string;    // Gmail attachment ID (for fetching)
  // For new attachments (uploaded by user)
  data?: string;            // Base64 encoded content
  // Common fields
  filename: string;
  mimeType: string;
  size: number;
  // UI state
  isFromOriginal?: boolean; // True if from reply/forward source
}

// Draft Types
export type EmailDraftType = 'reply' | 'forward' | 'new';

export interface EmailDraft {
  id?: string;
  threadId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;           // The new content written by user/AI
  quotedContent?: string; // Previous message(s) quoted below
  type: EmailDraftType;
  inReplyTo?: string;     // The Message-ID of the email being replied to
  references?: string;    // Chain of Message-IDs for threading
  attachments?: DraftAttachment[]; // Attachments to include
}

// Chat Types
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    draft?: EmailDraft;
    action?: 'draft' | 'send' | 'archive' | 'summarize';
  };
}

export interface ChatSession {
  id: string;
  emailThreadId?: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

// User Types
export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  accessToken?: string;
  refreshToken?: string;
}

// AI Provider Types
export type AIProvider = 'openai' | 'anthropic';

export interface AIConfig {
  provider: AIProvider;
  model: string;
}

// Voice Recording Types
export interface VoiceRecording {
  blob: Blob;
  duration: number;
  url: string;
}

