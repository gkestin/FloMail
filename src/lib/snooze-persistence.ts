'use client';

import { db } from './firebase';
import { 
  doc, 
  collection,
  getDoc, 
  setDoc, 
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A snoozed email record stored in Firestore
 */
export interface SnoozedEmail {
  id: string;              // Firestore doc ID (same as threadId for simplicity)
  threadId: string;        // Gmail thread ID
  userId: string;          // Firebase user ID
  snoozeUntil: Timestamp;  // When to unsnooze
  snoozedAt: Timestamp;    // When it was snoozed
  subject: string;         // For display in snoozed list
  snippet: string;         // Preview text
  senderName: string;      // Who sent the email
}

/**
 * Snooze time options for the picker
 */
export type SnoozeOption = 
  | 'later_today'      // 4 hours from now
  | 'tomorrow'         // Tomorrow at 1pm
  | 'this_weekend'     // Sunday at 1pm
  | 'in_30_minutes'    // 30 minutes from now
  | 'in_1_hour'        // 1 hour from now
  | 'in_3_hours'       // 3 hours from now
  | 'custom';          // User picks date/time

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate the unsnooze time based on the selected option
 */
export function calculateSnoozeUntil(option: SnoozeOption, customDate?: Date): Date {
  const now = new Date();
  
  switch (option) {
    case 'later_today': {
      // 4 hours from now
      return new Date(now.getTime() + 4 * 60 * 60 * 1000);
    }
    
    case 'tomorrow': {
      // Tomorrow at 1 PM
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(13, 0, 0, 0);
      return tomorrow;
    }
    
    case 'this_weekend': {
      // Sunday at 1 PM
      const sunday = new Date(now);
      const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
      sunday.setDate(now.getDate() + daysUntilSunday);
      sunday.setHours(13, 0, 0, 0);
      return sunday;
    }
    
    case 'in_30_minutes': {
      return new Date(now.getTime() + 30 * 60 * 1000);
    }
    
    case 'in_1_hour': {
      return new Date(now.getTime() + 60 * 60 * 1000);
    }
    
    case 'in_3_hours': {
      return new Date(now.getTime() + 3 * 60 * 60 * 1000);
    }
    
    case 'custom': {
      if (!customDate) {
        throw new Error('Custom date is required for custom snooze option');
      }
      return customDate;
    }
    
    default:
      throw new Error(`Unknown snooze option: ${option}`);
  }
}

/**
 * Format a snooze time for display
 */
export function formatSnoozeTime(date: Date): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const isToday = date.toDateString() === now.toDateString();
  const isTomorrow = date.toDateString() === tomorrow.toDateString();
  
  const timeStr = date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
  
  if (isToday) {
    return `Today, ${timeStr}`;
  } else if (isTomorrow) {
    return `Tomorrow, ${timeStr}`;
  } else {
    const dayStr = date.toLocaleDateString('en-US', { 
      weekday: 'short',
      month: 'short', 
      day: 'numeric' 
    });
    return `${dayStr}, ${timeStr}`;
  }
}

// ============================================================================
// FIRESTORE OPERATIONS
// ============================================================================

/**
 * Get the Firestore collection reference for snoozed emails
 */
function getSnoozedCollection(userId: string) {
  return collection(db, 'users', userId, 'snoozedEmails');
}

/**
 * Save a snoozed email to Firestore
 */
export async function saveSnoozedEmail(
  userId: string,
  threadId: string,
  snoozeUntil: Date,
  emailInfo: { subject: string; snippet: string; senderName: string }
): Promise<void> {
  const docRef = doc(getSnoozedCollection(userId), threadId);
  
  const snoozedEmail: Omit<SnoozedEmail, 'id'> = {
    threadId,
    userId,
    snoozeUntil: Timestamp.fromDate(snoozeUntil),
    snoozedAt: serverTimestamp() as Timestamp,
    subject: emailInfo.subject,
    snippet: emailInfo.snippet,
    senderName: emailInfo.senderName,
  };
  
  await setDoc(docRef, snoozedEmail);
}

/**
 * Get all snoozed emails for a user (for display in Snoozed folder)
 */
export async function getSnoozedEmails(userId: string): Promise<SnoozedEmail[]> {
  const q = query(
    getSnoozedCollection(userId),
    orderBy('snoozeUntil', 'asc')
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as SnoozedEmail));
}

