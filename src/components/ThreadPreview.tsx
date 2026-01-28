'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Mail, Maximize2, Minimize2, GripHorizontal, Inbox, Send, Star, FolderOpen, Clock, Shield, ShieldOff, Paperclip, Download, FileText, Image as ImageIcon, Film, Music, FileArchive, FileCode, File, X, Copy, Check } from 'lucide-react';
import { EmailThread, EmailMessage } from '@/types';
import { EmailHtmlViewer, isHtmlContent, normalizeEmailPlainText, stripBasicHtml } from './EmailHtmlViewer';
import { getDisplayContent } from '@/lib/email-content-parser';
import { getMessageBodyClass, getMetadataClass, getQuotedContentClass } from '@/lib/email-styles';
import { UnsubscribeButton } from './UnsubscribeButton';
import Linkify from 'linkify-react';

import { Attachment } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { getAttachment } from '@/lib/gmail';
import { formatFileSize } from '@/lib/email-parsing';
import { TTSController } from './TTSController';

// Copy button for email messages
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
      className={`p-1.5 rounded transition-all hover:bg-white/10 ${className}`}
      style={{ color: 'var(--text-muted)' }}
      title={copied ? 'Copied!' : 'Copy message'}
    >
      {copied ? (
        <Check className="w-4 h-4 text-green-400" />
      ) : (
        <Copy className="w-4 h-4" />
      )}
    </button>
  );
}

// Get appropriate icon for attachment type
function getAttachmentIcon(mimeType: string): React.ElementType {
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.startsWith('video/')) return Film;
  if (mimeType.startsWith('audio/')) return Music;
  if (mimeType.includes('pdf') || mimeType.includes('document')) return FileText;
  if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('compressed')) return FileArchive;
  if (mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('html')) return FileCode;
  return File;
}

// Folder type and display config
type MailFolder = 'inbox' | 'sent' | 'starred' | 'all' | 'drafts' | 'snoozed' | 'spam';

const FOLDER_DISPLAY: Record<MailFolder, { label: string; icon: React.ElementType; color: string }> = {
  inbox: { label: 'Inbox', icon: Inbox, color: 'text-blue-400 bg-blue-500/20' },
  sent: { label: 'Sent', icon: Send, color: 'text-green-400 bg-green-500/20' },
  starred: { label: 'Starred', icon: Star, color: 'text-yellow-400 bg-yellow-500/20' },
  all: { label: 'All Mail', icon: FolderOpen, color: 'text-slate-400 bg-slate-500/20' },
  drafts: { label: 'Drafts', icon: Mail, color: 'text-red-400 bg-red-500/20' },
  snoozed: { label: 'Snoozed', icon: Clock, color: 'text-amber-400 bg-amber-500/20' },
  spam: { label: 'Spam', icon: Shield, color: 'text-orange-400 bg-orange-500/20' },
};

/**
 * Clean angle-bracketed URLs like <https://example.com> to just https://example.com
 * This is a common format in plain text emails
 */
function cleanAngleBracketUrls(text: string): string {
  if (!text) return '';
  // Match <URL> and extract just the URL
  return text.replace(/<(https?:\/\/[^>]+)>/gi, '$1');
}

/**
 * Detect if a line is part of quoted content
 */
function isQuotedLine(line: string): boolean {
  const trimmed = line.trim();
  // Lines starting with > (quoted reply)
  if (trimmed.startsWith('>')) return true;
  return false;
}

/**
 * Detect if a line is a quote attribution (e.g., "On Jan 10, 2026, John wrote:")
 */
function isQuoteAttribution(line: string): boolean {
  const trimmed = line.trim();
  // Match patterns like "On [date], [name] wrote:" or "On [date] at [time] [name] <email> wrote:"
  if (/^On\s+.+\s+wrote:?\s*$/i.test(trimmed)) return true;
  // Match "From: ... Sent: ... To: ..." (forwarded email headers)
  if (/^(From|Sent|To|Subject|Date):\s*.+$/i.test(trimmed)) return true;
  return false;
}

/**
 * Parse email body into main content and quoted content
 */
function parseEmailContent(text: string): { mainContent: string; quotedContent: string | null; attributionLine: string | null } {
  if (!text) return { mainContent: '', quotedContent: null, attributionLine: null };
  
  const lines = text.split('\n');
  const mainLines: string[] = [];
  const quotedLines: string[] = [];
  let attributionLine: string | null = null;
  let inQuotedSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if this line starts quoted content
    if (!inQuotedSection && isQuoteAttribution(line)) {
      // Found attribution line - everything after is quoted
      attributionLine = line;
      inQuotedSection = true;
      continue;
    }
    
    if (!inQuotedSection && isQuotedLine(line)) {
      // Found quoted line without attribution
      inQuotedSection = true;
    }
    
    if (inQuotedSection) {
      quotedLines.push(line);
    } else {
      mainLines.push(line);
    }
  }
  
  // Trim trailing empty lines from main content
  while (mainLines.length > 0 && mainLines[mainLines.length - 1].trim() === '') {
    mainLines.pop();
  }
  
  return {
    mainContent: mainLines.join('\n'),
    quotedContent: quotedLines.length > 0 ? quotedLines.join('\n') : null,
    attributionLine,
  };
}

/**
 * Component to render email body with collapsible quoted content
 */
