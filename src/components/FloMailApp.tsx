'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { LoginScreen } from './LoginScreen';
import { InboxList, MailFolder } from './InboxList';
import { EmailView } from './EmailView';
import { ChatInterface } from './ChatInterface';
import { EmailThread, EmailDraft } from '@/types';
import { Loader2, LogOut, User, MessageSquare, Inbox, ArrowLeft, ChevronLeft, ChevronRight, Archive } from 'lucide-react';
import { sendEmail, archiveThread, fetchInbox } from '@/lib/gmail';

type View = 'inbox' | 'email' | 'chat';

export function FloMailApp() {
  const { user, loading, signOut, getAccessToken } = useAuth();
  const [currentView, setCurrentView] = useState<View>('inbox');
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null);
  const [currentDraft, setCurrentDraft] = useState<EmailDraft | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [allThreads, setAllThreads] = useState<EmailThread[]>([]);
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

  const handleSelectThread = useCallback((thread: EmailThread, folder: MailFolder = 'inbox') => {
    setSelectedThread(thread);
    setCurrentMailFolder(folder);
    // Find index in all threads
    const idx = allThreads.findIndex((t) => t.id === thread.id);
    if (idx !== -1) {
      currentThreadIndexRef.current = idx;
    }
    setCurrentView('chat'); // Go directly to chat for the "flow" experience
  }, [allThreads]);

  const handleBack = useCallback(() => {
    if (currentView === 'chat') {
      setCurrentView('email');
    } else {
      setSelectedThread(null);
      setCurrentDraft(null);
      setCurrentView('inbox');
    }
  }, [currentView]);

  const handleGoToInbox = useCallback(() => {
    setSelectedThread(null);
    setCurrentDraft(null);
    setCurrentView('inbox');
    loadThreads(); // Refresh
  }, [loadThreads]);

  const handleOpenChat = useCallback(() => {
    setCurrentView('chat');
  }, []);

  const handleDraftCreated = useCallback((draft: EmailDraft) => {
    setCurrentDraft(draft);
  }, []);

  const handleSendEmail = useCallback(async (draft: EmailDraft) => {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');
    
    await sendEmail(token, draft);
    setCurrentDraft(null);
  }, [getAccessToken]);

  const handleArchive = useCallback(async () => {
    if (!selectedThread) return;
    
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      await archiveThread(token, selectedThread.id);
      
      // Get the next thread BEFORE removing from list
      const currentIndex = allThreads.findIndex(t => t.id === selectedThread.id);
      const remainingThreads = allThreads.filter((t) => t.id !== selectedThread.id);
      
      // Remove from local list
      setAllThreads(remainingThreads);
      
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
  }, [selectedThread, getAccessToken, allThreads]);

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
    if (allThreads.length === 0) {
      setSelectedThread(null);
      setCurrentDraft(null);
      setCurrentView('inbox');
      return;
    }

    // Simply go to next index in the list
    const currentIndex = currentThreadIndexRef.current;
    const nextIndex = currentIndex + 1;
    
    // If we're past the end, stay at last or wrap to first
    const nextThread = allThreads[nextIndex] || allThreads[allThreads.length - 1];
    
    if (nextThread && nextThread.id !== selectedThread?.id) {
      setSelectedThread(nextThread);
      setCurrentDraft(null);
      currentThreadIndexRef.current = nextIndex < allThreads.length ? nextIndex : allThreads.length - 1;
      setCurrentView('chat');
    } else if (allThreads.length > 0 && nextIndex >= allThreads.length) {
      // Already at the last email
      // Optionally go to inbox or stay
    }
  }, [allThreads, selectedThread]);

  const handlePreviousEmail = useCallback(() => {
    const prevIndex = currentThreadIndexRef.current - 1;
    
    if (prevIndex < 0 || allThreads.length === 0) {
      // No previous emails, stay where we are or go to inbox
      return;
    }

    const prevThread = allThreads[prevIndex];
    
    if (prevThread) {
      setSelectedThread(prevThread);
      setCurrentDraft(null);
      currentThreadIndexRef.current = prevIndex;
      setCurrentView('chat');
    }
  }, [allThreads]);

  const handleClearDraft = useCallback(() => {
    setCurrentDraft(null);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return <LoginScreen />;
  }

  // Main app
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
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
              className="absolute top-16 right-4 z-50 w-64 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl overflow-hidden"
            >
              <div className="p-4 border-b border-slate-700">
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
                    <p className="font-medium text-slate-200 truncate">
                      {user.displayName || 'User'}
                    </p>
                    <p className="text-sm text-slate-400 truncate">{user.email}</p>
                  </div>
                </div>
              </div>
              <button
                onClick={signOut}
                className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-300 hover:bg-slate-700/50 transition-colors"
              >
                <LogOut className="w-5 h-5 text-slate-400" />
                Sign out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/80 backdrop-blur-lg border-b border-slate-800/50 safe-top">
        <div className="flex items-center gap-1">
          {currentView !== 'inbox' ? (
            <>
              {/* Back to inbox */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleGoToInbox}
                className="p-2 -ml-2 rounded-lg hover:bg-slate-800 transition-colors"
                title="Back to inbox"
              >
                <Inbox className="w-5 h-5 text-slate-300" />
              </motion.button>
              
              {/* Previous/Next navigation - clear labeled buttons */}
              <div className="flex items-center gap-1 ml-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handlePreviousEmail}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 transition-colors text-slate-400 hover:text-slate-200"
                  title="Previous email"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="text-xs font-medium">Prev</span>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleNextEmail}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700 transition-colors text-slate-400 hover:text-slate-200"
                  title="Next email"
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
                className="p-2 ml-1 rounded-lg hover:bg-slate-800 hover:text-blue-400 transition-colors"
                title="Archive"
              >
                <Archive className="w-4 h-4 text-slate-400" />
              </motion.button>
            </>
          ) : (
            <>
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              <span className="font-semibold text-slate-200 ml-2">FloMail</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View toggle */}
          {selectedThread && (
            <div className="flex bg-slate-800 rounded-lg p-1">
              <button
                onClick={() => setCurrentView('email')}
                className={`p-1.5 rounded transition-colors ${
                  currentView === 'email'
                    ? 'bg-slate-700 text-slate-200'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
                title="Email view"
              >
                <Inbox className="w-4 h-4" />
              </button>
              <button
                onClick={() => setCurrentView('chat')}
                className={`p-1.5 rounded transition-colors ${
                  currentView === 'chat'
                    ? 'bg-slate-700 text-slate-200'
                    : 'text-slate-400 hover:text-slate-300'
                }`}
                title="Chat view"
              >
                <MessageSquare className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Profile */}
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="relative"
          >
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="w-8 h-8 rounded-full ring-2 ring-slate-700"
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
              />
            </motion.div>
          )}

          {currentView === 'email' && selectedThread && (
            <motion.div
              key="email"
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              className="absolute inset-0"
            >
              <EmailView
                thread={selectedThread}
                onBack={handleGoToInbox}
                onArchive={handleArchive}
                onOpenChat={handleOpenChat}
                currentDraft={currentDraft}
                onClearDraft={handleClearDraft}
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
