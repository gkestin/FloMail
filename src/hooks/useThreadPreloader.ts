'use client';

import { useEffect, useRef, useCallback } from 'react';
import { EmailThread } from '@/types';
import { fetchThread } from '@/lib/gmail';
import { emailCache } from '@/lib/email-cache';

interface ThreadCache {
  [threadId: string]: EmailThread;
}

/**
 * Hook to preload adjacent threads for seamless navigation
 * Caches the previous and next threads to enable instant transitions
 */
export function useThreadPreloader(
  currentThread: EmailThread | null,
  threads: EmailThread[],
  getAccessToken: () => Promise<string | null>
) {
  const cache = useRef<ThreadCache>({});
  const loadingRef = useRef<Set<string>>(new Set());

  // Preload a thread if not already cached
  const preloadThread = useCallback(async (threadId: string) => {
    // Skip if already cached or currently loading
    if (cache.current[threadId] || loadingRef.current.has(threadId)) {
      return;
    }

    // Check if we have it in the email cache first
    const cached = emailCache.getThread(threadId);
    if (cached) {
      cache.current[threadId] = cached;
      return;
    }

    // Mark as loading
    loadingRef.current.add(threadId);

    try {
      const token = await getAccessToken();
      if (token) {
        const fullThread = await fetchThread(token, threadId);
        if (fullThread) {
          cache.current[threadId] = fullThread;
          // Also store in email cache for consistency
          emailCache.setThread(threadId, fullThread);
        }
      }
    } catch (error) {
      console.error('Failed to preload thread:', error);
    } finally {
      loadingRef.current.delete(threadId);
    }
  }, [getAccessToken]);

  // Preload adjacent threads when current thread changes
  useEffect(() => {
    if (!currentThread || threads.length === 0) return;

    const currentIndex = threads.findIndex(t => t.id === currentThread.id);
    if (currentIndex === -1) return;

    // Cache current thread
    cache.current[currentThread.id] = currentThread;

    // Preload previous thread
    if (currentIndex > 0) {
      const prevThread = threads[currentIndex - 1];
      preloadThread(prevThread.id);
    }

    // Preload next thread
    if (currentIndex < threads.length - 1) {
      const nextThread = threads[currentIndex + 1];
      preloadThread(nextThread.id);
    }

    // Preload 2 threads ahead for even smoother experience
    if (currentIndex < threads.length - 2) {
      const nextNextThread = threads[currentIndex + 2];
      setTimeout(() => preloadThread(nextNextThread.id), 500);
    }
  }, [currentThread, threads, preloadThread]);

  // Get a cached thread or return partial data
  const getCachedThread = useCallback((threadId: string): EmailThread | null => {
    return cache.current[threadId] || emailCache.getThread(threadId) || null;
  }, []);

  // Clear cache when unmounting or when threads change significantly
  useEffect(() => {
    return () => {
      cache.current = {};
      loadingRef.current.clear();
    };
  }, []);

  return { getCachedThread, preloadThread };
}