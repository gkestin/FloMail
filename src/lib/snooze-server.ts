// Server-side snooze utilities for API routes
// Uses firebase-admin style access via the standard Firebase client SDK
// Note: This works because Next.js API routes can use the Firebase client SDK

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, collection, getDoc, setDoc, deleteDoc, getDocs, query, where, orderBy, Timestamp } from 'firebase/firestore';

// Initialize Firebase for server-side use (reuse existing app if available)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

// ============================================================================
// TYPES (duplicated from client-side for server use)
// ============================================================================

export interface SnoozedEmail {
  id: string;
  threadId: string;
  userId: string;
  snoozeUntil: Timestamp;
  snoozedAt: Timestamp;
  subject: string;
  snippet: string;
  senderName: string;
}

export type SnoozeOption = 
  | 'later_today'
  | 'tomorrow'
  | 'this_weekend'
  | 'in_30_minutes'
  | 'in_1_hour'
  | 'in_3_hours'
  | 'custom';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

// ============================================================================
// FIRESTORE OPERATIONS (Server-side)
// ============================================================================

function getSnoozedCollection(userId: string) {
  return collection(db, 'users', userId, 'snoozedEmails');
}

export async function saveSnoozedEmailServer(
  userId: string,
  threadId: string,
  snoozeUntil: Date,
  emailInfo: { subject: string; snippet: string; senderName: string }
): Promise<void> {
  const docRef = doc(getSnoozedCollection(userId), threadId);
  
  await setDoc(docRef, {
    threadId,
    userId,
    snoozeUntil: Timestamp.fromDate(snoozeUntil),
    snoozedAt: Timestamp.now(),
    subject: emailInfo.subject,
    snippet: emailInfo.snippet,
    senderName: emailInfo.senderName,
  });
}

export async function getSnoozedEmailsServer(userId: string): Promise<SnoozedEmail[]> {
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

export async function getExpiredSnoozesServer(userId: string): Promise<SnoozedEmail[]> {
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

export async function deleteSnoozedEmailServer(userId: string, threadId: string): Promise<void> {
  const docRef = doc(getSnoozedCollection(userId), threadId);
  await deleteDoc(docRef);
}
