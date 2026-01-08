'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  RefreshCw, 
  Mail, 
  MailOpen, 
  Archive, 
  Trash2,
  ChevronRight,
  Loader2,
  Paperclip
} from 'lucide-react';
import { EmailThread } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { fetchInbox, archiveThread, trashThread, markAsRead } from '@/lib/gmail';

interface InboxListProps {
  onSelectThread: (thread: EmailThread) => void;
  selectedThreadId?: string;
}

export function InboxList({ onSelectThread, selectedThreadId }: InboxListProps) {
  const { getAccessToken } = useAuth();
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInbox = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const { threads: fetchedThreads } = await fetchInbox(token);
      setThreads(fetchedThreads);
    } catch (err: any) {
      console.error('Failed to load inbox:', err);
      setError(err.message || 'Failed to load inbox');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  const handleArchive = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      await archiveThread(token, threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
    } catch (err) {
      console.error('Failed to archive:', err);
    }
  };

  const handleTrash = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      await trashThread(token, threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
    } catch (err) {
      console.error('Failed to trash:', err);
    }
  };

  const handleSelect = async (thread: EmailThread) => {
    onSelectThread(thread);
    
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
        }
      } catch (err) {
        console.error('Failed to mark as read:', err);
      }
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

  const getSenderNames = (thread: EmailThread) => {
    if (thread.messages.length === 1) {
      const msg = thread.messages[0];
      return msg.from.name || msg.from.email.split('@')[0] || 'Unknown';
    }
    
    // For multiple messages, show unique senders (like Gmail: "John, Me, Sarah")
    const seen = new Set<string>();
    const names: string[] = [];
    
    for (const msg of thread.messages) {
      const name = msg.from.name || msg.from.email.split('@')[0] || 'Unknown';
      // Check if this is "me" (could check against user email if we had it)
      const shortName = name.length > 12 ? name.substring(0, 12) + '…' : name;
      
      if (!seen.has(msg.from.email)) {
        seen.add(msg.from.email);
        names.push(shortName);
      }
    }
    
    // Limit to 3 names max
    if (names.length > 3) {
      return names.slice(0, 2).join(', ') + ' +' + (names.length - 2);
    }
    return names.join(', ');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={() => loadInbox()}
          className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/50">
        <h1 className="text-xl font-bold text-slate-100">Inbox</h1>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => loadInbox(true)}
          disabled={refreshing}
          className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className={`w-5 h-5 text-slate-400 ${refreshing ? 'animate-spin' : ''}`} />
        </motion.button>
      </div>

      {/* Email List */}
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <Mail className="w-12 h-12 text-slate-600 mb-4" />
            <p className="text-slate-400">Your inbox is empty</p>
          </div>
        ) : (
          <AnimatePresence>
            {threads.map((thread, index) => (
              <motion.div
                key={thread.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ delay: index * 0.03 }}
                onClick={() => handleSelect(thread)}
                className={`
                  relative group cursor-pointer
                  ${selectedThreadId === thread.id ? 'bg-purple-500/10' : 'hover:bg-slate-800/50'}
                  ${!thread.isRead ? 'bg-slate-800/30' : ''}
                  transition-colors
                `}
              >
                <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-800/30">
                  {/* Unread indicator */}
                  <div className="flex-shrink-0 pt-1">
                    {thread.isRead ? (
                      <MailOpen className="w-5 h-5 text-slate-600" />
                    ) : (
                      <Mail className="w-5 h-5 text-purple-400" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`font-medium truncate ${!thread.isRead ? 'text-slate-100' : 'text-slate-300'}`}>
                          {getSenderNames(thread)}
                        </span>
                        {/* Message count - Gmail style */}
                        {thread.messages.length > 1 && (
                          <span className="flex-shrink-0 text-xs text-slate-500 font-medium">
                            ({thread.messages.length})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Attachment indicator */}
                        {thread.messages.some(m => m.hasAttachments) && (
                          <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                        )}
                        <span className="text-xs text-slate-500">
                          {formatDate(thread.lastMessageDate)}
                        </span>
                      </div>
                    </div>
                    <p className={`text-sm truncate mb-1 ${!thread.isRead ? 'text-slate-200' : 'text-slate-400'}`}>
                      {thread.subject || '(No Subject)'}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {thread.snippet}
                    </p>
                  </div>

                  {/* Chevron */}
                  <ChevronRight className="w-5 h-5 text-slate-600 flex-shrink-0 self-center opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Swipe actions (visible on hover) */}
                <div className="absolute right-12 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => handleArchive(e, thread.id)}
                    className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
                  >
                    <Archive className="w-4 h-4 text-slate-300" />
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(e) => handleTrash(e, thread.id)}
                    className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 transition-colors"
                  >
                    <Trash2 className="w-4 h-4 text-red-400" />
                  </motion.button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