/**
 * Get snoozed emails that are due to be unsnoozed
 */
export async function getExpiredSnoozes(userId: string): Promise<SnoozedEmail[]> {
  const now = Timestamp.now();
  
  const q = query(
    getSnoozedCollection(userId),
    where('snoozeUntil', '<=', now)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as SnoozedEmail));
}

/**
 * Delete a snoozed email record (after unsnoozing or canceling)
 */
export async function deleteSnoozedEmail(userId: string, threadId: string): Promise<void> {
  const docRef = doc(getSnoozedCollection(userId), threadId);
  await deleteDoc(docRef);
}

/**
 * Get a specific snoozed email
 */
export async function getSnoozedEmail(userId: string, threadId: string): Promise<SnoozedEmail | null> {
  const docRef = doc(getSnoozedCollection(userId), threadId);
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    return {
      id: docSnap.id,
      ...docSnap.data()
    } as SnoozedEmail;
  }
  
  return null;
}

/**
 * Check if a thread is snoozed
 */
export async function isThreadSnoozed(userId: string, threadId: string): Promise<boolean> {
  const snoozed = await getSnoozedEmail(userId, threadId);
  return snoozed !== null;
}

/**
 * Update snooze time for an already snoozed email
 */
export async function updateSnoozeTime(
  userId: string, 
  threadId: string, 
  newSnoozeUntil: Date
): Promise<void> {
  const docRef = doc(getSnoozedCollection(userId), threadId);
  await setDoc(docRef, {
    snoozeUntil: Timestamp.fromDate(newSnoozeUntil),
  }, { merge: true });
}

// ============================================================================
// RECENTLY UNSNOOZED TRACKING
// ============================================================================

/**
 * Recently unsnoozed email record
 * These are threads that were snoozed and have now returned to the inbox.
 * We track them temporarily (24 hours) to show the "Back!" badge.
 */
export interface RecentlyUnsnoozedEmail {
  id: string;
  threadId: string;
  userId: string;
  unsnoozedAt: Timestamp;
}

function getUnsnoozedCollection(userId: string) {
  return collection(db, 'users', userId, 'recentlyUnsnoozed');
}

/**
 * Mark a thread as recently unsnoozed
 */
export async function markAsUnsnoozed(userId: string, threadId: string): Promise<void> {
  try {
    const docRef = doc(getUnsnoozedCollection(userId), threadId);
    await setDoc(docRef, {
      threadId,
      userId,
      unsnoozedAt: serverTimestamp(),
    });
    console.log(`[Snooze] Marked thread ${threadId} as unsnoozed`);
  } catch (error) {
    console.error(`[Snooze] Failed to mark as unsnoozed:`, error);
    throw error;
  }
}

/**
 * Get all recently unsnoozed threads (within last 24 hours)
 */
export async function getRecentlyUnsnoozed(userId: string): Promise<RecentlyUnsnoozedEmail[]> {
  try {
    // Get all unsnoozed records, filter by time client-side to avoid index requirements
    const collectionRef = getUnsnoozedCollection(userId);
    const snapshot = await getDocs(collectionRef);
    
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    
    const results = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      } as RecentlyUnsnoozedEmail))
      .filter(item => {
        // Filter out entries older than 24 hours
        if (item.unsnoozedAt?.toDate) {
          return item.unsnoozedAt.toDate() >= cutoff;
        }
        return true; // Keep if no timestamp (recently added)
      });
    
    console.log(`[Snooze] Found ${results.length} recently unsnoozed threads`);
    return results;
  } catch (error) {
    console.error('[Snooze] Failed to get recently unsnoozed:', error);
    return [];
  }
}

/**
 * Clear the "Back!" status for a thread (when user dismisses or interacts with it)
 */
export async function clearUnsnoozedStatus(userId: string, threadId: string): Promise<void> {
  const docRef = doc(getUnsnoozedCollection(userId), threadId);
  await deleteDoc(docRef);
}

/**
 * Clean up old unsnoozed records (older than 24 hours)
 */
export async function cleanupOldUnsnoozed(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const q = query(
    getUnsnoozedCollection(userId),
    where('unsnoozedAt', '<', Timestamp.fromDate(cutoff))
  );
  
  const snapshot = await getDocs(q);
  await Promise.all(snapshot.docs.map(doc => deleteDoc(doc.ref)));
}
