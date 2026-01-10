'use client';

import { db } from './firebase';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';
import { EmailDraft } from '@/types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A chat message that can be persisted to Firestore.
 * This is a simplified version of UIMessage that can be serialized.
 */
export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO string for serialization
  
  // Tool call data (for context)
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  
  // Draft data - fully preserved
  draft?: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    type: 'reply' | 'forward' | 'new';
    quotedContent?: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    gmailDraftId?: string; // ID of saved Gmail draft for updates
    attachments?: Array<{
      filename: string;
      mimeType: string;
      size: number;
      data?: string;
      isFromOriginal?: boolean;
      messageId?: string;
      attachmentId?: string;
    }>;
  };
  draftCancelled?: boolean;
  
  // System message data
  isSystemMessage?: boolean;
  systemType?: 'archived' | 'sent' | 'navigated' | 'context' | 'search';
  systemSnippet?: string;
  systemPreview?: string;
  
  // Search results
  searchResults?: Array<{
    type: 'web_search' | 'browse_url' | 'search_emails';
    query: string;
    success: boolean;
    resultPreview?: string;
  }>;
  
  // Action button state
  hasActionButtons?: boolean;
  actionButtonsHandled?: boolean;
}

/**
 * The full chat document stored in Firestore
 */
export interface ThreadChatDocument {
  messages: PersistedMessage[];
  lastUpdated: Timestamp;
  messageCount: number;
  lastMessagePreview: string;
}

// ============================================================================
// CONVERSION FUNCTIONS
// ============================================================================

/**
 * Convert a UI message to a persisted message (for saving)
 */
export function toPersistedMessage(msg: {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  draft?: EmailDraft;
  draftCancelled?: boolean;
  isSystemMessage?: boolean;
  systemType?: 'archived' | 'sent' | 'navigated' | 'context' | 'search';
  systemSnippet?: string;
  systemPreview?: string;
  searchResults?: Array<{ type: 'web_search' | 'browse_url' | 'search_emails'; query: string; success: boolean; resultPreview?: string }>;
  hasActionButtons?: boolean;
  actionButtonsHandled?: boolean;
}): PersistedMessage {
  const persisted: PersistedMessage = {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp.toISOString(),
  };

  if (msg.toolCalls && msg.toolCalls.length > 0) {
    persisted.toolCalls = msg.toolCalls;
  }

  if (msg.draft) {
    // Build draft object without undefined values (Firestore doesn't allow undefined)
    const draft: PersistedMessage['draft'] = {
      to: msg.draft.to,
      subject: msg.draft.subject,
      body: msg.draft.body,
      type: msg.draft.type,
    };
    
    // Only add optional fields if they have values
    if (msg.draft.cc && msg.draft.cc.length > 0) draft.cc = msg.draft.cc;
    if (msg.draft.bcc && msg.draft.bcc.length > 0) draft.bcc = msg.draft.bcc;
    if (msg.draft.quotedContent) draft.quotedContent = msg.draft.quotedContent;
    if (msg.draft.threadId) draft.threadId = msg.draft.threadId;
    if (msg.draft.inReplyTo) draft.inReplyTo = msg.draft.inReplyTo;
    if (msg.draft.references) draft.references = msg.draft.references;
    if (msg.draft.gmailDraftId) draft.gmailDraftId = msg.draft.gmailDraftId;
    if (msg.draft.attachments && msg.draft.attachments.length > 0) {
      draft.attachments = msg.draft.attachments.map(att => {
        const attachment: {
          filename: string;
          mimeType: string;
          size: number;
          data?: string;
          isFromOriginal?: boolean;
          messageId?: string;
          attachmentId?: string;
        } = {
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
        };
        if (att.data) attachment.data = att.data;
        if (att.isFromOriginal !== undefined) attachment.isFromOriginal = att.isFromOriginal;
        if (att.messageId) attachment.messageId = att.messageId;
        if (att.attachmentId) attachment.attachmentId = att.attachmentId;
        return attachment;
      });
    }
    
    persisted.draft = draft;
  }

  if (msg.draftCancelled) persisted.draftCancelled = true;
  if (msg.isSystemMessage) persisted.isSystemMessage = true;
  if (msg.systemType) persisted.systemType = msg.systemType;
  if (msg.systemSnippet) persisted.systemSnippet = msg.systemSnippet;
  if (msg.systemPreview) persisted.systemPreview = msg.systemPreview;
  if (msg.searchResults && msg.searchResults.length > 0) persisted.searchResults = msg.searchResults;
  if (msg.hasActionButtons) persisted.hasActionButtons = true;
  if (msg.actionButtonsHandled) persisted.actionButtonsHandled = true;

  return persisted;
}

/**
 * Convert a persisted message back to UI format (for loading)
 */
