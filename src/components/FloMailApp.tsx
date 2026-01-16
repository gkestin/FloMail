'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
// URL state sync uses native browser history API
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { LoginScreen } from './LoginScreen';
import { InboxList, MailFolder } from './InboxList';
import { ChatInterface } from './ChatInterface';
import { EmailThread, EmailDraft, AIProvider } from '@/types';
import { Loader2, LogOut, User, ArrowLeft, ChevronLeft, ChevronRight, Archive, Search, X, Clock, ChevronDown, Settings, Plus, Pencil } from 'lucide-react';
import { OPENAI_MODELS } from '@/lib/openai';
import { CLAUDE_MODELS } from '@/lib/anthropic';
import { sendEmail, archiveThread, getAttachment, createGmailDraft, updateGmailDraft, hasSnoozedLabel, fetchThread, fetchInbox } from '@/lib/gmail';
import { emailCache } from '@/lib/email-cache';
import { DraftAttachment } from '@/types';
import { SnoozePicker } from './SnoozePicker';
import { SnoozeOption } from '@/lib/snooze-persistence';

import { User as UserType } from '@/types';

// Valid folder names for URL
const VALID_FOLDERS: MailFolder[] = ['inbox', 'sent', 'drafts', 'snoozed', 'starred', 'all'];

type View = 'inbox' | 'chat';

// User avatar component with fallback
function UserAvatar({ user }: { user: UserType }) {
  const [imgError, setImgError] = useState(false);
  
  if (user.photoURL && !imgError) {
    return (
      <img
        src={user.photoURL}
        alt={user.displayName || 'User'}
        className="w-8 h-8 rounded-full object-cover"
        style={{ boxShadow: '0 0 0 2px var(--border-default)' }}
        referrerPolicy="no-referrer"
        onError={() => setImgError(true)}
      />
    );
  }
  
  return (
    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
      <User className="w-4 h-4 text-white" />
    </div>
  );
}

// Folder display names
const FOLDER_LABELS: Record<MailFolder, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  drafts: 'Drafts',
  snoozed: 'Snoozed',
  starred: 'Starred',
  spam: 'Spam',
  all: 'All Mail',
};

