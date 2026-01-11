'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Mail, Maximize2, Minimize2, GripHorizontal, Inbox, Send, Star, FolderOpen, Clock, Shield, ShieldOff } from 'lucide-react';
import { EmailThread, EmailMessage } from '@/types';
import { EmailHtmlViewer, isRichHtmlContent, stripBasicHtml } from './EmailHtmlViewer';
import { UnsubscribeButton } from './UnsubscribeButton';
import Linkify from 'linkify-react';

// Folder type and display config
type MailFolder = 'inbox' | 'sent' | 'starred' | 'all' | 'drafts' | 'snoozed';

const FOLDER_DISPLAY: Record<MailFolder, { label: string; icon: React.ElementType; color: string }> = {
  inbox: { label: 'Inbox', icon: Inbox, color: 'text-blue-400 bg-blue-500/20' },
  sent: { label: 'Sent', icon: Send, color: 'text-green-400 bg-green-500/20' },
  starred: { label: 'Starred', icon: Star, color: 'text-yellow-400 bg-yellow-500/20' },
  all: { label: 'All Mail', icon: FolderOpen, color: 'text-slate-400 bg-slate-500/20' },
  drafts: { label: 'Drafts', icon: Mail, color: 'text-red-400 bg-red-500/20' },
  snoozed: { label: 'Snoozed', icon: Clock, color: 'text-amber-400 bg-amber-500/20' },
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
  const { mainContent, quotedContent, attributionLine } = parseEmailContent(content);
  
  return (
    <div 
      className={`text-sm leading-relaxed ${isDraft ? 'italic' : ''}`}
      style={{ color: isDraft ? 'var(--text-secondary)' : 'var(--text-primary)' }}
    >
      {/* Main content with Linkify */}
      <div className="whitespace-pre-wrap">
        <Linkify
          options={{
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'text-blue-400 hover:underline',
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
}: ThreadPreviewProps) {
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
  const [messagesHeight, setMessagesHeight] = useState(() => {
    if (typeof window === 'undefined') return 250;
    const saved = localStorage.getItem(STORAGE_KEY_HEIGHT);
    return saved !== null ? parseInt(saved, 10) : 250;
  });
  
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
    }
  }, [thread.id, thread.messages]);

  // Track previous revealed count to detect when new messages are revealed
  const prevRevealedCount = useRef(revealedMessageCount || 0);
  
  // Auto-expand individual messages when they're revealed by scrolling
  useEffect(() => {
    if (!isPullToRevealMode) return;
    
    const currentCount = revealedMessageCount || 0;
    
    // If revealing more messages than before, add them to the expanded set
    if (currentCount > prevRevealedCount.current && currentCount > 0) {
      // Get the messages being revealed
      const revealedMessages = thread.messages.slice(-currentCount);
      
      // Add all newly revealed messages to expanded set
      setExpandedMessages(prev => {
        const newSet = new Set(prev);
        revealedMessages.forEach(msg => newSet.add(msg.id));
        return newSet;
      });
    }
    
    prevRevealedCount.current = currentCount;
  }, [revealedMessageCount, isPullToRevealMode, thread.messages]);
  
  // Handler for toggling expand state
  const handleToggleExpand = useCallback(() => {
    if (isPullToRevealMode && onRevealedCountChange) {
      // Toggle between 0 (collapsed) and 1 (show latest message)
      onRevealedCountChange(isExpanded ? 0 : 1);
    } else {
      setLocalIsExpanded(prev => !prev);
    }
  }, [isPullToRevealMode, onRevealedCountChange, isExpanded]);

  // ===========================================
  // SCROLL-TO-REVEAL/CLOSE WITHIN MESSAGE CONTAINER
  // ===========================================
  // Uses refs to avoid stale closure issues
  const revealedCountRef = useRef(revealedMessageCount || 1);
  const baseCountRef = useRef(baseRevealedCount);
  const totalMessagesRef = useRef(thread.messages.length);
  
  useEffect(() => { revealedCountRef.current = revealedMessageCount || 1; }, [revealedMessageCount]);
  useEffect(() => { baseCountRef.current = baseRevealedCount; }, [baseRevealedCount]);
  useEffect(() => { totalMessagesRef.current = thread.messages.length; }, [thread.messages.length]);
  
  const hasRevealedThisGesture = useRef(false);
  const gestureTimeout = useRef<NodeJS.Timeout | null>(null);
  // Store callback in ref to avoid stale closures
  const onScrollRevealRef = useRef(onScrollReveal);
  useEffect(() => { onScrollRevealRef.current = onScrollReveal; }, [onScrollReveal]);
  
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    let accumulatedDelta = 0;
    const threshold = 60;
    
    const resetGesture = () => {
      if (gestureTimeout.current) clearTimeout(gestureTimeout.current);
      gestureTimeout.current = setTimeout(() => {
        hasRevealedThisGesture.current = false;
        accumulatedDelta = 0;
      }, 40);
    };
    
    const handleWheel = (e: WheelEvent) => {
      // Check if scroll handling is enabled
      const scrollHandler = onScrollRevealRef.current;
      if (!scrollHandler) return;
      
      const current = revealedCountRef.current;
      const base = baseCountRef.current;
      const total = totalMessagesRef.current;
      const atTop = container.scrollTop <= 2;
      const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 2;
      
      // Scroll DOWN (deltaY > 0) at BOTTOM = CLOSE ALL to base
      // Only collapse when at bottom (can't scroll further down)
      if (e.deltaY > 0 && atBottom && current > base) {
        scrollHandler(base);
        e.stopPropagation();
        return;
      }
      
      // Scroll UP (deltaY < 0) at TOP = reveal ONE message
      if (e.deltaY < 0 && atTop) {
        accumulatedDelta += Math.abs(e.deltaY);
        
        if (!hasRevealedThisGesture.current && accumulatedDelta > threshold) {
          if (current < total) {
            scrollHandler(current + 1);
            hasRevealedThisGesture.current = true;
          }
        }
        
        e.preventDefault();
        e.stopPropagation();
        resetGesture();
      }
    };
    
    container.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (gestureTimeout.current) clearTimeout(gestureTimeout.current);
    };
  }, []); // Empty deps - uses refs for all state, always attached

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = messagesHeight;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, [messagesHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const deltaY = e.clientY - startY.current;
      const newHeight = Math.max(80, Math.min(window.innerHeight * 0.7, startHeight.current + deltaY));
      setMessagesHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Save height when drag ends
        saveHeight(messagesHeight);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [messagesHeight, saveHeight]);

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
        {/* Clickable subject area */}
        <button
          onClick={handleToggleExpand}
          className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity text-left"
        >
          <div className="p-1.5 rounded-lg bg-blue-500/20">
            <Mail className="w-4 h-4 text-blue-400" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {thread.subject || '(No Subject)'}
              </span>
              <span className="flex-shrink-0 text-xs text-blue-300/70 bg-blue-500/10 px-1.5 py-0.5 rounded">
                {thread.messages.length}
              </span>
              {/* Folder badge - always show for consistency */}
              {folder && (
                <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${FOLDER_DISPLAY[folder].color}`}>
                  {(() => {
                    const Icon = FOLDER_DISPLAY[folder].icon;
                    return <Icon className="w-3 h-3" />;
                  })()}
                  {FOLDER_DISPLAY[folder].label}
                </span>
              )}
            </div>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {thread.participants.map((p) => p.name || p.email.split('@')[0]).join(', ')}
            </p>
          </div>

          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
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
              {/* Messages */}
              <div 
                ref={containerRef}
                style={{ maxHeight: `${messagesHeight}px` }}
                className="overflow-y-auto px-4 pb-3"
              >
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
                          />
                        </motion.div>
                      );
                    });
                  })()}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Draggable resize handle - only show when expanded */}
      {isExpanded && (
        <div
          onMouseDown={handleMouseDown}
          className="group relative cursor-ns-resize"
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

// Individual message item
function MessageItem({
  message,
  isExpanded,
  isLast,
  onToggle,
  formatDate,
  getAvatarColor,
}: {
  message: EmailMessage;
  isExpanded: boolean;
  isLast: boolean;
  onToggle: () => void;
  formatDate: (date: string) => string;
  getAvatarColor: (email: string) => string;
}) {
  const senderName = message.from.name || message.from.email.split('@')[0];
  const senderInitial = senderName.charAt(0).toUpperCase();
  
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
          </div>
          {!isExpanded && (
            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {message.snippet || message.body.slice(0, 100)}
            </p>
          )}
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

              {/* Email body - use HTML viewer only for rich HTML content (tables, images, styles) */}
              {message.bodyHtml && isRichHtmlContent(message.bodyHtml) ? (
                <div className={isDraft ? 'italic' : ''}>
                  <EmailHtmlViewer
                    html={message.bodyHtml}
                    plainText={message.body}
                    maxHeight={600}
                  />
                  {isDraft && (
                    <div className="mt-2 text-xs text-red-400/70 not-italic">
                      — This is a draft, not yet sent
                    </div>
                  )}
                </div>
              ) : (
                <EmailBodyWithQuotes 
                  content={message.body || (message.bodyHtml ? stripBasicHtml(message.bodyHtml) : '')}
                  isDraft={isDraft}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

