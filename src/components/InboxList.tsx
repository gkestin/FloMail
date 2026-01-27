'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo, animate } from 'framer-motion';
import { 
  RefreshCw, 
  Mail, 
  MailOpen, 
  Archive, 
  Loader2,
  Paperclip,
  Send,
  Inbox,
  Star,
  FolderOpen,
  FileEdit,
  Undo2,
  Check,
  Search,
  X,
  Clock,
  Bell,
  ShieldAlert
} from 'lucide-react';
import { EmailThread } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { fetchInbox, archiveThread, markAsRead, listGmailDrafts, GmailDraftInfo, getThreadsWithDrafts, fetchThread, moveToInbox, getSnoozedThreads, SNOOZE_LABEL_NAME, UNSNOOZED_LABEL_NAME, clearUnsnoozedLabel, hasSnoozedLabel, hasUnsnoozedLabel } from '@/lib/gmail';
import { getSnoozedEmails, SnoozedEmail, formatSnoozeTime, SnoozeOption, getRecentlyUnsnoozed, RecentlyUnsnoozedEmail } from '@/lib/snooze-persistence';
import { SnoozePicker } from './SnoozePicker';
import { emailCache } from '@/lib/email-cache';

// Available mail folders/views
export type MailFolder = 'inbox' | 'sent' | 'starred' | 'all' | 'drafts' | 'snoozed' | 'spam';

// Gmail API label configuration
// Note: Gmail uses LABELS not folders. "Archive" in Gmail simply means
// removing the INBOX label - archived emails appear in All Mail.
const FOLDER_CONFIG: Record<MailFolder, { 
  label: string; 
  labelIds?: string[];  // Gmail system label IDs (preferred)
  query?: string;       // Fallback search query
  icon: React.ElementType;
  isDrafts?: boolean;   // Special handling for drafts
  isSnoozed?: boolean;  // Special handling for snoozed
}> = {
  inbox: { label: 'Inbox', labelIds: ['INBOX'], icon: Inbox },
  sent: { label: 'Sent', labelIds: ['SENT'], icon: Send },
  drafts: { label: 'Drafts', labelIds: ['DRAFT'], icon: FileEdit, isDrafts: true },
  snoozed: { label: 'Snoozed', icon: Clock, isSnoozed: true },
  starred: { label: 'Starred', labelIds: ['STARRED'], icon: Star },
  spam: { label: 'Spam', labelIds: ['SPAM'], icon: ShieldAlert },
  all: { label: 'All Mail', icon: Mail }, // No filter = all mail
};

interface InboxListProps {
  onSelectThread: (thread: EmailThread, folder: MailFolder, folderThreads: EmailThread[]) => void;
  selectedThreadId?: string;
  defaultFolder?: MailFolder; // Folder to show when returning from email view
  searchQuery?: string; // Search query from parent
  onClearSearch?: () => void; // Callback to clear search
  onFolderChange?: (folder: MailFolder) => void; // Notify parent when folder changes
  onRegisterLoadMore?: (loadMore: () => Promise<void>, hasMore: () => boolean) => void; // Expose loadMore to parent
  onThreadsUpdate?: (threads: EmailThread[], folder: MailFolder) => void; // Notify parent when threads change
}

// Type for pending undo actions (archive with undo capability)
interface PendingUndo {
  id: string;
  threadId: string;
  subject: string;
  createdAt: number;
  duration: number;
}

