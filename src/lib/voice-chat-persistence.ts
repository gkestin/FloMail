'use client';

import { db } from './firebase';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  Timestamp,
} from 'firebase/firestore';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single voice message persisted to Firestore.
 * Each message belongs to a session (continuous voice conversation)
 * and is stored under the thread it was about.
 */
export interface PersistedVoiceMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO string
  sessionId: string; // Groups messages from the same continuous voice session
  isToolAction?: boolean;
  toolName?: string;
}

/**
 * Firestore document for a thread's voice history.
 * Stored at: /users/{userId}/voiceChats/{threadId}
 */
export interface VoiceChatDocument {
  messages: PersistedVoiceMessage[];
  lastUpdated: Timestamp;
  messageCount: number;
  lastMessagePreview: string;
  lastSessionId: string;
  lastEmailMessageId?: string; // Tracks the latest Gmail message ID to detect new emails
}

// ============================================================================
// HELPERS
// ============================================================================

function getVoiceChatDocRef(userId: string, threadId: string) {
  return doc(db, 'users', userId, 'voiceChats', threadId);
}

/**
 * Generate a session ID for a new voice conversation.
 * Format: vs_{timestamp}_{random} — human-readable and unique.
 */
export function generateSessionId(): string {
  return `vs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================================================
// FIRESTORE OPERATIONS
// ============================================================================

export interface VoiceChatLoadResult {
  messages: PersistedVoiceMessage[];
  lastEmailMessageId?: string;
}

/**
 * Load voice chat history for a specific thread.
 */
export async function loadVoiceChat(
  userId: string,
  threadId: string
): Promise<VoiceChatLoadResult> {
  try {
    const docRef = getVoiceChatDocRef(userId, threadId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data() as VoiceChatDocument;
      return {
        messages: data.messages || [],
        lastEmailMessageId: data.lastEmailMessageId,
      };
    }
    return { messages: [] };
  } catch (error) {
    console.error('[VoiceChat] Failed to load:', error);
    return { messages: [] };
  }
}

/**
 * Save voice messages for a thread.
 * Appends new messages (by sessionId) to any existing history,
 * avoiding duplicates by checking message IDs.
 */
export async function saveVoiceChat(
  userId: string,
  threadId: string,
  newMessages: PersistedVoiceMessage[],
  lastEmailMessageId?: string
): Promise<void> {
  if (!newMessages.length) return;

  try {
    const docRef = getVoiceChatDocRef(userId, threadId);
    const docSnap = await getDoc(docRef);

    let allMessages: PersistedVoiceMessage[];

    if (docSnap.exists()) {
      const existing = (docSnap.data() as VoiceChatDocument).messages || [];
      // Merge: add only messages whose IDs don't already exist
      const existingIds = new Set(existing.map((m) => m.id));
      const toAdd = newMessages.filter((m) => !existingIds.has(m.id));
      allMessages = [...existing, ...toAdd];
    } else {
      allMessages = newMessages;
    }

    const lastMsg = allMessages[allMessages.length - 1];
    const preview = lastMsg?.content?.slice(0, 100) || '';

    const chatDoc: VoiceChatDocument = {
      messages: allMessages,
      lastUpdated: Timestamp.now(),
      messageCount: allMessages.length,
      lastMessagePreview: preview,
      lastSessionId: lastMsg?.sessionId || '',
    };
    if (lastEmailMessageId) {
      chatDoc.lastEmailMessageId = lastEmailMessageId;
    }

    await setDoc(docRef, chatDoc);
  } catch (error) {
    console.error('[VoiceChat] Failed to save:', error);
  }
}

/**
 * Clear voice chat history for a specific thread.
 */
export async function clearVoiceChat(
  userId: string,
  threadId: string
): Promise<void> {
  try {
    const docRef = getVoiceChatDocRef(userId, threadId);
    await deleteDoc(docRef);
  } catch (error) {
    console.error('[VoiceChat] Failed to clear:', error);
  }
}

/**
 * Check if voice history exists for a single thread.
 */
export async function hasVoiceHistory(
  userId: string,
  threadId: string
): Promise<boolean> {
  try {
    const docRef = getVoiceChatDocRef(userId, threadId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) return false;
    const data = docSnap.data() as VoiceChatDocument;
    return (data.messageCount || 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Batch check: which of these thread IDs have voice history?
 * Returns a Set of thread IDs that have saved voice chats.
 * Uses individual doc reads (Firestore doesn't support IN queries on doc IDs
 * across subcollections efficiently), but we limit to small batches.
 */
export async function getThreadsWithVoiceHistory(
  userId: string,
  threadIds: string[]
): Promise<Set<string>> {
  const result = new Set<string>();
  if (!threadIds.length) return result;

  // Batch reads in groups of 10 to avoid hammering Firestore
  const BATCH = 10;
  for (let i = 0; i < threadIds.length; i += BATCH) {
    const batch = threadIds.slice(i, i + BATCH);
    const promises = batch.map(async (tid) => {
      try {
        const docRef = getVoiceChatDocRef(userId, tid);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data() as VoiceChatDocument;
          if ((data.messageCount || 0) > 0) {
            result.add(tid);
          }
        }
      } catch {
        // Skip failures
      }
    });
    await Promise.all(promises);
  }

  return result;
}

// ============================================================================
// SEGMENTATION — split a live session's messages by thread
// ============================================================================

/**
 * Given a flat list of voice messages from a live session (which may span
 * multiple threads via context switches), segment them by thread ID.
 *
 * Uses context switch messages and an initial thread ID to assign each
 * message to its thread. Context switch messages themselves are excluded
 * from the saved history (they're only useful in the live UI).
 *
 * @param messages - All messages from the current session
 * @param initialThreadId - The thread ID when the session started
 * @param sessionId - The session ID to stamp on each message
 * @returns Map of threadId → messages for that thread
 */
export function segmentMessagesByThread(
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    isToolAction?: boolean;
    toolName?: string;
    isContextSwitch?: boolean;
    _threadId?: string; // If explicitly tagged
  }>,
  initialThreadId: string | undefined,
  sessionId: string
): Map<string, PersistedVoiceMessage[]> {
  const segments = new Map<string, PersistedVoiceMessage[]>();
  let currentThreadId = initialThreadId;

  for (const msg of messages) {
    // Context switch message — update current thread, don't save the divider
    if (msg.isContextSwitch) {
      // The _threadId on subsequent messages will reflect the new thread,
      // but we can also pick up the thread ID from explicit tagging
      if (msg._threadId) {
        currentThreadId = msg._threadId;
      }
      continue;
    }

    // Use explicit thread tag if available, otherwise current
    const threadId = msg._threadId || currentThreadId;
    if (!threadId) continue;

    if (!segments.has(threadId)) {
      segments.set(threadId, []);
    }

    const persisted: PersistedVoiceMessage = {
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp.toISOString(),
      sessionId,
    };
    if (msg.isToolAction) persisted.isToolAction = true;
    if (msg.toolName) persisted.toolName = msg.toolName;

    segments.get(threadId)!.push(persisted);
  }

  return segments;
}
