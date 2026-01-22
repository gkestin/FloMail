'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, X, Loader2, Reply, Forward, Mail, Plus, Paperclip, Trash2, AlertTriangle, ArrowLeftRight, Save, FileIcon as LucideFile, ImageIcon as LucideImage, FileText as LucideFileText, Film, Music, FileArchive, FileCode, FileSpreadsheet, Presentation, ChevronDown, Copy, Check, Volume2, VolumeX } from 'lucide-react';
import { EmailDraft, DraftAttachment, EmailDraftType, EmailThread, EmailMessage } from '@/types';
import { buildReplyQuote } from '@/lib/agent-tools';
import { formatFileSize, getFileIcon as getFileIconType } from '@/lib/email-parsing';
import { EmailHtmlViewer, isHtmlContent, stripBasicHtml } from './EmailHtmlViewer';
import Linkify from 'linkify-react';

// Format date for message display
function formatMessageDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

// Get avatar color based on email
function getAvatarColor(email: string): string {
  const colors = [
    'from-blue-500 to-blue-600',
    'from-emerald-500 to-emerald-600',
    'from-violet-500 to-violet-600',
    'from-amber-500 to-amber-600',
    'from-rose-500 to-rose-600',
    'from-cyan-500 to-cyan-600',
  ];
  const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

// Small copy button for draft body
function DraftCopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
      className="p-1.5 rounded-md transition-colors hover:bg-white/10"
      style={{ color: 'var(--text-muted)' }}
      title={copied ? 'Copied!' : 'Copy email body'}
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

// Singleton for speech synthesis tracking
// Singleton audio reference for stopping
let draftCurrentAudio: HTMLAudioElement | null = null;
let draftSpeakingId: string | null = null;

// TTS settings helpers (same as ChatInterface)
interface TTSSettings {
  voice: string;
  speed: number;
  useNaturalVoice: boolean;
}

function getDraftTTSSettings(): TTSSettings {
  if (typeof window === 'undefined') return { voice: 'nova', speed: 1.0, useNaturalVoice: true };
  try {
    const stored = localStorage.getItem('flomail_tts_settings');
    if (stored) return { voice: 'nova', speed: 1.0, useNaturalVoice: true, ...JSON.parse(stored) };
  } catch {}
  return { voice: 'nova', speed: 1.0, useNaturalVoice: true };
}

// Small speak button for draft body - uses OpenAI TTS like ChatInterface
function DraftSpeakButton({ content, draftId }: { content: string; draftId?: string }) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const buttonId = draftId || 'draft-body';
  
  useEffect(() => {
    const checkSpeaking = () => {
      const isPlaying = draftCurrentAudio && !draftCurrentAudio.paused && !draftCurrentAudio.ended;
      setIsSpeaking(draftSpeakingId === buttonId && !!isPlaying);
    };
    checkSpeaking();
    const interval = setInterval(checkSpeaking, 200);
    return () => clearInterval(interval);
  }, [buttonId]);
  
  const speakWithBrowserFallback = useCallback((text: string, speed: number) => {
    speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = speed;
    utterance.pitch = 1.0;
    
    utterance.onend = () => {
      draftSpeakingId = null;
      setIsSpeaking(false);
    };
    
    utterance.onerror = () => {
      draftSpeakingId = null;
      setIsSpeaking(false);
    };
    
    draftSpeakingId = buttonId;
    setIsSpeaking(true);
    speechSynthesis.speak(utterance);
  }, [buttonId]);
  
  const handleSpeak = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (isSpeaking) {
      if (draftCurrentAudio) {
        draftCurrentAudio.pause();
        draftCurrentAudio.currentTime = 0;
        draftCurrentAudio = null;
      }
      speechSynthesis.cancel();
      draftSpeakingId = null;
      setIsSpeaking(false);
      return;
    }
    
    // Stop any previous audio
    if (draftCurrentAudio) {
      draftCurrentAudio.pause();
      draftCurrentAudio.currentTime = 0;
    }
    speechSynthesis.cancel();
    
    const settings = getDraftTTSSettings();
    
    // If natural voice is disabled, use browser fallback
    if (!settings.useNaturalVoice) {
      speakWithBrowserFallback(content, settings.speed);
      return;
    }
    
    // Try OpenAI TTS API
    setIsLoading(true);
    try {
      const response = await fetch('/api/ai/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: content,
          voice: settings.voice,
          speed: settings.speed,
        }),
      });
      
      if (!response.ok) {
        throw new Error('TTS API failed');
      }
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        draftCurrentAudio = null;
        draftSpeakingId = null;
        setIsSpeaking(false);
      };
      
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        draftCurrentAudio = null;
        draftSpeakingId = null;
        setIsSpeaking(false);
        // Fallback to browser
        speakWithBrowserFallback(content, settings.speed);
      };
      
      draftCurrentAudio = audio;
      draftSpeakingId = buttonId;
      setIsSpeaking(true);
      setIsLoading(false);
      await audio.play();
      
    } catch (error) {
      console.error('TTS error, falling back to browser:', error);
      setIsLoading(false);
      // Fallback to browser speech synthesis
      speakWithBrowserFallback(content, settings.speed);
    }
  };
  
  return (
    <button
      onClick={handleSpeak}
      className="p-1.5 rounded-md transition-colors hover:bg-white/10"
      style={{ color: 'var(--text-muted)' }}
      title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
    >
      {isSpeaking ? (
        <VolumeX className="w-3.5 h-3.5 text-amber-400" />
      ) : (
        <Volume2 className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

// Parse draft body to separate user's content from quoted reply content
// Returns the user's new text (before the "On ... wrote:" line) and whether there's quoted content
function parseDraftBody(body: string): { userContent: string; hasQuotedContent: boolean } {
  if (!body) return { userContent: '', hasQuotedContent: false };
  
  // Common patterns for quote attribution lines
  const quotePatterns = [
    /^On .+ wrote:$/m,                    // "On Mon, Jan 12, 2026 at 4:03 PM ... wrote:"
    /^On .+ at .+,.*wrote:$/m,            // Variations
    /^>\s/m,                              // Lines starting with >
    /^-{3,}\s*Original Message/im,        // "--- Original Message ---"
    /^_{3,}\s*$/m,                        // "___" separators
  ];
  
  let splitIndex = body.length;
  
  for (const pattern of quotePatterns) {
    const match = body.match(pattern);
    if (match && match.index !== undefined) {
      splitIndex = Math.min(splitIndex, match.index);
    }
  }
  
  // If we found a split point, extract user content
  if (splitIndex < body.length) {
    const userContent = body.slice(0, splitIndex).trim();
    return { userContent, hasQuotedContent: true };
  }
  
  return { userContent: body, hasQuotedContent: false };
}

// Thread message preview component - shows messages like the message region
// Uses the same HTML rendering as the message region
function ThreadMessagePreview({ message, isLast }: { message: EmailMessage; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const senderName = message.from.name || message.from.email.split('@')[0];
  const senderInitial = senderName.charAt(0).toUpperCase();
  
  // Get preview text - use snippet if available, otherwise strip HTML
  const previewText = message.snippet || 
    (message.bodyHtml ? stripBasicHtml(message.bodyHtml).slice(0, 150) : (message.body || '').slice(0, 150));
  const hasHtml = message.bodyHtml && isHtmlContent(message.bodyHtml);
  
  return (
    <div 
      className={!isLast ? 'pb-3 mb-3' : ''}
      style={!isLast ? { borderBottom: '1px solid var(--border-subtle)' } : {}}
    >
      {/* Message header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 text-left hover:bg-white/5 rounded-lg p-1 -m-1 transition-colors"
      >
        {/* Avatar */}
        <div
          className={`w-7 h-7 rounded-full bg-gradient-to-br ${getAvatarColor(message.from.email)} flex items-center justify-center flex-shrink-0`}
        >
          <span className="text-white font-medium text-xs">{senderInitial}</span>
        </div>
        
        {/* Sender & date */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
              {senderName}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatMessageDate(message.date)}
            </span>
          </div>
          {!expanded && (
            <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
              {previewText}{previewText.length >= 150 ? '...' : ''}
            </p>
          )}
        </div>
        
        {/* Expand indicator */}
        <ChevronDown 
          className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      
      {/* Expanded body - use same rendering as message region */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-2 pl-9">
              {/* Recipients info */}
              <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                To: {message.to.map((t) => t.name || t.email).join(', ')}
                {message.cc && message.cc.length > 0 && (
                  <span className="ml-2">· Cc: {message.cc.map((c) => c.name || c.email).join(', ')}</span>
                )}
              </div>
              
              {/* Email body - use HTML viewer for any HTML content (preserves links, formatting) */}
              {hasHtml ? (
                <EmailHtmlViewer
                  html={message.bodyHtml!}
                  plainText={message.body}
                  maxHeight={400}
                />
              ) : (
                <div 
                  className="text-sm leading-relaxed whitespace-pre-wrap"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <Linkify
                    options={{
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      className: 'text-blue-400 hover:underline',
                    }}
                  >
                    {message.body || ''}
                  </Linkify>
                </div>
              )}
              
              {/* Attachments indicator */}
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2 flex items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <Paperclip className="w-3 h-3" />
                  <span>{message.attachments.length} attachment{message.attachments.length > 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface DraftCardProps {
  draft: EmailDraft;
  thread?: EmailThread; // For building quoted content when switching to reply
  onSend: (updatedDraft: EmailDraft) => void;
  onSaveDraft?: (updatedDraft: EmailDraft) => Promise<EmailDraft | void>; // Save as Gmail draft
  onDiscard: (draft: EmailDraft) => void; // Discard/delete the draft (also deletes from Gmail if saved)
  isSending?: boolean;
  isSaving?: boolean;
  isDeleting?: boolean; // Draft is being deleted
  isStreaming?: boolean; // Content is still being streamed in
}

// Map file icon type names to Lucide components
const FILE_ICON_MAP: Record<string, React.ElementType> = {
  image: LucideImage,
  video: Film,
  audio: Music,
  pdf: LucideFileText,
  document: LucideFileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  archive: FileArchive,
  code: FileCode,
  text: LucideFileText,
  file: LucideFile,
};

// Get icon component for file type
function getFileIcon(mimeType: string, filename?: string): React.ElementType {
  const iconType = getFileIconType(mimeType, filename);
  return FILE_ICON_MAP[iconType] || LucideFile;
}

export function DraftCard({ draft, thread, onSend, onSaveDraft, onDiscard, isSending, isSaving, isDeleting, isStreaming }: DraftCardProps) {
  const [editedDraft, setEditedDraft] = useState<EmailDraft>(draft);
  
  // Track if user has made local edits (to prevent overwriting with stale draft prop)
  const hasUserEditsRef = useRef(false);
  // Track the last draft ID we synced from
  const lastSyncedDraftIdRef = useRef(draft.id);
  // Track previous streaming state to detect when streaming ends
  const wasStreamingRef = useRef(isStreaming);
  
  // For replies with thread context, parse body to separate user content from garbled quoted content
  // We'll show thread messages with proper HTML rendering instead of the malformed quoted text
  const { userContent, hasQuotedContent } = editedDraft.type === 'reply' && thread?.messages 
    ? parseDraftBody(editedDraft.body)
    : { userContent: editedDraft.body, hasQuotedContent: false };
  
  // Track the displayed body (user content only for replies with thread)
  const displayedBody = (editedDraft.type === 'reply' && thread?.messages && hasQuotedContent) 
    ? userContent 
    : editedDraft.body;
  
  // Count original attachments (from forward)
  const originalAttachments = editedDraft.attachments?.filter(a => a.isFromOriginal) || [];
  const userAttachments = editedDraft.attachments?.filter(a => !a.isFromOriginal) || [];
  const [showCcBcc, setShowCcBcc] = useState(
    (draft.cc && draft.cc.length > 0) || (draft.bcc && draft.bcc.length > 0)
  );
  const [showQuoted, setShowQuoted] = useState(false);
  
  // Responsive button labels - progressively hide as space shrinks
  // Store width thresholds for each compact level
  const [compactLevel, setCompactLevel] = useState(0); // 0=full, 1=hide discard text, 2=hide save text, 3=hide send text
  const actionsRef = useRef<HTMLDivElement>(null);
  const lastWidthRef = useRef<number>(0);
  const isInitializedRef = useRef(false);
  
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const quotedRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Observe actions container width and adjust compact level based on available space
  useEffect(() => {
    const actionsContainer = actionsRef.current;
    if (!actionsContainer) return;
    
    // Approximate widths for each label (icon is always ~28px, text adds ~50-70px)
    const DISCARD_TEXT_WIDTH = 60;
    const SAVE_TEXT_WIDTH = 45;
    const SEND_TEXT_WIDTH = 45;
    
    // Base width with all icons only
    const BASE_WIDTH = 180; // icons + gaps + padding
    
    const calculateCompactLevel = (containerWidth: number) => {
      // Calculate how much space we have beyond base
      const availableForText = containerWidth - BASE_WIDTH;
      
      if (availableForText >= DISCARD_TEXT_WIDTH + SAVE_TEXT_WIDTH + SEND_TEXT_WIDTH) {
        return 0; // Room for all labels
      } else if (availableForText >= SAVE_TEXT_WIDTH + SEND_TEXT_WIDTH) {
        return 1; // Hide discard text
      } else if (availableForText >= SEND_TEXT_WIDTH) {
        return 2; // Hide discard + save text
      } else {
        return 3; // Hide all text
      }
    };
    
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      
      const containerWidth = entry.contentRect.width;
      
      // Skip if width hasn't changed significantly (prevents micro-jitter)
      if (Math.abs(containerWidth - lastWidthRef.current) < 5 && isInitializedRef.current) {
        return;
      }
      
      lastWidthRef.current = containerWidth;
      isInitializedRef.current = true;
      
      const newLevel = calculateCompactLevel(containerWidth);
      setCompactLevel(newLevel);
    });
    
    observer.observe(actionsContainer);
    
    return () => observer.disconnect();
  }, [onSaveDraft]); // Re-run when save button visibility changes

  // Update editedDraft when draft prop changes - BUT preserve user edits
  useEffect(() => {
    // Case 1: Different draft entirely - reset everything
    if (draft.id !== lastSyncedDraftIdRef.current) {
      setEditedDraft(draft);
      setShowCcBcc((draft.cc && draft.cc.length > 0) || (draft.bcc && draft.bcc.length > 0));
      lastSyncedDraftIdRef.current = draft.id;
      hasUserEditsRef.current = false;
      wasStreamingRef.current = isStreaming;
      return;
    }
    
    // Case 2: Same draft, still streaming - sync body content from AI
    if (isStreaming && !hasUserEditsRef.current) {
      setEditedDraft(draft);
      wasStreamingRef.current = true;
      return;
    }
    
    // Case 3: Streaming JUST finished - sync the FINAL draft content (unless user edited)
    // This is crucial: when streaming ends, we get the final complete draft
    if (wasStreamingRef.current && !isStreaming && !hasUserEditsRef.current) {
      setEditedDraft(draft);
      wasStreamingRef.current = false;
      return;
    }
    
    // Case 4: Same draft, user has made edits, streaming done - DON'T overwrite
    // The user's local edits in editedDraft take precedence
    wasStreamingRef.current = isStreaming;
  }, [draft, isStreaming]);

  // Handle file selection
  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Process each selected file
    const newAttachments: DraftAttachment[] = [];
    
    Array.from(files).forEach(file => {
      // Check size limit (25MB for Gmail)
      if (file.size > 25 * 1024 * 1024) {
        alert(`File "${file.name}" is too large (max 25MB)`);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        // Remove the data URL prefix (e.g., "data:image/png;base64,")
        const base64Data = base64.split(',')[1];
        
        const attachment: DraftAttachment = {
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          data: base64Data,
          isFromOriginal: false,
        };

        setEditedDraft(prev => ({
          ...prev,
          attachments: [...(prev.attachments || []), attachment],
        }));
      };
      reader.readAsDataURL(file);
    });

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // Remove attachment
  const removeAttachment = useCallback((index: number) => {
    setEditedDraft(prev => ({
      ...prev,
      attachments: prev.attachments?.filter((_, i) => i !== index),
    }));
  }, []);

  // Auto-resize textarea without causing scroll jumps on mobile
  const autoResize = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    
    // Save current scroll positions
    const containerScrollTop = containerRef.current?.scrollTop || 0;
    const windowScrollY = window.scrollY;
    
    // Use 'auto' instead of '1px' to avoid collapse that causes scroll jumps
    // Only resize if content has grown beyond current height
    const currentHeight = textarea.offsetHeight;
    textarea.style.height = 'auto';
    const newHeight = textarea.scrollHeight;
    
    // Apply new height
    textarea.style.height = newHeight + 'px';
    
    // Restore scroll positions immediately
    if (containerRef.current) {
      containerRef.current.scrollTop = containerScrollTop;
    }
    // Also restore window scroll for iOS
    window.scrollTo(window.scrollX, windowScrollY);
  };

  // Resize body textarea
  useEffect(() => {
    const resize = () => autoResize(bodyRef.current);
    resize();
    // Also resize after a frame in case fonts haven't loaded
    requestAnimationFrame(resize);
  }, [editedDraft.body]);

  // Resize quoted textarea (for replies when expanded, or forwards which always show)
  useEffect(() => {
    const shouldResize = (showQuoted && editedDraft.type === 'reply') || editedDraft.type === 'forward';
    if (shouldResize && quotedRef.current) {
      const resize = () => autoResize(quotedRef.current);
      resize();
      requestAnimationFrame(resize);
    }
  }, [showQuoted, editedDraft.quotedContent, editedDraft.type]);

  const handleSendClick = () => {
    onSend(editedDraft);
  };

  // Common input styles - looks like text until focused, high contrast
  const inputBaseClass = `
    w-full bg-transparent text-sm
    border border-transparent rounded-lg px-2 py-1 -mx-2
    transition-all duration-150
    hover:bg-white/5
    focus:bg-white/10 focus:border-blue-500/50 focus:outline-none focus:ring-1 focus:ring-blue-500/30
  `;
  const inputStyle = { color: 'var(--text-primary)' };

  // Switch draft type
  const switchToReply = () => {
    setEditedDraft(prev => {
      // Build quoted content if switching to reply and thread exists
      let quotedContent = prev.quotedContent;
      if (!quotedContent && thread) {
        quotedContent = buildReplyQuote(thread);
      }
      
      // Remove auto-attached (original) attachments - keep only user-added ones
      const userAddedAttachments = prev.attachments?.filter(a => !a.isFromOriginal);
      
      // Get the original sender's email to reply to
      const lastMessage = thread?.messages[thread.messages.length - 1];
      const replyTo = lastMessage?.from.email ? [lastMessage.from.email] : prev.to;
      
      return {
        ...prev,
        type: 'reply',
        subject: prev.subject.startsWith('Re: ') ? prev.subject : `Re: ${prev.subject.replace(/^Fwd:\s*/i, '')}`,
        to: replyTo,
        quotedContent,
        attachments: userAddedAttachments?.length ? userAddedAttachments : undefined,
      };
    });
  };

  const switchToForward = () => {
    setEditedDraft(prev => ({
      ...prev,
      type: 'forward',
      subject: prev.subject.startsWith('Fwd: ') ? prev.subject : `Fwd: ${prev.subject.replace(/^Re:\s*/i, '')}`,
      to: [], // Clear recipients for forward
    }));
  };
  
  // Remove all original attachments
  const removeOriginalAttachments = () => {
    setEditedDraft(prev => ({
      ...prev,
      attachments: prev.attachments?.filter(a => !a.isFromOriginal),
    }));
  };

  return (
    <motion.div
      // Only animate opacity - no transforms to avoid iOS cursor positioning issues in textareas
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className={`rounded-lg border-l-2 ${
        editedDraft.type === 'new' ? 'border-amber-500/70' :
        editedDraft.type === 'forward' ? 'border-orange-500/50' :
        'border-cyan-500/50'
      }`}
      style={{ background: 'var(--bg-elevated)' }}
    >
      {/* Header with type switcher */}
      <div className={`px-3 py-2 flex items-center justify-between ${
        editedDraft.type === 'new' ? 'bg-amber-500/10 border-b border-amber-500/20' :
        editedDraft.type === 'forward' ? 'bg-orange-500/5 border-b border-orange-500/10' :
        ''
      }`}>
        {/* Current type indicator */}
        <div className="flex items-center gap-2">
          <div className={`p-1 rounded ${
            editedDraft.type === 'new' ? 'bg-amber-500/20' :
            editedDraft.type === 'forward' ? 'bg-orange-500/20' :
            'bg-blue-500/20'
          }`}>
            {editedDraft.type === 'reply' ? (
              <Reply className="w-3.5 h-3.5 text-blue-400" />
            ) : editedDraft.type === 'forward' ? (
              <Forward className="w-3.5 h-3.5 text-orange-400" />
            ) : (
              <Mail className="w-4 h-4 text-amber-400" />
            )}
          </div>
          <div>
            <span className={`text-sm font-medium ${
              editedDraft.type === 'new' ? 'text-amber-300' :
              editedDraft.type === 'forward' ? 'text-orange-300' :
              'text-slate-300'
            }`}>
              {editedDraft.type === 'reply' ? 'Reply' : 
               editedDraft.type === 'forward' ? 'Forward' : 
               'New Email'}
            </span>
            {editedDraft.type === 'new' && (
              <span className="text-xs text-amber-400/70 ml-2">(not a reply)</span>
            )}
          </div>
        </div>

        {/* Type switcher - always visible */}
        <div className="flex items-center gap-1">
          {editedDraft.type !== 'reply' && (
            <button
              onClick={switchToReply}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                editedDraft.type === 'new' 
                  ? 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30' 
                  : 'text-slate-500 hover:text-blue-400'
              }`}
            >
              <Reply className="w-3 h-3" />
              {editedDraft.type === 'new' ? 'Make Reply' : 'Reply'}
            </button>
          )}
          {editedDraft.type !== 'forward' && (
            <button
              onClick={switchToForward}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-slate-500 hover:text-orange-400 transition-colors"
            >
              <Forward className="w-3 h-3" />
              Fwd
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-3 py-2 space-y-2">
        {/* To */}
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wide w-12 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>To</span>
          <input
            type="text"
            value={editedDraft.to.join(', ')}
            onChange={(e) => {
              hasUserEditsRef.current = true;
              setEditedDraft({
                ...editedDraft,
                to: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
              });
            }}
            placeholder="recipient@email.com"
            disabled={isSending}
            className={inputBaseClass}
            style={inputStyle}
          />
        </div>

        {/* CC/BCC - Collapsed unless has values or user expanded */}
        {showCcBcc ? (
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-wide w-12 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>CC</span>
              <input
                type="text"
                value={editedDraft.cc?.join(', ') || ''}
                onChange={(e) => {
                  hasUserEditsRef.current = true;
                  setEditedDraft({
                    ...editedDraft,
                    cc: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  });
                }}
                placeholder="cc@email.com"
                disabled={isSending}
                className={inputBaseClass}
                style={inputStyle}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-wide w-12 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>BCC</span>
              <input
                type="text"
                value={editedDraft.bcc?.join(', ') || ''}
                onChange={(e) => {
                  hasUserEditsRef.current = true;
                  setEditedDraft({
                    ...editedDraft,
                    bcc: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  });
                }}
                placeholder="bcc@email.com"
                disabled={isSending}
                className={inputBaseClass}
                style={inputStyle}
              />
            </div>
          </>
        ) : (
          <button
            onClick={() => setShowCcBcc(true)}
            className="flex items-center gap-1.5 text-xs transition-colors ml-14 hover:text-blue-400"
            style={{ color: 'var(--text-muted)' }}
          >
            <Plus className="w-3 h-3" />
            Add CC/BCC
          </button>
        )}

        {/* Subject */}
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wide w-12 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>Subj</span>
          <input
            type="text"
            value={editedDraft.subject}
            onChange={(e) => {
              hasUserEditsRef.current = true;
              setEditedDraft({ ...editedDraft, subject: e.target.value });
            }}
            placeholder="Email subject"
            disabled={isSending}
            className={inputBaseClass}
            style={inputStyle}
          />
        </div>

        {/* Separator line */}
        <div className="my-2" style={{ borderTop: '1px solid var(--border-subtle)' }}></div>

        {/* Body - one scrollable container, textareas expand */}
        <div ref={containerRef} className="max-h-[60vh] overflow-y-auto relative">
          {/* Streaming indicator overlay */}
          {isStreaming && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute bottom-0 left-0 right-0 flex items-center gap-2 py-2 px-1"
              style={{ background: 'linear-gradient(to top, var(--bg-elevated), transparent)' }}
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span className="text-xs text-blue-400">Writing draft...</span>
            </motion.div>
          )}
          
          <textarea
            ref={bodyRef}
            value={displayedBody}
            onChange={(e) => {
              hasUserEditsRef.current = true;
              // For replies with thread context, we only edit the user content part
              // The quoted content is shown separately via thread messages
              if (editedDraft.type === 'reply' && thread?.messages && hasQuotedContent) {
                // Keep just the user's new content
                setEditedDraft({ ...editedDraft, body: e.target.value });
              } else {
                setEditedDraft({ ...editedDraft, body: e.target.value });
              }
            }}
            placeholder="Write your message..."
            disabled={isSending || isStreaming}
            className="w-full bg-transparent leading-relaxed resize-none border-none focus:outline-none focus:ring-0 p-0"
            style={{ 
              color: 'var(--text-primary)',
              // 16px minimum to prevent iOS auto-zoom on focus
              fontSize: '16px',
            }}
          />

          {/* Copy and speak buttons for draft body - subtle, at bottom of body area */}
          {displayedBody && displayedBody.trim() && !isStreaming && (
            <div className="flex items-center gap-0.5 mt-2 opacity-50 hover:opacity-80 transition-opacity">
              <DraftCopyButton content={displayedBody} />
              <DraftSpeakButton content={displayedBody} draftId={editedDraft.id} />
            </div>
          )}

          {/* Quoted content / Thread context - show for replies when thread has messages or body has quoted content */}
          {editedDraft.type === 'reply' && (thread?.messages?.length || hasQuotedContent || editedDraft.quotedContent) && (
            <>
              <button
                onClick={() => setShowQuoted(!showQuoted)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm mt-4 transition-all duration-200 cursor-pointer ${showQuoted ? 'bg-slate-600/60 text-slate-200' : 'bg-slate-700/40 text-slate-400 hover:bg-slate-600/50 hover:text-slate-200'}`}
              >
                <span className="font-black tracking-wider">···</span>
                {thread?.messages && thread.messages.length > 0 && (
                  <span className="text-xs opacity-70">
                    {thread.messages.length} previous {thread.messages.length === 1 ? 'message' : 'messages'}
                  </span>
                )}
              </button>

              {showQuoted && (
                <div className="mt-3">
                  {/* ALWAYS prefer thread messages for proper HTML rendering */}
                  {thread?.messages && thread.messages.length > 0 ? (
                    <div 
                      className="rounded-lg p-3 max-h-[400px] overflow-y-auto"
                      style={{ 
                        background: 'var(--bg-secondary)', 
                        border: '1px solid var(--border-subtle)' 
                      }}
                    >
                      {/* Show messages in chronological order (oldest first) */}
                      {thread.messages.map((msg, idx) => (
                        <ThreadMessagePreview 
                          key={msg.id} 
                          message={msg}
                          isLast={idx === thread.messages.length - 1}
                        />
                      ))}
                    </div>
                  ) : editedDraft.quotedContent ? (
                    /* Fallback to plain text ONLY if no thread messages available */
                    <div className="pl-3 border-l-2 border-slate-500/50">
                      <textarea
                        ref={quotedRef}
                        value={editedDraft.quotedContent}
                        onChange={(e) => {
                          hasUserEditsRef.current = true;
                          setEditedDraft({ ...editedDraft, quotedContent: e.target.value });
                        }}
                        disabled={isSending}
                        className="w-full bg-transparent text-slate-400 leading-relaxed resize-none border-none focus:outline-none focus:ring-0 p-0"
                        style={{ fontSize: '16px' }}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
          
          {/* Forward: collapsible forwarded content (same UX as replies) */}
          {editedDraft.type === 'forward' && (thread?.messages?.length || editedDraft.quotedContent) && (
            <>
              <button
                onClick={() => setShowQuoted(!showQuoted)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm mt-4 transition-all duration-200 cursor-pointer ${showQuoted ? 'bg-orange-600/40 text-orange-200' : 'bg-orange-700/20 text-orange-400 hover:bg-orange-600/30 hover:text-orange-200'}`}
              >
                <Forward className="w-3.5 h-3.5" />
                <span className="text-xs opacity-90">
                  {thread?.messages && thread.messages.length > 0 
                    ? `${thread.messages.length} forwarded ${thread.messages.length === 1 ? 'message' : 'messages'}`
                    : 'Forwarded content'}
                </span>
              </button>

              {showQuoted && (
                <div className="mt-3">
                  {/* Prefer thread messages for proper HTML rendering */}
                  {thread?.messages && thread.messages.length > 0 ? (
                    <div 
                      className="rounded-lg p-3 max-h-[400px] overflow-y-auto"
                      style={{ 
                        background: 'rgba(249, 115, 22, 0.05)', 
                        border: '1px solid rgba(249, 115, 22, 0.2)' 
                      }}
                    >
                      {/* Show messages in chronological order (oldest first) */}
                      {thread.messages.map((msg, idx) => (
                        <ThreadMessagePreview 
                          key={msg.id} 
                          message={msg}
                          isLast={idx === thread.messages.length - 1}
                        />
                      ))}
                    </div>
                  ) : editedDraft.quotedContent ? (
                    /* Fallback to plain text ONLY if no thread messages available */
                    <div className="pl-3 border-l-2 border-orange-500/30">
                      <textarea
                        ref={quotedRef}
                        value={editedDraft.quotedContent}
                        onChange={(e) => {
                          hasUserEditsRef.current = true;
                          setEditedDraft({ ...editedDraft, quotedContent: e.target.value });
                        }}
                        disabled={isSending}
                        className="w-full bg-transparent text-orange-300/70 leading-relaxed resize-none border-none focus:outline-none focus:ring-0 p-0"
                        style={{ fontSize: '16px' }}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>

        {/* Original attachments notice (for forwards) */}
        {originalAttachments.length > 0 && (
          <div className="mt-3 p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-purple-400" />
                <span className="text-sm text-purple-300">
                  {originalAttachments.length} attachment{originalAttachments.length > 1 ? 's' : ''} from original
                </span>
              </div>
              <button
                onClick={removeOriginalAttachments}
                disabled={isSending}
                className="flex items-center gap-1 px-2 py-1 text-xs text-purple-400 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
              >
                <X className="w-3 h-3" />
                Remove all
              </button>
            </div>
            {/* List original attachments */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {originalAttachments.map((att, i) => {
                const FileIcon = getFileIcon(att.mimeType, att.filename);
                const globalIndex = editedDraft.attachments?.findIndex(a => a === att) ?? -1;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-purple-500/10 text-xs"
                  >
                    <FileIcon className="w-3 h-3 text-purple-400" />
                    <span className="text-purple-200 max-w-[120px] truncate">{att.filename}</span>
                    <button
                      onClick={() => removeAttachment(globalIndex)}
                      disabled={isSending}
                      className="p-0.5 hover:bg-red-500/20 rounded transition-colors"
                    >
                      <X className="w-3 h-3 text-purple-400 hover:text-red-400" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* User-added attachments section */}
        {userAttachments.length > 0 && (
          <div className="mt-3 pt-3 border-t border-slate-700/50">
            <div className="flex items-center gap-2 mb-2">
              <Paperclip className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-xs text-slate-500 uppercase tracking-wide">
                Your Attachments ({userAttachments.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {userAttachments.map((att, i) => {
                const FileIcon = getFileIcon(att.mimeType, att.filename);
                const globalIndex = editedDraft.attachments?.findIndex(a => a === att) ?? -1;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm bg-slate-700/50 border border-slate-600/30"
                  >
                    <FileIcon className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-300 max-w-[150px] truncate">{att.filename}</span>
                    <span className="text-xs text-slate-500">{formatFileSize(att.size)}</span>
                    <button
                      onClick={() => removeAttachment(globalIndex)}
                      disabled={isSending}
                      className="p-0.5 hover:bg-red-500/20 rounded transition-colors"
                      title="Remove attachment"
                    >
                      <X className="w-3.5 h-3.5 text-slate-500 hover:text-red-400" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        accept="*/*"
      />

      {/* Actions - compact row with dynamic responsive labels */}
      <div ref={actionsRef} className="flex items-center gap-2 px-3 py-2 overflow-hidden">
        <button
          onClick={() => onDiscard(editedDraft)}
          disabled={isSending || isSaving || isDeleting}
          className="flex items-center gap-1 px-2 py-1.5 text-sm text-slate-400 hover:text-red-400 transition-colors disabled:opacity-50 whitespace-nowrap"
          title={editedDraft.gmailDraftId ? "Delete draft from Gmail" : "Discard draft"}
        >
          {isDeleting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className="w-3.5 h-3.5" />
          )}
          {compactLevel < 1 && <span>{isDeleting ? 'Deleting...' : 'Discard'}</span>}
        </button>
        
        {/* Add attachment button - always icon only */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending || isSaving}
          className="flex items-center px-2 py-1.5 text-sm text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-50"
          title="Add attachment"
        >
          <Paperclip className="w-3.5 h-3.5" />
        </button>
        
        <div className="flex-1 min-w-0" />
        
        {/* Save Draft button */}
        {onSaveDraft && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSaveDraft(editedDraft)}
            disabled={isSending || isSaving}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
            title="Save as Gmail draft"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {compactLevel < 2 && <span>{isSaving ? 'Saving...' : 'Save'}</span>}
          </motion.button>
        )}
        
        {/* Send button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleSendClick}
          disabled={isSending || isSaving || editedDraft.to.length === 0}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500/90 hover:bg-cyan-500 text-white text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {isSending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          {compactLevel < 3 && <span>{isSending ? 'Sending...' : 'Send'}</span>}
        </motion.button>
      </div>
    </motion.div>
  );
}
