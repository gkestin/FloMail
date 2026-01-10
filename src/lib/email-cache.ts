/**
 * Email Cache - Smart caching for Gmail data
 * 
 * Features:
 * - Caches thread lists per folder with TTL
 * - Caches individual thread details
 * - Memory-efficient with LRU-style eviction
 * - Supports background refresh
 */

import { EmailThread } from '@/types';
import { MailFolder } from '@/components/InboxList';
import { GmailDraftInfo } from './gmail';
import { SnoozedEmail } from './snooze-persistence';

// Cache configuration
const FOLDER_CACHE_TTL = 2 * 60 * 1000; // 2 minutes for folder lists
const THREAD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes for individual threads
const MAX_CACHED_THREADS = 50; // Max individual threads to cache
const MAX_CACHED_FOLDERS = 6; // All folders we support

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface FolderCacheData {
  threads: EmailThread[];
  drafts?: GmailDraftInfo[];
  threadsWithDrafts?: Set<string>;
  snoozedEmails?: SnoozedEmail[];
}

class EmailCache {
  private folderCache: Map<MailFolder, CacheEntry<FolderCacheData>> = new Map();
  private threadCache: Map<string, CacheEntry<EmailThread>> = new Map();
  private threadAccessOrder: string[] = []; // For LRU eviction
  
  // ============================================
  // Folder Cache (thread lists)
  // ============================================
  
  /**
   * Get cached folder data if valid
   */
  getFolderData(folder: MailFolder): FolderCacheData | null {
    const entry = this.folderCache.get(folder);
    if (!entry) return null;
    
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      // Expired, but return stale data for background refresh pattern
      return null;
    }
    
    return entry.data;
  }
  
  /**
   * Get stale folder data (expired but available for immediate display)
   */
  getStaleFolderData(folder: MailFolder): FolderCacheData | null {
    const entry = this.folderCache.get(folder);
    if (!entry) return null;
    return entry.data;
  }
  
  /**
   * Check if folder cache is stale (expired but exists)
   */
  isFolderStale(folder: MailFolder): boolean {
    const entry = this.folderCache.get(folder);
    if (!entry) return true;
    
    const age = Date.now() - entry.timestamp;
    return age > entry.ttl;
  }
  
  /**
   * Set folder cache data
   */
  setFolderData(folder: MailFolder, data: FolderCacheData): void {
    this.folderCache.set(folder, {
      data,
      timestamp: Date.now(),
      ttl: FOLDER_CACHE_TTL,
    });
  }
  
  /**
   * Invalidate a folder's cache (e.g., after archiving)
   */
  invalidateFolder(folder: MailFolder): void {
    this.folderCache.delete(folder);
  }
  
  /**
   * Invalidate all folder caches (e.g., after sending email)
   */
  invalidateAllFolders(): void {
    this.folderCache.clear();
  }
  
  /**
   * Update a thread within cached folders (e.g., mark as read)
   */
  updateThreadInFolders(threadId: string, updater: (thread: EmailThread) => EmailThread): void {
    this.folderCache.forEach((entry, folder) => {
      const threadIndex = entry.data.threads.findIndex(t => t.id === threadId);
      if (threadIndex !== -1) {
        entry.data.threads[threadIndex] = updater(entry.data.threads[threadIndex]);
      }
    });
  }
  
  /**
   * Remove a thread from all cached folders (e.g., after archiving from inbox)
   */
  removeThreadFromFolder(folder: MailFolder, threadId: string): void {
    const entry = this.folderCache.get(folder);
    if (entry) {
      entry.data.threads = entry.data.threads.filter(t => t.id !== threadId);
    }
  }
  
  // ============================================
  // Thread Cache (individual thread details)
  // ============================================
  
  /**
   * Get cached thread if valid
   */
  getThread(threadId: string): EmailThread | null {
    const entry = this.threadCache.get(threadId);
    if (!entry) return null;
    
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      return null; // Expired
    }
    
    // Update access order for LRU
    this.updateAccessOrder(threadId);
    
    return entry.data;
  }
  
  /**
   * Get stale thread (for immediate display while refreshing)
   */
  getStaleThread(threadId: string): EmailThread | null {
    const entry = this.threadCache.get(threadId);
    if (!entry) return null;
    return entry.data;
  }
  
  /**
   * Set thread cache
   */
  setThread(thread: EmailThread): void {
    // Evict oldest if at capacity
    if (this.threadCache.size >= MAX_CACHED_THREADS && !this.threadCache.has(thread.id)) {
      this.evictOldestThread();
    }
    
    this.threadCache.set(thread.id, {
      data: thread,
      timestamp: Date.now(),
      ttl: THREAD_CACHE_TTL,
    });
    
    this.updateAccessOrder(thread.id);
  }
  
  /**
   * Cache multiple threads at once (from folder load)
   */
  setThreads(threads: EmailThread[]): void {
    threads.forEach(thread => {
      // Only cache if not already cached (preserve existing cache)
      if (!this.threadCache.has(thread.id)) {
        this.setThread(thread);
      }
    });
  }
  
  /**
   * Invalidate a specific thread
   */
  invalidateThread(threadId: string): void {
    this.threadCache.delete(threadId);
    this.threadAccessOrder = this.threadAccessOrder.filter(id => id !== threadId);
  }
  
  // ============================================
  // LRU Helpers
  // ============================================
  
  private updateAccessOrder(threadId: string): void {
    // Move to end (most recently accessed)
    this.threadAccessOrder = this.threadAccessOrder.filter(id => id !== threadId);
    this.threadAccessOrder.push(threadId);
  }
  
  private evictOldestThread(): void {
    if (this.threadAccessOrder.length === 0) return;
    
    const oldestId = this.threadAccessOrder.shift();
    if (oldestId) {
      this.threadCache.delete(oldestId);
    }
  }
  
  // ============================================
  // Cache Stats (for debugging)
  // ============================================
  
  getStats(): { folders: number; threads: number; oldestThread: number | null } {
    let oldestThread: number | null = null;
    
    this.threadCache.forEach(entry => {
      const age = Date.now() - entry.timestamp;
      if (oldestThread === null || age > oldestThread) {
        oldestThread = age;
      }
    });
    
    return {
      folders: this.folderCache.size,
      threads: this.threadCache.size,
      oldestThread: oldestThread ? Math.round(oldestThread / 1000) : null,
    };
  }
  
  /**
   * Clear all caches
   */
  clear(): void {
    this.folderCache.clear();
    this.threadCache.clear();
    this.threadAccessOrder = [];
  }
}

// Singleton instance
export const emailCache = new EmailCache();