export function InboxList({ onSelectThread, selectedThreadId, defaultFolder = 'inbox', searchQuery = '', onClearSearch, onFolderChange, onRegisterLoadMore, onThreadsUpdate }: InboxListProps) {
  const { getAccessToken, user } = useAuth();
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [drafts, setDrafts] = useState<GmailDraftInfo[]>([]);
  const [threadsWithDrafts, setThreadsWithDrafts] = useState<Set<string>>(new Set());
  const [snoozedEmailsData, setSnoozedEmailsData] = useState<SnoozedEmail[]>([]); // Snooze metadata from Firestore
  const [recentlyUnsnoozedData, setRecentlyUnsnoozedData] = useState<RecentlyUnsnoozedEmail[]>([]); // Recently unsnoozed threads
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false); // Loading next page
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<MailFolder>(defaultFolder);
  const loadMoreRef = useRef<HTMLDivElement>(null); // For intersection observer
  
  // Floating undo state - track archived threads that can be undone
  const [pendingUndos, setPendingUndos] = useState<PendingUndo[]>([]);
  const UNDO_DURATION = 5000; // 5 seconds to undo
  
  // Search state (query comes from parent, results managed here)
  const [searchResults, setSearchResults] = useState<EmailThread[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const isSearchActive = searchQuery.trim().length > 0;
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const pullStartY = useRef(0);
  const PULL_THRESHOLD = 80; // Distance needed to trigger refresh
  
  // Collapse animation state for swipe actions
  const [collapsingThreads, setCollapsingThreads] = useState<Record<string, { height: number; type: 'archive' | 'snooze' }>>({});
  const collapsingThreadsRef = useRef(collapsingThreads);
  const rowHeightsRef = useRef<Record<string, number>>({});
  const [pendingSnoozeHeights, setPendingSnoozeHeights] = useState<Record<string, number>>({});
  const pendingSnoozeHeightsRef = useRef(pendingSnoozeHeights);
  
  // Last refresh tracking for stale indicator
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
  const [isStale, setIsStale] = useState(false);
  const STALE_THRESHOLD = 10 * 60 * 1000; // 10 minutes in milliseconds
  const AUTO_REFRESH_INTERVAL = 3 * 60 * 1000; // 3 minutes - background refresh
  
  // Always skip entrance animations - they cause visual glitches and delays
  // Keeping this as a constant true instead of removing to minimize code changes
  const skipAnimation = true;

  // Sync with defaultFolder when returning from email view
  useEffect(() => {
    if (defaultFolder !== currentFolder) {
      setCurrentFolder(defaultFolder);
    }
  }, [defaultFolder]); // eslint-disable-line react-hooks/exhaustive-deps
  
  useEffect(() => {
    collapsingThreadsRef.current = collapsingThreads;
  }, [collapsingThreads]);
  
  useEffect(() => {
    pendingSnoozeHeightsRef.current = pendingSnoozeHeights;
  }, [pendingSnoozeHeights]);

  const loadFolder = useCallback(async (folder: MailFolder, forceRefresh = false) => {
    try {
      setError(null);
      
      // Check cache first (unless forcing refresh)
      if (!forceRefresh) {
        const cachedData = emailCache.getFolderData(folder);
        if (cachedData) {
          // Cache hit! Use cached data immediately
          setThreads(cachedData.threads);
          setDrafts(cachedData.drafts || []);
          setThreadsWithDrafts(cachedData.threadsWithDrafts || new Set());
          setNextPageToken(cachedData.nextPageToken); // Restore pagination token!
          // Restore snoozed emails data if present (for snoozed folder)
          if (cachedData.snoozedEmails) {
            setSnoozedEmailsData(cachedData.snoozedEmails);
          }
          setLoading(false);
          setRefreshing(false);
          return;
        }
        
        // Check for stale cache (show immediately, refresh in background)
        const staleData = emailCache.getStaleFolderData(folder);
        if (staleData) {
          setThreads(staleData.threads);
          setDrafts(staleData.drafts || []);
          setThreadsWithDrafts(staleData.threadsWithDrafts || new Set());
          setNextPageToken(staleData.nextPageToken); // Restore pagination token!
          // Restore snoozed emails data if present (for snoozed folder)
          if (staleData.snoozedEmails) {
            setSnoozedEmailsData(staleData.snoozedEmails);
          }
          setLoading(false);
          setRefreshing(true); // Show refresh indicator for background update
        } else {
          setLoading(true);
        }
      } else {
        setRefreshing(true);
      }

      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const config = FOLDER_CONFIG[folder];
      
      // Special handling for drafts folder
      if (config.isDrafts) {
        const draftList = await listGmailDrafts(token);
        setDrafts(draftList);
        setThreads([]);
        setSnoozedEmailsData([]);
        setRecentlyUnsnoozedData([]);
        
        // Cache the result
        emailCache.setFolderData(folder, { threads: [], drafts: draftList });
      } else if (config.isSnoozed) {
        // Special handling for snoozed folder
        // Get snoozed emails from both Gmail (by label) and Firestore (for snooze times)
        const [snoozedThreads, snoozedData] = await Promise.all([
          getSnoozedThreads(token),
          user?.uid ? getSnoozedEmails(user.uid).catch(() => []) : Promise.resolve([]),
        ]);
        setThreads(snoozedThreads);
        setSnoozedEmailsData(snoozedData);
        setRecentlyUnsnoozedData([]);
        setDrafts([]);
        setNextPageToken(undefined);
        
        // Cache the result
        emailCache.setFolderData(folder, { 
          threads: snoozedThreads,
          snoozedEmails: snoozedData 
        });
      } else {
        // Use labelIds when available (proper Gmail API approach), 
        // fall back to query for archive (which has no label)
        // Also load snoozed and recently unsnoozed data for badges
        const [threadsResult, draftThreadIds, snoozedResult, unsnoozedResult] = await Promise.all([
          fetchInbox(token, { 
            labelIds: config.labelIds,
            query: config.query 
          }),
          getThreadsWithDrafts(token),
          user?.uid ? getSnoozedEmails(user.uid).catch(() => []) : Promise.resolve([]),
          user?.uid ? getRecentlyUnsnoozed(user.uid).catch(() => []) : Promise.resolve([]),
        ]);
        
        const { threads: fetchedThreads, nextPageToken: pageToken } = threadsResult;
        
        setThreads(fetchedThreads);
        setThreadsWithDrafts(draftThreadIds);
        setNextPageToken(pageToken); // Store for "load more"
        setDrafts([]);
        setSnoozedEmailsData(snoozedResult);
        setRecentlyUnsnoozedData(unsnoozedResult);
        
        // Cache the result (including nextPageToken for pagination)
        emailCache.setFolderData(folder, { 
          threads: fetchedThreads, 
          threadsWithDrafts: draftThreadIds,
          nextPageToken: pageToken 
        });
        
        // Also cache individual threads for quick access when viewing
        emailCache.setThreads(fetchedThreads);
      }
    } catch (err: any) {
      console.error('Failed to load folder:', err);
      setError(err.message || 'Failed to load emails');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastRefreshTime(new Date());
      setIsStale(false);
    }
  }, [getAccessToken]);

  // Pull-to-refresh handlers (must be after loadFolder definition)
  const handlePullStart = useCallback((e: React.TouchEvent) => {
    const container = listContainerRef.current;
    if (!container || container.scrollTop > 5 || isPullRefreshing) return;
    
    pullStartY.current = e.touches[0].clientY;
    setIsPulling(true);
  }, [isPullRefreshing]);
  
  const handlePullMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling || isPullRefreshing) return;
    
    const container = listContainerRef.current;
    if (!container || container.scrollTop > 5) {
      setIsPulling(false);
      setPullDistance(0);
      return;
    }
    
    const deltaY = e.touches[0].clientY - pullStartY.current;
    if (deltaY > 0) {
      // Apply resistance as pull increases
      const resistance = Math.min(deltaY * 0.5, 120);
      setPullDistance(resistance);
    }
  }, [isPulling, isPullRefreshing]);
  
  const handlePullEnd = useCallback(async () => {
    if (!isPulling) return;
    
    if (pullDistance >= PULL_THRESHOLD && !isPullRefreshing) {
      // Trigger refresh
      setIsPullRefreshing(true);
      setPullDistance(PULL_THRESHOLD); // Keep at threshold during refresh
      
      try {
        await loadFolder(currentFolder, true);
      } finally {
        setIsPullRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
    
    setIsPulling(false);
  }, [isPulling, pullDistance, isPullRefreshing, loadFolder, currentFolder]);
  
  // Desktop scroll wheel handler for pull-to-refresh
  // Only triggers when user is already at top and deliberately scrolls up more
  const wheelAccumulatorRef = useRef(0);
  const wheelTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pullEligibleRef = useRef(false);
  const topIdleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const TOP_IDLE_DELAY = 80; // ms of no wheel activity at top before pull activates
  
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const container = listContainerRef.current;
    if (!container || isPullRefreshing) return;
    
    const isAtTop = container.scrollTop <= 0;
    
    if (!isAtTop) {
      pullEligibleRef.current = false;
      if (topIdleTimerRef.current) {
        clearTimeout(topIdleTimerRef.current);
      }
      wheelAccumulatorRef.current = 0;
      if (!isPullRefreshing) {
        setPullDistance(0);
      }
      return;
    }
    
    // If we just reached top, wait for a brief pause before enabling pull-to-refresh.
    // This avoids triggering during momentum scroll.
    if (!pullEligibleRef.current) {
      if (topIdleTimerRef.current) {
        clearTimeout(topIdleTimerRef.current);
      }
      topIdleTimerRef.current = setTimeout(() => {
        pullEligibleRef.current = true;
      }, TOP_IDLE_DELAY);
      return;
    }
    
    // Now we're definitely at top and intentionally scrolling up
    if (e.deltaY < 0) {
      // Accumulate upward scroll
      wheelAccumulatorRef.current -= e.deltaY;
      
      // Show pull indicator based on accumulated scroll
      const pullAmount = Math.min(wheelAccumulatorRef.current * 0.25, 100);
      setPullDistance(pullAmount);
      
      // Clear existing timeout
      if (wheelTimeoutRef.current) {
        clearTimeout(wheelTimeoutRef.current);
      }
      
      // After user stops scrolling, either refresh or reset
      wheelTimeoutRef.current = setTimeout(async () => {
        if (wheelAccumulatorRef.current > PULL_THRESHOLD * 2.5 && !isPullRefreshing) {
          // Trigger refresh
          setIsPullRefreshing(true);
          setPullDistance(PULL_THRESHOLD);
          
          try {
            await loadFolder(currentFolder, true);
          } finally {
            setIsPullRefreshing(false);
            setPullDistance(0);
            pullEligibleRef.current = false;
          }
        } else {
          setPullDistance(0);
          pullEligibleRef.current = false;
        }
        wheelAccumulatorRef.current = 0;
      }, 200);
    } else {
      // Scrolling down while at top shouldn't trigger refresh
      wheelAccumulatorRef.current = 0;
      if (!isPullRefreshing) {
        setPullDistance(0);
      }
      pullEligibleRef.current = false;
    }
  }, [isPullRefreshing, loadFolder, currentFolder]);

  useEffect(() => {
    loadFolder(currentFolder);
  }, [currentFolder, loadFolder]);
  
  // Stale data checking - every minute, check if data is older than 10 minutes
  useEffect(() => {
    const checkStale = () => {
      const now = Date.now();
      const lastRefresh = lastRefreshTime.getTime();
      setIsStale(now - lastRefresh > STALE_THRESHOLD);
    };
    
    const interval = setInterval(checkStale, 60 * 1000); // Check every minute
    return () => clearInterval(interval);
  }, [lastRefreshTime, STALE_THRESHOLD]);
  
  // Auto-refresh in background - every 3 minutes, silently refresh if visible and not loading
  useEffect(() => {
    const autoRefresh = async () => {
      // Only auto-refresh if page is visible and not already loading/refreshing
      if (document.visibilityState === 'visible' && !loading && !refreshing && !isPullRefreshing) {
        try {
          const token = await getAccessToken();
          if (!token) return;
          
          // Silently fetch new data without showing loading state
          const config = FOLDER_CONFIG[currentFolder];
          if (config.isDrafts || config.isSnoozed) return; // Skip special folders
          
          const { threads: freshThreads } = await fetchInbox(token, {
            labelIds: config.labelIds,
            query: config.query,
          });
          
          // Only update if we got results and threads have changed
          if (freshThreads.length > 0) {
            const currentIds = threads.map(t => t.id).join(',');
            const newIds = freshThreads.map(t => t.id).join(',');
            
            if (currentIds !== newIds) {
              setThreads(freshThreads);
              emailCache.setFolderData(currentFolder, {
                threads: freshThreads,
                drafts,
                threadsWithDrafts,
                nextPageToken: undefined,
              });
            }
          }
          
          setLastRefreshTime(new Date());
          setIsStale(false);
        } catch (err) {
          // Silent failure for auto-refresh
          console.error('Auto-refresh failed:', err);
        }
      }
    };
    
    const interval = setInterval(autoRefresh, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [getAccessToken, currentFolder, loading, refreshing, isPullRefreshing, threads, drafts, threadsWithDrafts, AUTO_REFRESH_INTERVAL]);

  // Search function - uses Gmail's powerful query syntax
  const performSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);

    try {
      const token = await getAccessToken();
      if (!token) return;

      // Use Gmail's search API with the query
      const { threads: results } = await fetchInbox(token, {
        query: query.trim(),
        maxResults: 30, // Show more results for search
      });

      setSearchResults(results);
    } catch (err) {
      console.error('Search failed:', err);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [getAccessToken]);

  // Watch for searchQuery changes from parent and trigger search
  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    // Debounce the search
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);
  }, [searchQuery, performSearch]);

  // Cleanup search timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Load more threads (next page)
  const loadMore = useCallback(async () => {
    if (loadingMore || !nextPageToken || FOLDER_CONFIG[currentFolder].isDrafts) return;
    
    try {
      setLoadingMore(true);
      
      const token = await getAccessToken();
      if (!token) return;
      
      const config = FOLDER_CONFIG[currentFolder];
      
      const { threads: moreThreads, nextPageToken: newPageToken } = await fetchInbox(token, {
        labelIds: config.labelIds,
        query: config.query,
        pageToken: nextPageToken,
      });
      
      // Append to existing threads
      const allThreads = [...threads, ...moreThreads];
      setThreads(allThreads);
      setNextPageToken(newPageToken);
      
      // Cache the individual threads
      emailCache.setThreads(moreThreads);
      
      // Update folder cache with all threads (including new pageToken)
      emailCache.setFolderData(currentFolder, {
        threads: allThreads,
        threadsWithDrafts,
        nextPageToken: newPageToken,
      });
      
      // Notify parent that threads have been updated
      onThreadsUpdate?.(allThreads, currentFolder);
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextPageToken, currentFolder, getAccessToken, threads, threadsWithDrafts, onThreadsUpdate]);

  // Register loadMore with parent so it can trigger loading more threads
  useEffect(() => {
    if (onRegisterLoadMore) {
      const hasMore = () => Boolean(nextPageToken && !FOLDER_CONFIG[currentFolder].isDrafts);
      onRegisterLoadMore(loadMore, hasMore);
    }
  }, [onRegisterLoadMore, loadMore, nextPageToken, currentFolder]);

  // Intersection Observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextPageToken && !loadingMore && !loading) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: '100px' } // Trigger when within 100px of bottom
    );
    
    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }
    
    return () => observer.disconnect();
  }, [nextPageToken, loadingMore, loading, loadMore]);

  const handleFolderChange = (folder: MailFolder) => {
    if (folder !== currentFolder) {
      // Check cache SYNCHRONOUSLY before changing folder
      // This prevents the flash of old threads
      const cachedData = emailCache.getFolderData(folder);
      const staleData = cachedData || emailCache.getStaleFolderData(folder);
      
      if (staleData) {
        // Update threads immediately with cached data (same render cycle)
        setThreads(staleData.threads);
        setDrafts(staleData.drafts || []);
        setThreadsWithDrafts(staleData.threadsWithDrafts || new Set());
        // Restore snoozed emails data if present (for snoozed folder)
        if (staleData.snoozedEmails) {
          setSnoozedEmailsData(staleData.snoozedEmails);
        }
        setLoading(false);
        
        // If data is stale (not fresh cache), set refreshing for background update
        if (!cachedData && staleData) {
          setRefreshing(true);
        }
      } else {
        // No cache at all - clear and show loading
        setThreads([]);
        setDrafts([]);
        setLoading(true);
      }
      
      // Reset pagination for new folder
      setNextPageToken(undefined);
      setCurrentFolder(folder);
      
      // Notify parent of folder change
      onFolderChange?.(folder);
    }
  };
  
  const rememberRowHeight = useCallback((threadId: string, height: number) => {
    if (height > 0) {
      rowHeightsRef.current[threadId] = height;
    }
  }, []);
  
  const startCollapse = useCallback((threadId: string, type: 'archive' | 'snooze', heightOverride?: number) => {
    setCollapsingThreads((prev) => {
      if (prev[threadId]) return prev;
      const height = heightOverride ?? rowHeightsRef.current[threadId] ?? 80;
      return { ...prev, [threadId]: { height, type } };
    });
  }, []);
  
  const finishCollapse = useCallback((threadId: string) => {
    setCollapsingThreads((prev) => {
      if (!prev[threadId]) return prev;
      const { [threadId]: _, ...rest } = prev;
      return rest;
    });
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
  }, []);

  const handleArchive = async (e: React.MouseEvent, threadId: string, threadSubject?: string) => {
    e.stopPropagation();
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      // Get thread info before removing
      const thread = threads.find(t => t.id === threadId);
      const subject = threadSubject || thread?.subject || '(No subject)';
      
      // Archive immediately (API call)
      await archiveThread(token, threadId);
      
      // Update cache: remove from current folder, invalidate all mail
      emailCache.removeThreadFromFolder(currentFolder, threadId);
      emailCache.invalidateFolder('all');
      
      // Ensure collapse animation starts even for non-swipe archive actions
      if (!collapsingThreadsRef.current[threadId]) {
        startCollapse(threadId, 'archive');
      }
      
      // Add floating undo button
      const undoId = `undo-${Date.now()}`;
      setPendingUndos(prev => [...prev, {
        id: undoId,
        threadId,
        subject,
        createdAt: Date.now(),
        duration: UNDO_DURATION,
      }]);
      
      // Auto-remove undo button after duration
      setTimeout(() => {
        setPendingUndos(prev => prev.filter(u => u.id !== undoId));
      }, UNDO_DURATION);
      
    } catch (err) {
      console.error('Failed to archive:', err);
    }
  };
  
  // Undo a single archive action
  const handleUndoSingleArchive = async (undoId: string, threadId: string) => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      // Move back to inbox
      await moveToInbox(token, threadId);
      
      // Remove the undo from list
      setPendingUndos(prev => prev.filter(u => u.id !== undoId));
      
      // Refresh if this was the last one
      emailCache.invalidateFolder(currentFolder);
      emailCache.invalidateFolder('inbox');
      await loadFolder(currentFolder, true);
      
    } catch (err) {
      console.error('Failed to undo archive:', err);
    }
  };
  
  // Undo all pending archives
  const handleUndoAllArchives = async () => {
    if (pendingUndos.length === 0) return;
    
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      // Move all back to inbox in parallel
      const undosToProcess = [...pendingUndos];
      await Promise.all(
        undosToProcess.map(undo => moveToInbox(token, undo.threadId))
      );
      
      // Clear all pending undos
      setPendingUndos([]);
      
      // Refresh the list once
      emailCache.invalidateFolder(currentFolder);
      emailCache.invalidateFolder('inbox');
      await loadFolder(currentFolder, true);
      
    } catch (err) {
      console.error('Failed to undo archives:', err);
    }
  };

  const handleMoveToInbox = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      await moveToInbox(token, threadId);
      
      // Update the thread's labels locally to reflect the change
      setThreads((prev) => prev.map((t) => 
        t.id === threadId 
          ? { ...t, labels: [...(t.labels || []), 'INBOX'] }
          : t
      ));
      
      // Invalidate inbox cache since we added to it
      emailCache.invalidateFolder('inbox');
    } catch (err) {
      console.error('Failed to move to inbox:', err);
    }
  };

  // Snooze state
  const [snoozePickerOpen, setSnoozePickerOpen] = useState(false);
  const [snoozeTargetThread, setSnoozeTargetThread] = useState<EmailThread | null>(null);
  const [snoozeLoading, setSnoozeLoading] = useState(false);
  const [snoozeCancelledId, setSnoozeCancelledId] = useState<string | null>(null); // Track which thread's snooze was cancelled

  const handleOpenSnoozePicker = (e: React.MouseEvent, thread: EmailThread) => {
    e.stopPropagation();
    setSnoozeTargetThread(thread);
    setSnoozeCancelledId(null); // Reset cancelled state
    setSnoozePickerOpen(true);
  };
  
  const handleCloseSnoozePickerWithCancel = () => {
    if (!snoozeLoading) {
      // Mark this thread's snooze as cancelled so SwipeableEmailRow can reset
      if (snoozeTargetThread) {
        setSnoozeCancelledId(snoozeTargetThread.id);
        setPendingSnoozeHeights((prev) => {
          const { [snoozeTargetThread.id]: _, ...rest } = prev;
          return rest;
        });
      }
      setSnoozePickerOpen(false);
      setSnoozeTargetThread(null);
    }
  };

  const handleSnooze = async (option: SnoozeOption, customDate?: Date) => {
    if (!snoozeTargetThread || !user?.uid) return;
    
    setSnoozeLoading(true);
    
    try {
      const token = await getAccessToken();
      if (!token) return;

      // Save last snooze option for "repeat" feature
      const { saveLastSnooze } = await import('./SnoozePicker');
      saveLastSnooze(option, customDate);

      // Get thread info for the snooze record
      const lastMessage = snoozeTargetThread.messages[snoozeTargetThread.messages.length - 1];
      const emailInfo = {
        subject: snoozeTargetThread.subject || '(No subject)',
        snippet: snoozeTargetThread.snippet || '',
        senderName: lastMessage?.from?.name || lastMessage?.from?.email || 'Unknown',
      };

      // Call the snooze API (handles Gmail labels)
      const response = await fetch('/api/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'snooze',
          threadId: snoozeTargetThread.id,
          accessToken: token,
          snoozeOption: option,
          customDate: customDate?.toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to snooze');
      }

      const data = await response.json();
      
      // Save to Firestore client-side (where auth context is available)
      const { saveSnoozedEmail } = await import('@/lib/snooze-persistence');
      await saveSnoozedEmail(user.uid, snoozeTargetThread.id, new Date(data.snoozeUntil), emailInfo);

      // Update behavior based on current folder
      if (currentFolder === 'all') {
        // In All Mail: update thread labels to show snoozed status (don't remove)
        setThreads((prev) => prev.map((t) => 
          t.id === snoozeTargetThread.id 
            ? { ...t, labels: [...(t.labels || []).filter(l => l !== 'INBOX'), SNOOZE_LABEL_NAME] }
            : t
        ));
        // Clear any pending swipe height
        setPendingSnoozeHeights((prev) => {
          const { [snoozeTargetThread.id]: _, ...rest } = prev;
          return rest;
        });
      } else {
        // In Inbox or other folders: remove from current view
        const pendingHeight = pendingSnoozeHeightsRef.current[snoozeTargetThread.id];
        startCollapse(snoozeTargetThread.id, 'snooze', pendingHeight);
        emailCache.removeThreadFromFolder(currentFolder, snoozeTargetThread.id);
        setPendingSnoozeHeights((prev) => {
          const { [snoozeTargetThread.id]: _, ...rest } = prev;
          return rest;
        });
      }
      
      // Invalidate snoozed folder cache
      emailCache.invalidateFolder('snoozed');
      
      // Close picker - clear cancelled ID since this was a success
      setSnoozePickerOpen(false);
      setSnoozeTargetThread(null);
      setSnoozeCancelledId(null);
    } catch (err) {
      console.error('Failed to snooze:', err);
      // On error, treat like cancel - reset the row
      if (snoozeTargetThread) {
        setSnoozeCancelledId(snoozeTargetThread.id);
        setPendingSnoozeHeights((prev) => {
          const { [snoozeTargetThread.id]: _, ...rest } = prev;
          return rest;
        });
      }
    } finally {
      setSnoozeLoading(false);
    }
  };

  const handleSelect = async (thread: EmailThread) => {
    // Pass the current folder's threads so navigation stays within this folder
    onSelectThread(thread, currentFolder, threads);
    
    if (!thread.isRead) {
      try {
        const token = await getAccessToken();
        if (token) {
          await markAsRead(token, thread.id);
          setThreads((prev) =>
            prev.map((t) =>
              t.id === thread.id ? { ...t, isRead: true } : t
            )
          );
          
          // Update cache to reflect read status
          emailCache.updateThreadInFolders(thread.id, t => ({ ...t, isRead: true }));
        }
      } catch (err) {
        console.error('Failed to mark as read:', err);
      }
    }
  };

  // Handle clicking on a draft - fetch the full thread and all draft threads for navigation
  const handleDraftSelect = async (draft: GmailDraftInfo) => {
    if (!draft.threadId) {
      console.error('Draft has no threadId:', draft);
      return;
    }
    
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      // Fetch all draft threads for navigation
      // Get unique threadIds from all drafts
      const threadIds = [...new Set(drafts.filter(d => d.threadId).map(d => d.threadId as string))];
      
      // Fetch all draft threads in parallel
      const draftThreads = await Promise.all(
        threadIds.map(tid => fetchThread(token, tid))
      );
      
      // Find the clicked thread (it's one of the fetched threads)
      const clickedThread = draftThreads.find(t => t.id === draft.threadId) || draftThreads[0];
      
      // Open the thread with all draft threads for navigation
      onSelectThread(clickedThread, currentFolder, draftThreads);
    } catch (err) {
      console.error('Failed to open draft thread:', err);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Gmail-ish: the left side primarily reads as "who sent the most recent message".
  // (Thread headers can still show participants elsewhere if desired.)
  const getSenderNames = (thread: EmailThread) => {
    const last = thread.messages[thread.messages.length - 1];
    if (!last) return 'Unknown';
    return last.from.name || last.from.email.split('@')[0] || 'Unknown';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--bg-primary)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center" style={{ background: 'var(--bg-primary)' }}>
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => loadFolder(currentFolder)}
          className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  const FolderIcon = FOLDER_CONFIG[currentFolder].icon;
  
  // Define tab order explicitly: Inbox → Sent → Drafts → Snoozed → Starred → Spam → All Mail
  const FOLDER_ORDER: MailFolder[] = ['inbox', 'sent', 'drafts', 'snoozed', 'starred', 'spam', 'all'];

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-sidebar)' }}>
      {/* Folder tabs - hidden when search is active */}
      {!isSearchActive && (
      <div className="flex items-center gap-1 px-2 py-2.5 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        {FOLDER_ORDER.map((folder) => {
          const config = FOLDER_CONFIG[folder];
          const Icon = config.icon;
          const isActive = folder === currentFolder;
          
          return (
            <button
              key={folder}
              onClick={() => handleFolderChange(folder)}
              className="flex items-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-all"
              style={isActive ? {
                padding: '8px 16px',
                background: 'rgba(59, 130, 246, 0.2)',
                color: 'rgb(147, 197, 253)',
                border: '1px solid rgba(59, 130, 246, 0.4)',
                fontSize: '1rem',
              } : {
                padding: '6px 12px',
                fontSize: '0.875rem',
                color: 'var(--text-secondary)',
                background: 'transparent',
              }}
            >
              <Icon className={isActive ? 'w-5 h-5' : 'w-4 h-4'} />
              {config.label}
            </button>
          );
        })}
        
        {/* Refresh button - at the end */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => loadFolder(currentFolder, true)}
          disabled={refreshing}
          className="ml-auto p-2 rounded-lg transition-colors flex-shrink-0"
          style={{ color: 'var(--text-muted)' }}
        >
          <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
        </motion.button>
      </div>
      )}

      {/* Search results header */}
      {isSearchActive && (
        <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2">
            {isSearching && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {isSearching ? 'Searching...' : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`}
            </span>
          </div>
          <button
            onClick={onClearSearch}
            className="text-xs px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-accent-blue)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Email List */}
      <div 
        ref={listContainerRef}
        className="flex-1 overflow-y-auto" 
        style={{ background: 'var(--bg-primary)' }}
        onTouchStart={handlePullStart}
        onTouchMove={handlePullMove}
        onTouchEnd={handlePullEnd}
        onWheel={handleWheel}
      >
        {/* Pull-to-refresh indicator */}
        <AnimatePresence>
          {(pullDistance > 0 || isPullRefreshing) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ 
                height: isPullRefreshing ? 50 : pullDistance, 
                opacity: pullDistance > 20 || isPullRefreshing ? 1 : 0.5 
              }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: isPullRefreshing ? 0.2 : 0 }}
              className="flex items-center justify-center overflow-hidden"
              style={{ background: 'var(--bg-secondary)' }}
            >
              <motion.div
                animate={{ rotate: isPullRefreshing ? 360 : (pullDistance / PULL_THRESHOLD) * 180 }}
                transition={isPullRefreshing ? { duration: 1, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
              >
                <RefreshCw 
                  className={`w-5 h-5 ${pullDistance >= PULL_THRESHOLD || isPullRefreshing ? 'text-blue-400' : ''}`}
                  style={{ color: pullDistance >= PULL_THRESHOLD || isPullRefreshing ? undefined : 'var(--text-muted)' }}
                />
              </motion.div>
              {isPullRefreshing && (
                <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>Refreshing...</span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Stale data banner - shows when data is older than 10 minutes */}
        <AnimatePresence>
          {isStale && !loading && !refreshing && !isPullRefreshing && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-3 py-2 text-center overflow-hidden"
              style={{ background: 'rgba(251, 191, 36, 0.1)', borderBottom: '1px solid rgba(251, 191, 36, 0.2)' }}
            >
              <button
                onClick={() => loadFolder(currentFolder, true)}
                className="text-xs hover:underline"
                style={{ color: 'rgba(251, 191, 36, 0.8)' }}
              >
                Last refreshed {Math.round((Date.now() - lastRefreshTime.getTime()) / 60000)} min ago • Pull down to refresh
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Search Results */}
        {isSearchActive ? (
          searchResults.length === 0 && !isSearching ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <Search className="w-12 h-12 mb-4" style={{ color: 'var(--text-disabled)' }} />
              <p style={{ color: 'var(--text-secondary)' }}>No results found</p>
              <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                Try different keywords or Gmail search operators
              </p>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {['from:', 'to:', 'subject:', 'has:attachment', 'is:unread'].map(op => (
                  <span
                    key={op}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ background: 'var(--bg-interactive)', color: 'var(--text-secondary)' }}
                  >
                    {op}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div>
              {searchResults.map((thread, index) => {
                // Only show "Inbox" badge for messages in inbox
                const isInInbox = thread.labels?.includes('INBOX');
                
                // Check snooze status using Firestore data
                const snoozeData = snoozedEmailsData.find(s => s.threadId === thread.id);
                const isThreadSnoozed = !!snoozeData;
                
                // Check if recently unsnoozed using Firestore data
                const isThreadUnsnoozed = recentlyUnsnoozedData.some(u => u.threadId === thread.id);
                
                // Build appropriate label badge
                let searchLabelBadge = null;
                if (isThreadSnoozed) {
                  searchLabelBadge = (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'rgba(251, 191, 36, 0.15)', color: 'rgb(251, 191, 36)' }}>
                      Snoozed
                    </span>
                  );
                } else if (isThreadUnsnoozed) {
                  searchLabelBadge = (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'rgba(251, 191, 36, 0.15)', color: 'rgb(251, 191, 36)' }}>
                      Unsnoozed
                    </span>
                  );
                } else if (isInInbox) {
                  searchLabelBadge = (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ 
                      background: 'rgba(59, 130, 246, 0.2)',
                      color: 'rgb(147, 197, 253)'
                    }}>
                      Inbox
                    </span>
                  );
                }
                
                const collapseInfo = collapsingThreads[thread.id];
                if (collapseInfo) {
                  return (
                    <CollapseRow
                      key={thread.id}
                      height={collapseInfo.height}
                      color={collapseInfo.type === 'archive' ? 'rgb(34, 197, 94)' : 'rgb(245, 158, 11)'}
                      onComplete={() => finishCollapse(thread.id)}
                    />
                  );
                }
                
                return (
                  <SwipeableEmailRow
                    key={thread.id}
                    thread={thread}
                    index={index}
                    isSelected={selectedThreadId === thread.id}
                    hasDraft={threadsWithDrafts.has(thread.id)}
                    skipAnimation={skipAnimation}
                    isInInbox={isInInbox}
                    isUnsnoozed={isThreadUnsnoozed}
                    snoozeCancelled={snoozeCancelledId === thread.id}
                    onSelect={() => {
                      // For search results, pass them as the folder threads
                      onSelectThread(thread, 'all', searchResults);
                    }}
                    onArchive={(e) => handleArchive(e, thread.id)}
                    onMoveToInbox={(e) => handleMoveToInbox(e, thread.id)}
                    onSnooze={(e) => handleOpenSnoozePicker(e, thread)}
                    onCollapseStart={(height, type) => startCollapse(thread.id, type, height)}
                    onSnoozePendingHeight={(height) => {
                      setPendingSnoozeHeights((prev) => ({ ...prev, [thread.id]: height }));
                    }}
                    onMeasureHeight={(height) => rememberRowHeight(thread.id, height)}
                    getSenderNames={getSenderNames}
                    formatDate={formatDate}
                    labelBadge={searchLabelBadge}
                  />
                );
              })}
            </div>
          )
        ) : currentFolder === 'drafts' ? (
          drafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <FileEdit className="w-12 h-12 mb-4" style={{ color: 'var(--text-disabled)' }} />
              <p style={{ color: 'var(--text-secondary)' }}>No drafts</p>
            </div>
          ) : (
            <div>
              {drafts.map((draft, index) => (
                <motion.div
                  key={draft.id}
                  initial={skipAnimation ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={skipAnimation ? { duration: 0 } : { delay: index * 0.02 }}
                  className="px-4 py-3 cursor-pointer transition-colors"
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onClick={() => handleDraftSelect(draft)}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-1">
                      <div className="p-1.5 rounded bg-amber-500/20">
                        <FileEdit className="w-4 h-4 text-amber-400" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-amber-400 font-medium">DRAFT</span>
                        <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                          To: {draft.to.length > 0 ? draft.to.join(', ') : '(no recipient)'}
                        </span>
                      </div>
                      <div className="text-sm font-medium truncate mt-0.5" style={{ color: 'var(--text-primary)' }}>
                        {draft.subject || '(No Subject)'}
                      </div>
                      <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {draft.snippet}
                      </div>
                    </div>
                    <div className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {formatDate(draft.date)}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <FolderIcon className="w-12 h-12 mb-4" style={{ color: 'var(--text-disabled)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>No emails in {FOLDER_CONFIG[currentFolder].label.toLowerCase()}</p>
          </div>
        ) : (
          <AnimatePresence>
            {threads.map((thread, index) => {
              // Determine if thread is in inbox (by folder or by labels)
              const threadInInbox = currentFolder === 'inbox' || thread.labels?.includes('INBOX');
              const threadIsSnoozed = currentFolder === 'snoozed';
              
              // Check snooze status using Firestore data (more reliable than Gmail labels)
              const snoozeData = snoozedEmailsData.find(s => s.threadId === thread.id);
              const isThreadSnoozed = !!snoozeData;
              const snoozeUntilStr = snoozeData 
                ? formatSnoozeTime(snoozeData.snoozeUntil.toDate())
                : undefined;
              
              // Check if recently unsnoozed using Firestore data
              const isThreadUnsnoozed = recentlyUnsnoozedData.some(u => u.threadId === thread.id);
              
              // Build label badge for special labels in All Mail/search
              // Also show "Unsnoozed" in inbox for recently unsnoozed threads
              let labelBadge = null;
              if (currentFolder === 'inbox' && isThreadUnsnoozed) {
                // Show "Unsnoozed" badge in inbox for recently unsnoozed threads
                labelBadge = (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ background: 'rgba(251, 191, 36, 0.15)', color: 'rgb(251, 191, 36)' }}>
                    Unsnoozed
                  </span>
                );
              } else if (currentFolder === 'all' || searchQuery) {
                if (isThreadSnoozed) {
                  // Show Snoozed badge for snoozed threads
                  labelBadge = (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'rgba(251, 191, 36, 0.15)', color: 'rgb(251, 191, 36)' }}>
                      Snoozed
                    </span>
                  );
                } else if (isThreadUnsnoozed) {
                  // Show Unsnoozed badge for recently unsnoozed threads
                  labelBadge = (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'rgba(251, 191, 36, 0.15)', color: 'rgb(251, 191, 36)' }}>
                      Unsnoozed
                    </span>
                  );
                } else if (thread.labels?.includes('INBOX')) {
                  labelBadge = (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ background: 'var(--bg-interactive-blue)', color: 'var(--text-accent-blue)' }}>
                      Inbox
                    </span>
                  );
                }
              }
              
              const collapseInfo = collapsingThreads[thread.id];
              if (collapseInfo) {
                return (
                  <CollapseRow
                    key={thread.id}
                    height={collapseInfo.height}
                    color={collapseInfo.type === 'archive' ? 'rgb(34, 197, 94)' : 'rgb(245, 158, 11)'}
                    onComplete={() => finishCollapse(thread.id)}
                  />
                );
              }
              
              return (
                <SwipeableEmailRow
                  key={thread.id}
                  thread={thread}
                  index={index}
                  isSelected={selectedThreadId === thread.id}
                  hasDraft={threadsWithDrafts.has(thread.id)}
                  skipAnimation={skipAnimation}
                  isInInbox={threadInInbox}
                  isSnoozed={threadIsSnoozed}
                  snoozeUntil={snoozeUntilStr}
                  isUnsnoozed={isThreadUnsnoozed}
                  snoozeCancelled={snoozeCancelledId === thread.id}
                  onSelect={() => handleSelect(thread)}
                  onArchive={(e) => handleArchive(e, thread.id)}
                  onMoveToInbox={(e) => handleMoveToInbox(e, thread.id)}
                  onSnooze={(e) => handleOpenSnoozePicker(e, thread)}
                  onCollapseStart={(height, type) => startCollapse(thread.id, type, height)}
                  onSnoozePendingHeight={(height) => {
                    setPendingSnoozeHeights((prev) => ({ ...prev, [thread.id]: height }));
                  }}
                  onMeasureHeight={(height) => rememberRowHeight(thread.id, height)}
                  getSenderNames={getSenderNames}
                  formatDate={formatDate}
                  labelBadge={labelBadge}
                />
              );
            })}
          </AnimatePresence>
        )}
        
        {/* Infinite scroll sentinel and loading indicator */}
        {!loading && threads.length > 0 && (
          <div ref={loadMoreRef} className="py-4 flex justify-center">
            {loadingMore ? (
              <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading more...</span>
              </div>
            ) : nextPageToken ? (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Scroll for more
              </div>
            ) : threads.length > 30 ? (
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                All {threads.length} emails loaded
              </div>
            ) : null}
          </div>
        )}
      </div>
      
      {/* Undo Banner - Fixed at bottom, doesn't scroll with list */}
      <AnimatePresence>
        {pendingUndos.length > 0 && (() => {
          // Calculate time remaining for progress bar based on oldest pending undo
          const oldestUndo = pendingUndos.reduce((oldest, current) => 
            current.createdAt < oldest.createdAt ? current : oldest
          );
          const elapsed = Date.now() - oldestUndo.createdAt;
          const remaining = Math.max(0, UNDO_DURATION - elapsed);
          const progressPercent = (remaining / UNDO_DURATION) * 100;
          
          return (
            <motion.div
              key="undo-banner"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="absolute bottom-0 left-0 right-0 z-50 px-3 pb-3 pt-2"
              style={{ 
                background: 'linear-gradient(to top, var(--bg-primary) 70%, transparent)',
                pointerEvents: 'none'
              }}
            >
              <motion.div 
                className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl"
                style={{ 
                  background: 'var(--bg-elevated)', 
                  border: '1px solid var(--border-subtle)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
                  pointerEvents: 'auto'
                }}
              >
                {/* Left side: Message */}
                <div className="flex items-center gap-2 min-w-0">
                  <Archive className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                    {pendingUndos.length === 1 
                      ? 'Conversation archived' 
                      : `${pendingUndos.length} conversations archived`}
                  </span>
                </div>
                
                {/* Right side: Undo button with subtle progress indicator */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleUndoAllArchives}
                  className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors overflow-hidden"
                  style={{ 
                    background: 'var(--bg-interactive)',
                    color: 'var(--text-accent-blue)'
                  }}
                >
                  {/* Progress bar underneath - starts from remaining time */}
                  <motion.div
                    key={oldestUndo.id} // Reset animation when oldest changes
                    className="absolute bottom-0 left-0 h-0.5 rounded-full"
                    style={{ background: 'var(--text-accent-blue)', opacity: 0.4 }}
                    initial={{ width: `${progressPercent}%` }}
                    animate={{ width: '0%' }}
                    transition={{ duration: remaining / 1000, ease: 'linear' }}
                  />
                  <Undo2 className="w-3.5 h-3.5" />
                  <span className="text-sm font-medium">Undo</span>
                </motion.button>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
      
      {/* Snooze Picker Modal */}
      <SnoozePicker
        isOpen={snoozePickerOpen}
        onClose={handleCloseSnoozePickerWithCancel}
        onSelect={handleSnooze}
        isLoading={snoozeLoading}
      />
    </div>
  );
}

function CollapseRow({
  height,
  color,
  onComplete,
}: {
  height: number;
  color: string;
  onComplete: () => void;
}) {
  return (
    <motion.div
      initial={{ height }}
      animate={{ height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="overflow-hidden"
      style={{ background: color }}
      onAnimationComplete={onComplete}
    />
  );
}

// Swipeable email row component
interface SwipeableEmailRowProps {
  thread: EmailThread;
  index: number;
  isSelected: boolean;
  hasDraft?: boolean; // Whether this thread has a draft
  skipAnimation?: boolean; // Skip entrance animation (for cached data)
  isInInbox?: boolean; // Whether this thread is currently in inbox
  isSnoozed?: boolean; // Whether this thread is snoozed
  snoozeUntil?: string; // When the snooze expires (formatted string)
  isUnsnoozed?: boolean; // Whether this thread just returned from snooze
  snoozeCancelled?: boolean; // Reset swipe when snooze picker is cancelled
  onSelect: () => void;
  onArchive: (e: React.MouseEvent) => void;
  onMoveToInbox?: (e: React.MouseEvent) => void; // For moving archived emails back to inbox
  onSnooze?: (e: React.MouseEvent) => void; // For snoozing emails
  onCollapseStart?: (height: number, type: 'archive' | 'snooze') => void;
  onSnoozePendingHeight?: (height: number) => void;
  onMeasureHeight?: (height: number) => void;
  getSenderNames: (thread: EmailThread) => string;
  formatDate: (date: string) => string;
  labelBadge?: React.ReactNode; // Optional label badge for search results
}

function SwipeableEmailRow({
  thread,
  index,
  isSelected,
  hasDraft,
  skipAnimation,
  isInInbox = true,
  isSnoozed,
  snoozeUntil,
  isUnsnoozed,
  snoozeCancelled,
  onSelect,
  onArchive,
  onMoveToInbox,
  onSnooze,
  onCollapseStart,
  onSnoozePendingHeight,
  onMeasureHeight,
  getSenderNames,
  formatDate,
  labelBadge,
}: SwipeableEmailRowProps) {
  const x = useMotionValue(0);
  const [swipeState, setSwipeState] = useState<'idle' | 'snooze-pending'>('idle');
  const hasDragged = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const SWIPE_THRESHOLD = -100; // Threshold to trigger archive
  const SNOOZE_THRESHOLD = 100; // Right swipe threshold for snooze
  
  // Reset swipe state when snooze is cancelled
  useEffect(() => {
    if (snoozeCancelled && swipeState === 'snooze-pending') {
      setSwipeState('idle');
      animate(x, 0, { type: 'spring', stiffness: 300, damping: 25 });
    }
  }, [snoozeCancelled, swipeState, x]);
  
  useEffect(() => {
    if (containerRef.current) {
      onMeasureHeight?.(containerRef.current.offsetHeight);
    }
  }, [onMeasureHeight, thread.id]);
  
  // Get container width for calculations
  const getContainerWidth = () => containerRef.current?.offsetWidth || 400;
  
  // Smooth transforms for visual feedback (left swipe = archive)
  // Icon stays pinned to edge, moves with content after threshold
  const archiveBgOpacity = useTransform(x, [-200, -60, 0], [1, 0.6, 0]);
  const archiveIconScale = useTransform(x, [-150, -80, 0], [1.2, 1, 0.8]);
  
  // Right swipe = snooze
  const snoozeBgOpacity = useTransform(x, [0, 60, 200], [0, 0.6, 1]);
  const snoozeIconScale = useTransform(x, [0, 80, 150], [0.8, 1, 1.2]);
  
  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const velocity = info.velocity.x;
    const offset = info.offset.x;
    
    // More responsive thresholds - consider velocity for quick flicks
    const shouldArchive = offset < SWIPE_THRESHOLD || 
                          (offset < -60 && velocity < -300);
    const shouldSnooze = isInInbox && onSnooze && (
                          offset > SNOOZE_THRESHOLD || 
                          (offset > 60 && velocity > 300));
    
    if (shouldArchive) {
      // Animate slide off screen to the left, then archive
      const containerWidth = getContainerWidth();
      animate(x, -containerWidth - 20, { type: 'tween', duration: 0.15, ease: 'easeOut' }).then(() => {
        const height = containerRef.current?.offsetHeight || 80;
        onCollapseStart?.(height, 'archive');
        onArchive({ stopPropagation: () => {} } as React.MouseEvent);
      });
    } else if (shouldSnooze) {
      // Mark as pending snooze (waiting for picker), slide off screen
      const containerWidth = getContainerWidth();
      animate(x, containerWidth + 20, { type: 'tween', duration: 0.15, ease: 'easeOut' }).then(() => {
        setSwipeState('snooze-pending');
        const height = containerRef.current?.offsetHeight || 80;
        onSnoozePendingHeight?.(height);
        onSnooze?.({ stopPropagation: () => {} } as React.MouseEvent);
      });
    } else {
      // Snap back with smooth spring
      animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 });
    }
    
    // Reset drag tracking after a brief delay
    setTimeout(() => {
      hasDragged.current = false;
    }, 100);
  };
  
  const handleDragStart = () => {
    hasDragged.current = true;
  };
  
  const handleClick = () => {
    // Only trigger select if we didn't just drag
    if (!hasDragged.current) {
      onSelect();
    }
  };
  
  // Snooze pending - keep off screen but don't collapse (waiting for picker result)
  // The snoozeCancelled prop will reset this state

  return (
    <motion.div
      ref={containerRef}
      initial={skipAnimation ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={skipAnimation ? { duration: 0 } : { delay: index * 0.02 }}
      className="relative overflow-hidden"
    >
      {/* Snooze action background (revealed on right swipe) */}
      {isInInbox && onSnooze && (
        <motion.div 
          className="absolute inset-0 flex items-center justify-start pl-6"
          style={{ 
            opacity: snoozeBgOpacity,
            background: 'linear-gradient(90deg, rgb(251 191 36) 0%, rgb(245 158 11) 100%)'
          }}
        >
          <motion.div 
            style={{ scale: snoozeIconScale }}
            className="flex items-center gap-2"
          >
            <Clock className="w-6 h-6 text-white drop-shadow-sm" />
            <span className="text-white text-sm font-semibold drop-shadow-sm">
              Snooze
            </span>
          </motion.div>
        </motion.div>
      )}
      
      {/* Archive action background (revealed on left swipe) */}
      <motion.div 
        className="absolute inset-0 flex items-center justify-end pr-6"
        style={{ 
          opacity: archiveBgOpacity,
          background: 'linear-gradient(270deg, rgb(22 163 74) 0%, rgb(21 128 61) 100%)'
        }}
      >
        <motion.div 
          style={{ scale: archiveIconScale }}
          className="flex items-center gap-2"
        >
          <span className="text-white text-sm font-semibold drop-shadow-sm">
            Archive
          </span>
          <Archive className="w-6 h-6 text-white drop-shadow-sm" />
        </motion.div>
      </motion.div>
      
      {/* Swipeable content - follows finger with no hard constraints */}
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }} // No hard constraints - elastic handles resistance
        dragElastic={{ left: 0.6, right: isInInbox && onSnooze ? 0.6 : 0.1 }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ 
          x,
          background: isSelected 
            ? 'rgba(168, 85, 247, 0.08)' 
            : !thread.isRead 
              ? 'var(--bg-elevated)' 
              : 'var(--bg-primary)'
        }}
        whileDrag={{ cursor: 'grabbing' }}
        onClick={handleClick}
        className="relative cursor-pointer transition-colors touch-pan-y select-none"
      >
        {/* Mobile: py-4 for more breathing room, Desktop: py-3 */}
        <div className="flex items-start gap-3 px-4 py-4 sm:py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {/* Avatar with sender initial - colored circle */}
          {(() => {
            const senderName = getSenderNames(thread);
            const senderInitial = senderName.charAt(0).toUpperCase();
            const senderEmail = thread.messages[thread.messages.length - 1]?.from?.email || '';
            const colors = [
              'from-purple-500 to-pink-500',
              'from-cyan-500 to-blue-500',
              'from-green-500 to-emerald-500',
              'from-orange-500 to-red-500',
              'from-indigo-500 to-purple-500',
              'from-rose-500 to-orange-500',
              'from-teal-500 to-cyan-500',
              'from-amber-500 to-orange-500',
            ];
            const hash = senderEmail.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
            const avatarColor = colors[hash % colors.length];
            
            return (
              <div 
                className={`flex-shrink-0 w-10 h-10 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br ${avatarColor} flex items-center justify-center shadow-sm ${!thread.isRead ? 'ring-2 ring-blue-400/50' : ''}`}
              >
                <span className="text-white font-semibold text-sm sm:text-xs">{senderInitial}</span>
              </div>
            );
          })()}

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Mobile layout: Sender + metadata on row 1, Subject on row 2 */}
            {/* Desktop layout: Sender | Subject + metadata on row 1 */}
            
            {/* Row 1: Sender name with time/metadata */}
            <div className="flex items-center justify-between gap-2 mb-0.5">
              {/* Left side: sender + count + draft */}
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`text-sm truncate ${!thread.isRead ? 'font-bold' : 'font-medium'}`}
                  style={{ color: !thread.isRead ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                >
                  {getSenderNames(thread)}
                </span>
                {thread.messages.length > 1 && (
                  <span className={`text-xs ${!thread.isRead ? 'font-semibold' : 'font-medium'}`} style={{ color: 'var(--text-muted)' }}>
                    ({thread.messages.length})
                  </span>
                )}
                {hasDraft && (
                  <span className="text-xs font-semibold text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded">
                    Draft
                  </span>
                )}
                {/* Labels appear after sender, left-justified (like Draft badge) */}
                {labelBadge}
              </div>
              
              {/* Right side metadata */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* In snoozed folder, show snooze time instead of date */}
                {isSnoozed && snoozeUntil ? (
                  <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded" 
                    style={{ background: 'rgba(251, 191, 36, 0.15)', color: 'rgb(251, 191, 36)' }}>
                    <Clock className="w-3 h-3" />
                    {snoozeUntil}
                  </span>
                ) : (
                  <span className={`text-xs ${!thread.isRead ? 'font-medium' : ''}`} style={{ color: 'var(--text-muted)' }}>
                    {formatDate(thread.lastMessageDate)}
                  </span>
                )}
              </div>
            </div>
            
            {/* Row 2: Subject line - dedicated row, bold for unread */}
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className={`truncate text-sm ${!thread.isRead ? 'font-semibold' : ''}`}
                style={{ color: 'var(--text-primary)' }}
              >
                {thread.subject || '(No Subject)'}
              </span>
              {/* Attachment indicator - more prominent */}
              {thread.messages.some(m => m.hasAttachments) && (
                <span className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs" 
                  style={{ background: 'var(--bg-interactive)', color: 'var(--text-muted)' }}>
                  <Paperclip className="w-3 h-3" />
                </span>
              )}
              {/* FloMail Snoozed label - only show when NOT in snoozed folder view */}
              {hasSnoozedLabel(thread) && !isSnoozed && (
                <span className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs"
                  style={{ background: 'rgba(251, 191, 36, 0.15)', color: 'rgb(251, 191, 36)' }}>
                  <Clock className="w-3 h-3" />
                  <span>Snoozed</span>
                </span>
              )}
              {/* FloMail Unsnoozed label (just returned from snooze) */}
              {hasUnsnoozedLabel(thread) && (
                <span className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs"
                  style={{ background: 'rgba(34, 197, 94, 0.15)', color: 'rgb(34, 197, 94)' }}>
                  <Bell className="w-3 h-3" />
                  <span>Unsnoozed</span>
                </span>
              )}
            </div>
            
            {/* Row 3: Snippet preview */}
            <p className={`text-xs truncate ${!thread.isRead ? 'text-slate-400' : ''}`} style={{ color: 'var(--text-secondary)' }}>
              {thread.snippet}
            </p>
          </div>

          {/* Action buttons - hidden on mobile (use swipe gestures) */}
          <div className="hidden sm:flex items-center gap-1 self-center">
            {/* Snooze button (for inbox emails) */}
            {isInInbox && onSnooze && (
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSnooze(e);
                }}
                className="p-2 rounded-lg transition-colors hover:bg-amber-500/20 hover:text-amber-400"
                style={{ background: 'var(--bg-interactive)', color: 'var(--text-muted)' }}
                title="Snooze"
              >
                <Clock className="w-4 h-4" />
              </motion.button>
            )}
            
            {/* Archive button (for inbox emails) */}
            {isInInbox && !isSnoozed ? (
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                  e.stopPropagation();
                  // Archive immediately - floating undo button will appear
                  onArchive(e);
                }}
                className="p-2 rounded-lg transition-colors hover:bg-blue-500/20 hover:text-blue-400"
                style={{ background: 'var(--bg-interactive)', color: 'var(--text-muted)' }}
                title="Archive"
              >
                <Archive className="w-4 h-4" />
              </motion.button>
            ) : !isInInbox && onMoveToInbox && (
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveToInbox(e);
                }}
                className="p-2 rounded-lg transition-colors hover:bg-blue-500/20 hover:text-blue-400"
                style={{ background: 'var(--bg-interactive)', color: 'var(--text-muted)' }}
                title="Move to Inbox"
              >
                <Inbox className="w-4 h-4" />
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

