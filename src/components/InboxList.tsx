'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from 'framer-motion';
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
  FileEdit
} from 'lucide-react';
import { EmailThread } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { fetchInbox, archiveThread, markAsRead, listGmailDrafts, GmailDraftInfo, getThreadsWithDrafts, fetchThread } from '@/lib/gmail';
import { emailCache } from '@/lib/email-cache';

// Available mail folders/views
export type MailFolder = 'inbox' | 'sent' | 'starred' | 'all' | 'archive' | 'drafts';

// Gmail API label configuration
// Note: Gmail uses LABELS not folders. Archive is NOT a label - 
// archived messages are simply messages without the INBOX label.
const FOLDER_CONFIG: Record<MailFolder, { 
  label: string; 
  labelIds?: string[];  // Gmail system label IDs (preferred)
  query?: string;       // Fallback search query
  icon: React.ElementType;
  isDrafts?: boolean;   // Special handling for drafts
}> = {
  inbox: { label: 'Inbox', labelIds: ['INBOX'], icon: Inbox },
  archive: { label: 'Archive', query: '-in:inbox -in:spam -in:trash', icon: Archive },
  sent: { label: 'Sent', labelIds: ['SENT'], icon: Send },
  drafts: { label: 'Drafts', labelIds: ['DRAFT'], icon: FileEdit, isDrafts: true },
  starred: { label: 'Starred', labelIds: ['STARRED'], icon: Star },
  all: { label: 'All Mail', icon: Mail }, // No filter = all mail
};

interface InboxListProps {
  onSelectThread: (thread: EmailThread, folder: MailFolder, folderThreads: EmailThread[]) => void;
  selectedThreadId?: string;
}

