'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { LoginScreen } from './LoginScreen';
import { InboxList, MailFolder } from './InboxList';
import { ChatInterface } from './ChatInterface';
import { EmailThread, EmailDraft } from '@/types';
import { Loader2, LogOut, User, ArrowLeft, ChevronLeft, ChevronRight, Archive } from 'lucide-react';
import { sendEmail, archiveThread, fetchInbox, getAttachment, createGmailDraft } from '@/lib/gmail';
import { emailCache } from '@/lib/email-cache';
import { DraftAttachment } from '@/types';

type View = 'inbox' | 'chat';

// Folder display names
const FOLDER_LABELS: Record<MailFolder, string> = {
  inbox: 'Inbox',
  sent: 'Sent',
  drafts: 'Drafts',
  starred: 'Starred',
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
  const [currentMailFolder, setCurrentMailFolder] = useState<MailFolder>('inbox');
  const currentThreadIndexRef = useRef(0);
  const archiveHandlerRef = useRef<(() => void) | null>(null);

  // Load threads for navigation
  const loadThreads = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const { threads } = await fetchInbox(token);
      setAllThreads(threads);
    } catch (err) {
      console.error('Failed to load threads:', err);
    }
  }, [getAccessToken]);

  // Load threads on mount
  useEffect(() => {
    if (user) {
      loadThreads();
    }
  }, [user, loadThreads]);

  const handleSelectThread = useCallback((thread: EmailThread, folder: MailFolder = 'inbox', threadsInFolder: EmailThread[] = []) => {
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
  }, [allThreads]);

  const handleBack = useCallback(() => {
    setSelectedThread(null);
    setCurrentDraft(null);
    setCurrentView('inbox');
  }, []);

  const handleGoToInbox = useCallback(() => {
    setSelectedThread(null);
    setCurrentDraft(null);
    setCurrentView('inbox');
    loadThreads(); // Refresh
  }, [loadThreads]);


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
    setCurrentDraft(null);
    
    // Invalidate sent folder cache (new email there) and current thread
    emailCache.invalidateFolder('sent');
    if (selectedThread) {
      emailCache.invalidateThread(selectedThread.id);
    }
  }, [getAccessToken, selectedThread]);

  const handleSaveDraft = useCallback(async (draft: EmailDraft) => {
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
    
    await createGmailDraft(token, processedDraft);
    setCurrentDraft(null);
    
    // Invalidate drafts folder cache
    emailCache.invalidateFolder('drafts');
  }, [getAccessToken]);

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
        setSelectedThread(nextThread);
        setCurrentDraft(null);
        currentThreadIndexRef.current = remainingThreads.findIndex(t => t.id === nextThread.id);
        setCurrentView('chat');
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
      loadThreads();
    } catch (err) {
      console.error('Failed to move to inbox:', err);
    }
  }, [selectedThread, getAccessToken, loadThreads]);

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

  const handleNextEmail = useCallback(() => {
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
    
    // If we're past the end, stay at last
    const nextThread = navThreads[nextIndex] || navThreads[navThreads.length - 1];
    
    if (nextThread && nextThread.id !== selectedThread?.id) {
      setSelectedThread(nextThread);
      setCurrentDraft(null);
      currentThreadIndexRef.current = nextIndex < navThreads.length ? nextIndex : navThreads.length - 1;
      setCurrentView('chat');
    } else if (navThreads.length > 0 && nextIndex >= navThreads.length) {
      // Already at the last email in this folder
    }
  }, [folderThreads, allThreads, selectedThread]);

  const handlePreviousEmail = useCallback(() => {
    // Use folder-specific threads for navigation (fall back to allThreads if empty)
    const navThreads = folderThreads.length > 0 ? folderThreads : allThreads;
    
    const prevIndex = currentThreadIndexRef.current - 1;
    
    if (prevIndex < 0 || navThreads.length === 0) {
      // No previous emails in this folder, stay where we are
      return;
    }

    const prevThread = navThreads[prevIndex];
    
    if (prevThread) {
      setSelectedThread(prevThread);
      setCurrentDraft(null);
      currentThreadIndexRef.current = prevIndex;
      setCurrentView('chat');
    }
  }, [folderThreads, allThreads]);

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
      <div className="flex items-center justify-between px-4 py-3 safe-top" style={{ background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-1">
          {currentView !== 'inbox' ? (
            <>
              {/* Back to folder list */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleGoToInbox}
                className="p-2 -ml-2 rounded-lg transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                title="Back to folder list"
              >
                <ArrowLeft className="w-5 h-5" />
              </motion.button>
              
              {/* Current folder indicator - clickable to go back */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGoToInbox}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer hover:bg-blue-500/10 transition-colors"
                style={{ background: 'var(--bg-interactive)' }}
                title={`Back to ${FOLDER_LABELS[currentMailFolder]}`}
              >
                <span className="text-xs font-medium text-blue-400">
                  {FOLDER_LABELS[currentMailFolder]}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {currentThreadIndexRef.current + 1}/{folderThreads.length || allThreads.length}
                </span>
              </motion.button>
              
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
              
              {/* Quick archive */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleTopBarArchive}
                className="p-2 ml-1 rounded-lg transition-colors hover:text-blue-400"
                style={{ color: 'var(--text-muted)' }}
                title="Archive"
              >
                <Archive className="w-4 h-4" />
              </motion.button>
            </>
          ) : (
            <>
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              <span className="font-semibold ml-2" style={{ color: 'var(--text-primary)' }}>FloMail</span>
            </>
          )}
        </div>

          <div className="flex items-center gap-2">
          {/* Profile */}
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="relative"
          >
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="w-8 h-8 rounded-full"
                style={{ boxShadow: '0 0 0 2px var(--border-default)' }}
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
            )}
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
                onSelectThread={handleSelectThread}
                selectedThreadId={selectedThread?.id}
                defaultFolder={currentMailFolder}
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
                onDraftCreated={handleDraftCreated}
                onSendEmail={handleSendEmail}
                onSaveDraft={handleSaveDraft}
                onArchive={handleArchive}
                onMoveToInbox={handleMoveToInbox}
                onStar={handleStar}
                onUnstar={handleUnstar}
                onNextEmail={handleNextEmail}
                onGoToInbox={handleGoToInbox}
                onRegisterArchiveHandler={(handler) => { archiveHandlerRef.current = handler; }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom safe area */}
      <div className="safe-bottom" />
    </div>
  );
}