function EmailBodyWithQuotes({
  content,
  isDraft = false
}: {
  content: string;
  isDraft?: boolean;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const normalized = normalizeEmailPlainText(content);
  const { mainContent, quotedContent, attributionLine } = parseEmailContent(normalized);

  return (
    <div className={isDraft ? 'italic' : ''}>
      {/* Main content with improved styling */}
      <div className={getMessageBodyClass(true)}>
        <Linkify
          options={{
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'text-blue-400 hover:text-blue-300 underline',
            format: (value: string, type: string) => {
              if (type === 'url' && value.length > 50) {
                return value.slice(0, 50) + '…';
              }
              return value;
            }
          }}
        >
          {cleanAngleBracketUrls(mainContent)}
        </Linkify>
      </div>
      
      {/* Quoted content toggle */}
      {quotedContent && (
        <div className="mt-2">
          <button
            onClick={() => setShowQuoted(!showQuoted)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <span className="tracking-wider">•••</span>
          </button>
          
          <AnimatePresence>
            {showQuoted && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden"
              >
                <div 
                  className="mt-2 pl-3 border-l-2 whitespace-pre-wrap"
                  style={{ 
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-secondary)'
                  }}
                >
                  {/* Attribution line */}
                  {attributionLine && (
                    <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                      {attributionLine}
                    </div>
                  )}
                  {/* Quoted text */}
                  <Linkify
                    options={{
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      className: 'text-blue-400 hover:underline',
                    }}
                  >
                    {cleanAngleBracketUrls(quotedContent)}
                  </Linkify>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      
      {isDraft && (
        <div className="mt-2 text-xs text-red-400/70 not-italic">
          — This is a draft, not yet sent
        </div>
      )}
    </div>
  );
}

interface ThreadPreviewProps {
  thread: EmailThread;
  folder?: MailFolder;
  defaultExpanded?: boolean;
  /** Number of messages to reveal (from most recent). 0 = collapsed, 1+ = expanded with N messages. */
  revealedMessageCount?: number;
  /** Base count set by manual actions. Scroll-close snaps back to this. */
  baseRevealedCount?: number;
  /** Callback for MANUAL actions (header click) - sets both base and current */
  onRevealedCountChange?: (count: number) => void;
  /** Callback for SCROLL actions - only sets current, not base */
  onScrollReveal?: (count: number) => void;
  /**
   * Parent-triggered request to expand the message region to fit current content.
   * Increment this number to trigger another expand attempt.
   */
  expandRequestId?: number;
  /**
   * Reports whether the *next* pull-to-reveal gesture should EXPAND (vs reveal next message).
   * This is intentionally conservative: currently only true for the "most recent message" case.
   */
  onNeedsExpandChange?: (needsExpand: boolean) => void;
  /** Navigate to next thread (swipe left) */
  onNextEmail?: () => void;
  /** Navigate to previous thread (swipe right) */
  onPreviousEmail?: () => void;
  /** If true, start with full height (70% of viewport) - used for unread emails */
  startFullyExpanded?: boolean;
  /** Callback when user clicks edit draft - opens draft in chat for editing
   *  Receives isFullyExpanded: true if message region is at ~70% viewport height */
  onEditDraft?: (isFullyExpanded: boolean) => void;
  /** Callback when the "fully expanded" state changes - for showing/hiding action buttons */
  onFullyExpandedChange?: (isFullyExpanded: boolean) => void;
}

// Storage keys for persisting state
const STORAGE_KEY_EXPANDED = 'flomail-thread-expanded';
const STORAGE_KEY_HEIGHT = 'flomail-thread-height';

export function ThreadPreview({ 
  thread, 
  folder = 'inbox', 
  defaultExpanded = false,
  revealedMessageCount,
  baseRevealedCount = 1,
  onRevealedCountChange,
  onScrollReveal,
  expandRequestId,
  onNeedsExpandChange,
  onNextEmail,
  onPreviousEmail,
  startFullyExpanded = false,
  onEditDraft,
  onFullyExpandedChange,
}: ThreadPreviewProps) {
  const { getAccessToken } = useAuth();
  
  // If revealedMessageCount is provided (parent-controlled mode):
  // - 0 means collapsed
  // - 1+ means expanded with N messages visible
  const isPullToRevealMode = revealedMessageCount !== undefined;
  
  // In parent-controlled mode, expand state is derived from revealedMessageCount
  // Otherwise, use local state (legacy behavior)
  const [localIsExpanded, setLocalIsExpanded] = useState(() => {
    if (typeof window === 'undefined') return defaultExpanded;
    const saved = localStorage.getItem(STORAGE_KEY_EXPANDED);
    return saved !== null ? saved === 'true' : defaultExpanded;
  });
  
  // Determine actual expanded state
  const isExpanded = isPullToRevealMode 
    ? (revealedMessageCount || 0) > 0 
    : localIsExpanded;
  
  // Tracks which individual messages are expanded (shows full content)
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set([thread.messages[thread.messages.length - 1]?.id])
  );
  
  // Load persisted height from localStorage
  // For unread emails (startFullyExpanded), use 70% of viewport height
  const [messagesHeight, setMessagesHeight] = useState(() => {
    if (typeof window === 'undefined') return startFullyExpanded ? 500 : 250;
    if (startFullyExpanded) {
      // Use 70% of viewport height for unread emails
      return Math.floor(window.innerHeight * 0.7);
    }
    const saved = localStorage.getItem(STORAGE_KEY_HEIGHT);
    return saved !== null ? parseInt(saved, 10) : 250;
  });
  // The user's baseline (manually resized) height. Auto-expands should NOT overwrite this.
  // For unread emails, we don't want to persist the large initial height
  const manualHeightRef = useRef(startFullyExpanded ? 250 : messagesHeight);
  
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousThreadId = useRef<string | null>(null);
  
  // Persist expanded state when it changes (only in local mode)
  useEffect(() => {
    if (!isPullToRevealMode) {
      localStorage.setItem(STORAGE_KEY_EXPANDED, String(localIsExpanded));
    }
  }, [localIsExpanded, isPullToRevealMode]);

  // Persist height when it changes (debounced via mouseUp)
  const saveHeight = useCallback((height: number) => {
    localStorage.setItem(STORAGE_KEY_HEIGHT, String(height));
  }, []);

  // When thread changes, reset expanded messages to only the latest
  useEffect(() => {
    if (previousThreadId.current !== thread.id) {
      setExpandedMessages(new Set([thread.messages[thread.messages.length - 1]?.id]));
      previousThreadId.current = thread.id;
      prevRevealedCount.current = 0;
    }
  }, [thread.id, thread.messages]);

  // Track previous revealed count to detect when new messages are revealed
  const prevRevealedCount = useRef(revealedMessageCount || 0);
  
  // Auto-expand individual messages when they're revealed by scrolling
  useEffect(() => {
    if (!isPullToRevealMode) return;
    
    const currentCount = revealedMessageCount || 0;
    
    if (currentCount > prevRevealedCount.current && currentCount > 0) {
      const revealedMessages = thread.messages.slice(-currentCount);
      setExpandedMessages(prev => {
        const newSet = new Set(prev);
        revealedMessages.forEach(msg => newSet.add(msg.id));
        return newSet;
      });
    }
    
    prevRevealedCount.current = currentCount;
  }, [revealedMessageCount, isPullToRevealMode, thread.messages]);
  
  // ===========================================
  // SIMPLE SCROLL INDICATOR - shows when there's more to scroll
  // ===========================================
  const [hasMoreBelow, setHasMoreBelow] = useState(false);
  
  // Simple function to check if there's more content below
  const checkHasMoreBelow = useCallback(() => {
    const container = containerRef.current;
    if (!container) return false;
    
    const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
    return remaining > 10;
  }, []);
  
  // Set up scroll listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isExpanded) {
      setHasMoreBelow(false);
      if (needsExpandRef.current) {
        needsExpandRef.current = false;
        onNeedsExpandChangeRef.current?.(false);
      }
      return;
    }
    
    // Check function - updates state only if value changes
    const updateIndicator = () => {
      const shouldShow = checkHasMoreBelow();
      setHasMoreBelow(prev => prev !== shouldShow ? shouldShow : prev);

      // ===== needsExpand computation =====
      // Only applies to the "most recent message not fully visible" case:
      // - pull-to-reveal mode
      // - exactly 1 message revealed
      // - user is at TOP of message container
      // - there is more content below (would show gradient)
      // - we still have room to grow the message region height
      const count = revealedCountRef.current;
      const atTop = container.scrollTop <= 5;
      const maxAllowedHeight = window.innerHeight * 0.7;
      const canExpand = messagesHeightRef.current < maxAllowedHeight - 1;
      const needsExpand = Boolean(isPullToRevealMode && count === 1 && atTop && shouldShow && canExpand);

      if (needsExpand !== needsExpandRef.current) {
        needsExpandRef.current = needsExpand;
        onNeedsExpandChangeRef.current?.(needsExpand);
      }
    };
    
    // Multiple checks at different delays to catch iframe/image loading
    const timers = [
      setTimeout(updateIndicator, 50),
      setTimeout(updateIndicator, 200),
      setTimeout(updateIndicator, 500),
      setTimeout(updateIndicator, 1000),
      setTimeout(updateIndicator, 2000), // For slow-loading images
    ];
    
    // Listen to scroll events
    container.addEventListener('scroll', updateIndicator, { passive: true });
    
    // Poll every 300ms (more frequent than before)
    const pollInterval = setInterval(updateIndicator, 300);
    
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(pollInterval);
      container.removeEventListener('scroll', updateIndicator);
    };
  }, [isExpanded, checkHasMoreBelow, isPullToRevealMode]);
  
  // Also check when content changes (like expanding/collapsing messages)
  useEffect(() => {
    if (!isExpanded) return;
    
    const updateIndicator = () => {
      const container = containerRef.current;
      if (!container) return;
      
      const shouldShow = checkHasMoreBelow();
      setHasMoreBelow(shouldShow);

      // Keep needsExpand in sync for delayed iframe/image resizes too
      const count = revealedCountRef.current;
      const atTop = container.scrollTop <= 5;
      const maxAllowedHeight = window.innerHeight * 0.7;
      const canExpand = messagesHeightRef.current < maxAllowedHeight - 1;
      const needsExpand = Boolean(isPullToRevealMode && count === 1 && atTop && shouldShow && canExpand);
      
      if (needsExpand !== needsExpandRef.current) {
        needsExpandRef.current = needsExpand;
        onNeedsExpandChangeRef.current?.(needsExpand);
      }
    };
    
    // Check at multiple delays to catch animations and iframe resizes
    const t1 = setTimeout(updateIndicator, 100);
    const t2 = setTimeout(updateIndicator, 400);
    const t3 = setTimeout(updateIndicator, 800);
    
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isExpanded, expandedMessages.size, thread.messages.length, messagesHeight, checkHasMoreBelow]);
  
  // Auto-expand for unread emails: immediately expand to fit content
  useEffect(() => {
    if (!startFullyExpanded || !isExpanded) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    const autoExpandToFit = () => {
      const maxAllowedHeight = window.innerHeight * 0.7;
      const contentHeight = container.scrollHeight + 20;
      const newHeight = Math.min(contentHeight, maxAllowedHeight);
      
      if (newHeight > messagesHeight) {
        setMessagesHeight(newHeight);
        messagesHeightRef.current = newHeight;
      }
    };
    
    // Multiple attempts to catch iframe/image loading
    const t1 = setTimeout(autoExpandToFit, 100);
    const t2 = setTimeout(autoExpandToFit, 300);
    const t3 = setTimeout(autoExpandToFit, 600);
    const t4 = setTimeout(autoExpandToFit, 1000);
    
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [startFullyExpanded, isExpanded, thread.id]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Handler for toggling expand state
  const handleToggleExpand = useCallback(() => {
    if (isPullToRevealMode && onRevealedCountChange) {
      onRevealedCountChange(isExpanded ? 0 : 1);
    } else {
      setLocalIsExpanded(prev => !prev);
    }
  }, [isPullToRevealMode, onRevealedCountChange, isExpanded]);

  // ===========================================
  // SCROLL-TO-REVEAL/CLOSE WITHIN MESSAGE CONTAINER
  // ===========================================
  // Behavior:
  // - At TOP of scroll + scroll UP (deltaY < 0) → reveal ONE older message
  // - At BOTTOM of scroll + scroll DOWN (deltaY > 0) → collapse ALL to base
  //
  // Uses refs to avoid stale closure issues
  const revealedCountRef = useRef<number>(revealedMessageCount ?? 0);
  const baseCountRef = useRef(baseRevealedCount);
  const totalMessagesRef = useRef(thread.messages.length);
  const hasRevealedThisGesture = useRef(false);
  const gestureTimeout = useRef<NodeJS.Timeout | null>(null);
  const onScrollRevealRef = useRef(onScrollReveal);
  const onNeedsExpandChangeRef = useRef(onNeedsExpandChange);
  const needsExpandRef = useRef(false);
  const lastExpandRequestIdRef = useRef<number | undefined>(expandRequestId);
  
  // Keep refs in sync
  useEffect(() => { revealedCountRef.current = revealedMessageCount ?? 0; }, [revealedMessageCount]);
  useEffect(() => { baseCountRef.current = baseRevealedCount; }, [baseRevealedCount]);
  useEffect(() => { totalMessagesRef.current = thread.messages.length; }, [thread.messages.length]);
  useEffect(() => { onScrollRevealRef.current = onScrollReveal; }, [onScrollReveal]);
  useEffect(() => { onNeedsExpandChangeRef.current = onNeedsExpandChange; }, [onNeedsExpandChange]);
  
  // Refs for navigation callbacks (to avoid stale closures)
  const onNextEmailRef = useRef(onNextEmail);
  const onPreviousEmailRef = useRef(onPreviousEmail);
  useEffect(() => { onNextEmailRef.current = onNextEmail; }, [onNextEmail]);
  useEffect(() => { onPreviousEmailRef.current = onPreviousEmail; }, [onPreviousEmail]);
  
  // Horizontal swipe state
  const horizontalAccumulatedDelta = useRef(0);
  const hasNavigatedThisGesture = useRef(false);
  
  // Ref for height to use in scroll handler
  const messagesHeightRef = useRef(messagesHeight);
  useEffect(() => { messagesHeightRef.current = messagesHeight; }, [messagesHeight]);
  
  // Report fully expanded state to parent
  const lastFullyExpandedRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!onFullyExpandedChange) return;
    const maxAllowedHeight = typeof window !== 'undefined' ? window.innerHeight * 0.7 : 500;
    const isFullyExpanded = isExpanded && messagesHeight >= maxAllowedHeight * 0.85;
    if (lastFullyExpandedRef.current !== isFullyExpanded) {
      lastFullyExpandedRef.current = isFullyExpanded;
      onFullyExpandedChange(isFullyExpanded);
    }
  }, [messagesHeight, isExpanded, onFullyExpandedChange]);

  // When the message region is re-opened (collapsed → expanded), reset to the user's baseline height.
  // This keeps the "first open = half-ish" behavior consistent even after a temporary auto-expand.
  const wasExpandedRef = useRef(isExpanded);
  useEffect(() => {
    const wasExpanded = wasExpandedRef.current;
    if (!wasExpanded && isExpanded) {
      const baseline = manualHeightRef.current;
      if (Math.abs(messagesHeightRef.current - baseline) > 1) {
        setMessagesHeight(baseline);
        messagesHeightRef.current = baseline;
        currentHeightRef.current = baseline;
      }
    }
    wasExpandedRef.current = isExpanded;
  }, [isExpanded]);
  
  
  // Parent-triggered expand request (e.g., pull gesture in chat region)
  useEffect(() => {
    if (expandRequestId === undefined) return;
    if (expandRequestId === lastExpandRequestIdRef.current) return;
    lastExpandRequestIdRef.current = expandRequestId;
    
    const container = containerRef.current;
    if (!container || !isExpanded) return;
    
    const maxAllowedHeight = window.innerHeight * 0.7;
    const contentHeight = container.scrollHeight + 20;
    const newHeight = Math.min(contentHeight, maxAllowedHeight);
    
    if (newHeight > messagesHeightRef.current + 1) {
      setMessagesHeight(newHeight);
      messagesHeightRef.current = newHeight;
      currentHeightRef.current = newHeight;
      // NOTE: do not persist auto-expands; only manual resizes persist.
    }
  }, [expandRequestId, isExpanded, saveHeight]);
  
  // Set up wheel handler for reveal/collapse/expand
  useEffect(() => {
    // Only attach handlers when expanded (container exists)
    if (!isExpanded) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    let accumulatedDelta = 0;
    const threshold = 60;
    let isTouching = false;
    let lastTouchY = 0;
    
    // Collapse gesture gating:
    // Prevent accidental collapse when you *reach* bottom while still scrolling.
    // Only allow collapse if the scroll gesture STARTED while already at bottom / in collapse zone.
    let wheelLastEventAt = 0;
    let wheelGestureStartedInCollapseArea = false;
    let wheelCollapseAccumulated = 0;
    const wheelGestureGapMs = 30; // Very short pause to distinguish "new gesture at bottom" from "continuous scroll reaching bottom"
    const wheelCollapseThreshold = 60; // Hard scroll requirement
    const wheelMinDeltaToCount = 6; // Ignore tiny inertial deltas

    // Touch: similarly, only allow collapse if the touch gesture started at bottom / in collapse zone
    let touchCollapseEligible = false;
    let touchCollapseAccumulated = 0;
    const touchCollapseThreshold = 60;
    
    const resetGesture = () => {
      if (gestureTimeout.current) clearTimeout(gestureTimeout.current);
      gestureTimeout.current = setTimeout(() => {
        hasRevealedThisGesture.current = false;
        accumulatedDelta = 0;
      }, 40); // 40ms between actions
    };
    
    const handleWheel = (e: WheelEvent) => {
      // Skip if we're resizing
      if (isDragging.current) return;
      
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
        if (gestureTimeout.current) clearTimeout(gestureTimeout.current);
        gestureTimeout.current = setTimeout(() => {
          hasNavigatedThisGesture.current = false;
          horizontalAccumulatedDelta.current = 0;
        }, 150);
        
        return; // Don't process vertical scroll when horizontal
      }
      
      // ===========================================
      // VERTICAL SCROLL → Reveal/collapse messages
      // ===========================================
      // Skip if no scroll handler
      const scrollHandler = onScrollRevealRef.current;
      if (!scrollHandler) return;
      
      const current = Math.max(revealedCountRef.current, 1);
      const total = totalMessagesRef.current;
      
      // Check scroll position with small threshold
      const atTop = container.scrollTop <= 5;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
      
      // Check if mouse is in the "collapse zone" (bottom ~60px of the container)
      const containerRect = container.getBoundingClientRect();
      const mouseY = e.clientY;
      const distanceFromBottom = containerRect.bottom - mouseY;
      const inCollapseZone = distanceFromBottom >= 0 && distanceFromBottom <= 60;

      // Track wheel gesture boundaries so "reaching bottom" in a continuous scroll doesn't immediately collapse.
      const now = performance.now();
      const isNewWheelGesture = now - wheelLastEventAt > wheelGestureGapMs;
      if (isNewWheelGesture) {
        wheelGestureStartedInCollapseArea = atBottom || inCollapseZone;
        wheelCollapseAccumulated = 0;
      }
      wheelLastEventAt = now;
      
      // Collapse gestures (wheel):
      // - in collapse zone OR at bottom
      // - only if gesture started in collapse area (prevents continuous scroll-to-bottom from collapsing)
      if (e.deltaY > 0 && current > 0 && (inCollapseZone || atBottom)) {
        if (wheelGestureStartedInCollapseArea) {
          const dy = Math.abs(e.deltaY);
          if (dy >= wheelMinDeltaToCount) {
            wheelCollapseAccumulated += dy;
          }
          if (wheelCollapseAccumulated >= wheelCollapseThreshold) {
            scrollHandler(0);
            // Require a fresh gesture for another collapse
            wheelCollapseAccumulated = 0;
            wheelGestureStartedInCollapseArea = false;
          }
        }
        // Always swallow in collapse area to avoid scroll chaining / bounce.
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      // Pull gesture at TOP (deltaY < 0) → EXPAND (if needed) else REVEAL next
      if (e.deltaY < 0 && atTop) {
        accumulatedDelta += Math.abs(e.deltaY);
        
        if (!hasRevealedThisGesture.current && accumulatedDelta > threshold) {
          // First priority: expand the message region if the most recent message isn't fully visible
          if (needsExpandRef.current) {
            const maxAllowedHeight = window.innerHeight * 0.7;
            const contentHeight = container.scrollHeight + 20;
            const newHeight = Math.min(contentHeight, maxAllowedHeight);
            
            if (newHeight > messagesHeightRef.current + 1) {
              setMessagesHeight(newHeight);
              messagesHeightRef.current = newHeight;
              currentHeightRef.current = newHeight;
              // NOTE: do not persist auto-expands; only manual resizes persist.
            } else {
            }
            
            hasRevealedThisGesture.current = true;
          } else {
            // Otherwise reveal the next older message
            if (current < total) {
              scrollHandler(current + 1);
              hasRevealedThisGesture.current = true;
            }
          }
        }
        
        e.preventDefault();
        e.stopPropagation();
        resetGesture();
      }
    };

    // Track touch start position for both vertical and horizontal
    let touchStartX = 0;
    let touchStartY = 0;
    let touchCurrentX = 0;
    
    const handleTouchStart = (e: TouchEvent) => {
      if (isDragging.current) return;
      isTouching = true;
      lastTouchY = e.touches[0]?.clientY ?? 0;
      touchStartX = e.touches[0]?.clientX ?? 0;
      touchStartY = e.touches[0]?.clientY ?? 0;
      touchCurrentX = touchStartX;
      accumulatedDelta = 0;
      hasRevealedThisGesture.current = false;
      hasNavigatedThisGesture.current = false;
      horizontalAccumulatedDelta.current = 0;

      // Arm collapse only if the touch gesture STARTS at bottom or inside the collapse zone.
      const rect = container.getBoundingClientRect();
      const distanceFromBottomStart = rect.bottom - touchStartY;
      const startedInCollapseZone = distanceFromBottomStart >= 0 && distanceFromBottomStart <= 60;
      const startedAtBottom =
        container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
      touchCollapseEligible = startedInCollapseZone || startedAtBottom;
      touchCollapseAccumulated = 0;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isDragging.current) return;
      if (!isTouching) return;

      const x = e.touches[0]?.clientX ?? touchCurrentX;
      const y = e.touches[0]?.clientY ?? lastTouchY;
      const deltaY = y - lastTouchY;
      touchCurrentX = x;
      lastTouchY = y;
      
      // Calculate total distance from touch start
      const totalDeltaX = x - touchStartX;
      const totalDeltaY = y - touchStartY;
      
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
      const scrollHandler = onScrollRevealRef.current;
      if (!scrollHandler) return;

      const current = Math.max(revealedCountRef.current, 1);
      const total = totalMessagesRef.current;
      const atTop = container.scrollTop <= 5;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 5;
      
      // Check if touch is in the "collapse zone" (bottom ~60px of the container)
      const containerRect = container.getBoundingClientRect();
      const distanceFromBottom = containerRect.bottom - y;
      const inCollapseZone = distanceFromBottom >= 0 && distanceFromBottom <= 60;
      
      // Collapse gestures (touch):
      // - in collapse zone OR at bottom
      // - only if gesture started in collapse area (prevents continuous scroll-to-bottom from collapsing)
      if (deltaY < 0 && current > 0 && (inCollapseZone || atBottom)) {
        if (touchCollapseEligible) {
          touchCollapseAccumulated += Math.abs(deltaY);
          if (touchCollapseAccumulated >= touchCollapseThreshold) {
            scrollHandler(0);
            touchCollapseEligible = false;
            touchCollapseAccumulated = 0;
          }
        }
        // Always swallow in collapse area to avoid rubber-band / accidental chaining.
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // PULL DOWN at TOP (finger down, deltaY > 0) → EXPAND (if needed) else REVEAL next
      if (deltaY > 0 && atTop) {
        accumulatedDelta += deltaY;

        if (!hasRevealedThisGesture.current && accumulatedDelta > threshold) {
          if (needsExpandRef.current) {
            const maxAllowedHeight = window.innerHeight * 0.7;
            const contentHeight = container.scrollHeight + 20;
            const newHeight = Math.min(contentHeight, maxAllowedHeight);

            if (newHeight > messagesHeightRef.current + 1) {
              setMessagesHeight(newHeight);
              messagesHeightRef.current = newHeight;
              currentHeightRef.current = newHeight;
              // NOTE: do not persist auto-expands; only manual resizes persist.
            } else {
            }
            hasRevealedThisGesture.current = true;
          } else if (current < total) {
            scrollHandler(current + 1);
            hasRevealedThisGesture.current = true;
          }
        }

        e.preventDefault();
        e.stopPropagation();
        resetGesture();
      }
    };

    const handleTouchEnd = () => {
      isTouching = false;
      accumulatedDelta = 0;
      hasRevealedThisGesture.current = false;
      hasNavigatedThisGesture.current = false;
      horizontalAccumulatedDelta.current = 0;
    };
    
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    
    return () => {
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      if (gestureTimeout.current) clearTimeout(gestureTimeout.current);
    };
  }, [isExpanded]); // Re-run when expanded state changes so we can attach to the container
  
  // ===========================================
  // ROBUST RESIZE HANDLE
  // Uses direct DOM manipulation during drag to avoid React re-render issues
  // ===========================================
  const currentHeightRef = useRef(messagesHeight);
  const [isResizing, setIsResizing] = useState(false); // For rendering overlay
  
  // Sync ref with state (but not during drag)
  useEffect(() => { 
    if (!isDragging.current) {
      currentHeightRef.current = messagesHeight; 
    }
  }, [messagesHeight]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    setIsResizing(true); // Show overlay
    startY.current = e.clientY;
    startHeight.current = currentHeightRef.current;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('resizing-messages');
  }, []);

  // Resize event handlers - use direct DOM manipulation during drag
  useEffect(() => {
    const finishDrag = () => {
      if (isDragging.current) {
        isDragging.current = false;
        setIsResizing(false); // Hide overlay
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.body.classList.remove('resizing-messages');
        // Only update React state when drag ends
        const finalHeight = currentHeightRef.current;
        setMessagesHeight(finalHeight);
        saveHeight(finalHeight);
        manualHeightRef.current = finalHeight;
      }
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      e.preventDefault();
      
      const deltaY = e.clientY - startY.current;
      const newHeight = Math.max(80, Math.min(window.innerHeight * 0.7, startHeight.current + deltaY));
      
      // Update ref immediately
      currentHeightRef.current = newHeight;
      
      // Directly update DOM to avoid React re-render during drag
      const container = containerRef.current;
      if (container) {
        container.style.maxHeight = `${newHeight}px`;
      }
    };

    const handleMouseUp = () => finishDrag();
    const handleWindowBlur = () => finishDrag();
    // Also handle if mouse leaves the window
    const handleMouseLeave = (e: MouseEvent) => {
      // Only finish if mouse actually left the window (not just an element)
      if (e.relatedTarget === null && isDragging.current) {
        finishDrag();
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('mouseleave', handleMouseLeave);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('mouseleave', handleMouseLeave);
      // Cleanup any stuck state on unmount
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.body.classList.remove('resizing-messages');
      }
    };
  }, [saveHeight]);

  const toggleMessage = (messageId: string) => {
    setExpandedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedMessages(new Set(thread.messages.map((m) => m.id)));
  };

  const collapseAll = () => {
    setExpandedMessages(new Set());
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getAvatarColor = (email: string) => {
    const colors = [
      'from-purple-500 to-pink-500',
      'from-cyan-500 to-blue-500',
      'from-green-500 to-emerald-500',
      'from-orange-500 to-red-500',
      'from-indigo-500 to-purple-500',
      'from-rose-500 to-orange-500',
    ];
    const hash = email.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  return (
    <div>
      {/* Main content with background */}
      <div className="relative" style={{ background: 'var(--bg-sidebar)' }}>
        {/* Header row - contains subject AND expand/collapse controls */}
        <div className="relative z-10 flex items-center gap-3 px-4 py-2.5">
        {/* Clickable subject area - no envelope icon, no folder badge for more space */}
        <button
          onClick={handleToggleExpand}
          className="flex items-start gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity text-left"
        >
          <div className="flex-1 min-w-0">
            {/* Collapsed: Sender + Subject on one line */}
            {/* Expanded: Sender on first line, Subject on second line (multi-line allowed) */}
            {!isExpanded ? (
              // Collapsed view - single line
              <div className="flex items-center gap-1.5">
                <span
                  className="flex-shrink-0 text-sm font-semibold"
                  style={{ color: 'rgb(147, 197, 253)', maxWidth: '40%' }}
                >
                  <span className="truncate block">
                    {thread.messages[thread.messages.length - 1]?.from.name || 
                     thread.messages[thread.messages.length - 1]?.from.email.split('@')[0] || 
                     'Unknown'}
                  </span>
                </span>
                <span
                  className="mx-1 h-4 w-px flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.16)' }}
                />
                <span className="font-medium truncate flex-1 text-sm" style={{ color: 'var(--text-primary)' }}>
                  {thread.subject || '(No Subject)'}
                </span>
                {thread.messages.length > 1 && (
                  <span className="flex-shrink-0 text-xs text-blue-300/70 bg-blue-500/10 px-1.5 py-0.5 rounded">
                    {thread.messages.length}
                  </span>
                )}
              </div>
            ) : (
              // Expanded view - subject gets its own line(s)
              <div className="space-y-1">
                {/* Row 1: Sender + message count */}
                <div className="flex items-center gap-2">
                  <span
                    className="text-sm font-semibold"
                    style={{ color: 'rgb(147, 197, 253)' }}
                  >
                    {thread.messages[thread.messages.length - 1]?.from.name || 
                     thread.messages[thread.messages.length - 1]?.from.email.split('@')[0] || 
                     'Unknown'}
                  </span>
                  {thread.messages.length > 1 && (
                    <span className="text-xs text-blue-300/70 bg-blue-500/10 px-1.5 py-0.5 rounded">
                      {thread.messages.length}
                    </span>
                  )}
                </div>
                {/* Row 2: Full subject (can wrap to multiple lines) */}
                <p 
                  className="font-medium text-sm leading-snug" 
                  style={{ color: 'var(--text-primary)' }}
                >
                  {thread.subject || '(No Subject)'}
                </p>
              </div>
            )}
          </div>

          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0 mt-0.5"
          >
            <ChevronDown className="w-4 h-4 text-blue-400/60" />
          </motion.div>
        </button>

        {/* Expand/Collapse controls - only show when expanded, inline */}
        {isExpanded && thread.messages.length > 1 && (
          <div className="flex items-center gap-1 flex-shrink-0 pl-3" style={{ borderLeft: '1px solid var(--border-subtle)' }}>
            <button
              onClick={(e) => { e.stopPropagation(); expandAll(); }}
              className="p-1.5 transition-colors hover:text-blue-400"
              style={{ color: 'var(--text-muted)' }}
              title="Expand all"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); collapseAll(); }}
              className="p-1.5 transition-colors hover:text-blue-400"
              style={{ color: 'var(--text-muted)' }}
              title="Collapse all"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

        {/* Expanded Content - Email Thread */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="relative z-10 overflow-hidden"
            >
              {/* Messages container wrapper with scroll indicator overlay */}
              <div className="relative">
              
              {/* Invisible overlay during resize to block iframe events */}
              {isResizing && (
                <div 
                  className="absolute inset-0 z-50"
                  style={{ cursor: 'ns-resize' }}
                />
              )}
              
              <div 
                ref={containerRef}
                style={{ maxHeight: `${messagesHeight}px` }}
                className="overflow-y-auto px-4 pb-3"
              >
                {/* Collapsed messages indicator - shows count of hidden older messages */}
                {isPullToRevealMode && thread.messages.length > (revealedMessageCount || 1) && (
                  <div className="flex items-center gap-3 py-2 mb-1">
                    <div className="flex-1 h-px" style={{ background: 'linear-gradient(to right, transparent, rgba(147, 197, 253, 0.3), rgba(147, 197, 253, 0.3))' }} />
                    <span 
                      className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ 
                        color: 'rgba(147, 197, 253, 0.8)', 
                        background: 'rgba(59, 130, 246, 0.1)',
                        border: '1px solid rgba(59, 130, 246, 0.2)'
                      }}
                    >
                      {thread.messages.length - (revealedMessageCount || 1)} older {thread.messages.length - (revealedMessageCount || 1) === 1 ? 'message' : 'messages'}
                    </span>
                    <div className="flex-1 h-px" style={{ background: 'linear-gradient(to left, transparent, rgba(147, 197, 253, 0.3), rgba(147, 197, 253, 0.3))' }} />
                  </div>
                )}
                
                <AnimatePresence mode="popLayout">
                  {(() => {
                    // In pull-to-reveal mode, only show the N most recent messages
                    const messagesToShow = isPullToRevealMode
                      ? thread.messages.slice(-(revealedMessageCount || 1))
                      : thread.messages;
                    
                    return messagesToShow.map((message, index) => {
                      const originalIndex = isPullToRevealMode
                        ? thread.messages.length - messagesToShow.length + index
                        : index;
                      
                      return (
                        <motion.div
                          key={message.id}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.25, ease: 'easeOut' }}
                        >
                          <MessageItem
                            message={message}
                            isExpanded={expandedMessages.has(message.id)}
                            isLast={originalIndex === thread.messages.length - 1}
                            onToggle={() => toggleMessage(message.id)}
                            formatDate={formatDate}
                            getAvatarColor={getAvatarColor}
                            onNextEmail={onNextEmail}
                            onPreviousEmail={onPreviousEmail}
                            getAccessToken={getAccessToken}
                            onEditDraft={onEditDraft ? () => {
                              // Calculate if fully expanded (height at ~70% of viewport)
                              const maxAllowedHeight = typeof window !== 'undefined' ? window.innerHeight * 0.7 : 500;
                              const isFullyExpanded = messagesHeightRef.current >= maxAllowedHeight * 0.85;
                              onEditDraft(isFullyExpanded);
                            } : undefined}
                          />
                        </motion.div>
                      );
                    });
                  })()}
                </AnimatePresence>
                
              </div>
                
                {/* Collapse zone - positioned absolutely at bottom, handles click AND scroll-up */}
                <div className="absolute bottom-0 left-0 right-0 z-10" style={{ marginBottom: 0 }}>
                  {/* Gradient - only shown when there's more content below */}
                  <AnimatePresence>
                    {hasMoreBelow && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute bottom-0 left-0 right-0"
                        style={{
                          height: '2.5rem',
                          background: 'linear-gradient(to top, rgba(30, 58, 138, 0.85) 0%, rgba(37, 99, 235, 0.5) 40%, transparent 100%)',
                          pointerEvents: 'none'
                        }}
                      />
                    )}
                  </AnimatePresence>

                  {/* Clickable/scrollable collapse zone with semicircle - always visible */}
                  <div
                    onClick={() => {
                      // Collapse the message region
                      if (isPullToRevealMode && onScrollReveal) {
                        onScrollReveal(0);
                      } else {
                        setLocalIsExpanded(false);
                      }
                    }}
                    onWheel={(e) => {
                      // Scroll UP (negative deltaY on desktop, positive on natural scroll) = collapse
                      // We want scroll-up gesture to collapse, which is deltaY > 0 on most systems
                      if (e.deltaY > 0) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (isPullToRevealMode && onScrollReveal) {
                          onScrollReveal(0);
                        } else {
                          setLocalIsExpanded(false);
                        }
                      }
                    }}
                    onTouchStart={(e) => {
                      const touch = e.touches[0];
                      (e.currentTarget as HTMLElement).dataset.touchStartY = String(touch.clientY);
                    }}
                    onTouchMove={(e) => {
                      const startY = parseFloat((e.currentTarget as HTMLElement).dataset.touchStartY || '0');
                      const currentY = e.touches[0].clientY;
                      const deltaY = currentY - startY;
                      // Swipe up (negative delta) = collapse
                      if (deltaY < -30) {
                        if (isPullToRevealMode && onScrollReveal) {
                          onScrollReveal(0);
                        } else {
                          setLocalIsExpanded(false);
                        }
                      }
                    }}
                    className="w-full cursor-pointer group flex items-end justify-center pb-0 relative"
                    style={{
                      height: hasMoreBelow ? '2.5rem' : '1.75rem', // Smaller when at bottom
                    }}
                  >
                    {/* Semicircle collapse handle - always visible but smaller when at bottom */}
                    <motion.div
                      animate={{
                        scale: hasMoreBelow ? 1 : 0.85,
                        opacity: hasMoreBelow ? 1 : 0.9
                      }}
                      transition={{ duration: 0.2 }}
                      className="relative flex items-center justify-center transition-all group-hover:scale-105"
                      title="Scroll or tap to collapse"
                      style={{
                        width: '56px',
                        height: '28px',
                        borderTopLeftRadius: '28px',
                        borderTopRightRadius: '28px',
                        background: 'linear-gradient(to bottom, rgba(59, 130, 246, 0.35), rgba(59, 130, 246, 0.5))',
                        boxShadow: '0 -2px 12px rgba(59, 130, 246, 0.3), inset 0 1px 0 rgba(147, 197, 253, 0.3)',
                        marginBottom: '-1px', // Connect to bottom edge
                      }}
                    >
                      <ChevronUp
                        className="w-5 h-5 transition-transform group-hover:-translate-y-0.5"
                        style={{ color: 'rgba(147, 197, 253, 1)' }}
                        strokeWidth={2.5}
                      />
                    </motion.div>
                  </div>
                </div>
              </div>{/* End wrapper */}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Draggable resize handle - only show when expanded */}
      {isExpanded && (
        <div
          onMouseDown={handleMouseDown}
          className="group relative cursor-ns-resize resize-handle"
        >
          {/* Subtle separator line */}
          <div className="h-px" style={{ background: 'var(--border-default)' }}></div>
          
          {/* Drag handle indicator */}
          <div className="absolute left-1/2 -translate-x-1/2 -top-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <GripHorizontal className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
          </div>
          
          {/* Larger hit area for easier grabbing */}
          <div className="absolute inset-x-0 -top-2 h-6"></div>
        </div>
      )}
      
      {/* Simple line when collapsed */}
      {!isExpanded && (
        <div className="h-px" style={{ background: 'var(--border-default)' }}></div>
      )}
      
      {/* Subtle shadow for depth */}
      <div className="h-2" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.15), transparent)' }}></div>
    </div>
  );
}