export function FloMailApp() {
  const { user, loading, signOut, getAccessToken } = useAuth();
  
  const [currentView, setCurrentView] = useState<View>('inbox');
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null);
  const [currentDraft, setCurrentDraft] = useState<EmailDraft | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [allThreads, setAllThreads] = useState<EmailThread[]>([]);
  const [folderThreads, setFolderThreads] = useState<EmailThread[]>([]); // Threads in current folder for navigation
  // Keep ref in sync with state for use in callbacks
  useEffect(() => { folderThreadsRef.current = folderThreads; }, [folderThreads]);
  const [currentMailFolder, setCurrentMailFolder] = useState<MailFolder>('inbox');
  const [searchQuery, setSearchQuery] = useState(''); // Search query for inbox
  const [snoozePickerOpen, setSnoozePickerOpen] = useState(false);
  const [snoozeLoading, setSnoozeLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // Increment to trigger InboxList refresh
  const [urlInitialized, setUrlInitialized] = useState(false);
  
  // AI Provider settings (moved here from ChatInterface so they persist globally)
  const [aiProvider, setAiProvider] = useState<AIProvider>('anthropic');
  const [aiModel, setAiModel] = useState<string>('claude-sonnet-4-20250514');
  const availableModels = aiProvider === 'openai' ? OPENAI_MODELS : CLAUDE_MODELS;
  
  // Update model when provider changes
  useEffect(() => {
    const defaultModel = aiProvider === 'openai' ? 'gpt-4.1' : 'claude-sonnet-4-20250514';
    setAiModel(defaultModel);
  }, [aiProvider]);
  const currentThreadIndexRef = useRef(0);
  const archiveHandlerRef = useRef<(() => void) | null>(null);
  const isUpdatingFromUrl = useRef(false); // Prevent URL update loops
  const loadMoreRef = useRef<(() => Promise<void>) | null>(null);
  const hasMoreRef = useRef<(() => boolean) | null>(null);
  const folderThreadsRef = useRef<EmailThread[]>([]); // Ref for latest folderThreads

  // NOTE: Threads are loaded by InboxList, not here, to avoid duplicate API calls
  // allThreads is updated via handleSelectThread callback from InboxList
  // Use refreshKey to trigger InboxList to reload when needed
  const triggerRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
  }, []);

  // Handler for InboxList to register its loadMore function
  const handleRegisterLoadMore = useCallback((loadMore: () => Promise<void>, hasMore: () => boolean) => {
    loadMoreRef.current = loadMore;
    hasMoreRef.current = hasMore;
  }, []);

  // Handler for InboxList to notify when threads are updated (e.g., after loadMore)
  const handleThreadsUpdate = useCallback((threads: EmailThread[], folder: MailFolder) => {
    if (folder === currentMailFolder) {
      setFolderThreads(threads);
      // Also update allThreads with any new threads
      setAllThreads(prev => {
        const existingIds = new Set(prev.map(t => t.id));
        const newThreads = threads.filter(t => !existingIds.has(t.id));
        return [...prev, ...newThreads];
      });
    }
  }, [currentMailFolder]);

  // === URL STATE SYNC ===
  // Parse URL params helper
  const parseUrlParams = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const folder = params.get('folder');
    const thread = params.get('thread');
    const search = params.get('q');
    return {
      folder: (folder && VALID_FOLDERS.includes(folder as MailFolder)) ? folder as MailFolder : 'inbox',
      thread: thread || null,
      search: search || '',
    };
  }, []);

  // Update URL (push to history for navigation, replace for state sync)
  const updateUrl = useCallback((folder: MailFolder, threadId?: string, search?: string, push = false) => {
    const params = new URLSearchParams();
    if (folder !== 'inbox') {
      params.set('folder', folder);
    }
    if (threadId) {
      params.set('thread', threadId);
    }
    if (search) {
      params.set('q', search);
    }
    
    const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
    const currentUrl = window.location.search || '/';
    
    // Only update if URL actually changed
    if (newUrl !== currentUrl && `?${params.toString()}` !== currentUrl) {
      if (push) {
        window.history.pushState({}, '', newUrl);
      } else {
        window.history.replaceState({}, '', newUrl);
      }
    }
  }, []);

  // Read initial state from URL on mount
  useEffect(() => {
    if (urlInitialized || !user) return;
    
    const { folder, thread, search } = parseUrlParams();
    
    console.log('[URL] Initial load:', { folder, thread, search });
    
    // Set folder and search from URL
    setCurrentMailFolder(folder);
    if (search) setSearchQuery(search);
    
    // If there's a thread ID in URL, load folder threads AND the specific thread
    if (thread) {
      const loadThreadFromUrl = async () => {
        try {
          const token = await getAccessToken();
          if (!token) return;
          
          // Map folder to Gmail labelIds
          const folderLabelMap: Record<MailFolder, string[] | undefined> = {
            inbox: ['INBOX'],
            sent: ['SENT'],
            drafts: ['DRAFT'],
            snoozed: undefined, // Special handling
            starred: ['STARRED'],
            spam: ['SPAM'],
            all: undefined, // No filter = all mail
          };
          
          // Load folder threads first so we have the count and position
          const labelIds = folderLabelMap[folder];
          const folderResult = await fetchInbox(token, { labelIds });
          if (folderResult?.threads) {
            setFolderThreads(folderResult.threads);
            setAllThreads(prev => {
              const existingIds = new Set(prev.map(t => t.id));
              const newThreads = folderResult.threads.filter((t: EmailThread) => !existingIds.has(t.id));
              return [...prev, ...newThreads];
            });
            
            // Find the thread index in the folder
            const idx = folderResult.threads.findIndex((t: EmailThread) => t.id === thread);
            if (idx !== -1) {
              currentThreadIndexRef.current = idx;
            }
          }
          
          // Now fetch the full thread data
          const threadData = await fetchThread(token, thread);
          if (threadData) {
            setSelectedThread(threadData);
            setCurrentView('chat');
          }
        } catch (e) {
          console.error('Failed to load thread from URL:', e);
        }
      };
      loadThreadFromUrl();
    }
    
    setUrlInitialized(true);
  }, [user, urlInitialized, parseUrlParams, getAccessToken]);

  // Sync state changes to URL (one-way: state → URL)
  useEffect(() => {
    if (!urlInitialized) return;
    
    const threadId = currentView === 'chat' && selectedThread ? selectedThread.id : undefined;
    updateUrl(currentMailFolder, threadId, searchQuery || undefined);
  }, [currentView, selectedThread?.id, currentMailFolder, searchQuery, urlInitialized, updateUrl]);

  // Handle browser back/forward button (popstate event)
  useEffect(() => {
    const handlePopState = async () => {
      const { folder, thread, search } = parseUrlParams();
      
      console.log('[URL] Popstate:', { folder, thread, search });
      
      // Update folder
      setCurrentMailFolder(folder);
      setSearchQuery(search);
      
      // Handle thread navigation
      if (thread) {
        // Need to load the thread
        try {
          const token = await getAccessToken();
          if (token) {
            const threadData = await fetchThread(token, thread);
            if (threadData) {
              setSelectedThread(threadData);
              setCurrentView('chat');
              return;
            }
          }
        } catch (e) {
          console.error('Failed to load thread on popstate:', e);
        }
      }
      
      // No thread in URL, go to inbox view
      setSelectedThread(null);
      setCurrentView('inbox');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [parseUrlParams, getAccessToken]);

  // Check for expired snoozes on app load and periodically (client-side with auth)
  useEffect(() => {
    if (!user) return;

    const checkExpiredSnoozes = async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;

        // Import client-side functions
        const { getExpiredSnoozes, deleteSnoozedEmail } = await import('@/lib/snooze-persistence');
        const { unsnoozeThread } = await import('@/lib/gmail');
        
        // Get expired snoozes from Firestore (client-side, authenticated)
        const expired = await getExpiredSnoozes(user.uid);
        
        if (expired.length === 0) return;
        
        console.log(`[Snooze] Found ${expired.length} expired snoozes`);
        
        // Unsnooze each one
        const { markAsUnsnoozed } = await import('@/lib/snooze-persistence');
        for (const snoozed of expired) {
          try {
            await unsnoozeThread(token, snoozed.threadId);
            await deleteSnoozedEmail(user.uid, snoozed.threadId);
            // Mark as recently unsnoozed for "Back!" badge
            await markAsUnsnoozed(user.uid, snoozed.threadId);
            console.log(`[Snooze] Unsnoozed: ${snoozed.subject}`);
          } catch (e) {
            console.error(`[Snooze] Failed to unsnooze ${snoozed.threadId}:`, e);
          }
        }
        
        // Invalidate caches
        emailCache.invalidateFolder('inbox');
        emailCache.invalidateFolder('snoozed');
      } catch (err) {
        console.error('[Snooze] Failed to check expired snoozes:', err);
      }
    };

    // Check immediately on load
    checkExpiredSnoozes();

    // Check every 60 seconds
    const interval = setInterval(checkExpiredSnoozes, 60000);
    return () => clearInterval(interval);
  }, [user, getAccessToken]);

  const handleSelectThread = useCallback(async (thread: EmailThread, folder: MailFolder = 'inbox', threadsInFolder: EmailThread[] = []) => {
    // Set thread immediately for fast UI response (shows metadata)
    setSelectedThread(thread);
    setCurrentMailFolder(folder);
    
    // Store the folder's threads for navigation
    if (threadsInFolder.length > 0) {
      setFolderThreads(threadsInFolder);
      // Find index in folder threads (not all threads)
      const idx = threadsInFolder.findIndex((t) => t.id === thread.id);
      if (idx !== -1) {
        currentThreadIndexRef.current = idx;
      }
    } else {
      // Fallback: find in allThreads
      const idx = allThreads.findIndex((t) => t.id === thread.id);
      if (idx !== -1) {
        currentThreadIndexRef.current = idx;
      }
    }
    
    setCurrentView('chat'); // Go directly to chat for the "flow" experience
    
    // Push to browser history so back button works
    const params = new URLSearchParams();
    if (folder !== 'inbox') params.set('folder', folder);
    params.set('thread', thread.id);
    const newUrl = `?${params.toString()}`;
    window.history.pushState({}, '', newUrl);
    
    // If thread only has metadata, fetch full content in background
    if (thread._metadataOnly) {
      try {
        const token = await getAccessToken();
        if (token) {
          const fullThread = await fetchThread(token, thread.id);
          // Update the selected thread with full content
          setSelectedThread(fullThread);
          // Also update in the thread lists
          setAllThreads(prev => prev.map((t: EmailThread) => 
            t.id === fullThread.id ? fullThread : t
          ));
          setFolderThreads(prev => prev.map((t: EmailThread) => 
            t.id === fullThread.id ? fullThread : t
          ));
        }
      } catch (e) {
        console.error('Failed to fetch full thread content:', e);
      }
    }
  }, [allThreads, getAccessToken]);

  const handleBack = useCallback(() => {
    // Use browser history if available
    window.history.back();
  }, []);

  const handleGoToInbox = useCallback(() => {
    setSelectedThread(null);
    setCurrentDraft(null);
    setCurrentView('inbox');
    setCurrentMailFolder('inbox'); // Reset to inbox folder
    setSearchQuery(''); // Clear any search
    triggerRefresh(); // Signal InboxList to refresh
    // Update URL to root
    window.history.pushState({}, '', '/');
  }, [triggerRefresh]);


  const handleDraftCreated = useCallback((draft: EmailDraft) => {
    setCurrentDraft(draft);
  }, []);

  const handleSendEmail = useCallback(async (draft: EmailDraft) => {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');
    
    // Fetch attachment data for any attachments that are from original messages
    let processedDraft = draft;
    if (draft.attachments && draft.attachments.length > 0) {
      const attachmentsWithData = await Promise.all(
        draft.attachments.map(async (att): Promise<DraftAttachment | null> => {
          // If it's from original and doesn't have data, fetch it
          if (att.isFromOriginal && !att.data && att.messageId && att.attachmentId) {
            try {
              const data = await getAttachment(token, att.messageId, att.attachmentId);
              return { ...att, data };
            } catch (err) {
              console.error(`Failed to fetch attachment ${att.filename}:`, err);
              // Skip failed attachments
              return null;
            }
          }
          return att;
        })
      );
      
      // Filter out failed attachments
      processedDraft = {
        ...draft,
        attachments: attachmentsWithData.filter((att): att is DraftAttachment => att !== null),
      };
    }
    
    await sendEmail(token, processedDraft);
    // Note: If draft.gmailDraftId exists, sendEmail uses drafts.send which 
    // automatically deletes the draft - no manual cleanup needed!
    
    setCurrentDraft(null);
    
    // Invalidate sent folder cache (new email there), drafts cache, and current thread
    emailCache.invalidateFolder('sent');
    emailCache.invalidateFolder('drafts');
    
    // Refresh the current thread to show the sent message immediately
    if (selectedThread) {
      emailCache.invalidateThread(selectedThread.id);
      try {
        // Fetch the updated thread with the new sent message
        const updatedThread = await fetchThread(token, selectedThread.id);
        if (updatedThread) {
          // Update the selected thread to show the sent message
          setSelectedThread(updatedThread);
          // Also update the thread in the threads lists
          setAllThreads(prev => prev.map((t: EmailThread) => 
            t.id === updatedThread.id ? updatedThread : t
          ));
          setFolderThreads(prev => prev.map((t: EmailThread) => 
            t.id === updatedThread.id ? updatedThread : t
          ));
        }
      } catch (e) {
        console.error('Failed to refresh thread after send:', e);
      }
    }
  }, [getAccessToken, selectedThread]);

  const handleSaveDraft = useCallback(async (draft: EmailDraft): Promise<EmailDraft> => {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');
    
    // Fetch attachment data for any attachments that are from original messages
    let processedDraft = draft;
    if (draft.attachments && draft.attachments.length > 0) {
      const attachmentsWithData = await Promise.all(
        draft.attachments.map(async (att): Promise<DraftAttachment | null> => {
          if (att.isFromOriginal && !att.data && att.messageId && att.attachmentId) {
            try {
              const data = await getAttachment(token, att.messageId, att.attachmentId);
              return { ...att, data };
            } catch (err) {
              console.error(`Failed to fetch attachment ${att.filename}:`, err);
              return null;
            }
          }
          return att;
        })
      );
      
      processedDraft = {
        ...draft,
        attachments: attachmentsWithData.filter((att): att is DraftAttachment => att !== null),
      };
    }
    
    // Update existing draft if we have a gmailDraftId, otherwise create new
    let savedDraftId: string;
    if (draft.gmailDraftId) {
      savedDraftId = await updateGmailDraft(token, draft.gmailDraftId, processedDraft);
    } else {
      savedDraftId = await createGmailDraft(token, processedDraft);
    }
    
    // Create the saved draft with the ID
    const savedDraft = { ...processedDraft, gmailDraftId: savedDraftId };
    
    // Update the draft with the saved ID so future saves update instead of create
    setCurrentDraft(prev => prev ? savedDraft : null);
    
    // Invalidate drafts folder cache
    emailCache.invalidateFolder('drafts');
    
    // Return the saved draft with ID for ChatInterface to update its state
    return savedDraft;
  }, [getAccessToken]);

  const handleDeleteDraft = useCallback(async (draftId: string) => {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');
    
    const { deleteGmailDraft } = await import('@/lib/gmail');
    await deleteGmailDraft(token, draftId);
    
    // Invalidate drafts folder cache
    emailCache.invalidateFolder('drafts');
    
    // Refresh current thread to remove draft indicator
    if (selectedThread) {
      emailCache.invalidateThread(selectedThread.id);
      try {
        const updatedThread = await fetchThread(token, selectedThread.id);
        if (updatedThread) {
          setSelectedThread(updatedThread);
          setAllThreads(prev => prev.map((t: EmailThread) => 
            t.id === updatedThread.id ? updatedThread : t
          ));
          setFolderThreads(prev => prev.map((t: EmailThread) => 
            t.id === updatedThread.id ? updatedThread : t
          ));
        }
      } catch (e) {
        console.error('Failed to refresh thread after delete:', e);
      }
    }
  }, [getAccessToken, selectedThread]);

  const handleArchive = useCallback(async () => {
    if (!selectedThread) return;
    
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      await archiveThread(token, selectedThread.id);
      
      // Update cache: remove from current folder, invalidate archive
      emailCache.removeThreadFromFolder(currentMailFolder, selectedThread.id);
      emailCache.invalidateFolder('all');
      
      // Use folder-specific threads for navigation
      const navThreads = folderThreads.length > 0 ? folderThreads : allThreads;
      
      // Get the next thread BEFORE removing from list
      const currentIndex = navThreads.findIndex(t => t.id === selectedThread.id);
      const remainingThreads = navThreads.filter((t) => t.id !== selectedThread.id);
      
      // Remove from local lists
      setAllThreads(prev => prev.filter((t) => t.id !== selectedThread.id));
      setFolderThreads(remainingThreads);
      
      // Navigate to next thread (or previous if at end, or inbox if none left)
      if (remainingThreads.length === 0) {
        setSelectedThread(null);
        setCurrentDraft(null);
        setCurrentView('inbox');
      } else {
        // Go to the thread that's now at the same index (which was the next one)
        const nextThread = remainingThreads[currentIndex] || remainingThreads[currentIndex - 1] || remainingThreads[0];
        setCurrentDraft(null);
        currentThreadIndexRef.current = remainingThreads.findIndex(t => t.id === nextThread.id);
        setCurrentView('chat');
        
        // Fetch full thread data (remainingThreads might only have metadata)
        try {
          const fullThread = await fetchThread(token, nextThread.id);
          if (fullThread) {
            setSelectedThread(fullThread);
          } else {
            setSelectedThread(nextThread); // Fallback to cached
          }
        } catch (e) {
          console.error('Failed to fetch full thread after archive:', e);
          setSelectedThread(nextThread); // Fallback to cached
        }
      }
    } catch (err) {
      console.error('Failed to archive:', err);
    }
  }, [selectedThread, getAccessToken, currentMailFolder, folderThreads, allThreads]);

  // Handler for top bar archive button - uses registered handler from ChatInterface for notification
  const handleTopBarArchive = useCallback(() => {
    if (archiveHandlerRef.current) {
      archiveHandlerRef.current();
    } else {
      // Fallback if handler not registered
      handleArchive();
    }
  }, [handleArchive]);

  // Move to inbox (unarchive)
  const handleMoveToInbox = useCallback(async () => {
    if (!selectedThread) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      const { moveToInbox } = await import('@/lib/gmail');
      await moveToInbox(token, selectedThread.id);
      // Refresh the thread list
      triggerRefresh();
    } catch (err) {
      console.error('Failed to move to inbox:', err);
    }
  }, [selectedThread, getAccessToken, triggerRefresh]);

  // Star email
  const handleStar = useCallback(async () => {
    if (!selectedThread) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      const { starThread } = await import('@/lib/gmail');
      await starThread(token, selectedThread.id);
    } catch (err) {
      console.error('Failed to star:', err);
    }
  }, [selectedThread, getAccessToken]);

  // Unstar email
  const handleUnstar = useCallback(async () => {
    if (!selectedThread) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      const { unstarThread } = await import('@/lib/gmail');
      await unstarThread(token, selectedThread.id);
    } catch (err) {
      console.error('Failed to unstar:', err);
    }
  }, [selectedThread, getAccessToken]);

  const handleNextEmail = useCallback(async () => {
    // Use folder-specific threads for navigation (fall back to allThreads if empty)
    const navThreads = folderThreads.length > 0 ? folderThreads : allThreads;
    
    if (navThreads.length === 0) {
      setSelectedThread(null);
      setCurrentDraft(null);
      setCurrentView('inbox');
      return;
    }

    // Simply go to next index in the list
    const currentIndex = currentThreadIndexRef.current;
    const nextIndex = currentIndex + 1;
    
    // If we're at the last loaded thread and there are more to load
    if (nextIndex >= navThreads.length) {
      const hasMore = hasMoreRef.current?.() ?? false;
      if (hasMore && loadMoreRef.current) {
        // Load more threads, then navigate to the first new one
        await loadMoreRef.current();
        // After loading, folderThreadsRef will have the updated threads via onThreadsUpdate
        // Use a small delay to ensure state has propagated
        setTimeout(() => {
          // Use ref to get the latest threads (state may have updated)
          const updatedThreads = folderThreadsRef.current.length > 0 ? folderThreadsRef.current : allThreads;
          if (nextIndex < updatedThreads.length) {
            const newThread = updatedThreads[nextIndex];
            if (newThread) {
              setCurrentDraft(null);
              currentThreadIndexRef.current = nextIndex;
              setCurrentView('chat');
              getAccessToken().then(async (token) => {
                if (token) {
                  try {
                    const fullThread = await fetchThread(token, newThread.id);
                    if (fullThread) {
                      setSelectedThread(fullThread);
                      return;
                    }
                  } catch (e) {
                    console.error('Failed to fetch full thread:', e);
                  }
                }
                setSelectedThread(newThread);
              });
            }
          }
        }, 100);
        return;
      }
      // No more to load, stay at last
      return;
    }
    
    const nextThread = navThreads[nextIndex];
    
    if (nextThread && nextThread.id !== selectedThread?.id) {
      setCurrentDraft(null);
      currentThreadIndexRef.current = nextIndex;
      setCurrentView('chat');
      
      // Fetch full thread data (navThreads might only have metadata)
      try {
        const token = await getAccessToken();
        if (token) {
          const fullThread = await fetchThread(token, nextThread.id);
          if (fullThread) {
            setSelectedThread(fullThread);
            return;
          }
        }
      } catch (e) {
        console.error('Failed to fetch full thread:', e);
      }
      // Fallback to cached thread if fetch fails
      setSelectedThread(nextThread);
    }
  }, [folderThreads, allThreads, selectedThread, getAccessToken]);

  const handlePreviousEmail = useCallback(async () => {
    // Use folder-specific threads for navigation (fall back to allThreads if empty)
    const navThreads = folderThreads.length > 0 ? folderThreads : allThreads;
    
    const prevIndex = currentThreadIndexRef.current - 1;
    
    if (prevIndex < 0 || navThreads.length === 0) {
      // No previous emails in this folder, stay where we are
      return;
    }

    const prevThread = navThreads[prevIndex];
    
    if (prevThread) {
      setCurrentDraft(null);
      currentThreadIndexRef.current = prevIndex;
      setCurrentView('chat');
      
      // Fetch full thread data (navThreads might only have metadata)
      try {
        const token = await getAccessToken();
        if (token) {
          const fullThread = await fetchThread(token, prevThread.id);
          if (fullThread) {
            setSelectedThread(fullThread);
            return;
          }
        }
      } catch (e) {
        console.error('Failed to fetch full thread:', e);
      }
      // Fallback to cached thread if fetch fails
      setSelectedThread(prevThread);
    }
  }, [folderThreads, allThreads, getAccessToken]);

  // Handler for snooze from the draft card page header
  const handleSnooze = useCallback(async (option: SnoozeOption, customDate?: Date) => {
    if (!selectedThread || !user?.uid) return;
    
    setSnoozeLoading(true);
    
    try {
      const token = await getAccessToken();
      if (!token) return;

      // Save last snooze option for "repeat" feature
      const { saveLastSnooze } = await import('./SnoozePicker');
      saveLastSnooze(option, customDate);

      // Get thread info for the snooze record
      const lastMessage = selectedThread.messages[selectedThread.messages.length - 1];
      const emailInfo = {
        subject: selectedThread.subject || '(No subject)',
        snippet: selectedThread.snippet || '',
        senderName: lastMessage?.from?.name || lastMessage?.from?.email || 'Unknown',
      };

      // Call the snooze API (handles Gmail labels)
      const response = await fetch('/api/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'snooze',
          threadId: selectedThread.id,
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
      await saveSnoozedEmail(user.uid, selectedThread.id, new Date(data.snoozeUntil), emailInfo);

      // Close picker and update UI
      setSnoozePickerOpen(false);
      
      // Invalidate caches
      emailCache.invalidateFolder('inbox');
      emailCache.invalidateFolder('snoozed');
      
      // Navigate to next thread
      handleNextEmail();
    } catch (err) {
      console.error('Failed to snooze:', err);
    } finally {
      setSnoozeLoading(false);
    }
  }, [selectedThread, user, getAccessToken, handleNextEmail]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return <LoginScreen />;
  }

  // Main app
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* Profile dropdown */}
      <AnimatePresence>
        {showProfile && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setShowProfile(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-16 right-4 z-50 w-64 rounded-xl shadow-2xl overflow-hidden"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}
            >
              <div className="p-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center gap-3">
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'User'}
                      className="w-10 h-10 rounded-full"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
                      <User className="w-5 h-5 text-white" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {user.displayName || 'User'}
                    </p>
                    <p className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>{user.email}</p>
                  </div>
                </div>
              </div>
              {/* AI Model Settings */}
              <div className="p-4 space-y-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Settings className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>AI Model</span>
                </div>
                
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAiProvider('anthropic')}
                    className="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all"
                    style={aiProvider === 'anthropic' ? {
                      background: 'rgba(168, 85, 247, 0.2)',
                      color: 'rgb(216, 180, 254)',
                      border: '1px solid rgba(168, 85, 247, 0.5)'
                    } : {
                      background: 'var(--bg-interactive)',
                      color: 'var(--text-secondary)',
                      border: '1px solid transparent'
                    }}
                  >
                    Claude
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiProvider('openai')}
                    className="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all"
                    style={aiProvider === 'openai' ? {
                      background: 'rgba(6, 182, 212, 0.2)',
                      color: 'rgb(103, 232, 249)',
                      border: '1px solid rgba(6, 182, 212, 0.5)'
                    } : {
                      background: 'var(--bg-interactive)',
                      color: 'var(--text-secondary)',
                      border: '1px solid transparent'
                    }}
                  >
                    GPT
                  </button>
                </div>

                <div className="relative">
                  <select
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm appearance-none cursor-pointer focus:outline-none"
                    style={{ 
                      background: 'var(--bg-interactive)', 
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    {Object.entries(availableModels).map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>
              
              <button
                onClick={signOut}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:opacity-80"
                style={{ color: 'var(--text-secondary)' }}
              >
                <LogOut className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                Sign out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <div className="flex items-center justify-between px-3 pb-2.5 safe-top" style={{ background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-1">
          {/* FloMail logo - always visible, always clickable to go to inbox */}
          <button
            type="button"
            onClick={handleGoToInbox}
            className="flex items-center gap-1.5 hover:opacity-80 active:scale-95 transition-all mr-2 cursor-pointer z-10"
            title="Go to Inbox"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-xs">F</span>
            </div>
            {currentView === 'inbox' && (
              <span className="font-semibold flex-shrink-0 text-sm" style={{ color: 'var(--text-primary)' }}>FloMail</span>
            )}
          </button>
          
          {currentView !== 'inbox' && (
            <>
              {/* Current folder indicator - clickable to go back */}
              {(() => {
                // Show "Snoozed" if viewing a snoozed thread from All Mail or search
                const isSnoozedThread = selectedThread && hasSnoozedLabel(selectedThread);
                const displayFolder = isSnoozedThread && currentMailFolder !== 'snoozed' 
                  ? 'Snoozed' 
                  : FOLDER_LABELS[currentMailFolder];
                
                return (
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleGoToInbox}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer hover:bg-blue-500/10 transition-colors"
                    style={{ background: 'var(--bg-interactive)' }}
                    title={`Back to ${FOLDER_LABELS[currentMailFolder]}`}
                  >
                    <span className={`text-xs font-medium ${isSnoozedThread && currentMailFolder !== 'snoozed' ? 'text-amber-400' : 'text-blue-400'}`}>
                      {displayFolder}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {currentThreadIndexRef.current + 1}/{folderThreads.length || allThreads.length}
                    </span>
                  </motion.button>
                );
              })()}
              
              {/* Previous/Next navigation - clear labeled buttons */}
              <div className="flex items-center gap-1 ml-1">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handlePreviousEmail}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors"
                  style={{ background: 'var(--bg-interactive)', color: 'var(--text-secondary)' }}
                  title={`Previous in ${FOLDER_LABELS[currentMailFolder]}`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="text-xs font-medium">Prev</span>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleNextEmail}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors"
                  style={{ background: 'var(--bg-interactive)', color: 'var(--text-secondary)' }}
                  title={`Next in ${FOLDER_LABELS[currentMailFolder]}`}
                >
                  <span className="text-xs font-medium">Next</span>
                  <ChevronRight className="w-4 h-4" />
                </motion.button>
              </div>
              
              {/* Quick snooze */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSnoozePickerOpen(true)}
                className="p-2 ml-1 rounded-lg transition-colors hover:text-amber-400"
                style={{ color: 'var(--text-muted)' }}
                title="Snooze"
              >
                <Clock className="w-4 h-4" />
              </motion.button>
              
              {/* Quick archive */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleTopBarArchive}
                className="p-2 rounded-lg transition-colors hover:text-blue-400"
                style={{ color: 'var(--text-muted)' }}
                title="Archive"
              >
                <Archive className="w-4 h-4" />
              </motion.button>
            </>
          )}
        </div>

        {/* Search bar - full width in center when on inbox view */}
        {currentView === 'inbox' && (
          <div className="flex-1 ml-2 mr-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search mail..."
                className="w-full pl-9 pr-8 py-1.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
                style={{ 
                  background: 'var(--bg-interactive)', 
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)'
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-white/10 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Profile */}
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="relative"
          >
            <UserAvatar user={user} />
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {currentView === 'inbox' && (
            <motion.div
              key="inbox"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, x: -50 }}
              className="absolute inset-0"
            >
              <InboxList
                key={refreshKey} // Change key to force remount/refresh
                onSelectThread={handleSelectThread}
                selectedThreadId={selectedThread?.id}
                defaultFolder={currentMailFolder}
                searchQuery={searchQuery}
                onClearSearch={() => setSearchQuery('')}
                onFolderChange={setCurrentMailFolder}
                onRegisterLoadMore={handleRegisterLoadMore}
                onThreadsUpdate={handleThreadsUpdate}
              />
            </motion.div>
          )}

          {currentView === 'chat' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              className="absolute inset-0"
            >
              <ChatInterface
                thread={selectedThread || undefined}
                folder={currentMailFolder}
                provider={aiProvider}
                model={aiModel}
                onDraftCreated={handleDraftCreated}
                onSendEmail={handleSendEmail}
                onSaveDraft={handleSaveDraft}
                onDeleteDraft={handleDeleteDraft}
                onArchive={handleArchive}
                onMoveToInbox={handleMoveToInbox}
                onStar={handleStar}
                onUnstar={handleUnstar}
                onNextEmail={handleNextEmail}
                onPreviousEmail={handlePreviousEmail}
                onGoToInbox={handleGoToInbox}
                onRegisterArchiveHandler={(handler) => { archiveHandlerRef.current = handler; }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom safe area */}
      <div className="safe-bottom" />

      {/* Floating compose button - bottom right, only on inbox view */}
      <AnimatePresence>
        {currentView === 'inbox' && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              setSelectedThread(null);
              setCurrentDraft(null);
              setCurrentView('chat');
            }}
            className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-all group"
            style={{ 
              background: 'linear-gradient(135deg, rgb(168, 85, 247), rgb(6, 182, 212))',
              boxShadow: '0 4px 20px rgba(168, 85, 247, 0.4)'
            }}
            title="Compose new message"
          >
            <Pencil className="w-6 h-6" />
            {/* Hover tooltip */}
            <span className="absolute right-full mr-3 px-2.5 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}>
              Compose
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Snooze Picker Modal */}
      <SnoozePicker
        isOpen={snoozePickerOpen}
        onClose={() => {
          if (!snoozeLoading) {
            setSnoozePickerOpen(false);
          }
        }}
        onSelect={handleSnooze}
        isLoading={snoozeLoading}
      />
    </div>
  );
}
