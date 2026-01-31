'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, Sparkles, ChevronDown, ChevronRight, ChevronLeft, X, Edit2, Edit3, RotateCcw, Mic, Square, Archive, Eye, Inbox, ArrowUp, EyeOff, Search, Globe, ExternalLink, CheckCircle, XCircle, Save, Ghost, Copy, Check, Clock, Trash2 } from 'lucide-react';
import { DraftCard } from './DraftCard';
import { ThreadPreview } from './ThreadPreview';
import { WaveformVisualizer } from './WaveformVisualizer';
import { ChatMessage, EmailThread, EmailDraft, AIProvider, AIDraftingPreferences } from '@/types';
import { ToolCall, buildDraftFromToolCall, buildReplyQuote } from '@/lib/agent-tools';
import { useAuth } from '@/contexts/AuthContext';
import { 
  loadThreadChat, 
  saveThreadChat, 
  toPersistedMessage, 
  fromPersistedMessage,
  PersistedMessage 
} from '@/lib/chat-persistence';
import { getDraftForThread, FullGmailDraft } from '@/lib/gmail';
import { TTSController, stopAllTTS } from './TTSController';

// Custom hook for button press animation
function useButtonAnimation() {
  return useCallback((e: React.MouseEvent<HTMLButtonElement>, callback: () => void) => {
    const btn = e.currentTarget;
    btn.classList.add('button-press-glow');
    setTimeout(() => btn.classList.remove('button-press-glow'), 300);
    callback();
  }, []);
}