// Attachment item component
function AttachmentItem({ 
  attachment, 
  messageId,
  getAccessToken 
}: { 
  attachment: Attachment; 
  messageId: string;
  getAccessToken: () => Promise<string | null>;
}) {
  const [loading, setLoading] = useState(false);
  const Icon = getAttachmentIcon(attachment.mimeType);
  
  const handleDownload = async () => {
    setLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      
      const base64Data = await getAttachment(token, messageId, attachment.id);
      
      // Convert base64 to blob and download
      const binaryStr = atob(base64Data.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: attachment.mimeType });
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download attachment:', err);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors hover:bg-white/10 disabled:opacity-50"
      style={{ background: 'var(--bg-interactive)', border: '1px solid var(--border-subtle)' }}
      title={`Download ${attachment.filename}`}
    >
      <Icon className="w-4 h-4 text-slate-400" />
      <span className="truncate max-w-[120px]" style={{ color: 'var(--text-primary)' }}>{attachment.filename}</span>
      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatFileSize(attachment.size)}</span>
      <Download className={`w-3 h-3 text-slate-500 ${loading ? 'animate-pulse' : ''}`} />
    </button>
  );
}

// Individual message item
function MessageItem({
  message,
  isExpanded,
  isLast,
  onToggle,
  formatDate,
  getAvatarColor,
  onNextEmail,
  onPreviousEmail,
  getAccessToken,
  onEditDraft,
}: {
  message: EmailMessage;
  isExpanded: boolean;
  isLast: boolean;
  onToggle: () => void;
  formatDate: (date: string) => string;
  getAvatarColor: (email: string) => string;
  onNextEmail?: () => void;
  onPreviousEmail?: () => void;
  getAccessToken: () => Promise<string | null>;
  onEditDraft?: () => void; // Callback - editing happens in chat
}) {
  const senderName = message.from.name || message.from.email.split('@')[0];
  const senderInitial = senderName.charAt(0).toUpperCase();
  const hasAttachments = message.hasAttachments || (message.attachments && message.attachments.length > 0);
  
  // Check if this message is a draft
  const isDraft = message.labels?.includes('DRAFT');

  return (
    <div 
      className={isDraft ? 'bg-red-500/5' : ''}
      style={!isLast ? { borderBottom: '1px solid var(--border-subtle)' } : {}}
    >
      {/* Message Header - Clickable to expand/collapse */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 py-2 transition-colors text-left"
        style={{ background: isExpanded ? 'rgba(255,255,255,0.02)' : 'transparent' }}
      >
        {/* Avatar - Red border for drafts */}
        <div
          className={`w-8 h-8 rounded-full bg-gradient-to-br ${isDraft ? 'from-red-600 to-red-700 ring-2 ring-red-500/50' : getAvatarColor(message.from.email)} flex items-center justify-center flex-shrink-0 shadow-sm`}
        >
          <span className="text-white font-medium text-xs">{isDraft ? '✎' : senderInitial}</span>
        </div>

        {/* Sender & Preview */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {/* Draft label - single indicator */}
            {isDraft ? (
              <span className="text-xs font-semibold text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded">
                Draft
              </span>
            ) : (
              <span 
                className="font-medium text-sm"
                style={{ color: 'var(--text-primary)' }}
              >
                {senderName}
              </span>
            )}
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatDate(message.date)}
            </span>
            {hasAttachments && (
              <Paperclip className="w-3 h-3" style={{ color: 'var(--text-muted)' }} />
            )}
          </div>
          {!isExpanded && (() => {
            // Use our parser to get clean preview text
            const { content } = getDisplayContent(message);
            return (
              <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                {message.snippet || content.slice(0, 100)}
              </p>
            );
          })()}
        </div>

        {/* Expand indicator */}
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronUp className="w-4 h-4 text-slate-500" />
        </motion.div>
      </button>

      {/* Expanded Body */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pl-11 pb-3">
              {/* Recipients info - inline, minimal */}
              <div className="text-xs mb-1.5 flex items-center gap-2 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                <span>
                  To: {message.to.map((t) => t.email).join(', ')}
                  {message.cc && message.cc.length > 0 && (
                    <span className="ml-2">· Cc: {message.cc.map((c) => c.email).join(', ')}</span>
                  )}
                </span>
                
                {/* TLS indicator */}
                {message.tls !== undefined && (
                  <span 
                    className={`flex items-center gap-0.5 ${message.tls ? 'text-green-400' : 'text-yellow-400'}`}
                    title={message.tls ? 'Sent with TLS encryption' : 'Not encrypted with TLS'}
                  >
                    {message.tls ? <Shield className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                  </span>
                )}
                
                {/* Unsubscribe button */}
                {message.listUnsubscribe && (
                  <span className="ml-auto">
                    <UnsubscribeButton
                      listUnsubscribe={message.listUnsubscribe}
                      listUnsubscribePost={message.listUnsubscribePost}
                      variant="subtle"
                    />
                  </span>
                )}
              </div>

              {/* Edit Draft button at top for drafts */}
              {isDraft && onEditDraft && (
                <div className="mb-3">
                  <button
                    onClick={onEditDraft}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30"
                  >
                    <span>✎</span>
                    Edit in Chat
                  </button>
                </div>
              )}

              {/* Email body - use our improved parser for better separation */}
              {(() => {
                const { content: displayContent, isHtml, ttsContent } = getDisplayContent(message);

                return (
                  <>
                    {isHtml ? (
                      <div className={isDraft ? 'italic opacity-80' : ''}>
                        <EmailHtmlViewer
                          html={displayContent}
                          plainText={message.body}
                          maxHeight={600}
                          onNextEmail={onNextEmail}
                          onPreviousEmail={onPreviousEmail}
                        />
                      </div>
                    ) : (
                      <EmailBodyWithQuotes
                        content={displayContent}
                        isDraft={isDraft}
                      />
                    )}

                    {/* Copy and TTS buttons for the message - use clean TTS content */}
                    <div className="flex items-center gap-2 mt-3">
                      <CopyButton content={displayContent} />
                      <TTSController
                        content={ttsContent || displayContent}
                        id={`email-${message.id}`}
                        compact={true}
                      />
                    </div>
                  </>
                );
              })()}

              {/* Attachments section */}
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Paperclip className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                    <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                      {message.attachments.length} attachment{message.attachments.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {message.attachments.map((att) => (
                      <AttachmentItem 
                        key={att.id} 
                        attachment={att} 
                        messageId={message.id}
                        getAccessToken={getAccessToken}
                      />
                    ))}
                  </div>
                </div>
              )}
              
              {/* Edit Draft button at bottom for drafts */}
              {isDraft && onEditDraft && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <button
                    onClick={onEditDraft}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30"
                  >
                    <span>✎</span>
                    Edit in Chat
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

