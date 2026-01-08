'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, X, User, Users, AtSign, Loader2, Reply, Forward, Mail, Plus } from 'lucide-react';
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
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${
            editedDraft.type === 'reply' ? 'bg-blue-500/20' : 
            editedDraft.type === 'forward' ? 'bg-orange-500/20' : 
            'bg-purple-500/20'
          }`}>
            {editedDraft.type === 'reply' ? (
              <Reply className="w-4 h-4 text-blue-400" />
            ) : editedDraft.type === 'forward' ? (
              <Forward className="w-4 h-4 text-orange-400" />
            ) : (
              <Mail className="w-4 h-4 text-purple-400" />
            )}
          </div>
          <span className="font-medium text-slate-200">
            {editedDraft.type === 'reply' ? 'Reply' : 
             editedDraft.type === 'forward' ? 'Forward' : 
             'New Email'}
          </span>
        </div>
      </div>

      {/* Content - All fields are always editable */}
      <div className="p-4 space-y-2">
        {/* To */}
        <div className="flex items-start gap-3">
          <User className="w-4 h-4 text-slate-500 mt-2.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <label className="text-xs text-slate-500 uppercase tracking-wide">To</label>
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
        </div>

        {/* CC/BCC - Collapsed unless has values or user expanded */}
        {showCcBcc ? (
          <>
            {/* CC */}
            <div className="flex items-start gap-3">
              <Users className="w-4 h-4 text-slate-500 mt-2.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <label className="text-xs text-slate-500 uppercase tracking-wide">CC</label>
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
            </div>

            {/* BCC */}
            <div className="flex items-start gap-3">
              <Users className="w-4 h-4 text-slate-500 mt-2.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <label className="text-xs text-slate-500 uppercase tracking-wide">BCC</label>
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
            </div>
          </>
        ) : (
          <button
            onClick={() => setShowCcBcc(true)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 transition-colors ml-7"
          >
            <Plus className="w-3 h-3" />
            Add CC/BCC
          </button>
        )}

        {/* Subject */}
        <div className="flex items-start gap-3">
          <AtSign className="w-4 h-4 text-slate-500 mt-2.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <label className="text-xs text-slate-500 uppercase tracking-wide">Subject</label>
            <input
              type="text"
              value={editedDraft.subject}
              onChange={(e) => setEditedDraft({ ...editedDraft, subject: e.target.value })}
              placeholder="Email subject"
              disabled={isSending}
              className={inputBaseClass}
            />
          </div>
        </div>

        {/* Body - one scrollable container, textareas expand (overflow-hidden prevents internal scroll) */}
        <div ref={containerRef} className="mt-3 rounded-xl border border-slate-600/40 bg-slate-800/20 p-4 max-h-[60vh] overflow-y-auto">
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

      {/* Actions - Just Cancel and Send */}
      <div className="flex items-center gap-2 p-4 pt-0">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onCancel}
          disabled={isSending}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-700/50 text-slate-300 hover:bg-red-500/20 hover:text-red-300 transition-colors disabled:opacity-50"
        >
          <X className="w-4 h-4" />
          Cancel
        </motion.button>
        
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleSendClick}
          disabled={isSending || editedDraft.to.length === 0}
          className="flex-[2] flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 text-white font-medium shadow-lg shadow-purple-500/20 disabled:opacity-50"
        >
          {isSending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {isSending ? 'Sending...' : 'Send'}
        </motion.button>
      </div>
    </motion.div>
  );
}