// Collapsed view for completed drafts (cancelled, saved, or sent)
function CompletedDraftPreview({ 
  draft, 
  status 
}: { 
  draft: EmailDraft; 
  status: 'cancelled' | 'saved' | 'sent';
}) {
  const [expanded, setExpanded] = useState(false);
  
  // Check if there are CC/BCC recipients
  const hasCc = draft.cc && draft.cc.length > 0;
  const hasBcc = draft.bcc && draft.bcc.length > 0;
  
  // Different styling for each status - improved contrast for visibility
  const statusConfig = {
    cancelled: {
      icon: X,
      label: 'Cancelled draft',
      borderColor: 'border-slate-600/40',
      bgColor: 'bg-slate-700/30',
      iconColor: 'text-slate-400',
      labelColor: 'text-slate-300',
      opacity: 'opacity-75',
    },
    saved: {
      icon: Save,
      label: 'Saved draft',
      borderColor: 'border-blue-500/40',
      bgColor: 'bg-blue-900/25',
      iconColor: 'text-blue-400',
      labelColor: 'text-blue-300',
      opacity: 'opacity-80',
    },
    sent: {
      icon: Send,
      label: 'Sent',
      borderColor: 'border-green-500/40',
      bgColor: 'bg-green-900/25',
      iconColor: 'text-green-400',
      labelColor: 'text-green-300',
      opacity: 'opacity-80',
    },
  };
  
  const config = statusConfig[status];
  const Icon = config.icon;
  
  return (
    <div className={`${config.bgColor} rounded-xl border ${config.borderColor} overflow-hidden ${config.opacity}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Icon className={`w-4 h-4 ${config.iconColor} flex-shrink-0`} />
          <span className={`text-sm ${config.labelColor}`}>{config.label}</span>
          <span className="text-xs text-slate-500">• {draft.to.join(', ').slice(0, 20)}{draft.to.join(', ').length > 20 ? '...' : ''}</span>
          {/* Show CC/BCC inline if they exist */}
          {hasCc && (
            <span className="text-xs text-slate-500">
              <span className="text-slate-600">CC:</span> {draft.cc!.join(', ').slice(0, 15)}{draft.cc!.join(', ').length > 15 ? '...' : ''}
            </span>
          )}
          {hasBcc && (
            <span className="text-xs text-slate-500">
              <span className="text-slate-600">BCC:</span> {draft.bcc!.join(', ').slice(0, 15)}{draft.bcc!.join(', ').length > 15 ? '...' : ''}
            </span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      
      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-700/30 space-y-1.5 text-sm">
          <div className="flex gap-2">
            <span className="text-slate-500 w-12">To:</span>
            <span className="text-slate-400">{draft.to.join(', ')}</span>
          </div>
          {hasCc && (
            <div className="flex gap-2">
              <span className="text-slate-500 w-12">CC:</span>
              <span className="text-slate-400">{draft.cc!.join(', ')}</span>
            </div>
          )}
          {hasBcc && (
            <div className="flex gap-2">
              <span className="text-slate-500 w-12">BCC:</span>
              <span className="text-slate-400">{draft.bcc!.join(', ')}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-slate-500 w-12">Subj:</span>
            <span className="text-slate-400">{draft.subject}</span>
          </div>
          <div className="mt-2 p-2 bg-slate-900/50 rounded-lg text-slate-400 text-xs whitespace-pre-wrap max-h-32 overflow-y-auto">
            {draft.body}
          </div>
        </div>
      )}
    </div>
  );
}

// Copy button for AI responses
function CopyButton({ content, className = '' }: { content: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };
  
  return (
    <button
      onClick={handleCopy}
      className={`p-1 rounded transition-opacity ${className}`}
      style={{ color: 'var(--text-muted)' }}
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

// TTS settings helper export (used by settings panel)
export function saveTTSSettings(settings: Partial<{ voice: string; speed: number; useNaturalVoice: boolean }>) {
  if (typeof window === 'undefined') return;
  try {
    const stored = localStorage.getItem('flomail_tts_settings');
    const current = stored ? JSON.parse(stored) : { voice: 'nova', speed: 1.0, useNaturalVoice: true };
    localStorage.setItem('flomail_tts_settings', JSON.stringify({ ...current, ...settings }));
  } catch {}
}

// Import folder type
import { MailFolder } from './InboxList';

interface ChatInterfaceProps {
  thread?: EmailThread;
  folder?: MailFolder;
  threadLabels?: string[]; // Current Gmail labels on the thread
  // AI settings (managed by parent)
  provider?: AIProvider;
  model?: string;
  draftingPreferences?: AIDraftingPreferences;
  onDraftCreated?: (draft: EmailDraft) => void;
  onSendEmail?: (draft: EmailDraft) => Promise<void>;
  onSaveDraft?: (draft: EmailDraft) => Promise<EmailDraft>;
  onDeleteDraft?: (draftId: string) => Promise<void>; // Delete draft from Gmail
  onArchive?: () => void;
  onMoveToInbox?: () => void;
  onStar?: () => void;
  onUnstar?: () => void;
  onSnooze?: (snoozeUntil: Date) => Promise<void>; // Snooze email until specified time
  onOpenSnoozePicker?: () => void; // Open snooze picker modal for editing
  onNextEmail?: () => void;
  onPreviousEmail?: () => void;
  onGoToInbox?: () => void;
  // Callback to register archive handler that includes notification
  onRegisterArchiveHandler?: (handler: () => void) => void;
}

interface SearchResult {
  type: 'web_search' | 'browse_url' | 'search_emails';
  query: string;
  success: boolean;
  resultPreview?: string;
}

interface UIMessage extends ChatMessage {
  toolCalls?: ToolCall[];
  draft?: EmailDraft;
  isTranscribing?: boolean;
  transcriptionError?: boolean;
  isEditing?: boolean;
  isCancelled?: boolean;
  isStreaming?: boolean; // Content is still being streamed
  draftCancelled?: boolean; // Draft was cancelled but kept for history
  draftSaved?: boolean; // Draft was saved to Gmail
  draftSent?: boolean; // Draft was sent
  isSystemMessage?: boolean; // For action confirmations (archive, navigate, etc.)
  systemType?: 'archived' | 'sent' | 'navigated' | 'context' | 'search'; // Type of system message
  // Stored data for system messages (so we don't rely on current thread state)
  systemSnippet?: string;
  systemPreview?: string;
  // Action buttons for post-send flow
  hasActionButtons?: boolean;
  actionButtonsHandled?: boolean; // Set to true once user clicks a button
  // Search results
  searchResults?: SearchResult[];
  // Snooze confirmation
  snoozeConfirmation?: {
    date: string; // ISO date string
    confirmed: boolean; // Whether user confirmed
  };
}

export function ChatInterface({
  thread,
  folder = 'inbox',
  threadLabels = [],
  provider = 'anthropic',
  model = 'claude-sonnet-4-20250514',
  draftingPreferences,
  onDraftCreated,
  onSendEmail,
  onSaveDraft,
  onDeleteDraft,
  onArchive,
  onMoveToInbox,
  onStar,
  onUnstar,
  onSnooze,
  onOpenSnoozePicker,
  onNextEmail,
  onPreviousEmail,
  onGoToInbox,
  onRegisterArchiveHandler,
}: ChatInterfaceProps) {
  const { user, getAccessToken } = useAuth();
  const animateButton = useButtonAnimation();
  
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [collapsedMessages, setCollapsedMessages] = useState<UIMessage[]>([]);
  const [showCollapsedMessages, setShowCollapsedMessages] = useState(false);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('Thinking...');
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [currentDraft, setCurrentDraft] = useState<EmailDraft | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  
  // Chat persistence state
  const [isIncognito, setIsIncognito] = useState(false);
  const [isLoadingChat, setIsLoadingChat] = useState(false);
  
  // Undo send state - delayed send with undo option
  const [pendingSend, setPendingSend] = useState<{
    draft: EmailDraft;
    timeoutId: NodeJS.Timeout;
    timestamp: number;
    confirmMessageId: string; // ID of the "Sending to..." message to update
  } | null>(null);
  const pendingSendRef = useRef<typeof pendingSend>(null);
  const [undoCountdown, setUndoCountdown] = useState(5);
  
  // Track if message region is fully expanded (for mobile action buttons)
  const [isMessageFullyExpanded, setIsMessageFullyExpanded] = useState(false);
  
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const transcriptionBlobsRef = useRef<Map<string, Blob>>(new Map());
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const previousThreadIdRef = useRef<string | null>(null);
  const pendingNavTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Track which thread the current messages belong to (to prevent race conditions)
  const messagesThreadIdRef = useRef<string | null>(null);
  
  // ===========================================
  // PULL-TO-REVEAL STATE
  // ===========================================
  // Storage key for persisting the load preference
  const LOAD_PREF_KEY = 'threadPreview_loadExpanded';
  
  // Get initial load preference from localStorage (true = start with 1 message, false = start collapsed)
  const getLoadPreference = useCallback((): number => {
    if (typeof window === 'undefined') return 1;
    const saved = localStorage.getItem(LOAD_PREF_KEY);
    return saved === 'false' ? 0 : 1; // Default to expanded (1)
  }, []);
  
  // 0 = thread collapsed, 1+ = thread expanded with N messages visible
  const [revealedMessageCount, setRevealedMessageCount] = useState(() => getLoadPreference());
  // Base count = what was set by manual action (header click). Used for reference only.
  const [baseRevealedCount, setBaseRevealedCount] = useState(() => getLoadPreference());
  
  // Refs to always have latest values in event handlers (avoids stale closures)
  const revealedCountRef = useRef(revealedMessageCount);
  const baseCountRef = useRef(baseRevealedCount);
  useEffect(() => { revealedCountRef.current = revealedMessageCount; }, [revealedMessageCount]);
  useEffect(() => { baseCountRef.current = baseRevealedCount; }, [baseRevealedCount]);
  useEffect(() => { pendingSendRef.current = pendingSend; }, [pendingSend]);

  // Update countdown timer for undo
  useEffect(() => {
    if (!pendingSend) {
      setUndoCountdown(5);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - pendingSend.timestamp;
      const remaining = Math.max(0, 5000 - elapsed);
      const seconds = Math.ceil(remaining / 1000);
      setUndoCountdown(seconds);

      if (seconds <= 0) {
        clearInterval(interval);
      }
    }, 100); // Update every 100ms for smooth countdown

    return () => clearInterval(interval);
  }, [pendingSend]);
  
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const isPullingRef = useRef(false);
  const pullStartY = useRef(0);
  const lastScrollTop = useRef(0);
  
  // Callback for ThreadPreview MANUAL actions (header click) - sets BOTH base and current
  // Also saves the preference for future loads
  const handleRevealedCountChange = useCallback((count: number) => {
    setBaseRevealedCount(count);
    setRevealedMessageCount(count);
    // Save preference: if collapsed (0), remember that; if expanded (1+), remember expanded
    localStorage.setItem(LOAD_PREF_KEY, count > 0 ? 'true' : 'false');
  }, []);
  
  // Callback for SCROLL actions - only sets current, not base
  // Also saves preference when collapsing to 0
  const handleScrollReveal = useCallback((count: number) => {
    setRevealedMessageCount(count);
    // If scroll-collapsed to 0, save that preference
    if (count === 0) {
      localStorage.setItem(LOAD_PREF_KEY, 'false');
    }
  }, []);

  // Load chat history when thread changes
  useEffect(() => {
    if (!thread?.id || !user?.uid) {
      // No thread or user - clear messages
      setMessages([]);
      setCollapsedMessages([]);
      setShowCollapsedMessages(false);
      previousThreadIdRef.current = null;
      messagesThreadIdRef.current = null;
      return;
    }
    
    const currentId = thread.id;
    const prevId = previousThreadIdRef.current;
    
    // Skip if same thread
    if (prevId === currentId) {
      return;
    }
    
    previousThreadIdRef.current = currentId;
    
    // IMPORTANT: Cancel any pending persist timeout to prevent saving old messages to new thread
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }
    
    // Cancel any pending navigation timeout
    if (pendingNavTimeoutRef.current) {
      clearTimeout(pendingNavTimeoutRef.current);
      pendingNavTimeoutRef.current = null;
    }
    
    // Only show loading spinner if thread doesn't have full content yet
    const hasFullContent = thread?.messages && thread.messages.length > 0;
    if (!hasFullContent) {
      setIsLoadingChat(true);
    }
    
    // Clear messages and mark that we're switching threads
    // This prevents any race conditions with persisting
    messagesThreadIdRef.current = null; // Clear thread association before loading
    setMessages([]);
    setCollapsedMessages([]);
    setShowCollapsedMessages(false);
    setCurrentDraft(null);
    
    // In incognito mode, just clear messages (already done above)
    if (isIncognito) {
      messagesThreadIdRef.current = currentId;
      setIsLoadingChat(false);
      return;
    }
    
    // Load chat history for this thread
    const loadChat = async () => {
      try {
        // Double-check we're still on this thread (user might have navigated again)
        if (previousThreadIdRef.current !== currentId) {
          return;
        }
        
        // Load both persisted chat history and check for existing Gmail draft
        const [chatData, accessToken] = await Promise.all([
          loadThreadChat(user.uid, currentId),
          getAccessToken(),
        ]);

        // Double-check again after async operation
        if (previousThreadIdRef.current !== currentId) {
          return;
        }

        // Check if there are new messages since last chat
        const lastEmailMessageId = thread.messages[thread.messages.length - 1]?.id;
        const hasNewEmailSinceChat = chatData.lastEmailMessageId &&
                                     chatData.lastEmailMessageId !== lastEmailMessageId;

        let uiMessages: UIMessage[] = chatData.messages.map(pm => fromPersistedMessage(pm) as UIMessage);

        // If there are new emails, collapse old messages
        if (hasNewEmailSinceChat && uiMessages.length > 0) {
          // Store the full chat history separately
          setCollapsedMessages(uiMessages);
          setShowCollapsedMessages(false);

          // Only show a placeholder for collapsed messages
          uiMessages = [];
        }
        
        // Check if there's an unsent draft from chat history
        // A draft is only "active" if not cancelled, not saved to Gmail, and not sent
        const lastDraftMsg = [...uiMessages].reverse().find(m => m.draft && !m.draftCancelled && !m.draftSaved && !m.draftSent);
        let draftToRestore: EmailDraft | null = lastDraftMsg?.draft || null;
        
        // Also check Gmail for an existing draft for this thread
        // This handles drafts saved via "Save Draft" button that may not be in chat history
        if (accessToken && !draftToRestore) {
          try {
            const gmailDraft = await getDraftForThread(accessToken, currentId);
            if (gmailDraft && previousThreadIdRef.current === currentId) {
              // Convert Gmail draft to EmailDraft format
              draftToRestore = {
                to: gmailDraft.to,
                cc: gmailDraft.cc,
                bcc: gmailDraft.bcc,
                subject: gmailDraft.subject,
                body: gmailDraft.body,
                type: gmailDraft.type,
                threadId: gmailDraft.threadId,
                inReplyTo: gmailDraft.inReplyTo,
                references: gmailDraft.references,
                gmailDraftId: gmailDraft.id, // Store the Gmail draft ID for updates
              };
              
              // Add a system message indicating the draft was loaded
              uiMessages.push({
                id: `draft-loaded-${Date.now()}`,
                role: 'assistant',
                content: 'You have an unsent draft for this thread. You can continue editing it below.',
                timestamp: new Date(),
                draft: draftToRestore,
                isSystemMessage: true,
                systemType: 'context',
              });
            }
          } catch (e) {
            console.error('Failed to check for Gmail draft:', e);
            // Continue without draft - not critical
          }
        }
        
        // NOW set the thread ID association - messages are ready
        messagesThreadIdRef.current = currentId;
        setMessages(uiMessages);
        
        // Restore the draft if we found one
        if (draftToRestore) {
          setCurrentDraft(draftToRestore);
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
        // Even on error, associate with this thread so new messages can be saved
        if (previousThreadIdRef.current === currentId) {
          messagesThreadIdRef.current = currentId;
          setMessages([]);
        }
      } finally {
        if (previousThreadIdRef.current === currentId) {
          setIsLoadingChat(false);
        }
      }
    };
    
    loadChat();
  }, [thread?.id, user?.uid, isIncognito]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Track if we've already auto-expanded for the current thread to avoid re-collapsing
  const hasAutoExpandedRef = useRef<string | null>(null);

  // Reset revealed messages when thread changes
  // For unread emails, always start expanded (revealed = 1)
  // For read emails, use stored preference
  useEffect(() => {
    // If thread ID changes, reset our tracking
    if (thread?.id !== hasAutoExpandedRef.current) {
      hasAutoExpandedRef.current = null;
    }

    if (thread && !thread.isRead) {
      // Unread email - start fully expanded and remember we did this
      setRevealedMessageCount(1);
      setBaseRevealedCount(1);
      hasAutoExpandedRef.current = thread.id;
    } else if (thread && thread.id !== hasAutoExpandedRef.current) {
      // Only apply stored preference if we haven't already auto-expanded for this thread
      // This prevents re-collapsing when the thread changes from unread to read
      const pref = getLoadPreference();
      setRevealedMessageCount(pref);
      setBaseRevealedCount(pref);
    }
    // If this is the same thread we auto-expanded, don't change anything
  }, [thread?.id, thread?.isRead, getLoadPreference]);

  // ===========================================
  // SCROLL-TO-REVEAL/CLOSE LOGIC + HORIZONTAL NAV
  // ===========================================
  // Behavior:
  // - Scroll UP (deltaY < 0) at top → reveal ONE message at a time
  // - Scroll DOWN (deltaY > 0) anywhere → close ALL to base immediately
  // - Swipe LEFT (deltaX > 0) → go to NEXT thread
  // - Swipe RIGHT (deltaX < 0) → go to PREVIOUS thread
  // 
  // Uses refs for state to avoid stale closure issues
  const hasActedThisGesture = useRef(false);
  const gestureEndTimeout = useRef<NodeJS.Timeout | null>(null);
  const totalMessagesRef = useRef(0);
  const messageNeedsExpandRef = useRef(false);
  const [expandRequestId, setExpandRequestId] = useState(0);
  
  // Refs for navigation callbacks (to avoid stale closures)
  const onNextEmailRef = useRef(onNextEmail);
  const onPreviousEmailRef = useRef(onPreviousEmail);
  useEffect(() => { onNextEmailRef.current = onNextEmail; }, [onNextEmail]);
  useEffect(() => { onPreviousEmailRef.current = onPreviousEmail; }, [onPreviousEmail]);
  
  // Horizontal swipe state
  const horizontalAccumulatedDelta = useRef(0);
  const hasNavigatedThisGesture = useRef(false);

  // Track when we reach the top to prevent momentum scroll from opening message region
  const reachedTopTimeRef = useRef(0);
  const scrollMomentumDelayRef = useRef<NodeJS.Timeout | null>(null);
  const isScrollingEligibleRef = useRef(false);

  useEffect(() => {
    if (thread) {
      totalMessagesRef.current = thread.messages.length;
    }
  }, [thread?.messages.length]);
  
  const handleNeedsExpandChange = useCallback((needsExpand: boolean) => {
    messageNeedsExpandRef.current = needsExpand;
  }, []);
  
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    let accumulatedDelta = 0;
    const revealThreshold = 80;
    
    const resetGesture = () => {
      if (gestureEndTimeout.current) clearTimeout(gestureEndTimeout.current);
      gestureEndTimeout.current = setTimeout(() => {
        hasActedThisGesture.current = false;
        accumulatedDelta = 0;
      }, 40);
    };
    
    // Track touch start position for both vertical and horizontal
    let touchStartX = 0;
    let touchStartY = 0;
    let touchCurrentX = 0;
    
    const handleTouchStart = (e: TouchEvent) => {
      isPullingRef.current = true;
      pullStartY.current = e.touches[0].clientY;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchCurrentX = touchStartX;
      accumulatedDelta = 0;
      hasActedThisGesture.current = false;
      hasNavigatedThisGesture.current = false;
      horizontalAccumulatedDelta.current = 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPullingRef.current) return;
      
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const deltaX = currentX - touchCurrentX;
      const deltaY = currentY - pullStartY.current;
      touchCurrentX = currentX;
      pullStartY.current = currentY;
      
      // Calculate total distance from touch start
      const totalDeltaX = currentX - touchStartX;
      const totalDeltaY = currentY - touchStartY;
      
      const current = revealedCountRef.current;
      const total = totalMessagesRef.current;
      
      // ===========================================
      // HORIZONTAL SWIPE → Navigate between threads
      // ===========================================
      const horizontalThreshold = 80;
      
      // If predominantly horizontal swipe
      if (Math.abs(totalDeltaX) > Math.abs(totalDeltaY) * 1.5 && Math.abs(totalDeltaX) > 30) {
        if (!hasNavigatedThisGesture.current) {
          if (totalDeltaX < -horizontalThreshold) {
            // Swipe LEFT (finger moving left, negative delta) → NEXT
            onNextEmailRef.current?.();
            hasNavigatedThisGesture.current = true;
            e.preventDefault();
          } else if (totalDeltaX > horizontalThreshold) {
            // Swipe RIGHT (finger moving right, positive delta) → PREVIOUS
            onPreviousEmailRef.current?.();
            hasNavigatedThisGesture.current = true;
            e.preventDefault();
          }
        }
        return; // Don't process vertical when doing horizontal swipe
      }
      
      // ===========================================
      // VERTICAL SWIPE → Reveal/collapse messages
      // ===========================================
      // Pull UP (negative delta) = CLOSE ALL to 0 immediately
      if (deltaY < 0 && current > 0) {
        handleScrollReveal(0);
        return;
      }
      
      // Pull DOWN (positive delta) at top = reveal ONE message
      // Only require atTop - atBottom check was causing issues when ThreadPreview expands
      const atTop = container.scrollTop <= 5;
      
      if (deltaY > 0 && atTop) {
        accumulatedDelta += deltaY;
        
        if (!hasActedThisGesture.current && accumulatedDelta > revealThreshold) {
          // Priority order:
          // 1) If collapsed → open (reveal 1)
          // 2) If the most recent message isn't fully visible → request EXPAND
          // 3) Otherwise → reveal next message
          if (current === 0) {
            handleScrollReveal(1);
            hasActedThisGesture.current = true;
          } else if (current === 1 && messageNeedsExpandRef.current) {
            setExpandRequestId((v) => v + 1);
            hasActedThisGesture.current = true;
          } else if (current < total) {
            handleScrollReveal(current + 1);
            hasActedThisGesture.current = true;
          }
          e.preventDefault();
        } else if (hasActedThisGesture.current) {
          e.preventDefault();
        }
      }
    };

    const handleTouchEnd = () => {
      isPullingRef.current = false;
      accumulatedDelta = 0;
      hasActedThisGesture.current = false;
      hasNavigatedThisGesture.current = false;
      horizontalAccumulatedDelta.current = 0;
    };

    const handleWheel = (e: WheelEvent) => {
      const current = revealedCountRef.current;
      const total = totalMessagesRef.current;

      // ===========================================
      // HORIZONTAL SCROLL → Navigate between threads
      // ===========================================
      // Swipe LEFT (deltaX > 0) → NEXT thread
      // Swipe RIGHT (deltaX < 0) → PREVIOUS thread
      const horizontalThreshold = 100;

      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        // Predominantly horizontal scroll
        horizontalAccumulatedDelta.current += e.deltaX;

        if (!hasNavigatedThisGesture.current) {
          if (horizontalAccumulatedDelta.current > horizontalThreshold) {
            // Swipe LEFT → NEXT
            onNextEmailRef.current?.();
            hasNavigatedThisGesture.current = true;
            horizontalAccumulatedDelta.current = 0;
          } else if (horizontalAccumulatedDelta.current < -horizontalThreshold) {
            // Swipe RIGHT → PREVIOUS
            onPreviousEmailRef.current?.();
            hasNavigatedThisGesture.current = true;
            horizontalAccumulatedDelta.current = 0;
          }
        }

        // Reset navigation gesture after short delay
        if (gestureEndTimeout.current) clearTimeout(gestureEndTimeout.current);
        gestureEndTimeout.current = setTimeout(() => {
          hasNavigatedThisGesture.current = false;
          horizontalAccumulatedDelta.current = 0;
        }, 150);

        return; // Don't process vertical scroll when horizontal
      }

      // ===========================================
      // VERTICAL SCROLL → Reveal/collapse messages
      // ===========================================
      // Scroll DOWN (deltaY > 0) = CLOSE ALL to 0 immediately
      // Always allow collapsing to 0, regardless of load preference
      if (e.deltaY > 0 && current > 0) {
        handleScrollReveal(0);
        return; // Exit, allow normal scroll to continue
      }

      // Check scroll position
      const atTop = container.scrollTop <= 5;

      // Track when we reach the top
      if (atTop && !isScrollingEligibleRef.current) {
        // Just reached top - start delay timer
        if (scrollMomentumDelayRef.current) {
          clearTimeout(scrollMomentumDelayRef.current);
        }
        scrollMomentumDelayRef.current = setTimeout(() => {
          isScrollingEligibleRef.current = true;
        }, 50); // 50ms delay to avoid momentum scroll
      } else if (!atTop) {
        // Not at top - reset eligibility
        isScrollingEligibleRef.current = false;
        if (scrollMomentumDelayRef.current) {
          clearTimeout(scrollMomentumDelayRef.current);
          scrollMomentumDelayRef.current = null;
        }
      }

      // Scroll UP (deltaY < 0) at top = reveal ONE message
      // But only if we've been at the top for at least 50ms
      if (e.deltaY < 0 && atTop && isScrollingEligibleRef.current) {
        accumulatedDelta += Math.abs(e.deltaY);

        if (!hasActedThisGesture.current && accumulatedDelta > revealThreshold) {
          // Priority order:
          // 1) If collapsed → open (reveal 1)
          // 2) If the most recent message isn't fully visible → request EXPAND
          // 3) Otherwise → reveal next message
          if (current === 0) {
            handleScrollReveal(1);
            hasActedThisGesture.current = true;
          } else if (current === 1 && messageNeedsExpandRef.current) {
            setExpandRequestId((v) => v + 1);
            hasActedThisGesture.current = true;
          } else if (current < total) {
            handleScrollReveal(current + 1);
            hasActedThisGesture.current = true;
          }
        }

        e.preventDefault();
        resetGesture();
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
      if (gestureEndTimeout.current) clearTimeout(gestureEndTimeout.current);
      if (scrollMomentumDelayRef.current) clearTimeout(scrollMomentumDelayRef.current);
    };
  }, []); // Empty deps - uses refs for all state

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Update model when provider changes

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Persist chat to Firestore (debounced)
  const persistTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const persistChat = useCallback((messagesToSave: UIMessage[], threadIdToSave: string, emailThread?: EmailThread) => {
    // Don't save in incognito mode
    if (isIncognito || !threadIdToSave || !user?.uid) return;
    
    // CRITICAL: Only save if the messages belong to the thread we're saving to
    // This prevents race conditions when navigating between threads
    if (messagesThreadIdRef.current !== threadIdToSave) {
      return;
    }
    
    // Don't save if no meaningful messages (only system/transient messages)
    const hasMeaningfulMessages = messagesToSave.some(m => 
      m.role === 'user' || (m.role === 'assistant' && !m.isSystemMessage && m.content)
    );
    if (!hasMeaningfulMessages) return;
    
    // Debounce saves
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    
    // Capture the thread ID at the time of scheduling
    const capturedThreadId = threadIdToSave;
    
    persistTimeoutRef.current = setTimeout(async () => {
      try {
        // Double-check thread ID hasn't changed during the debounce period
        if (messagesThreadIdRef.current !== capturedThreadId) {
          return;
        }
        
        // Filter out transient states before saving
        const persistableMessages: PersistedMessage[] = messagesToSave
          .filter(m => !m.isTranscribing && !m.transcriptionError && !m.isEditing && !m.isCancelled && !m.isStreaming)
          .map(m => toPersistedMessage(m));

        // Get the last email message ID from the current thread
        const lastEmailMessage = emailThread?.messages[emailThread.messages.length - 1];
        const lastEmailMessageId = lastEmailMessage?.id;
        const lastEmailMessageDate = lastEmailMessage?.date;

        await saveThreadChat(user.uid, capturedThreadId, persistableMessages, lastEmailMessageId, lastEmailMessageDate);
      } catch (error) {
        console.error('Failed to persist chat:', error);
      }
    }, 1000); // Save 1 second after last change
  }, [isIncognito, user?.uid, thread]);
  
  // Auto-persist when messages change (after initial load)
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    // Skip during initial load
    if (isLoadingChat) {
      hasLoadedRef.current = false;
      return;
    }
    
    // Skip if no thread association yet
    const currentMessagesThreadId = messagesThreadIdRef.current;
    if (!currentMessagesThreadId) {
      return;
    }
    
    // Mark that we've completed loading
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      return; // Don't save the initial load
    }
    
    // Persist the current messages with the associated thread ID
    persistChat(messages, currentMessagesThreadId, thread);
  }, [messages, isLoadingChat, persistChat, thread]);

  // Archive with notification - used by both agent and direct button press
  const archiveWithNotification = useCallback(async () => {
    if (isArchiving) return; // Prevent double-clicks

    setIsArchiving(true);
    try {
      const archiveSubject = thread?.subject || 'Email';
      const lastMsg = thread?.messages[thread.messages.length - 1];
      const archiveSnippet = lastMsg?.snippet || '';
      const archivePreview = lastMsg?.body || '';

      // Call the archive function
      await onArchive?.();

      // Show confirmation message after successful archive
      setMessages(prev => [...prev, {
        id: `archive-${Date.now()}`,
        role: 'assistant' as const,
        content: `Archived: "${archiveSubject}"`,
        timestamp: new Date(),
        isSystemMessage: true,
        systemType: 'archived' as const,
        systemSnippet: archiveSnippet,
        systemPreview: archivePreview,
      }]);
    } finally {
      setIsArchiving(false);
    }
  }, [thread, onArchive, isArchiving]);

  // Register archive handler with parent so top bar button can use it
  useEffect(() => {
    onRegisterArchiveHandler?.(archiveWithNotification);
  }, [archiveWithNotification, onRegisterArchiveHandler]);

  // Handle tool calls from the agent
  const handleToolCalls = useCallback(async (toolCalls: ToolCall[], existingDraft?: EmailDraft | null) => {
    for (const toolCall of toolCalls) {
      switch (toolCall.name) {
        case 'prepare_draft':
          // Cancel any existing unsent/unsaved drafts when creating a new one
          // This prevents multiple drafts from being open at once
          // BUT don't cancel drafts that are currently streaming (they'll be updated)
          setMessages(prev => prev.map(m => {
            if (m.draft && !m.draftCancelled && !m.draftSaved && !m.draftSent && !m.isStreaming) {
              return { ...m, draftCancelled: true };
            }
            return m;
          }));

          const newDraft = buildDraftFromToolCall(toolCall.arguments, thread);
          // Preserve gmailDraftId if we're modifying an existing draft
          const draft = existingDraft?.gmailDraftId
            ? { ...newDraft, gmailDraftId: existingDraft.gmailDraftId }
            : newDraft;
          setCurrentDraft(draft);
          onDraftCreated?.(draft);
          break;
        case 'archive_email':
          archiveWithNotification();
          break;
        case 'move_to_inbox':
          setMessages(prev => [...prev, {
            id: `action-${Date.now()}`,
            role: 'assistant' as const,
            content: `📥 Moved to Inbox: "${thread?.subject || 'Email'}"`,
            timestamp: new Date(),
            isSystemMessage: true,
            systemType: 'navigated' as const,
          }]);
          onMoveToInbox?.();
          break;
        case 'star_email':
          setMessages(prev => [...prev, {
            id: `action-${Date.now()}`,
            role: 'assistant' as const,
            content: `⭐ Starred: "${thread?.subject || 'Email'}"`,
            timestamp: new Date(),
            isSystemMessage: true,
            systemType: 'navigated' as const,
          }]);
          onStar?.();
          break;
        case 'unstar_email':
          setMessages(prev => [...prev, {
            id: `action-${Date.now()}`,
            role: 'assistant' as const,
            content: `☆ Unstarred: "${thread?.subject || 'Email'}"`,
            timestamp: new Date(),
            isSystemMessage: true,
            systemType: 'navigated' as const,
          }]);
          onUnstar?.();
          break;
        case 'snooze_email':
          if (onSnooze) {
            const snoozeUntilArg = toolCall.arguments.snooze_until as string;
            const customDate = toolCall.arguments.custom_date as string | undefined;
            
            // Calculate the snooze date
            let snoozeDate: Date;
            const now = new Date();
            
            switch (snoozeUntilArg) {
              case 'later_today':
                snoozeDate = new Date(now);
                snoozeDate.setHours(18, 0, 0, 0);
                if (snoozeDate <= now) snoozeDate.setDate(snoozeDate.getDate() + 1);
                break;
              case 'tomorrow':
                snoozeDate = new Date(now);
                snoozeDate.setDate(snoozeDate.getDate() + 1);
                snoozeDate.setHours(8, 0, 0, 0);
                break;
              case 'this_weekend':
                snoozeDate = new Date(now);
                const daysUntilSaturday = (6 - snoozeDate.getDay() + 7) % 7 || 7;
                snoozeDate.setDate(snoozeDate.getDate() + daysUntilSaturday);
                snoozeDate.setHours(8, 0, 0, 0);
                break;
              case 'next_week':
                snoozeDate = new Date(now);
                const daysUntilMonday = (8 - snoozeDate.getDay()) % 7 || 7;
                snoozeDate.setDate(snoozeDate.getDate() + daysUntilMonday);
                snoozeDate.setHours(8, 0, 0, 0);
                break;
              case 'custom':
                snoozeDate = customDate ? new Date(customDate) : new Date(now.getTime() + 24 * 60 * 60 * 1000);
                break;
              default:
                snoozeDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            }
            
            // Format the snooze time for display
            const formatSnooze = (d: Date) => {
              const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
              return d.toLocaleString('en-US', opts);
            };
            
            // Show confirmation message with action buttons instead of immediately snoozing
            const confirmId = `snooze-confirm-${Date.now()}`;
            setMessages(prev => [...prev, {
              id: confirmId,
              role: 'assistant' as const,
              content: `⏰ Pending snooze until ${formatSnooze(snoozeDate)} (awaiting confirmation)`,
              timestamp: new Date(),
              isSystemMessage: true,
              systemType: 'context' as const,
              snoozeConfirmation: {
                date: snoozeDate.toISOString(),
                confirmed: false,
              },
            }]);
          }
          break;
        case 'go_to_next_email':
          onNextEmail?.();
          break;
        case 'go_to_inbox':
          setMessages(prev => [...prev, {
            id: `action-${Date.now()}`,
            role: 'assistant' as const,
            content: 'Returning to inbox...',
            timestamp: new Date(),
            isSystemMessage: true,
            systemType: 'navigated' as const,
          }]);
          onGoToInbox?.();
          break;
      }
    }
  }, [thread, onDraftCreated, archiveWithNotification, onMoveToInbox, onStar, onUnstar, onSnooze, onNextEmail, onGoToInbox]);

  // Send message to AI with streaming
  const sendToAI = useCallback(async (messageId: string, content: string) => {
    setIsLoading(true);
    setLoadingStatus('Thinking...');
    abortControllerRef.current = new AbortController();

    // Capture the current draft at the start - we'll use this to preserve gmailDraftId
    const draftAtStart = currentDraft;

    // Create a placeholder for the streaming assistant message
    const assistantMessageId = (Date.now() + 1).toString();
    setStreamingMessageId(assistantMessageId);

    try {
      // Get all messages for context (excluding cancelled ones, empty ones, and pending snooze confirmations)
      // Anthropic requires all messages to have non-empty content
      // IMPORTANT: Filter out snooze confirmation messages to prevent AI from calling snooze_email again
      // Only include messages if collapsed messages are shown or there are no collapsed messages
      const messagesToInclude = showCollapsedMessages || collapsedMessages.length === 0 ? messages : messages;
      const contextMessages = messagesToInclude
        .filter(m => !m.isCancelled && !m.isTranscribing && !m.transcriptionError && m.content && m.content.trim() && !m.snoozeConfirmation)
        .map(m => ({ role: m.role, content: m.content }));
      
      // Check if there's a pending snooze confirmation - if so, tell the AI not to snooze again
      const hasPendingSnooze = messages.some(m => m.snoozeConfirmation && !m.snoozeConfirmation.confirmed);
      if (hasPendingSnooze) {
        // Add a system note so AI knows snooze is already pending
        contextMessages.push({ 
          role: 'assistant' as const, 
          content: '[SYSTEM: A snooze has already been queued and is awaiting user confirmation. Do NOT call snooze_email again.]' 
        });
      }
      
      // Add the current message (only if it has content)
      if (content && content.trim()) {
        contextMessages.push({ role: 'user' as const, content });
      }

      // Get access token for email search functionality
      const accessToken = await getAccessToken();
      
      const response = await fetch('/api/ai/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: contextMessages,
          thread,
          folder,
          provider,
          model,
          accessToken, // For email search
          currentDraft: currentDraft, // Pass existing draft so AI can modify it
          draftingPreferences, // User's drafting preferences
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let streamedContent = '';
      let toolCalls: ToolCall[] = [];
      let hasAddedMessage = false;
      let streamingDraft: EmailDraft | undefined = undefined;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          try {
            const event = JSON.parse(line.slice(6));
            
            switch (event.type) {
              case 'status':
                // Update loading status message
                setLoadingStatus(event.data.message);
                break;

              case 'text':
                // Stream text content
                streamedContent = event.data.fullContent;
                
                // Add or update the message
                if (!hasAddedMessage) {
                  hasAddedMessage = true;
                  setIsLoading(false); // Hide loading indicator once text starts
                  const newMessage: UIMessage = {
                    id: assistantMessageId,
                    role: 'assistant',
                    content: streamedContent,
                    timestamp: new Date(),
                    isStreaming: true,
                  };
                  setMessages(prev => [...prev, newMessage]);
                } else {
                  // Update existing message with new content
                  setMessages(prev => prev.map(m => 
                    m.id === assistantMessageId 
                      ? { ...m, content: streamedContent }
                      : m
                  ));
                }
                break;

              case 'tool_start':
                // Tool call started - already showing status via 'status' event
                break;

              case 'tool_args':
                // Streaming tool arguments - update draft preview
                if (event.data.name === 'prepare_draft' && event.data.partial) {
                  const partial = event.data.partial;
                  streamingDraft = {
                    to: partial.to ? (Array.isArray(partial.to) ? partial.to : [partial.to]) : [],
                    subject: partial.subject || '',
                    body: partial.body || '',
                    type: partial.type || 'reply',
                    threadId: thread?.id,
                  };
                  
                  // Show/update the streaming draft in the message
                  if (!hasAddedMessage) {
                    hasAddedMessage = true;
                    setIsLoading(false);
                    const newMessage: UIMessage = {
                      id: assistantMessageId,
                      role: 'assistant',
                      content: "Here's a draft for you:",
                      timestamp: new Date(),
                      isStreaming: true,
                      draft: streamingDraft,
                    };
                    setMessages(prev => [...prev, newMessage]);
                  } else {
                    setMessages(prev => prev.map(m => 
                      m.id === assistantMessageId 
                        ? { ...m, draft: streamingDraft, content: m.content || "Here's a draft for you:" }
                        : m
                    ));
                  }
                }
                break;

              case 'tool_done':
                // Tool call completed with full arguments
                const completedTool: ToolCall = {
                  id: event.data.id || `tool_${Date.now()}`,
                  name: event.data.name,
                  arguments: event.data.arguments,
                };
                toolCalls.push(completedTool);
                
                // Handle tool calls (pass existing draft to preserve gmailDraftId)
                handleToolCalls([completedTool], draftAtStart);
                
                // If it's a draft, build the full draft
                if (event.data.name === 'prepare_draft') {
                  const newDraft = buildDraftFromToolCall(event.data.arguments, thread);
                  // Preserve gmailDraftId if we're modifying an existing draft
                  const finalDraft = draftAtStart?.gmailDraftId 
                    ? { ...newDraft, gmailDraftId: draftAtStart.gmailDraftId }
                    : newDraft;
                  setCurrentDraft(finalDraft);
                  onDraftCreated?.(finalDraft);
                  
                  // Update message with final draft
                  if (!hasAddedMessage) {
                    hasAddedMessage = true;
                    setIsLoading(false);
                    const newMessage: UIMessage = {
                      id: assistantMessageId,
                      role: 'assistant',
                      content: "Here's a draft for you:",
                      timestamp: new Date(),
                      toolCalls: toolCalls,
                      draft: finalDraft,
                    };
                    setMessages(prev => [...prev, newMessage]);
                  } else {
                    setMessages(prev => prev.map(m => 
                      m.id === assistantMessageId 
                        ? { 
                            ...m, 
                            draft: finalDraft, 
                            toolCalls: toolCalls,
                            isStreaming: false,
                            content: m.content || "Here's a draft for you:",
                          }
                        : m
                    ));
                  }
                }
                break;

              case 'search_result':
                // Search completed - add as a simple left-aligned chat message (not centered system message)
                const searchResult: SearchResult = {
                  type: event.data.type,
                  query: event.data.query,
                  success: event.data.success,
                  resultPreview: event.data.resultPreview,
                };
                
                // Add a simple message showing the completed search (left-aligned, part of chat flow)
                const searchMessageId = `search-${Date.now()}`;
                const searchMessage: UIMessage = {
                  id: searchMessageId,
                  role: 'assistant',
                  content: '', // Content is rendered via searchResults
                  timestamp: new Date(),
                  searchResults: [searchResult],
                };
                setMessages(prev => [...prev, searchMessage]);
                break;

              case 'done':
                // Stream completed
                setMessages(prev => prev.map(m => 
                  m.id === assistantMessageId 
                    ? { ...m, isStreaming: false, toolCalls: toolCalls.length > 0 ? toolCalls : undefined }
                    : m
                ));
                
                // If no message was added yet (edge case), add an empty one
                if (!hasAddedMessage && toolCalls.length === 0) {
                  const newMessage: UIMessage = {
                    id: assistantMessageId,
                    role: 'assistant',
                    content: "I'm here to help! You can ask me to summarize this email, draft a reply, archive it, or move to the next email.",
                    timestamp: new Date(),
                  };
                  setMessages(prev => [...prev, newMessage]);
                }
                break;

              case 'error':
                throw new Error(event.data.message);
            }
          } catch (parseError) {
            // Skip malformed SSE lines (but not real errors)
            if (parseError instanceof SyntaxError) continue;
            throw parseError;
          }
        }
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Request was cancelled
        setMessages(prev => prev.filter(m => m.id !== assistantMessageId));
        return;
      }
      console.error('Chat error:', error);
      const errorMessage: UIMessage = {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setLoadingStatus('Thinking...');
      setStreamingMessageId(null);
      abortControllerRef.current = null;
    }
  }, [messages, thread, folder, provider, model, handleToolCalls, onDraftCreated, currentDraft, getAccessToken, showCollapsedMessages, collapsedMessages.length]);

  // Send a text message
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    // Ensure messages are associated with current thread when user starts chatting
    if (thread?.id && !messagesThreadIdRef.current) {
      messagesThreadIdRef.current = thread.id;
    }

    // Auto-cancel any existing drafts that haven't been saved or sent
    // This happens when user continues the conversation without saving/sending
    setMessages(prev => prev.map(m => {
      // Only cancel if: has draft, not already cancelled, not saved, not sent
      if (m.draft && !m.draftCancelled && !m.draftSaved && !m.draftSent) {
        return { ...m, draftCancelled: true };
      }
      return m;
    }))
    
    // Clear currentDraft if it exists and hasn't been saved
    if (currentDraft && !currentDraft.gmailDraftId) {
      setCurrentDraft(null);
    }

    const messageId = Date.now().toString();
    const userMessage: UIMessage = {
      id: messageId,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    
    // Note: Don't change message region state - chat and messages are independent
    
    await sendToAI(messageId, content.trim());
  }, [isLoading, sendToAI, thread?.id, currentDraft]);

  // Start voice recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      streamRef.current = stream;

      // Set up audio context for visualization
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      setAnalyserNode(analyser);

      // Set up media recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus' : 'audio/webm',
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size > 0) {
          // Create pending message immediately
          const messageId = Date.now().toString();
          setPendingMessageId(messageId);
          transcriptionBlobsRef.current.set(messageId, blob);
          
          const pendingMessage: UIMessage = {
            id: messageId,
            role: 'user',
            content: '',
            timestamp: new Date(),
            isTranscribing: true,
            transcriptionError: false,
          };
          console.log('[Transcribing] Adding transcribing message:', messageId);
          setMessages(prev => {
            console.log('[Transcribing] Previous messages count:', prev.length);
            console.log('[Transcribing] Has draft in messages:', prev.some(m => m.draft && !m.draftCancelled));
            console.log('[Transcribing] Messages before adding:', prev.map(m => ({
              id: m.id,
              role: m.role,
              hasDraft: !!m.draft,
              isTranscribing: m.isTranscribing,
              content: m.content?.substring(0, 50)
            })));
            const newMessages = [...prev, pendingMessage];
            console.log('[Transcribing] Messages after adding:', newMessages.length);
            return newMessages;
          });

          // Scroll to bottom to ensure transcribing message is visible
          setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }, 100);

          // Transcribe
          try {
            const formData = new FormData();
            formData.append('audio', blob, 'recording.webm');
            
            const response = await fetch('/api/ai/transcribe', {
              method: 'POST',
              body: formData,
            });

            if (!response.ok) throw new Error('Transcription failed');
            
            const { text } = await response.json();
            
            // Update message with transcribed text
            setMessages(prev => prev.map(m => 
              m.id === messageId 
                ? { ...m, content: text, isTranscribing: false, transcriptionError: false }
                : m
            ));
            transcriptionBlobsRef.current.delete(messageId);
            
            // Auto-send to AI
            await sendToAI(messageId, text);
          } catch (error) {
            console.error('Transcription error:', error);
            // Update message to show error
            setMessages(prev => prev.map(m => 
              m.id === messageId 
                ? { ...m, content: 'Failed to transcribe. Tap to retry.', isTranscribing: false, transcriptionError: true }
                : m
            ));
          } finally {
            setPendingMessageId(null);
          }
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingDuration(0);

      durationIntervalRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  }, [sendToAI]);

  // Stop voice recording (and send for transcription)
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        setAnalyserNode(null);
      }

      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    }
  }, [isRecording]);

  // Cancel voice recording (stop without sending)
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      // Clear the chunks so onstop doesn't process them
      chunksRef.current = [];
      
      // Remove the ondataavailable handler to prevent adding more chunks
      mediaRecorderRef.current.ondataavailable = null;
      
      // Set a no-op onstop handler to prevent transcription
      mediaRecorderRef.current.onstop = () => {};
      
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        setAnalyserNode(null);
      }

      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    }
  }, [isRecording]);

  // Keyboard shortcuts for recording: Enter to send, Escape to cancel
  useEffect(() => {
    if (!isRecording) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        stopRecording();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRecording();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, stopRecording, cancelRecording]);

  // Cancel pending message
  const cancelMessage = useCallback((messageId: string) => {
    setMessages(prev => prev.filter(m => m.id !== messageId));
    transcriptionBlobsRef.current.delete(messageId);
    if (isLoading) {
      abortControllerRef.current?.abort();
      setIsLoading(false);
    }
  }, [isLoading]);

  // Retry transcription for a failed voice message
  const retryTranscription = useCallback(async (messageId: string) => {
    const blob = transcriptionBlobsRef.current.get(messageId);
    if (!blob) {
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, content: 'Audio missing. Please record again.', transcriptionError: true, isTranscribing: false }
          : m
      ));
      return;
    }

    setPendingMessageId(messageId);
    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, content: '', isTranscribing: true, transcriptionError: false }
        : m
    ));

    try {
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');

      const response = await fetch('/api/ai/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Transcription failed');

      const { text } = await response.json();

      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, content: text, isTranscribing: false, transcriptionError: false }
          : m
      ));
      transcriptionBlobsRef.current.delete(messageId);

      await sendToAI(messageId, text);
    } catch (error) {
      console.error('Transcription error:', error);
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, content: 'Failed to transcribe. Tap to retry.', isTranscribing: false, transcriptionError: true }
          : m
      ));
    } finally {
      setPendingMessageId(null);
    }
  }, [sendToAI]);

  // Edit message
  const startEditing = useCallback((messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditingContent(content);
  }, []);

  const saveEdit = useCallback(async (messageId: string) => {
    if (!editingContent.trim()) return;
    
    // Update the message
    setMessages(prev => prev.map(m => 
      m.id === messageId ? { ...m, content: editingContent.trim() } : m
    ));
    
    // Remove any messages after this one (they're now stale)
    setMessages(prev => {
      const index = prev.findIndex(m => m.id === messageId);
      return prev.slice(0, index + 1);
    });
    
    setEditingMessageId(null);
    setEditingContent('');
    
    // Re-send to AI
    await sendToAI(messageId, editingContent.trim());
  }, [editingContent, sendToAI]);

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingContent('');
  }, []);

  // Cancel AI response
  const cancelAIResponse = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  
  // Undo the pending send
  const handleUndoSend = useCallback(() => {
    if (!pendingSend) return;

    // Clear the timeout
    clearTimeout(pendingSend.timeoutId);

    // Restore the draft
    setCurrentDraft(pendingSend.draft);

    // Un-mark ONLY the specific draft being undone (compare draft objects)
    // AND remove the confirmation message
    setMessages(prev => prev
      .filter(m => m.id !== pendingSend.confirmMessageId) // Remove "Sending to..." message
      .map(m =>
        // Only reset the specific draft being undone
        m.draft && m.draftSent && m.draft === pendingSend.draft
          ? { ...m, draftSent: false }
          : m
      )
    );

    // Clear pending send state
    setPendingSend(null);
    setIsSending(false);
  }, [pendingSend]);
  
  const handleSendDraft = async (updatedDraft: EmailDraft) => {
    if (!updatedDraft || !onSendEmail) return;

    setIsSending(true);
    setCurrentDraft(null);

    // Mark the draft as sent immediately
    setMessages(prev => prev.map(m => {
      if (m.draft && !m.draftCancelled && !m.draftSaved && !m.draftSent && !m.isStreaming) {
        return { ...m, draftSent: true };
      }
      return m;
    }));

    // Add a system message showing "Sent" immediately
    const recipient = updatedDraft.to[0] || 'recipient';
    const confirmMessageId = `sending-${Date.now()}`;
    const sentMessage: UIMessage = {
      id: confirmMessageId,
      role: 'assistant',
      content: `✓ Sent to ${recipient}`,
      timestamp: new Date(),
      isSystemMessage: true,
      systemType: 'sent',
      hasActionButtons: true,
      actionButtonsHandled: false,
    };
    setMessages(prev => [...prev, sentMessage]);

    // Immediately set isSending to false so UI updates to show sent state
    setIsSending(false);

    // Set up delayed actual send (5 seconds) - during this time undo is available
    const UNDO_DELAY = 5000;
    const timeoutId = setTimeout(async () => {
      // IMPORTANT: Clear pending state BEFORE executing send to prevent double-send
      setPendingSend(null);
      pendingSendRef.current = null;

      // Actually send the email
      try {
        await onSendEmail(updatedDraft);
      } catch (error) {
        console.error('Send error:', error);
        // Update message to show error
        setMessages(prev => prev.map(m =>
          m.id === confirmMessageId
            ? { ...m, content: '⚠️ Send failed. Please try again.' }
            : m
        ));
      }
    }, UNDO_DELAY);

    setPendingSend({
      draft: updatedDraft,
      timeoutId,
      timestamp: Date.now(),
      confirmMessageId,
    });
  };
  
  // Handle navigation away - complete any pending send immediately
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (pendingSendRef.current && onSendEmail) {
        // Clear the timeout and send immediately
        clearTimeout(pendingSendRef.current.timeoutId);
        // Try to send - browser may not complete async operation
        onSendEmail(pendingSendRef.current.draft).catch(console.error);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [onSendEmail]);

  // Also complete pending send when thread changes (navigating to different email)
  useEffect(() => {
    return () => {
      // Cleanup: if there's a pending send when thread changes, send it immediately
      if (pendingSendRef.current && onSendEmail) {
        clearTimeout(pendingSendRef.current.timeoutId);
        onSendEmail(pendingSendRef.current.draft).catch(console.error);
        pendingSendRef.current = null;
      }
    };
  }, [thread?.id, onSendEmail]);

  const handleSaveDraft = async (updatedDraft: EmailDraft) => {
    if (!updatedDraft || !onSaveDraft) return;
    
    setIsSaving(true);
    try {
      // Save and get back the draft with gmailDraftId
      const savedDraft = await onSaveDraft(updatedDraft);
      setCurrentDraft(null);
      
      // Update any messages with drafts to have the latest values including gmailDraftId
      // Also mark as saved so it won't be auto-cancelled
      setMessages(prev => prev.map(m => 
        m.draft && !m.draftCancelled 
          ? { ...m, draft: savedDraft, draftSaved: true }
          : m
      ));
      
      const confirmMessage: UIMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '✓ Draft saved',
        timestamp: new Date(),
        isSystemMessage: true,
        systemType: 'archived', // Reuse archived styling (blue)
      };
      setMessages(prev => [...prev, confirmMessage]);
    } catch (error) {
      console.error('Save draft error:', error);
      const errorMessage: UIMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '⚠️ Failed to save draft. Try again?',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle action button clicks from sent confirmation
  const handleSentActionArchiveNext = useCallback(() => {
    // Mark the buttons as handled so they disappear
    setMessages(prev => prev.map(m => 
      m.hasActionButtons ? { ...m, actionButtonsHandled: true } : m
    ));
    // Archive and then go to next
    archiveWithNotification();
  }, [archiveWithNotification]);

  const handleSentActionPrevious = useCallback(() => {
    // Mark the buttons as handled
    setMessages(prev => prev.map(m =>
      m.hasActionButtons ? { ...m, actionButtonsHandled: true } : m
    ));
    // Go to previous
    onPreviousEmail?.();
  }, [onPreviousEmail]);

  const handleSentActionNext = useCallback(() => {
    // Mark the buttons as handled
    setMessages(prev => prev.map(m =>
      m.hasActionButtons ? { ...m, actionButtonsHandled: true } : m
    ));
    // Just go to next
    onNextEmail?.();
  }, [onNextEmail]);

  const handleSentActionInbox = useCallback(() => {
    // Mark the buttons as handled
    setMessages(prev => prev.map(m =>
      m.hasActionButtons ? { ...m, actionButtonsHandled: true } : m
    ));
    // Go to inbox
    onGoToInbox?.();
  }, [onGoToInbox]);

  // Handle snooze confirmation
  const handleSnoozeConfirm = useCallback(async (messageId: string, snoozeDate: Date) => {
    if (!onSnooze) return;
    
    // Mark the message as confirmed
    setMessages(prev => prev.map(m => 
      m.id === messageId && m.snoozeConfirmation 
        ? { ...m, snoozeConfirmation: { ...m.snoozeConfirmation, confirmed: true } } 
        : m
    ));
    
    const formatSnooze = (d: Date) => {
      const opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
      return d.toLocaleString('en-US', opts);
    };
    
    try {
      await onSnooze(snoozeDate);
      setMessages(prev => [...prev, {
        id: `action-${Date.now()}`,
        role: 'assistant' as const,
        content: `✓ Snoozed until ${formatSnooze(snoozeDate)}`,
        timestamp: new Date(),
        isSystemMessage: true,
        systemType: 'navigated' as const,
      }]);
    } catch (err) {
      console.error('Snooze failed:', err);
      setMessages(prev => [...prev, {
        id: `action-${Date.now()}`,
        role: 'assistant' as const,
        content: '⚠️ Failed to snooze. Please try again.',
        timestamp: new Date(),
      }]);
    }
  }, [onSnooze]);

  // Handle snooze edit (opens snooze picker)
  // NOTE: We do NOT mark the message as confirmed here - the picker closing
  // should NOT hide the buttons. Only a successful snooze or explicit cancel should hide them.
  const handleSnoozeEdit = useCallback((_messageId: string, _currentDate: Date) => {
    // Open snooze picker - this is handled by parent component
    // The buttons remain visible if user closes the picker without selecting
    onOpenSnoozePicker?.();
  }, [onOpenSnoozePicker]);

  // Handle snooze cancel
  const handleSnoozeCancel = useCallback((messageId: string) => {
    // Mark the message as handled
    setMessages(prev => prev.map(m => 
      m.id === messageId && m.snoozeConfirmation 
        ? { ...m, snoozeConfirmation: { ...m.snoozeConfirmation, confirmed: true }, content: '↩️ Snooze cancelled' } 
        : m
    ));
  }, []);

  const handleDiscardDraft = async (draftToDiscard: EmailDraft) => {
    setIsDeleting(true);
    
    try {
      // If the draft was saved to Gmail, delete it
      if (draftToDiscard.gmailDraftId && onDeleteDraft) {
        await onDeleteDraft(draftToDiscard.gmailDraftId);
      }
      
      setCurrentDraft(null);
      // Mark only the ACTIVE (non-cancelled/saved/sent) draft as cancelled
      // Previously cancelled drafts should remain untouched with their draft data preserved
      setMessages(prev => prev.map(m => 
        m.draft && !m.draftCancelled && !m.draftSaved && !m.draftSent 
          ? { ...m, draftCancelled: true } 
          : m
      ));
      
      // Add brief confirmation
      const discardMessage: UIMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: draftToDiscard.gmailDraftId ? '🗑️ Draft deleted.' : '↩️ Discarded. What next?',
        timestamp: new Date(),
        isSystemMessage: true,
        systemType: 'archived',
      };
      setMessages(prev => [...prev, discardMessage]);
    } catch (error) {
      console.error('Failed to delete draft:', error);
      const errorMessage: UIMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '⚠️ Failed to delete draft from Gmail. Try again?',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsDeleting(false);
    }
  };
  
  // Handle editing a draft message in the thread preview
  // This opens the draft in the chat area for editing using the DraftCard component
  // isFullyExpanded: true if message region is at ~70% viewport height
  const handleEditDraftInThread = useCallback(async (isFullyExpanded: boolean) => {
    if (!thread) return;
    
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');
      
      // Step 1: Cancel any existing unsaved drafts in the chat
      // This keeps them in history but collapsed, just like when user continues the conversation
      setMessages(prev => prev.map(m => {
        if (m.draft && !m.draftCancelled && !m.draftSaved && !m.draftSent) {
          return { ...m, draftCancelled: true };
        }
        return m;
      }));
      
      // Step 2: Collapse the message region if fully expanded
      // If half-expanded, we can see both chat and message region, so no need to collapse
      if (isFullyExpanded) {
        setRevealedMessageCount(0);
        setBaseRevealedCount(0);
      }
      
      // Step 3: Find the draft for this thread from Gmail (source of truth)
      const gmailDraft = await getDraftForThread(accessToken, thread.id);
      if (!gmailDraft) {
        // No draft found - show error
        const errorMessage: UIMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: '⚠️ Could not find draft to edit.',
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errorMessage]);
        return;
      }
      
      // Step 4: Convert Gmail draft to EmailDraft format and set as currentDraft
      // IMPORTANT: For replies, we need to:
      // 1. Parse the body to extract just the user's new content (before quoted text)
      // 2. Rebuild quotedContent from the thread's HTML (not the garbled plain text)
      
      let cleanBody = gmailDraft.body;
      let quotedContent: string | undefined;
      
      if (gmailDraft.type === 'reply' && thread) {
        // Parse body to extract user's content (before the "On ... wrote:" line)
        const quotePatterns = [
          /\n\nOn .+ wrote:\n/,           // "On Mon, Jan 12, 2026 at 4:03 PM ... wrote:"
          /\n\nOn .+ at .+,.*wrote:\n/,   // Variations
          /\n>/,                           // Lines starting with > 
        ];
        
        for (const pattern of quotePatterns) {
          const match = cleanBody.match(pattern);
          if (match && match.index !== undefined) {
            cleanBody = cleanBody.slice(0, match.index).trim();
            break;
          }
        }
        
        // Rebuild quotedContent from the thread's actual HTML content
        // This ensures proper rendering instead of garbled plain text
        quotedContent = buildReplyQuote(thread);
      }
      
      const draftToEdit: EmailDraft = {
        to: gmailDraft.to,
        cc: gmailDraft.cc,
        bcc: gmailDraft.bcc,
        subject: gmailDraft.subject,
        body: cleanBody,
        type: gmailDraft.type,
        threadId: gmailDraft.threadId,
        inReplyTo: gmailDraft.inReplyTo,
        references: gmailDraft.references,
        gmailDraftId: gmailDraft.id,
        quotedContent,
      };
      
      setCurrentDraft(draftToEdit);
      
      // Step 5: Scroll to the bottom of the chat to show the draft card
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      
    } catch (error) {
      console.error('Failed to load draft for editing:', error);
      const errorMessage: UIMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '⚠️ Failed to load draft for editing.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  }, [thread, getAccessToken]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Add swipe gesture handling for navigation
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const wheelAccumX = useRef(0);
  const wheelTimeout = useRef<NodeJS.Timeout | undefined>(undefined);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;

    // Only trigger on definite horizontal swipes with reasonable threshold
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 100) {
      if (dx < 0) {
        onNextEmail?.(); // Swipe left = next
      } else {
        onPreviousEmail?.(); // Swipe right = previous
      }
    }
  }, [onNextEmail, onPreviousEmail]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Only handle horizontal scrolling for navigation
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
      wheelAccumX.current += e.deltaX;

      if (Math.abs(wheelAccumX.current) > 150) {
        if (wheelAccumX.current > 0) {
          onNextEmail?.(); // Scroll left = next
        } else {
          onPreviousEmail?.(); // Scroll right = previous
        }
        wheelAccumX.current = 0;
      }

      if (wheelTimeout.current) clearTimeout(wheelTimeout.current);
      wheelTimeout.current = setTimeout(() => {
        wheelAccumX.current = 0;
      }, 150);
    }
  }, [onNextEmail, onPreviousEmail]);

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-primary)' }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onWheel={handleWheel}
    >
      {/* Email Thread Preview */}
      {thread && (
        <ThreadPreview
          key={thread.id} // Force remount when thread changes to reset all internal state
          thread={thread}
          folder={folder}
          defaultExpanded={false}
          revealedMessageCount={revealedMessageCount}
          baseRevealedCount={baseRevealedCount}
          onRevealedCountChange={handleRevealedCountChange}
          onScrollReveal={handleScrollReveal}
          expandRequestId={expandRequestId}
          onNeedsExpandChange={handleNeedsExpandChange}
          onNextEmail={onNextEmail}
          onPreviousEmail={onPreviousEmail}
          startFullyExpanded={!thread.isRead} // Unread emails open fully expanded
          onEditDraft={handleEditDraftInThread}
          onFullyExpandedChange={setIsMessageFullyExpanded}
        />
      )}


      {/* Messages - with purple tint when in incognito mode */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto transition-colors duration-300"
        style={isIncognito ? {
          background: 'linear-gradient(180deg, rgba(139, 92, 246, 0.12) 0%, rgba(139, 92, 246, 0.05) 100%)',
          marginTop: '-1px', // Pull up to cover separator line
        } : {}}
      >
        {/* Inner padding wrapper - uses flex to allow child to fill height */}
        <div className="p-4 flex flex-col min-h-full" style={isIncognito ? { paddingTop: '1rem' } : {}}>
        {messages.length === 0 && !isRecording && !isLoadingChat && (
          <div className="relative flex flex-col flex-1">
            {/* Incognito toggle - absolute top left */}
            <button
              onClick={() => setIsIncognito(!isIncognito)}
              className="absolute top-4 left-4 p-2 rounded-lg transition-all group z-10"
              style={isIncognito ? {
                background: 'rgba(139, 92, 246, 0.2)',
                border: '1px solid rgba(139, 92, 246, 0.4)',
              } : {
                background: 'transparent',
                border: '1px solid transparent',
              }}
              title={isIncognito ? 'Incognito mode ON' : 'Enable incognito mode'}
            >
              <Ghost className={`w-5 h-5 ${isIncognito ? 'text-purple-400' : 'text-slate-500 group-hover:text-slate-400'}`} />
            </button>
            
            {/* Chat suggestion bubbles - absolute top right, styled as chat messages with plus icon */}
            {thread && (
              <div className="absolute top-4 right-2 sm:right-4 flex flex-col gap-3 items-end z-10">
                {['Summarize', 'Draft reply'].map((suggestion) => (
                  <motion.button
                    key={suggestion}
                    whileHover={{ scale: 1.03, x: -3 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => sendMessage(suggestion)}
                    className="relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all"
                    style={{ 
                      background: 'rgba(59, 130, 246, 0.1)',
                      color: 'rgba(147, 197, 253, 0.95)',
                      borderRadius: '18px 18px 6px 18px',
                      border: '1px dashed rgba(59, 130, 246, 0.4)',
                    }}
                  >
                    <span className="text-blue-400/70 text-lg font-light">+</span>
                    <span>{suggestion}</span>
                  </motion.button>
                ))}
              </div>
            )}
            
            {/* Prev/Next buttons - absolutely positioned on left/right, vertically centered */}
            {thread && (
              <>
                {/* Prev button - left edge, full height clickable area */}
                <motion.button
                  whileHover={{ x: -3, opacity: 1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => onPreviousEmail?.()}
                  className="absolute left-0 top-1/4 bottom-1/4 w-12 sm:w-16 flex flex-col items-center justify-center gap-1 transition-all opacity-50 hover:opacity-100 z-10"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <ChevronLeft className="w-6 h-10 sm:w-8 sm:h-14 stroke-[1.5]" />
                  <span className="text-[9px] sm:text-[10px] uppercase tracking-wider font-medium">Prev</span>
                </motion.button>
                
                {/* Next button - right edge, full height clickable area */}
                <motion.button
                  whileHover={{ x: 3, opacity: 1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => onNextEmail?.()}
                  className="absolute right-0 top-1/4 bottom-1/4 w-12 sm:w-16 flex flex-col items-center justify-center gap-1 transition-all opacity-50 hover:opacity-100 z-10"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <ChevronRight className="w-6 h-10 sm:w-8 sm:h-14 stroke-[1.5]" />
                  <span className="text-[9px] sm:text-[10px] uppercase tracking-wider font-medium">Next</span>
                </motion.button>
              </>
            )}
            
            {/* Center section - Mic button, vertically centered in the space */}
            <div className="flex-1 flex flex-col items-center justify-center px-16">
              {/* Incognito indicator when active */}
              {isIncognito && (
                <div className="flex items-center gap-2 mb-6 px-3 py-1.5 rounded-full"
                  style={{ background: 'rgba(139, 92, 246, 0.15)', border: '1px solid rgba(139, 92, 246, 0.25)' }}>
                  <Ghost className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs text-purple-300">Incognito mode</span>
                  <button
                    onClick={() => setIsIncognito(false)}
                    className="p-0.5 rounded hover:bg-purple-500/30 transition-colors"
                    title="Exit incognito"
                  >
                    <X className="w-3 h-3 text-purple-400" />
                  </button>
                </div>
              )}
              
              {/* Large microphone button with gradient edges - responsive size */}
              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={startRecording}
                disabled={isLoading}
                className="relative w-36 h-36 sm:w-44 sm:h-44 lg:w-52 lg:h-52 flex items-center justify-center disabled:opacity-50 transition-all"
                title="Start voice chat"
              >
                {/* Outermost soft glow */}
                <div 
                  className="absolute inset-0 rounded-full opacity-40 blur-2xl"
                  style={{ background: 'radial-gradient(circle, rgba(168, 85, 247, 0.7) 0%, rgba(6, 182, 212, 0.4) 40%, transparent 65%)' }}
                />
                {/* Gradient that fades to transparent at edges */}
                <div 
                  className="absolute inset-3 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(168, 85, 247, 0.75) 15%, rgba(139, 92, 246, 0.5) 45%, rgba(6, 182, 212, 0.2) 70%, transparent 95%)' }}
                />
                {/* Inner core - more solid */}
                <div 
                  className="absolute inset-8 sm:inset-10 lg:inset-12 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(168, 85, 247, 0.95) 0%, rgba(139, 92, 246, 0.8) 60%, rgba(168, 85, 247, 0.4) 100%)' }}
                />
                <Mic className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 text-white relative z-10 drop-shadow-lg" />
              </motion.button>
              
              {/* Instructions - more magical styling */}
              <div className="mt-8 text-center max-w-[280px]">
                <p className="text-sm mb-1" style={{ 
                  color: 'var(--text-secondary)',
                  background: 'linear-gradient(90deg, rgba(168, 85, 247, 0.8), rgba(6, 182, 212, 0.8))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}>
                  {thread ? 'Start a conversation' : 'Compose a new message'}
                </p>
                <p className="text-xs opacity-60" style={{ color: 'var(--text-muted)' }}>
                  {thread 
                    ? 'Tap the mic, type below, or try a chat starter →'
                    : 'Speak or type to get started'}
                </p>
              </div>
            </div>
            
            {/* Archive and Snooze buttons - positioned above input area */}
            {thread && (
              <div className="flex justify-center gap-2 pb-4">
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={(e) => animateButton(e, () => archiveWithNotification())}
                  disabled={isArchiving}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                  style={{
                    background: 'rgba(59, 130, 246, 0.1)',
                    color: 'rgba(147, 197, 253, 0.85)',
                    border: '1px solid rgba(59, 130, 246, 0.2)'
                  }}
                >
                  {isArchiving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Archive className="w-4 h-4" />
                  )}
                  Archive
                </motion.button>

                {/* Snooze button - icon only */}
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => onOpenSnoozePicker?.()}
                  disabled={!onOpenSnoozePicker}
                  className="p-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                  style={{
                    background: 'rgba(59, 130, 246, 0.1)',
                    color: 'rgba(147, 197, 253, 0.85)',
                    border: '1px solid rgba(59, 130, 246, 0.2)'
                  }}
                  title="Snooze"
                >
                  <Clock className="w-4 h-4" />
                </motion.button>
              </div>
            )}
            
            {/* Compose mode - for new messages (no thread) */}
            {!thread && (
              <div className="flex flex-col items-center gap-3 pb-4">
                <div className="flex flex-wrap gap-2 justify-center px-4">
                  {['Write a quick email to...', 'Draft meeting invite...'].map((suggestion) => (
                    <motion.button
                      key={suggestion}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => sendMessage(suggestion)}
                      className="relative px-4 py-2 text-sm font-medium transition-all"
                      style={{ 
                        background: 'rgba(139, 92, 246, 0.08)',
                        color: 'var(--text-secondary)',
                        borderRadius: '16px 16px 4px 16px',
                        border: '1px dashed rgba(139, 92, 246, 0.3)',
                      }}
                    >
                      {suggestion}
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Loading indicator for chat history */}
        {isLoadingChat && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center h-full text-center px-4"
          >
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: 'var(--bg-interactive)' }}>
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: 'var(--text-accent-blue)' }} />
            </div>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading chat...</span>
          </motion.div>
        )}
        
        {/* Chat controls bar - shows when there are messages */}
        {messages.length > 0 && (
          <div className="flex items-center justify-center gap-2 -mt-2 mb-2">
            {/* Incognito banner */}
            {isIncognito && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 py-1.5 px-3 rounded-full"
                style={{ 
                  background: 'rgba(139, 92, 246, 0.15)', 
                  border: '1px solid rgba(139, 92, 246, 0.3)',
                }}
              >
                <Ghost className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-xs text-purple-300">Incognito</span>
                <button
                  onClick={() => setIsIncognito(false)}
                  className="ml-1 p-0.5 rounded hover:bg-purple-500/30 transition-colors"
                  title="Exit incognito mode"
                >
                  <X className="w-3 h-3 text-purple-400" />
                </button>
              </motion.div>
            )}
            
            {/* Clear chat button - subtle, appears when messages exist */}
            <motion.button
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                if (confirm('Clear all chat messages?')) {
                  setMessages([]);
                  setCurrentDraft(null);
                  // Also clear from persistence if not incognito
                  if (!isIncognito && thread?.id && user?.uid) {
                    import('@/lib/chat-persistence').then(({ clearThreadChat }) => {
                      clearThreadChat(user.uid, thread.id);
                    });
                  }
                }
              }}
              className="flex items-center gap-1.5 py-1.5 px-3 rounded-full transition-colors hover:bg-red-500/20 group"
              style={{ 
                background: 'var(--bg-interactive)', 
                border: '1px solid var(--border-subtle)',
              }}
              title="Clear chat"
            >
              <Trash2 className="w-3.5 h-3.5 group-hover:text-red-400" style={{ color: 'var(--text-muted)' }} />
              <span className="text-xs group-hover:text-red-400" style={{ color: 'var(--text-muted)' }}>Clear</span>
            </motion.button>
          </div>
        )}

        {/* Collapsed messages button */}
        {collapsedMessages.length > 0 && !showCollapsedMessages && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-center mb-4"
          >
            <button
              onClick={() => {
                setShowCollapsedMessages(true);
                // Prepend collapsed messages to current messages
                setMessages(prev => [...collapsedMessages, ...prev]);
                setCollapsedMessages([]);
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors"
              style={{
                background: 'rgba(147, 197, 253, 0.08)',
                border: '1px solid rgba(147, 197, 253, 0.15)',
                color: 'rgba(147, 197, 253, 0.7)'
              }}
            >
              <Clock className="w-4 h-4" />
              Load previous messages from {new Date(collapsedMessages[collapsedMessages.length - 1].timestamp).toLocaleDateString()}
            </button>
          </motion.div>
        )}

        {messages.map((message, index) => {
          // Debug log for transcribing messages
          if (message.isTranscribing) {
            console.log('[Transcribing] Rendering transcribing message:', message.id, 'at index:', index);
          }
          return (
          <motion.div
            key={message.id}
            // Skip y transform for messages with drafts to avoid iOS cursor positioning issues
            initial={{ opacity: 0, y: message.draft ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex flex-col ${
              message.isSystemMessage
                ? 'items-center'
                : message.role === 'user'
                  ? 'items-end'
                  : 'items-start'
            } ${index > 0 ? 'mt-3' : ''}`}
          >
            {/* Snooze confirmation - special pending style with integrated buttons */}
            {message.isSystemMessage && message.snoozeConfirmation && !message.snoozeConfirmation.confirmed && (
              <div className="w-full flex flex-col items-center py-2">
                <div className="flex flex-col items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed border-orange-500/40 bg-orange-500/10">
                  {/* Message content */}
                  <div className="flex items-center gap-2 text-orange-300">
                    <Clock className="w-4 h-4" />
                    <span className="text-sm font-medium">{message.content}</span>
                  </div>
                  {/* Action buttons - integrated in same container */}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSnoozeConfirm(message.id, new Date(message.snoozeConfirmation!.date))}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/30 text-orange-200 border border-orange-500/40 hover:bg-orange-500/40 transition-colors text-sm font-medium"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Confirm
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSnoozeEdit(message.id, new Date(message.snoozeConfirmation!.date))}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/50 text-slate-300 border border-slate-600/30 hover:bg-slate-700 transition-colors text-sm font-medium"
                    >
                      <Edit3 className="w-4 h-4" />
                      Change
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleSnoozeCancel(message.id)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/50 text-slate-300 border border-slate-600/30 hover:bg-slate-700 transition-colors text-sm font-medium"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </motion.button>
                  </div>
                </div>
              </div>
            )}

            {/* System/Action message - horizontal divider with centered badge (not for pending snooze) */}
            {message.isSystemMessage && !(message.snoozeConfirmation && !message.snoozeConfirmation.confirmed) && (
              <div className="w-full flex items-center gap-2 py-2 group overflow-hidden">
                {/* Left line - min width ensures visibility on narrow screens */}
                <div className={`flex-1 min-w-12 h-px ${
                  message.systemType === 'archived' 
                    ? 'bg-gradient-to-r from-transparent to-blue-500/40' 
                    : message.systemType === 'sent'
                      ? 'bg-gradient-to-r from-transparent to-cyan-500/40'
                      : message.systemType === 'search'
                        ? 'bg-gradient-to-r from-transparent to-purple-500/40'
                        : 'bg-gradient-to-r from-transparent to-green-500/40'
                }`} />
                
                {/* Center badge - shrinks on narrow screens, lines stay visible */}
                <div className={`
                  relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-default
                  flex-shrink min-w-0 max-w-[calc(100%-112px)]
                  ${message.systemType === 'archived' 
                    ? 'bg-blue-500/15 text-blue-300 border border-blue-500/25' 
                    : message.systemType === 'sent'
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25'
                      : message.systemType === 'search'
                        ? 'bg-purple-500/15 text-purple-300 border border-purple-500/25'
                        : 'bg-green-500/15 text-green-300 border border-green-500/25'
                  }
                `}>
                  {message.systemType === 'archived' && <Archive className="w-4 h-4 text-blue-400 flex-shrink-0" />}
                  {message.systemType === 'sent' && <Send className="w-4 h-4 text-cyan-400 flex-shrink-0" />}
                  {message.systemType === 'navigated' && <Eye className="w-4 h-4 text-green-400 flex-shrink-0" />}
                  {message.systemType === 'search' && (
                    message.searchResults?.[0]?.type === 'browse_url' 
                      ? <Globe className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      : <Search className="w-4 h-4 text-purple-400 flex-shrink-0" />
                  )}
                  <div className="flex flex-col min-w-0 overflow-hidden">
                    <span className="font-medium truncate">{message.content}</span>
                    {/* Show stored snippet for navigation and archive */}
                    {message.systemSnippet && (message.systemType === 'navigated' || message.systemType === 'archived') && (
                      <span className="text-xs text-slate-500 leading-relaxed mt-0.5 line-clamp-2">
                        {message.systemSnippet.slice(0, 120)}
                        {message.systemSnippet.length > 120 && '...'}
                      </span>
                    )}
                    {/* Show URL for browse_url searches */}
                    {message.systemType === 'search' && message.searchResults?.[0]?.type === 'browse_url' && (
                      <a 
                        href={message.searchResults[0].query} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-xs text-purple-400/70 hover:text-purple-300 flex items-center gap-1 mt-0.5"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span className="truncate">{message.searchResults[0].query}</span>
                      </a>
                    )}
                  </div>
                  
                  {/* Hover tooltip with more info */}
                  {message.systemPreview && (message.systemType === 'navigated' || message.systemType === 'archived') && (
                    <div className="absolute left-0 right-0 bottom-full mb-2 flex justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl max-w-[280px] mx-2">
                        <p className="text-xs text-slate-400 mb-1">
                          {message.systemType === 'archived' ? 'Archived message:' : 'Message preview:'}
                        </p>
                        <p className="text-sm text-slate-200 leading-relaxed">
                          {message.systemPreview.slice(0, 250)}
                          {message.systemPreview.length > 250 && '...'}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Right line - min width ensures visibility on narrow screens */}
                <div className={`flex-1 min-w-12 h-px ${
                  message.systemType === 'archived' 
                    ? 'bg-gradient-to-l from-transparent to-blue-500/40' 
                    : message.systemType === 'sent'
                      ? 'bg-gradient-to-l from-transparent to-cyan-500/40'
                      : message.systemType === 'search'
                        ? 'bg-gradient-to-l from-transparent to-purple-500/40'
                        : 'bg-gradient-to-l from-transparent to-green-500/40'
                }`} />
              </div>
            )}

            {/* Undo button for sent messages during undo period */}
            {message.isSystemMessage && message.systemType === 'sent' && pendingSend && pendingSend.confirmMessageId === message.id && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="w-full flex items-center justify-center gap-3 py-2"
              >
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleUndoSend}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/30 transition-colors text-sm font-medium"
                  style={{ color: 'rgb(251, 191, 36)' }}
                >
                  <RotateCcw className="w-4 h-4" />
                  Undo Send
                </motion.button>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {undoCountdown}s
                </div>
              </motion.div>
            )}

            {/* Action buttons for sent confirmation (shown after undo period) */}
            {message.isSystemMessage && message.systemType === 'sent' && message.hasActionButtons && !message.actionButtonsHandled && !pendingSend && (
              <div className="w-full flex flex-wrap items-center justify-center gap-2 py-2">
                {/* Previous button with arrow */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSentActionPrevious}
                  disabled={!onPreviousEmail}
                  className="p-2 rounded-lg transition-colors disabled:opacity-50"
                  style={{
                    background: 'var(--bg-interactive)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)'
                  }}
                  title="Previous email"
                >
                  <ChevronLeft className="w-5 h-5" />
                </motion.button>

                {/* Archive button with blue styling */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={(e) => {
                    const btn = e.currentTarget;
                    btn.classList.add('button-press-glow');
                    setTimeout(() => btn.classList.remove('button-press-glow'), 300);
                    handleSentActionArchiveNext();
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 transition-colors text-sm font-medium"
                  style={{ color: 'rgb(147, 197, 253)' }}
                >
                  <Archive className="w-4 h-4" />
                  Archive & Next
                </motion.button>

                {/* Snooze button - icon only */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onOpenSnoozePicker?.()}
                  disabled={!onOpenSnoozePicker}
                  className="p-2 rounded-lg transition-colors disabled:opacity-50"
                  style={{
                    background: 'var(--bg-interactive)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)'
                  }}
                  title="Snooze"
                >
                  <Clock className="w-5 h-5" />
                </motion.button>

                {/* Next button with arrow */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSentActionNext}
                  className="p-2 rounded-lg transition-colors"
                  style={{
                    background: 'var(--bg-interactive)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)'
                  }}
                  title="Next email"
                >
                  <ChevronRight className="w-5 h-5" />
                </motion.button>
              </div>
            )}
            

            {/* User message with edit/cancel controls */}
            {!message.isSystemMessage && message.role === 'user' && (
              <div className={`group relative ${editingMessageId === message.id ? 'w-[85%]' : 'max-w-[85%]'}`}>
                {editingMessageId === message.id ? (
                  // Editing mode - full width of container, height grows with content
                  <div 
                    className="w-full rounded-2xl px-4 py-3"
                    style={{
                      background: 'var(--bg-interactive)',
                      border: '1px solid var(--border-default)',
                    }}
                  >
                    <textarea
                      value={editingContent}
                      onChange={(e) => {
                        setEditingContent(e.target.value);
                        // Auto-resize height only
                        e.target.style.height = 'auto';
                        e.target.style.height = e.target.scrollHeight + 'px';
                      }}
                      className="w-full bg-transparent text-sm resize-none focus:outline-none"
                      style={{ 
                        color: 'var(--text-primary)',
                        minHeight: '1.5em',
                      }}
                      rows={1}
                      autoFocus
                      ref={(el) => {
                        if (el) {
                          // Auto-size height on mount
                          el.style.height = 'auto';
                          el.style.height = el.scrollHeight + 'px';
                        }
                      }}
                    />
                    <div className="flex gap-2 justify-end mt-2">
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1.5 text-xs rounded-lg transition-colors"
                        style={{
                          background: 'var(--bg-elevated)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(message.id)}
                        className="px-3 py-1.5 text-xs rounded-lg text-white transition-colors bg-blue-500 hover:bg-blue-600"
                      >
                        Resend
                      </button>
                    </div>
                  </div>
                ) : (
                  // Normal display - user messages get gray bubble
                  <>
                    <div 
                      className={`rounded-2xl px-4 py-3 ${message.transcriptionError ? 'cursor-pointer' : ''}`}
                      onClick={() => {
                        if (message.transcriptionError) {
                          retryTranscription(message.id);
                        }
                      }}
                      style={message.isTranscribing ? {
                        background: 'var(--bg-interactive)',
                        border: '1px solid var(--border-default)'
                      } : message.transcriptionError ? {
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px dashed rgba(239, 68, 68, 0.35)',
                        color: 'var(--text-primary)'
                      } : {
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-primary)'
                      }}
                    >
                      {message.isTranscribing ? (
                        <div className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-sm">Transcribing...</span>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                    
                    {/* Action buttons - only show edit on hover for completed messages */}
                    {!message.isTranscribing && !message.transcriptionError && !isLoading && (
                      <div className="absolute -left-12 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEditing(message.id, message.content)}
                          className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
                          title="Edit and resend"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                      </div>
                    )}
                    
                    {/* Cancel button for transcribing messages */}
                    {message.isTranscribing && (
                      <button
                        onClick={() => cancelMessage(message.id)}
                        className="absolute -left-12 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 transition-colors"
                        title="Cancel"
                      >
                        <X className="w-4 h-4 text-red-400" />
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Assistant message - no bubble, just text with copy/speak buttons */}
            {!message.isSystemMessage && message.role === 'assistant' && message.content?.trim() && !message.isStreaming && (
              <div className="max-w-[85%] px-1 py-2 group/assistant">
                <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                  {message.content}
                </p>
                {/* Copy and speak buttons - always visible on mobile, hover on desktop */}
                <div className="flex items-center gap-0.5 mt-1.5 opacity-50 sm:opacity-0 sm:group-hover/assistant:opacity-60 transition-opacity">
                  <CopyButton content={message.content} className="hover:!opacity-100" />
                  <TTSController content={message.content} id={message.id} className="hover:!opacity-100" />
                </div>
              </div>
            )}
            {/* Streaming assistant message - no buttons yet */}
            {!message.isSystemMessage && message.role === 'assistant' && message.content?.trim() && message.isStreaming && (
              <div className="max-w-[85%] px-1 py-2">
                <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                  {message.content}
                </p>
              </div>
            )}

            {/* Search results - simple left-aligned in chat flow */}
            {!message.isSystemMessage && message.searchResults && message.searchResults.length > 0 && (
              <div className="max-w-[85%] px-1 py-1">
                {message.searchResults.map((result, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {result.success ? (
                      <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    )}
                    <span>
                      {result.type === 'web_search' 
                        ? `Searched web: "${result.query}"`
                        : result.type === 'search_emails'
                          ? `Searched emails: "${result.query}"`
                          : `Read: ${result.query}`
                      }
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Draft card - active, cancelled, saved, or sent */}
            {message.draft && message.role === 'assistant' && (
              <div className="w-full max-w-[85%] mt-3">
                {message.draftSent ? (
                  <CompletedDraftPreview draft={message.draft} status="sent" />
                ) : message.draftSaved ? (
                  <CompletedDraftPreview draft={message.draft} status="saved" />
                ) : message.draftCancelled ? (
                  <CompletedDraftPreview draft={message.draft} status="cancelled" />
                ) : (
                  <DraftCard
                    draft={message.draft}
                    thread={thread}
                    onSend={handleSendDraft}
                    onSaveDraft={onSaveDraft ? handleSaveDraft : undefined}
                    onDiscard={handleDiscardDraft}
                    isSending={isSending}
                    isSaving={isSaving}
                    isDeleting={isDeleting}
                    isStreaming={message.isStreaming}
                  />
                )}
              </div>
            )}

            {/* Tool action indicator */}
            {!message.content?.trim() && message.toolCalls && message.toolCalls.length > 0 && !message.draft && message.role === 'assistant' && (
              <div className="rounded-2xl px-4 py-3 flex items-center gap-2" style={{ background: 'var(--bg-elevated)' }}>
                <Sparkles className="w-4 h-4 text-blue-400" />
                <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {message.toolCalls[0].name === 'archive_email' && 'Archived!'}
                  {message.toolCalls[0].name === 'go_to_next_email' && 'Moving to next...'}
                  {message.toolCalls[0].name === 'go_to_inbox' && 'Going to inbox...'}
                  {message.toolCalls[0].name === 'send_email' && 'Sending...'}
                </span>
              </div>
            )}
          </motion.div>
        );
        })}

        {/* Current draft - only show if no ACTIVE (non-cancelled/saved/sent) draft in messages */}
        {currentDraft && !messages.some(m => m.draft && !m.draftCancelled && !m.draftSaved && !m.draftSent) && (
          <motion.div
            // Only animate opacity - no transforms to avoid iOS cursor positioning issues in textareas
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full max-w-[85%]"
          >
            <DraftCard
              draft={currentDraft}
              thread={thread}
              onSend={handleSendDraft}
              onSaveDraft={onSaveDraft ? handleSaveDraft : undefined}
              onDiscard={handleDiscardDraft}
              isSending={isSending}
              isSaving={isSaving}
              isDeleting={isDeleting}
            />
          </motion.div>
        )}

        {/* AI Loading indicator with cancel */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`flex justify-start ${messages.length > 0 ? 'mt-3' : ''}`}
          >
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: 'var(--bg-elevated)' }}>
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{loadingStatus}</span>
              <button
                onClick={cancelAIResponse}
                className="p-1 rounded transition-colors"
                title="Cancel"
                style={{ color: 'var(--text-muted)' }}
              >
                <X className="w-4 h-4 hover:text-red-400" />
              </button>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
        </div>{/* End inner padding wrapper */}
      </div>

      {/* Undo Send Banner - styled like inbox archive undo */}
      <AnimatePresence>
        {pendingSend && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="px-3 pb-2 pt-1"
            style={{ 
              background: 'linear-gradient(to top, var(--bg-primary) 70%, transparent)',
            }}
          >
            <motion.div 
              className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl"
              style={{ 
                background: 'var(--bg-elevated)', 
                border: '1px solid var(--border-subtle)',
                boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
              }}
            >
              {/* Left side: Message */}
              <div className="flex items-center gap-2 min-w-0">
                <Send className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>
                  Sending to {pendingSend.draft.to[0] || 'recipient'}...
                </span>
              </div>
              
              {/* Right side: Undo button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleUndoSend}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
                style={{ 
                  background: 'var(--bg-interactive)',
                  color: 'var(--text-accent-blue)'
                }}
              >
                <span className="text-sm font-medium">Undo</span>
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <div className="p-4" style={{ background: 'var(--bg-sidebar)', borderTop: '1px solid var(--border-subtle)' }}>
        {/* Recording state */}
        <AnimatePresence>
          {isRecording && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-3 p-3 rounded-2xl"
              style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(239, 68, 68, 0.3)' }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1">
                  <motion.div
                    className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0"
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                  <WaveformVisualizer
                    analyserNode={analyserNode}
                    isRecording={isRecording}
                    compact
                    className="flex-1 max-w-[160px]"
                  />
                  <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{formatDuration(recordingDuration)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Cancel recording button */}
                  <button
                    onClick={cancelRecording}
                    className="p-2.5 rounded-xl transition-colors"
                    style={{ background: 'var(--bg-interactive)', color: 'var(--text-secondary)' }}
                    title="Cancel recording"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  {/* Submit recording to chat - up arrow indicates adding to chat */}
                  <button
                    onClick={stopRecording}
                    className="p-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 text-white hover:opacity-90 transition-all shadow-lg shadow-purple-500/20"
                    title="Add to chat"
                  >
                    <ArrowUp className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* When message is fully expanded on mobile, show action buttons instead of chat input */}
        <AnimatePresence mode="wait">
          {isMessageFullyExpanded && thread ? (
            <motion.div
              key="action-buttons"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2 }}
              className="flex items-center justify-center gap-2"
            >
              {/* Previous button */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onPreviousEmail}
                disabled={!onPreviousEmail}
                className="p-2.5 rounded-xl transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--bg-interactive)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)'
                }}
                title="Previous email"
              >
                <ChevronLeft className="w-5 h-5" />
              </motion.button>

              {/* Archive button */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={(e) => animateButton(e, () => archiveWithNotification())}
                disabled={!onArchive || isArchiving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/30 transition-colors disabled:opacity-50"
                style={{ color: 'rgb(147, 197, 253)' }}
              >
                {isArchiving ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Archive className="w-5 h-5" />
                )}
                <span className="text-sm font-medium">Archive</span>
              </motion.button>

              {/* Snooze button - icon only */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onOpenSnoozePicker?.()}
                disabled={!onOpenSnoozePicker}
                className="p-2.5 rounded-xl transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--bg-interactive)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)'
                }}
                title="Snooze"
              >
                <Clock className="w-5 h-5" />
              </motion.button>

              {/* Next button */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onNextEmail}
                disabled={!onNextEmail}
                className="p-2.5 rounded-xl transition-colors disabled:opacity-50"
                style={{
                  background: 'var(--bg-interactive)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-muted)'
                }}
                title="Next email"
              >
                <ChevronRight className="w-5 h-5" />
              </motion.button>
            </motion.div>
          ) : (
            <motion.form 
              key="chat-input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.2 }}
              onSubmit={handleSubmit} 
              className="flex items-center gap-2"
            >
              {!isRecording && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  type="button"
                  onClick={startRecording}
                  disabled={isLoading}
                  className="p-3 rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 text-white disabled:opacity-50"
                >
                  <Mic className="w-5 h-5" />
                </motion.button>
              )}
              
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                  placeholder={isRecording ? 'Recording...' : 'Type or tap mic...'}
                  rows={1}
                  disabled={isRecording}
                  className="w-full px-4 py-3 rounded-2xl focus:outline-none focus:ring-2 focus:ring-purple-500/30 resize-none disabled:opacity-50"
                  style={{ 
                    background: 'var(--bg-interactive)', 
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)'
                  }}
                />
              </div>
              
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="submit"
                disabled={!input.trim() || isLoading || isRecording}
                className="p-3 rounded-xl text-white disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#3b82f6' }}
                title="Add to chat"
              >
                <ArrowUp className="w-5 h-5" />
              </motion.button>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
