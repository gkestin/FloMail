'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, X, Loader2, Reply, Forward, Mail, Plus } from 'lucide-react';
import { EmailDraft } from '@/types';

interface DraftCardProps {
  draft: EmailDraft;
  onSend: (updatedDraft: EmailDraft) => void;
  onCancel: () => void;
  isSending?: boolean;
}

export function DraftCard({ draft, onSend, onCancel, isSending }: DraftCardProps) {
  const [editedDraft, setEditedDraft] = useState<EmailDraft>(draft);
  const [showCcBcc, setShowCcBcc] = useState(
    (draft.cc && draft.cc.length > 0) || (draft.bcc && draft.bcc.length > 0)
  );
  const [showQuoted, setShowQuoted] = useState(false);
  
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const quotedRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Update editedDraft when draft prop changes
  useEffect(() => {
    setEditedDraft(draft);
    setShowCcBcc((draft.cc && draft.cc.length > 0) || (draft.bcc && draft.bcc.length > 0));
  }, [draft]);

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

  // Resize quoted textarea
  useEffect(() => {
    if (showQuoted && quotedRef.current) {
      const resize = () => autoResize(quotedRef.current);
      resize();
      requestAnimationFrame(resize);
    }
  }, [showQuoted, editedDraft.quotedContent]);

  const handleSendClick = () => {
    onSend(editedDraft);
  };

  // Common input styles - looks like text until focused
  const inputBaseClass = `
    w-full bg-transparent text-slate-200 text-sm
    border border-transparent rounded-lg px-2 py-1 -mx-2
    transition-all duration-150
    hover:bg-slate-700/30
    focus:bg-slate-700/50 focus:border-purple-500/50 focus:outline-none focus:ring-1 focus:ring-purple-500/30
  `;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-800/60 rounded-lg border-l-2 border-cyan-500/50"
    >
      {/* Header - compact */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className={`p-1 rounded ${
          editedDraft.type === 'reply' ? 'bg-blue-500/20' : 
          editedDraft.type === 'forward' ? 'bg-orange-500/20' : 
          'bg-cyan-500/20'
        }`}>
          {editedDraft.type === 'reply' ? (
            <Reply className="w-3.5 h-3.5 text-blue-400" />
          ) : editedDraft.type === 'forward' ? (
            <Forward className="w-3.5 h-3.5 text-orange-400" />
          ) : (
            <Mail className="w-3.5 h-3.5 text-cyan-400" />
          )}
        </div>
        <span className="text-sm font-medium text-slate-200">
          {editedDraft.type === 'reply' ? 'Reply' : 
           editedDraft.type === 'forward' ? 'Forward' : 
           'New Email'}
        </span>
      </div>

      {/* Content */}
      <div className="px-3 py-2 space-y-2">
        {/* To */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 uppercase tracking-wide w-12 flex-shrink-0">To</span>
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
          />
        </div>

        {/* CC/BCC - Collapsed unless has values or user expanded */}
        {showCcBcc ? (
          <>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 uppercase tracking-wide w-12 flex-shrink-0">CC</span>
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
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500 uppercase tracking-wide w-12 flex-shrink-0">BCC</span>
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
              />
            </div>
          </>
        ) : (
          <button
            onClick={() => setShowCcBcc(true)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-cyan-400 transition-colors ml-14"
          >
            <Plus className="w-3 h-3" />
            Add CC/BCC
          </button>
        )}

        {/* Subject */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 uppercase tracking-wide w-12 flex-shrink-0">Subj</span>
          <input
            type="text"
            value={editedDraft.subject}
            onChange={(e) => setEditedDraft({ ...editedDraft, subject: e.target.value })}
            placeholder="Email subject"
            disabled={isSending}
            className={inputBaseClass}
          />
        </div>

        {/* Separator line */}
        <div className="border-t border-cyan-500/10 my-2"></div>

        {/* Body - one scrollable container, textareas expand */}
        <div ref={containerRef} className="max-h-[60vh] overflow-y-auto">
          <textarea
            ref={bodyRef}
            value={editedDraft.body}
            onChange={(e) => setEditedDraft({ ...editedDraft, body: e.target.value })}
            placeholder="Write your message..."
            disabled={isSending}
            className="w-full bg-transparent text-slate-300 text-sm leading-relaxed resize-none border-none focus:outline-none focus:ring-0 p-0 overflow-hidden"
          />

          {editedDraft.quotedContent && (
            <button
              onClick={() => setShowQuoted(!showQuoted)}
              className={`inline-flex items-center px-3 py-1.5 rounded-full text-base mt-4 transition-all duration-200 cursor-pointer ${showQuoted ? 'bg-slate-600/60 text-slate-200' : 'bg-slate-700/40 text-slate-400 hover:bg-slate-600/50 hover:text-slate-200'}`}
            >
              <span className="font-black tracking-wider">···</span>
            </button>
          )}

          {editedDraft.quotedContent && showQuoted && (
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
        </div>
      </div>

      {/* Actions - compact row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onCancel}
          disabled={isSending}
          className="px-3 py-1.5 text-sm text-slate-400 hover:text-red-400 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleSendClick}
          disabled={isSending || editedDraft.to.length === 0}
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
