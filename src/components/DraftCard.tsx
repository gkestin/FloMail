'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, X, Loader2, Reply, Forward, Mail, Plus, Paperclip, File, Image, FileText, Trash2, AlertTriangle, ArrowLeftRight, Save } from 'lucide-react';
import { EmailDraft, DraftAttachment, EmailDraftType, EmailThread } from '@/types';
import { buildReplyQuote } from '@/lib/agent-tools';

interface DraftCardProps {
  draft: EmailDraft;
  thread?: EmailThread; // For building quoted content when switching to reply
  onSend: (updatedDraft: EmailDraft) => void;
  onSaveDraft?: (updatedDraft: EmailDraft) => Promise<void>; // Save as Gmail draft
  onCancel: () => void;
  isSending?: boolean;
  isSaving?: boolean;
  isStreaming?: boolean; // Content is still being streamed in
}

// Format file size for display
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Get icon for file type
function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return Image;
  if (mimeType.includes('pdf') || mimeType.includes('document')) return FileText;
  return File;
}

export function DraftCard({ draft, thread, onSend, onSaveDraft, onCancel, isSending, isSaving, isStreaming }: DraftCardProps) {
  const [editedDraft, setEditedDraft] = useState<EmailDraft>(draft);
  
  // Count original attachments (from forward)
  const originalAttachments = editedDraft.attachments?.filter(a => a.isFromOriginal) || [];
  const userAttachments = editedDraft.attachments?.filter(a => !a.isFromOriginal) || [];
  const [showCcBcc, setShowCcBcc] = useState(
    (draft.cc && draft.cc.length > 0) || (draft.bcc && draft.bcc.length > 0)
  );
  const [showQuoted, setShowQuoted] = useState(false);
  
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const quotedRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update editedDraft when draft prop changes
  useEffect(() => {
    setEditedDraft(draft);
    setShowCcBcc((draft.cc && draft.cc.length > 0) || (draft.bcc && draft.bcc.length > 0));
  }, [draft]);

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

  // Auto-resize textarea: set to 1px, measure scrollHeight, apply
  const autoResize = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    const scrollPos = containerRef.current?.scrollTop || 0;
    textarea.style.height = '1px';
    textarea.style.height = textarea.scrollHeight + 'px';
    if (containerRef.current) containerRef.current.scrollTop = scrollPos;
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
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
            onChange={(e) => setEditedDraft({
              ...editedDraft,
              to: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
            })}
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
                onChange={(e) => setEditedDraft({
                  ...editedDraft,
                  cc: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                })}
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
                onChange={(e) => setEditedDraft({
                  ...editedDraft,
                  bcc: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                })}
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
            onChange={(e) => setEditedDraft({ ...editedDraft, subject: e.target.value })}
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
            value={editedDraft.body}
            onChange={(e) => setEditedDraft({ ...editedDraft, body: e.target.value })}
            placeholder={isStreaming ? "AI is drafting..." : "Write your message..."}
            disabled={isSending || isStreaming}
            className={`w-full bg-transparent text-sm leading-relaxed resize-none border-none focus:outline-none focus:ring-0 p-0 overflow-hidden ${isStreaming ? 'animate-pulse' : ''}`}
            style={{ color: 'var(--text-primary)' }}
          />

          {/* Quoted content - different display for reply vs forward */}
          {editedDraft.quotedContent && editedDraft.type === 'reply' && (
            <>
              <button
                onClick={() => setShowQuoted(!showQuoted)}
                className={`inline-flex items-center px-3 py-1.5 rounded-full text-base mt-4 transition-all duration-200 cursor-pointer ${showQuoted ? 'bg-slate-600/60 text-slate-200' : 'bg-slate-700/40 text-slate-400 hover:bg-slate-600/50 hover:text-slate-200'}`}
              >
                <span className="font-black tracking-wider">···</span>
              </button>

              {showQuoted && (
                <div className="mt-3 pl-3 border-l-2 border-slate-500/50">
                  <textarea
                    ref={quotedRef}
                    value={editedDraft.quotedContent}
                    onChange={(e) => setEditedDraft({ ...editedDraft, quotedContent: e.target.value })}
                    disabled={isSending}
                    className="w-full bg-transparent text-slate-400 text-sm leading-relaxed resize-none border-none focus:outline-none focus:ring-0 p-0 overflow-hidden"
                  />
                </div>
              )}
            </>
          )}
          
          {/* Forward: show forwarded content inline (not collapsible) */}
          {editedDraft.quotedContent && editedDraft.type === 'forward' && (
            <div className="mt-4 pt-3 border-t border-orange-500/20">
              <div className="text-xs text-orange-400/70 mb-2">Forwarded message below:</div>
              <div className="pl-3 border-l-2 border-orange-500/30">
                <textarea
                  ref={quotedRef}
                  value={editedDraft.quotedContent}
                  onChange={(e) => setEditedDraft({ ...editedDraft, quotedContent: e.target.value })}
                  disabled={isSending}
                  className="w-full bg-transparent text-slate-400 text-sm leading-relaxed resize-none border-none focus:outline-none focus:ring-0 p-0 overflow-hidden"
                />
              </div>
            </div>
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
                const FileIcon = getFileIcon(att.mimeType);
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
                const FileIcon = getFileIcon(att.mimeType);
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

      {/* Actions - compact row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onCancel}
          disabled={isSending || isSaving}
          className="px-3 py-1.5 text-sm text-slate-400 hover:text-red-400 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        
        {/* Add attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending || isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-400 hover:text-cyan-400 transition-colors disabled:opacity-50"
          title="Add attachment"
        >
          <Paperclip className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Attach</span>
        </button>
        
        <div className="flex-1" />
        
        {/* Save Draft button */}
        {onSaveDraft && (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSaveDraft(editedDraft)}
            disabled={isSending || isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm font-medium transition-colors disabled:opacity-50"
            title="Save as Gmail draft"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {isSaving ? 'Saving...' : 'Save'}
          </motion.button>
        )}
        
        {/* Send button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleSendClick}
          disabled={isSending || isSaving || editedDraft.to.length === 0}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-cyan-500/90 hover:bg-cyan-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isSending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          {isSending ? 'Sending...' : 'Send'}
        </motion.button>
      </div>
    </motion.div>
  );
}
