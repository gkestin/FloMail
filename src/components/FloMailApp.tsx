'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { LoginScreen } from './LoginScreen';
import { InboxList } from './InboxList';
import { EmailView } from './EmailView';
import { ChatInterface } from './ChatInterface';
import { EmailThread, EmailDraft } from '@/types';
import { Loader2, LogOut, User, MessageSquare, Inbox, ArrowLeft } from 'lucide-react';
import { sendEmail, archiveThread, fetchInbox } from '@/lib/gmail';

type View = 'inbox' | 'email' | 'chat';

export function FloMailApp() {
  const { user, loading, signOut, getAccessToken } = useAuth();
  const [currentView, setCurrentView] = useState<View>('inbox');
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null);
  const [currentDraft, setCurrentDraft] = useState<EmailDraft | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [allThreads, setAllThreads] = useState<EmailThread[]>([]);
  const currentThreadIndexRef = useRef(0);

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

  const handleSelectThread = useCallback((thread: EmailThread) => {
    setSelectedThread(thread);
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
      
      // Remove from local list
      setAllThreads((prev) => prev.filter((t) => t.id !== selectedThread.id));
      
      // Move to next email automatically
      handleNextEmail();
    } catch (err) {
      console.error('Failed to archive:', err);
    }
  }, [selectedThread, getAccessToken]);

  const handleNextEmail = useCallback(() => {
    const nextIndex = currentThreadIndexRef.current + 1;
    
    // Filter out the current thread if it was archived
    const availableThreads = allThreads.filter((t) => t.id !== selectedThread?.id);
    
    if (availableThreads.length === 0) {
      // No more emails
      setSelectedThread(null);
      setCurrentDraft(null);
      setCurrentView('inbox');
      return;
    }

    // Get next thread (wrap around if needed)
    const nextThread = availableThreads[Math.min(nextIndex, availableThreads.length - 1)] || availableThreads[0];
    
    if (nextThread) {
      setSelectedThread(nextThread);
      setCurrentDraft(null);
      currentThreadIndexRef.current = allThreads.findIndex((t) => t.id === nextThread.id);
      // Stay in chat view for flow
      setCurrentView('chat');
    } else {
      handleGoToInbox();
    }
  }, [allThreads, selectedThread, handleGoToInbox]);

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
        <div className="flex items-center gap-2">
          {currentView !== 'inbox' ? (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleGoToInbox}
              className="p-2 -ml-2 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-300" />
            </motion.button>
          ) : (
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">F</span>
            </div>
          )}
          <span className="font-semibold text-slate-200">
            {currentView === 'inbox' ? 'FloMail' : selectedThread?.subject || 'FloMail'}
          </span>
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
                onDraftCreated={handleDraftCreated}
                onSendEmail={handleSendEmail}
                onArchive={handleArchive}
                onNextEmail={handleNextEmail}
                onGoToInbox={handleGoToInbox}
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
