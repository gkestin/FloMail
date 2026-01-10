/**
 * Mail Driver Types
 * 
 * This module defines the abstract interface for email providers.
 * Inspired by Zero's multi-provider architecture but simplified for FloMail.
 * 
 * Currently supports: Gmail
 * Future support: Outlook/Microsoft 365
 */

import { EmailThread, EmailMessage, EmailDraft, EmailAddress } from '@/types';

// ============================================================================
// PROVIDER TYPES
// ============================================================================

export type MailProvider = 'google' | 'microsoft';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface MailDriverConfig {
  provider: MailProvider;
  auth: {
    accessToken: string;
    refreshToken?: string;
    email: string;
  };
}

// ============================================================================
// PARSED EMAIL TYPES
// ============================================================================

export interface ParsedSender {
  name: string;
  email: string;
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  subject: string;
  sender: ParsedSender;
  to: ParsedSender[];
  cc: ParsedSender[] | null;
  bcc: ParsedSender[] | null;
  receivedOn: string;
  unread: boolean;
  body: string;
  bodyHtml: string;
  snippet: string;
  labels: string[];
  messageId?: string;        // RFC Message-ID header
  inReplyTo?: string;        // For threading
  references?: string;       // For threading
  replyTo?: string;          // Reply-To header
  listUnsubscribe?: string;  // List-Unsubscribe header
  listUnsubscribePost?: string; // List-Unsubscribe-Post header
  tls: boolean;              // Was sent with TLS
  attachments?: ParsedAttachment[];
  isDraft?: boolean;
}

export interface ParsedAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  headers?: { name: string; value: string }[];
}

export interface ParsedThread {
  id: string;
  messages: ParsedMessage[];
  latest?: ParsedMessage;
  hasUnread: boolean;
  totalReplies: number;
  labels: { id: string; name: string }[];
}

// ============================================================================
// OUTGOING MESSAGE
// ============================================================================

export interface OutgoingMessage {
  to: ParsedSender[];
  cc?: ParsedSender[];
  bcc?: ParsedSender[];
  subject: string;
  body: string;           // Plain text or HTML
  bodyHtml?: string;      // Explicit HTML version
  attachments?: OutgoingAttachment[];
  headers?: Record<string, string>;
  threadId?: string;      // For replies
  fromEmail?: string;     // Send from alias
  inReplyTo?: string;     // Message-ID we're replying to
  references?: string;    // Thread chain
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  data: string;  // Base64 encoded
  size: number;
}

// ============================================================================
// DRAFT TYPES
// ============================================================================

export interface DraftData {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  attachments?: OutgoingAttachment[];
  threadId?: string;
  fromEmail?: string;
}

export interface ParsedDraft {
  id: string;
  threadId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  createdAt?: string;
}

// ============================================================================
// LABEL TYPES
// ============================================================================

export interface MailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  color?: {
    backgroundColor: string;
    textColor: string;
  };
  messageCount?: number;
}

// ============================================================================
// LIST OPERATIONS
// ============================================================================

export interface ListParams {
  folder: string;
  query?: string;
  maxResults?: number;
  labelIds?: string[];
  pageToken?: string;
}

export interface ListResult {
  threads: { id: string; historyId: string | null }[];
  nextPageToken: string | null;
}

// ============================================================================
// UNSUBSCRIBE TYPES
// ============================================================================

export type ListUnsubscribeAction = 
  | { type: 'get'; url: string; host: string }
  | { type: 'post'; url: string; body: string; host: string }
  | { type: 'email'; emailAddress: string; subject: string; host: string };

// ============================================================================
// MAIL DRIVER INTERFACE
// ============================================================================

/**
 * Abstract interface for email providers.
 * All provider-specific implementations must implement this interface.
 */
export interface MailDriver {
  readonly provider: MailProvider;
  readonly config: MailDriverConfig;
  
  // --------------------------------------------
  // Thread Operations
  // --------------------------------------------
  
  /** Get a single thread with all messages */
  getThread(threadId: string): Promise<ParsedThread>;
  
  /** List threads in a folder */
  listThreads(params: ListParams): Promise<ListResult>;
  
  /** Search threads */
  searchThreads(query: string, maxResults?: number): Promise<ListResult>;
  
  // --------------------------------------------
  // Message Operations
  // --------------------------------------------
  
  /** Send an email */
  sendMessage(message: OutgoingMessage): Promise<{ id: string }>;
  
  /** Mark threads as read */
  markAsRead(threadIds: string[]): Promise<void>;
  
  /** Mark threads as unread */
  markAsUnread(threadIds: string[]): Promise<void>;
  
  /** Archive threads (remove from inbox) */
  archiveThreads(threadIds: string[]): Promise<void>;
  
  /** Move threads to trash */
  trashThreads(threadIds: string[]): Promise<void>;
  
  /** Modify thread labels */
  modifyLabels(threadIds: string[], options: {
    addLabels: string[];
    removeLabels: string[];
  }): Promise<void>;
  
  // --------------------------------------------
  // Draft Operations
  // --------------------------------------------
  
  /** Create a new draft */
  createDraft(data: DraftData): Promise<{ id: string }>;
  
  /** Update an existing draft */
  updateDraft(draftId: string, data: DraftData): Promise<{ id: string }>;
  
  /** Get a draft by ID */
  getDraft(draftId: string): Promise<ParsedDraft>;
  
  /** List all drafts */
  listDrafts(maxResults?: number): Promise<ParsedDraft[]>;
  
  /** Send a draft */
  sendDraft(draftId: string, message?: OutgoingMessage): Promise<{ id: string }>;
  
  /** Delete a draft */
  deleteDraft(draftId: string): Promise<void>;
  
  // --------------------------------------------
  // Attachment Operations
  // --------------------------------------------
  
  /** Get attachment data */
  getAttachment(messageId: string, attachmentId: string): Promise<string>;
  
  // --------------------------------------------
  // Label Operations
  // --------------------------------------------
  
  /** Get all labels */
  getLabels(): Promise<MailLabel[]>;
  
  /** Get a specific label */
  getLabel(labelId: string): Promise<MailLabel>;
  
  /** Create a new label */
  createLabel(name: string, color?: { backgroundColor: string; textColor: string }): Promise<MailLabel>;
  
  /** Update a label */
  updateLabel(labelId: string, updates: { name?: string; color?: { backgroundColor: string; textColor: string } }): Promise<MailLabel>;
  
  /** Delete a label */
  deleteLabel(labelId: string): Promise<void>;
  
  // --------------------------------------------
  // User Operations
  // --------------------------------------------
  
  /** Get email aliases */
  getEmailAliases(): Promise<{ email: string; name?: string; primary?: boolean }[]>;
  
  /** Get unread count */
  getUnreadCount(): Promise<number>;
}
