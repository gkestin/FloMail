'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
// URL state sync uses native browser history API
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { LoginScreen } from './LoginScreen';
import { InboxList, MailFolder } from './InboxList';
import { ChatInterface } from './ChatInterface';
import { EmailThread, EmailDraft, AIProvider, AIDraftingPreferences, DraftTone, DraftLength, SignOffStyle } from '@/types';
import { Loader2, LogOut, User, ArrowLeft, ChevronLeft, ChevronRight, Archive, Search, X, Clock, ChevronDown, Settings, Plus, Pencil, Edit3, Volume2 } from 'lucide-react';
import { OPENAI_MODELS } from '@/lib/openai';
import { CLAUDE_MODELS } from '@/lib/anthropic';
import { sendEmail, archiveThread, getAttachment, createGmailDraft, updateGmailDraft, hasSnoozedLabel, fetchThread, fetchInbox, markAsRead } from '@/lib/gmail';
import { emailCache } from '@/lib/email-cache';
import { DraftAttachment } from '@/types';
import { SnoozePicker } from './SnoozePicker';
import { SnoozeOption } from '@/lib/snooze-persistence';
import { getUserSettings, saveUserSettings, subscribeToUserSettings, migrateSettingsFromLocalStorage, TTSSettings } from '@/lib/user-settings-persistence';

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
  const [navigationDirection, setNavigationDirection] = useState<'forward' | 'backward'>('forward');
  const [showProfile, setShowProfile] = useState(false);
  const [allThreads, setAllThreads] = useState<EmailThread[]>([]);
  const [folderThreads, setFolderThreads] = useState<EmailThread[]>([]); // Threads in current folder for navigation
  // Keep ref in sync with state for use in callbacks
  useEffect(() => { folderThreadsRef.current = folderThreads; }, [folderThreads]);
  const [currentMailFolder, setCurrentMailFolder] = useState<MailFolder>('inbox');
  const [searchQuery, setSearchQuery] = useState(''); // Search query for inbox
  const [snoozePickerOpen, setSnoozePickerOpen] = useState(false);
  const [snoozeLoading, setSnoozeLoading] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false); // For archive button spinner
  const [refreshKey, setRefreshKey] = useState(0); // Increment to trigger InboxList refresh
  const [urlInitialized, setUrlInitialized] = useState(false);
  
  // AI Provider settings (moved here from ChatInterface so they persist globally)
  const [aiProvider, setAiProvider] = useState<AIProvider>('anthropic');
  const [aiModel, setAiModel] = useState<string>('claude-sonnet-4-20250514');
  const [settingsLoaded, setSettingsLoaded] = useState(false); // Move this up before it's used
  const availableModels = aiProvider === 'openai' ? OPENAI_MODELS : CLAUDE_MODELS;

  // Update model when provider changes (only if settings haven't been loaded from Firestore yet)
  useEffect(() => {
    if (!settingsLoaded) {
      const defaultModel = aiProvider === 'openai' ? 'gpt-4.1' : 'claude-sonnet-4-20250514';
      setAiModel(defaultModel);
    }
  }, [aiProvider, settingsLoaded]);
  
  // AI Drafting Preferences
  const defaultPreferences: AIDraftingPreferences = {
    userName: user?.displayName || '',
    tones: [],  // No tones selected by default
    length: undefined,  // No length selected by default
    useExclamations: undefined,  // No preference by default
    signOffStyle: 'none',
    customSignOff: '',
    customInstructions: '',
  };
  
  // Tooltip descriptions for each option
  const toneTooltips: Record<DraftTone, string> = {
    professional: 'Prompt: "Use a professional, business-appropriate tone. Be clear and direct."',
    friendly: 'Prompt: "Use a warm, friendly tone while remaining appropriate. Be personable."',
    casual: 'Prompt: "Use a casual, relaxed tone. Keep it conversational and approachable."',
    formal: 'Prompt: "Use a formal, respectful tone. Be courteous and precise."',
  };
  
  const lengthTooltips: Record<DraftLength, string> = {
    brief: 'Prompt: "Keep messages concise and to the point. Aim for 2-3 sentences when possible."',
    moderate: 'Prompt: "Write messages of moderate length. Include necessary context but avoid being verbose."',
    detailed: 'Prompt: "Write thorough, detailed messages. Include full context and explanation when helpful."',
  };
  
  const [aiDraftingPreferences, setAiDraftingPreferences] = useState<AIDraftingPreferences>(defaultPreferences);
  const [showDraftingSettings, setShowDraftingSettings] = useState(false);
  
  // TTS Settings
  const [showTTSSettings, setShowTTSSettings] = useState(false);
  const [ttsSettings, setTtsSettings] = useState<TTSSettings>({
    voice: 'nova',
    speed: 1.0,
    useNaturalVoice: true,
  });

  // Settings have been moved up to avoid "used before declaration" error

  // Load and subscribe to user settings from Firestore
  useEffect(() => {
    if (!user?.uid) return;

    let unsubscribe: (() => void) | undefined;

    // First, migrate any existing localStorage settings to Firestore
    migrateSettingsFromLocalStorage(user.uid).then(() => {
      // Then load settings from Firestore
      getUserSettings(user.uid).then(settings => {
        setAiProvider(settings.aiProvider);
        setAiModel(settings.aiModel);
        setAiDraftingPreferences({ ...defaultPreferences, ...settings.aiDraftingPreferences });
        setTtsSettings(settings.ttsSettings);
        setSettingsLoaded(true);

        // Subscribe to real-time updates
        unsubscribe = subscribeToUserSettings(user.uid, (updatedSettings) => {
          setAiProvider(updatedSettings.aiProvider);
          setAiModel(updatedSettings.aiModel);
          setAiDraftingPreferences({ ...defaultPreferences, ...updatedSettings.aiDraftingPreferences });
          setTtsSettings(updatedSettings.ttsSettings);
        });
      });
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Initialize user name from display name if not set
  useEffect(() => {
    if (settingsLoaded && user?.displayName && !aiDraftingPreferences.userName && user.uid) {
      const updates = { userName: user.displayName };
      setAiDraftingPreferences(prev => ({ ...prev, ...updates }));
      saveUserSettings(user.uid, { aiDraftingPreferences: { ...aiDraftingPreferences, ...updates } });
    }
  }, [settingsLoaded, user?.displayName, user?.uid, aiDraftingPreferences]);

  // Save TTS settings to Firestore
  const updateTTSSettings = useCallback((updates: Partial<TTSSettings>) => {
    if (!user?.uid) return;

    setTtsSettings(prev => {
      const updated = { ...prev, ...updates };
      // Save to Firestore
      saveUserSettings(user.uid, { ttsSettings: updated }).catch(error => {
        console.error('Failed to save TTS settings:', error);
      });
      // Also update localStorage for backward compatibility with TTSController
      localStorage.setItem('flomail_tts_settings', JSON.stringify(updated));
      return updated;
    });
  }, [user?.uid]);

  // Save AI drafting preferences to Firestore
  const updateDraftingPreferences = useCallback((updates: Partial<AIDraftingPreferences>) => {
    if (!user?.uid) return;

    setAiDraftingPreferences(prev => {
      const updated = { ...prev, ...updates };
      // Save to Firestore
      saveUserSettings(user.uid, { aiDraftingPreferences: updated }).catch(error => {
        console.error('Failed to save drafting preferences:', error);
      });
      // Also update localStorage for backward compatibility
      localStorage.setItem('flomail-drafting-preferences', JSON.stringify(updated));
      return updated;
    });
  }, [user?.uid]);
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
    // Set navigation direction for animation (going from inbox to chat is forward)
    setNavigationDirection('forward');

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

  // Go back to the current folder's list (preserves folder selection)
  const handleBackToList = useCallback(() => {
    setSelectedThread(null);
    setCurrentDraft(null);
    setCurrentView('inbox');
    // DON'T reset currentMailFolder - preserve where user came from
    // Clear search only if going back to a different folder
    triggerRefresh(); // Signal InboxList to refresh
    // Update URL without folder reset
    window.history.pushState({}, '', currentMailFolder === 'inbox' ? '/' : `/?folder=${currentMailFolder}`);
  }, [triggerRefresh, currentMailFolder]);
  
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
            // Store unread status for auto-expand
            const wasUnread = !fullThread.isRead;

            // Set thread FIRST while still unread (so ChatInterface can see it and auto-expand)
            setSelectedThread(fullThread);

            // Then mark as read if it was unread
            if (wasUnread) {
              await markAsRead(token, fullThread.id);
              // Invalidate cache for this thread AND update folder cache
              emailCache.invalidateThread(fullThread.id);
              // Update the cached folder data to reflect the read status
              const folderData = emailCache.getStaleFolderData(currentMailFolder);
              if (folderData && folderData.threads) {
                const updatedThreads = folderData.threads.map(t =>
                  t.id === fullThread.id ? { ...t, isRead: true } : t
                );
                emailCache.setFolderData(currentMailFolder, {
                  ...folderData,
                  threads: updatedThreads
                });
              }
              // Update all thread lists to show as read
              setAllThreads(prev => prev.map((t: EmailThread) =>
                t.id === fullThread.id ? { ...t, isRead: true } : t
              ));
              setFolderThreads(prev => prev.map((t: EmailThread) =>
                t.id === fullThread.id ? { ...t, isRead: true } : t
              ));
              // Update selectedThread to reflect read status
              setSelectedThread(prev => prev ? { ...prev, isRead: true } : prev);
            }
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
  const handleTopBarArchive = useCallback(async () => {
    setIsArchiving(true);
    try {
      if (archiveHandlerRef.current) {
        await archiveHandlerRef.current();
      } else {
        // Fallback if handler not registered
        await handleArchive();
      }
    } finally {
      setIsArchiving(false);
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
    // Set navigation direction for animation
    setNavigationDirection('forward');

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
                      // Store unread status for auto-expand
                      const wasUnread = !fullThread.isRead;

                      // Set thread FIRST while still unread (so ChatInterface can see it and auto-expand)
                      setSelectedThread(fullThread);

                      // Then mark as read if it was unread
                      if (wasUnread) {
                        await markAsRead(token, fullThread.id);
                        // Invalidate cache for this thread (was missing here!)
                        emailCache.invalidateThread(fullThread.id);
                        // Update all thread lists to show as read
                        setAllThreads(prev => prev.map((t: EmailThread) =>
                          t.id === fullThread.id ? { ...t, isRead: true } : t
                        ));
                        setFolderThreads(prev => prev.map((t: EmailThread) =>
                          t.id === fullThread.id ? { ...t, isRead: true } : t
                        ));
                        // Update selectedThread to reflect read status
                        setSelectedThread(prev => prev ? { ...prev, isRead: true } : prev);
                      }
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
            // Store unread status for auto-expand
            const wasUnread = !fullThread.isRead;

            // Set thread FIRST while still unread (so ChatInterface can see it and auto-expand)
            setSelectedThread(fullThread);

            // Then mark as read if it was unread
            if (wasUnread) {
              await markAsRead(token, fullThread.id);
              // Invalidate cache for this thread AND update folder cache
              emailCache.invalidateThread(fullThread.id);
              // Update the cached folder data to reflect the read status
              const folderData = emailCache.getStaleFolderData(currentMailFolder);
              if (folderData && folderData.threads) {
                const updatedThreads = folderData.threads.map(t =>
                  t.id === fullThread.id ? { ...t, isRead: true } : t
                );
                emailCache.setFolderData(currentMailFolder, {
                  ...folderData,
                  threads: updatedThreads
                });
              }
              // Update all thread lists to show as read
              setAllThreads(prev => prev.map((t: EmailThread) =>
                t.id === fullThread.id ? { ...t, isRead: true } : t
              ));
              setFolderThreads(prev => prev.map((t: EmailThread) =>
                t.id === fullThread.id ? { ...t, isRead: true } : t
              ));
              // Update selectedThread to reflect read status
              setSelectedThread(prev => prev ? { ...prev, isRead: true } : prev);
            }
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
    // Set navigation direction for animation
    setNavigationDirection('backward');

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
            // Store unread status for auto-expand
            const wasUnread = !fullThread.isRead;

            // Set thread FIRST while still unread (so ChatInterface can see it and auto-expand)
            setSelectedThread(fullThread);

            // Then mark as read if it was unread
            if (wasUnread) {
              await markAsRead(token, fullThread.id);
              // Invalidate cache for this thread AND update folder cache
              emailCache.invalidateThread(fullThread.id);
              // Update the cached folder data to reflect the read status
              const folderData = emailCache.getStaleFolderData(currentMailFolder);
              if (folderData && folderData.threads) {
                const updatedThreads = folderData.threads.map(t =>
                  t.id === fullThread.id ? { ...t, isRead: true } : t
                );
                emailCache.setFolderData(currentMailFolder, {
                  ...folderData,
                  threads: updatedThreads
                });
              }
              // Update all thread lists to show as read
              setAllThreads(prev => prev.map((t: EmailThread) =>
                t.id === fullThread.id ? { ...t, isRead: true } : t
              ));
              setFolderThreads(prev => prev.map((t: EmailThread) =>
                t.id === fullThread.id ? { ...t, isRead: true } : t
              ));
              // Update selectedThread to reflect read status
              setSelectedThread(prev => prev ? { ...prev, isRead: true } : prev);
            }
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
      
      // Invalidate caches
      emailCache.invalidateFolder('inbox');
      emailCache.invalidateFolder('snoozed');
      
      // Navigate to next thread BEFORE closing picker
      // so we don't see the current thread briefly
      await handleNextEmail();
      
      // Now close picker after navigation is complete
      setSnoozePickerOpen(false);
    } catch (err) {
      console.error('Failed to snooze:', err);
    } finally {
      setSnoozeLoading(false);
    }
  }, [selectedThread, user, getAccessToken, handleNextEmail]);

  // Handler for snooze from chat AI - takes a Date directly
  const handleSnoozeFromChat = useCallback(async (snoozeUntil: Date) => {
    if (!selectedThread || !user?.uid) return;
    
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      // Get thread info for the snooze record
      const lastMessage = selectedThread.messages[selectedThread.messages.length - 1];
      const emailInfo = {
        subject: selectedThread.subject || '(No subject)',
        snippet: selectedThread.snippet || '',
        senderName: lastMessage?.from?.name || lastMessage?.from?.email || 'Unknown',
      };

      // Call the snooze API
      const response = await fetch('/api/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'snooze',
          threadId: selectedThread.id,
          accessToken: token,
          snoozeOption: 'custom',
          customDate: snoozeUntil.toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to snooze');
      }

      // Save to Firestore client-side
      const { saveSnoozedEmail } = await import('@/lib/snooze-persistence');
      await saveSnoozedEmail(user.uid, selectedThread.id, snoozeUntil, emailInfo);
      
      // Invalidate caches
      emailCache.invalidateFolder('inbox');
      emailCache.invalidateFolder('snoozed');
      
      // Navigate to next email after snooze
      await handleNextEmail();
    } catch (err) {
      console.error('Failed to snooze from chat:', err);
      throw err;
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
              className="absolute top-16 right-4 z-50 w-80 max-h-[calc(100vh-100px)] rounded-xl shadow-2xl overflow-y-auto"
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
                    onClick={() => {
                      setAiProvider('anthropic');
                      if (user?.uid) {
                        saveUserSettings(user.uid, { aiProvider: 'anthropic' });
                      }
                    }}
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
                    onClick={() => {
                      setAiProvider('openai');
                      if (user?.uid) {
                        saveUserSettings(user.uid, { aiProvider: 'openai' });
                      }
                    }}
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
                    onChange={(e) => {
                      setAiModel(e.target.value);
                      if (user?.uid) {
                        saveUserSettings(user.uid, { aiModel: e.target.value });
                      }
                    }}
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
              
              {/* AI Drafting Preferences - Distinct section with gradient border */}
              <div 
                className="m-2 rounded-lg overflow-hidden"
                style={{ 
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.1), rgba(6, 182, 212, 0.1))',
                  border: '1px solid rgba(168, 85, 247, 0.3)'
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowDraftingSettings(!showDraftingSettings)}
                  className="w-full flex items-center justify-between p-3"
                >
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-4 h-4" style={{ color: 'rgb(168, 85, 247)' }} />
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'rgb(168, 85, 247)' }}>Drafting Preferences</span>
                  </div>
                  <ChevronDown 
                    className={`w-4 h-4 transition-transform ${showDraftingSettings ? 'rotate-180' : ''}`} 
                    style={{ color: 'rgb(168, 85, 247)' }} 
                  />
                </button>
                
                <AnimatePresence>
                  {showDraftingSettings && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 space-y-4">
                        {/* User Identity */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            Your Name <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(for sign-offs)</span>
                          </label>
                          <input
                            type="text"
                            value={aiDraftingPreferences.userName}
                            onChange={(e) => updateDraftingPreferences({ userName: e.target.value })}
                            placeholder="e.g., Greg Kestin"
                            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-1"
                            style={{ 
                              background: 'var(--bg-interactive)', 
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)'
                            }}
                          />
                        </div>
                        
                        {/* Tone - Multiple selection */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            Tone <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(select any that apply)</span>
                          </label>
                          <div className="grid grid-cols-2 gap-1.5">
                            {(['professional', 'friendly', 'casual', 'formal'] as DraftTone[]).map((t) => {
                              const isSelected = aiDraftingPreferences.tones?.includes(t);
                              return (
                                <button
                                  key={t}
                                  type="button"
                                  title={toneTooltips[t]}
                                  onClick={() => {
                                    const currentTones = aiDraftingPreferences.tones || [];
                                    const newTones = isSelected
                                      ? currentTones.filter(tone => tone !== t)
                                      : [...currentTones, t];
                                    updateDraftingPreferences({ tones: newTones });
                                  }}
                                  className="px-2 py-1.5 rounded-lg text-xs font-medium transition-all capitalize"
                                  style={isSelected ? {
                                    background: 'rgba(168, 85, 247, 0.2)',
                                    color: 'rgb(216, 180, 254)',
                                    border: '1px solid rgba(168, 85, 247, 0.5)'
                                  } : {
                                    background: 'var(--bg-interactive)',
                                    color: 'var(--text-secondary)',
                                    border: '1px solid transparent'
                                  }}
                                >
                                  {t}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        
                        {/* Length - Toggle selection */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            Message Length <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(click again to deselect)</span>
                          </label>
                          <div className="flex gap-1.5">
                            {(['brief', 'moderate', 'detailed'] as DraftLength[]).map((l) => (
                              <button
                                key={l}
                                type="button"
                                title={lengthTooltips[l]}
                                onClick={() => {
                                  // Toggle: click again to deselect
                                  const newLength = aiDraftingPreferences.length === l ? undefined : l;
                                  updateDraftingPreferences({ length: newLength });
                                }}
                                className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all capitalize"
                                style={aiDraftingPreferences.length === l ? {
                                  background: 'rgba(6, 182, 212, 0.2)',
                                  color: 'rgb(103, 232, 249)',
                                  border: '1px solid rgba(6, 182, 212, 0.5)'
                                } : {
                                  background: 'var(--bg-interactive)',
                                  color: 'var(--text-secondary)',
                                  border: '1px solid transparent'
                                }}
                              >
                                {l}
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        {/* Exclamations - 3-state toggle */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            Exclamation Marks
                          </label>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              title='Prompt: "You may use exclamation marks where appropriate to convey enthusiasm or warmth."'
                              onClick={() => updateDraftingPreferences({ useExclamations: aiDraftingPreferences.useExclamations === true ? undefined : true })}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all"
                              style={aiDraftingPreferences.useExclamations === true ? {
                                background: 'rgba(34, 197, 94, 0.2)',
                                color: 'rgb(134, 239, 172)',
                                border: '1px solid rgba(34, 197, 94, 0.5)'
                              } : {
                                background: 'var(--bg-interactive)',
                                color: 'var(--text-secondary)',
                                border: '1px solid transparent'
                              }}
                            >
                              Use them!
                            </button>
                            <button
                              type="button"
                              title='Prompt: "Avoid using exclamation marks. Keep punctuation understated."'
                              onClick={() => updateDraftingPreferences({ useExclamations: aiDraftingPreferences.useExclamations === false ? undefined : false })}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all"
                              style={aiDraftingPreferences.useExclamations === false ? {
                                background: 'rgba(239, 68, 68, 0.2)',
                                color: 'rgb(252, 165, 165)',
                                border: '1px solid rgba(239, 68, 68, 0.5)'
                              } : {
                                background: 'var(--bg-interactive)',
                                color: 'var(--text-secondary)',
                                border: '1px solid transparent'
                              }}
                            >
                              Avoid
                            </button>
                          </div>
                        </div>
                        
                        {/* Sign-off style */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            Sign-off Style
                          </label>
                          <div className="relative">
                            <select
                              value={aiDraftingPreferences.signOffStyle}
                              onChange={(e) => updateDraftingPreferences({ signOffStyle: e.target.value as SignOffStyle })}
                              className="w-full px-2 py-1.5 rounded-lg text-xs appearance-none cursor-pointer focus:outline-none"
                              style={{ 
                                background: 'var(--bg-interactive)', 
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--text-primary)'
                              }}
                            >
                              <option value="none">No sign-off</option>
                              <option value="best">Best, [Name]</option>
                              <option value="thanks">Thanks, [Name]</option>
                              <option value="regards">Regards, [Name]</option>
                              <option value="cheers">Cheers, [Name]</option>
                              <option value="custom">Custom...</option>
                            </select>
                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                          </div>
                          {aiDraftingPreferences.signOffStyle === 'custom' && (
                            <input
                              type="text"
                              value={aiDraftingPreferences.customSignOff || ''}
                              onChange={(e) => updateDraftingPreferences({ customSignOff: e.target.value })}
                              placeholder="e.g., Warmly, Greg"
                              className="w-full px-2 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-1"
                              style={{ 
                                background: 'var(--bg-interactive)', 
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--text-primary)'
                              }}
                            />
                          )}
                        </div>
                        
                        {/* Custom Instructions */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            Custom Instructions
                          </label>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            Free-form instructions added to the AI prompt
                          </p>
                          <textarea
                            value={aiDraftingPreferences.customInstructions || ''}
                            onChange={(e) => updateDraftingPreferences({ customInstructions: e.target.value })}
                            placeholder="e.g., Always be concise. Never use 'per our conversation'. Include relevant context from the thread."
                            rows={3}
                            className="w-full px-2 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-1 resize-none"
                            style={{ 
                              background: 'var(--bg-interactive)', 
                              border: '1px solid var(--border-subtle)',
                              color: 'var(--text-primary)'
                            }}
                          />
                        </div>
                        
                        <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
                          💡 Hover over options to see the exact prompt text
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              
              {/* Text-to-Speech Settings */}
              <div 
                className="overflow-hidden"
                style={{ borderBottom: '1px solid var(--border-subtle)' }}
              >
                <button
                  type="button"
                  onClick={() => setShowTTSSettings(!showTTSSettings)}
                  className="w-full flex items-center justify-between p-3"
                >
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4" style={{ color: 'rgb(34, 197, 94)' }} />
                    <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'rgb(34, 197, 94)' }}>Text-to-Speech</span>
                  </div>
                  <ChevronDown 
                    className={`w-4 h-4 transition-transform ${showTTSSettings ? 'rotate-180' : ''}`} 
                    style={{ color: 'rgb(34, 197, 94)' }} 
                  />
                </button>
                
                <AnimatePresence>
                  {showTTSSettings && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 space-y-4">
                        {/* Natural Voice Toggle */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            Voice Quality
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => updateTTSSettings({ useNaturalVoice: true })}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all"
                              style={ttsSettings.useNaturalVoice ? {
                                background: 'rgba(34, 197, 94, 0.2)',
                                color: 'rgb(134, 239, 172)',
                                border: '1px solid rgba(34, 197, 94, 0.5)'
                              } : {
                                background: 'var(--bg-interactive)',
                                color: 'var(--text-secondary)',
                                border: '1px solid transparent'
                              }}
                            >
                              Natural (AI)
                            </button>
                            <button
                              type="button"
                              onClick={() => updateTTSSettings({ useNaturalVoice: false })}
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all"
                              style={!ttsSettings.useNaturalVoice ? {
                                background: 'rgba(34, 197, 94, 0.2)',
                                color: 'rgb(134, 239, 172)',
                                border: '1px solid rgba(34, 197, 94, 0.5)'
                              } : {
                                background: 'var(--bg-interactive)',
                                color: 'var(--text-secondary)',
                                border: '1px solid transparent'
                              }}
                            >
                              System
                            </button>
                          </div>
                        </div>
                        
                        {/* Voice Selection (only for Natural) */}
                        {ttsSettings.useNaturalVoice && (
                          <div className="space-y-2">
                            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                              Voice
                            </label>
                            <div className="relative">
                              <select
                                value={ttsSettings.voice}
                                onChange={(e) => updateTTSSettings({ voice: e.target.value })}
                                className="w-full px-2 py-1.5 rounded-lg text-xs appearance-none cursor-pointer focus:outline-none"
                                style={{ 
                                  background: 'var(--bg-interactive)', 
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-primary)'
                                }}
                              >
                                <option value="alloy">Alloy (Neutral)</option>
                                <option value="echo">Echo (Male)</option>
                                <option value="fable">Fable (Expressive)</option>
                                <option value="onyx">Onyx (Deep Male)</option>
                                <option value="nova">Nova (Female)</option>
                                <option value="shimmer">Shimmer (Soft Female)</option>
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                            </div>
                          </div>
                        )}
                        
                        {/* Speed Control */}
                        <div className="space-y-2">
                          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                            Speed: {ttsSettings.speed.toFixed(1)}x
                          </label>
                          <input
                            type="range"
                            min="0.5"
                            max="2.0"
                            step="0.1"
                            value={ttsSettings.speed}
                            onChange={(e) => updateTTSSettings({ speed: parseFloat(e.target.value) })}
                            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
                            style={{ 
                              background: `linear-gradient(to right, rgb(34, 197, 94) 0%, rgb(34, 197, 94) ${((ttsSettings.speed - 0.5) / 1.5) * 100}%, var(--bg-interactive) ${((ttsSettings.speed - 0.5) / 1.5) * 100}%, var(--bg-interactive) 100%)`,
                              accentColor: 'rgb(34, 197, 94)'
                            }}
                          />
                          <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                            <span>0.5x</span>
                            <span>1.0x</span>
                            <span>2.0x</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
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
                    onClick={handleBackToList}
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
                disabled={isArchiving}
                className="p-2 rounded-lg transition-colors hover:text-blue-400 disabled:opacity-50"
                style={{ color: 'var(--text-muted)' }}
                title="Archive"
              >
                {isArchiving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Archive className="w-4 h-4" />
                )}
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

          {currentView === 'chat' && selectedThread && (
            <motion.div
              key={`chat-${selectedThread.id}`} // Key by thread ID for smooth transitions
              initial={{
                opacity: 0,
                x: navigationDirection === 'forward' ? 100 : -100,
                scale: 0.95
              }}
              animate={{
                opacity: 1,
                x: 0,
                scale: 1
              }}
              exit={{
                opacity: 0,
                x: navigationDirection === 'forward' ? -100 : 100,
                scale: 0.95
              }}
              transition={{
                type: "spring",
                stiffness: 260,
                damping: 20,
                opacity: { duration: 0.2 }
              }}
              className="absolute inset-0"
            >
              <ChatInterface
                thread={selectedThread || undefined}
                folder={currentMailFolder}
                provider={aiProvider}
                model={aiModel}
                draftingPreferences={aiDraftingPreferences}
                onDraftCreated={handleDraftCreated}
                onSendEmail={handleSendEmail}
                onSaveDraft={handleSaveDraft}
                onDeleteDraft={handleDeleteDraft}
                onArchive={handleArchive}
                onMoveToInbox={handleMoveToInbox}
                onStar={handleStar}
                onUnstar={handleUnstar}
                onSnooze={handleSnoozeFromChat}
                onOpenSnoozePicker={() => setSnoozePickerOpen(true)}
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