export function InboxList({ onSelectThread, selectedThreadId }: InboxListProps) {
  const { getAccessToken } = useAuth();
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [drafts, setDrafts] = useState<GmailDraftInfo[]>([]);
  const [threadsWithDrafts, setThreadsWithDrafts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<MailFolder>('inbox');
  // Always skip entrance animations - they cause visual glitches and delays
  // Keeping this as a constant true instead of removing to minimize code changes
  const skipAnimation = true;

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
        
        // Cache the result
        emailCache.setFolderData(folder, { threads: [], drafts: draftList });
      } else {
        // Use labelIds when available (proper Gmail API approach), 
        // fall back to query for archive (which has no label)
        const [{ threads: fetchedThreads }, draftThreadIds] = await Promise.all([
          fetchInbox(token, { 
            labelIds: config.labelIds,
            query: config.query 
          }),
          getThreadsWithDrafts(token),
        ]);
        setThreads(fetchedThreads);
        setThreadsWithDrafts(draftThreadIds);
        setDrafts([]);
        
        // Cache the result
        emailCache.setFolderData(folder, { 
          threads: fetchedThreads, 
          threadsWithDrafts: draftThreadIds 
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
    }
  }, [getAccessToken]);

  useEffect(() => {
    loadFolder(currentFolder);
  }, [currentFolder, loadFolder]);

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
      
      setCurrentFolder(folder);
    }
  };

  const handleArchive = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      await archiveThread(token, threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      
      // Update cache: remove from current folder, invalidate archive (it moved there)
      emailCache.removeThreadFromFolder(currentFolder, threadId);
      emailCache.invalidateFolder('archive');
    } catch (err) {
      console.error('Failed to archive:', err);
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
          onClick={() => loadFolder(currentFolder)}
          className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  const FolderIcon = FOLDER_CONFIG[currentFolder].icon;
  
  // Define tab order explicitly: Inbox → Archive → Sent → Drafts → Starred → All Mail
  const FOLDER_ORDER: MailFolder[] = ['inbox', 'archive', 'sent', 'drafts', 'starred', 'all'];

  return (
    <div className="flex flex-col h-full">
      {/* Folder tabs - combined with header (selected folder is prominent) */}
      <div className="flex items-center gap-1 px-2 py-2.5 border-b border-slate-800/50 overflow-x-auto">
        {FOLDER_ORDER.map((folder) => {
          const config = FOLDER_CONFIG[folder];
          const Icon = config.icon;
          const isActive = folder === currentFolder;
          
          return (
            <button
              key={folder}
              onClick={() => handleFolderChange(folder)}
              className={`flex items-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-all ${
                isActive 
                  ? 'px-4 py-2 bg-purple-500/25 text-purple-200 border border-purple-500/40 text-base shadow-sm' 
                  : 'px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
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
          className="ml-auto p-2 rounded-lg hover:bg-slate-800 transition-colors flex-shrink-0"
        >
          <RefreshCw className={`w-5 h-5 text-slate-400 ${refreshing ? 'animate-spin' : ''}`} />
        </motion.button>
      </div>

      {/* Email List */}
      <div className="flex-1 overflow-y-auto">
        {/* Drafts folder - show drafts */}
        {currentFolder === 'drafts' ? (
          drafts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <FileEdit className="w-12 h-12 text-slate-600 mb-4" />
              <p className="text-slate-400">No drafts</p>
            </div>
          ) : (
            <div>
              {drafts.map((draft, index) => (
                <motion.div
                  key={draft.id}
                  initial={skipAnimation ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={skipAnimation ? { duration: 0 } : { delay: index * 0.02 }}
                  className="px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer transition-colors"
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
                        <span className="text-sm text-slate-400 truncate">
                          To: {draft.to.length > 0 ? draft.to.join(', ') : '(no recipient)'}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-slate-200 truncate mt-0.5">
                        {draft.subject || '(No Subject)'}
                      </div>
                      <div className="text-xs text-slate-500 truncate mt-0.5">
                        {draft.snippet}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 flex-shrink-0">
                      {formatDate(draft.date)}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <FolderIcon className="w-12 h-12 text-slate-600 mb-4" />
            <p className="text-slate-400">No emails in {FOLDER_CONFIG[currentFolder].label.toLowerCase()}</p>
          </div>
        ) : (
          <AnimatePresence>
            {threads.map((thread, index) => (
              <SwipeableEmailRow
                key={thread.id}
                thread={thread}
                index={index}
                isSelected={selectedThreadId === thread.id}
                hasDraft={threadsWithDrafts.has(thread.id)}
                skipAnimation={skipAnimation}
                onSelect={() => handleSelect(thread)}
                onArchive={(e) => handleArchive(e, thread.id)}
                getSenderNames={getSenderNames}
                formatDate={formatDate}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

// Swipeable email row component
interface SwipeableEmailRowProps {
  thread: EmailThread;
  index: number;
  isSelected: boolean;
  hasDraft?: boolean; // Whether this thread has a draft
  skipAnimation?: boolean; // Skip entrance animation (for cached data)
  onSelect: () => void;
  onArchive: (e: React.MouseEvent) => void;
  getSenderNames: (thread: EmailThread) => string;
  formatDate: (date: string) => string;
}

function SwipeableEmailRow({
  thread,
  index,
  isSelected,
  hasDraft,
  skipAnimation,
  onSelect,
  onArchive,
  getSenderNames,
  formatDate,
}: SwipeableEmailRowProps) {
  const x = useMotionValue(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Transform for the archive background opacity
  const archiveBgOpacity = useTransform(x, [-150, -50, 0], [1, 0.5, 0]);
  const archiveIconScale = useTransform(x, [-150, -80, 0], [1.2, 1, 0.8]);
  
  const SWIPE_THRESHOLD = -100; // How far to swipe to trigger archive
  
  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    
    if (info.offset.x < SWIPE_THRESHOLD) {
      // Trigger archive
      setIsArchiving(true);
      // Animate off screen then archive
      setTimeout(() => {
        onArchive({ stopPropagation: () => {} } as React.MouseEvent);
      }, 200);
    }
  };
  
  const handleDragStart = () => {
    setIsDragging(true);
  };

  if (isArchiving) {
    return (
      <motion.div
        initial={{ opacity: 1, x: 0 }}
        animate={{ opacity: 0, x: -300 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-green-500/20 border-b border-slate-800/30"
      >
        <div className="flex items-center justify-center gap-2 py-6 text-green-400">
          <Archive className="w-5 h-5" />
          <span className="text-sm font-medium">Archived</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={containerRef}
      initial={skipAnimation ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={skipAnimation ? { duration: 0 } : { delay: index * 0.03 }}
      className="relative overflow-hidden"
    >
      {/* Archive action background (revealed on swipe) */}
      <motion.div 
        className="absolute inset-0 bg-gradient-to-l from-green-600 to-green-700 flex items-center justify-end pr-6"
        style={{ opacity: archiveBgOpacity }}
      >
        <motion.div style={{ scale: archiveIconScale }}>
          <Archive className="w-6 h-6 text-white" />
        </motion.div>
      </motion.div>
      
      {/* Swipeable content */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -150, right: 0 }}
        dragElastic={0.1}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        style={{ x }}
        animate={!isDragging ? { x: 0 } : undefined}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        onClick={() => !isDragging && onSelect()}
        className={`
          relative cursor-pointer bg-slate-900
          ${isSelected ? 'bg-purple-500/10' : 'hover:bg-slate-800/50'}
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
                {/* Draft indicator - next to message count */}
                {hasDraft && (
                  <span className="flex-shrink-0 text-xs font-semibold text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded">
                    Draft
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

          {/* Archive button (always visible on right) */}
          <div className="flex items-center gap-1 self-center">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => {
                e.stopPropagation();
                onArchive(e);
              }}
              className="p-2 rounded-lg bg-slate-800/50 hover:bg-green-500/20 text-slate-500 hover:text-green-400 transition-colors"
              title="Archive"
            >
              <Archive className="w-4 h-4" />
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