export function fromPersistedMessage(persisted: PersistedMessage): {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  draft?: EmailDraft;
  draftCancelled?: boolean;
  isSystemMessage?: boolean;
  systemType?: 'archived' | 'sent' | 'navigated' | 'context' | 'search';
  systemSnippet?: string;
  systemPreview?: string;
  searchResults?: Array<{ type: 'web_search' | 'browse_url' | 'search_emails'; query: string; success: boolean; resultPreview?: string }>;
  hasActionButtons?: boolean;
  actionButtonsHandled?: boolean;
} {
  const msg: ReturnType<typeof fromPersistedMessage> = {
    id: persisted.id,
    role: persisted.role,
    content: persisted.content,
    timestamp: new Date(persisted.timestamp),
  };

  if (persisted.toolCalls) msg.toolCalls = persisted.toolCalls;
  
  if (persisted.draft) {
    msg.draft = {
      to: persisted.draft.to,
      cc: persisted.draft.cc,
      bcc: persisted.draft.bcc,
      subject: persisted.draft.subject,
      body: persisted.draft.body,
      type: persisted.draft.type,
      quotedContent: persisted.draft.quotedContent,
      threadId: persisted.draft.threadId,
      inReplyTo: persisted.draft.inReplyTo,
      references: persisted.draft.references,
      gmailDraftId: persisted.draft.gmailDraftId,
      attachments: persisted.draft.attachments?.map(att => ({
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        data: att.data,
        isFromOriginal: att.isFromOriginal,
        messageId: att.messageId,
        attachmentId: att.attachmentId,
      })),
    };
  }

  if (persisted.draftCancelled) msg.draftCancelled = true;
  if (persisted.isSystemMessage) msg.isSystemMessage = true;
  if (persisted.systemType) msg.systemType = persisted.systemType;
  if (persisted.systemSnippet) msg.systemSnippet = persisted.systemSnippet;
  if (persisted.systemPreview) msg.systemPreview = persisted.systemPreview;
  if (persisted.searchResults) msg.searchResults = persisted.searchResults;
  if (persisted.hasActionButtons) msg.hasActionButtons = true;
  if (persisted.actionButtonsHandled) msg.actionButtonsHandled = true;

  return msg;
}

// ============================================================================
// FIRESTORE OPERATIONS
// ============================================================================

/**
 * Get the Firestore document reference for a thread's chat
 */
function getChatDocRef(userId: string, threadId: string) {
  return doc(db, 'users', userId, 'threadChats', threadId);
}

/**
 * Load chat history for a thread
 */
export async function loadThreadChat(
  userId: string, 
  threadId: string
): Promise<PersistedMessage[]> {
  try {
    const docRef = getChatDocRef(userId, threadId);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data() as ThreadChatDocument;
      return data.messages || [];
    }
    
    return [];
  } catch (error) {
    console.error('Failed to load thread chat:', error);
    return [];
  }
}

/**
 * Save/update the entire chat for a thread
 */
export async function saveThreadChat(
  userId: string,
  threadId: string,
  messages: PersistedMessage[]
): Promise<void> {
  try {
    const docRef = getChatDocRef(userId, threadId);
    
    // Get preview from last non-system message
    const lastContentMessage = [...messages]
      .reverse()
      .find(m => !m.isSystemMessage && m.content);
    const preview = lastContentMessage?.content.slice(0, 100) || '';
    
    const chatDoc: ThreadChatDocument = {
      messages,
      lastUpdated: Timestamp.now(),
      messageCount: messages.length,
      lastMessagePreview: preview,
    };
    
    await setDoc(docRef, chatDoc);
  } catch (error) {
    console.error('Failed to save thread chat:', error);
    throw error;
  }
}

/**
 * Append a single message to an existing chat (more efficient for real-time saving)
 */
export async function appendMessage(
  userId: string,
  threadId: string,
  message: PersistedMessage
): Promise<void> {
  try {
    const docRef = getChatDocRef(userId, threadId);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      // Append to existing messages
      const data = docSnap.data() as ThreadChatDocument;
      const updatedMessages = [...data.messages, message];
      
      await updateDoc(docRef, {
        messages: updatedMessages,
        lastUpdated: serverTimestamp(),
        messageCount: updatedMessages.length,
        lastMessagePreview: message.content?.slice(0, 100) || data.lastMessagePreview,
      });
    } else {
      // Create new document with single message
      await saveThreadChat(userId, threadId, [message]);
    }
  } catch (error) {
    console.error('Failed to append message:', error);
    throw error;
  }
}

/**
 * Clear chat history for a thread
 */
export async function clearThreadChat(
  userId: string,
  threadId: string
): Promise<void> {
  try {
    const docRef = getChatDocRef(userId, threadId);
    await setDoc(docRef, {
      messages: [],
      lastUpdated: Timestamp.now(),
      messageCount: 0,
      lastMessagePreview: '',
    });
  } catch (error) {
    console.error('Failed to clear thread chat:', error);
    throw error;
  }
}
