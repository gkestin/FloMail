'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ArrowLeft, 
  Archive, 
  Trash2, 
  Reply, 
  MoreVertical,
  ChevronDown,
  ChevronUp,
  Send,
  X,
  Loader2
} from 'lucide-react';
import { EmailThread, EmailMessage, EmailDraft } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { archiveThread, trashThread, sendEmail } from '@/lib/gmail';

interface EmailViewProps {
  thread: EmailThread;
  onBack: () => void;
  onArchive: () => Promise<void> | void;
  onOpenChat: () => void;
  currentDraft?: EmailDraft | null;
  onClearDraft?: () => void;
}

export function EmailView({
  thread,
  onBack,
  onArchive,
  onOpenChat,
  currentDraft,
  onClearDraft,
}: EmailViewProps) {
  const { getAccessToken } = useAuth();
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set([thread.messages[thread.messages.length - 1]?.id])
  );
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

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

  const handleArchive = async () => {
    try {
      const token = await getAccessToken();
      if (token) {
        await archiveThread(token, thread.id);
        onArchive();
      }
    } catch (err) {
      console.error('Failed to archive:', err);
    }
  };

  const handleTrash = async () => {
    try {
      const token = await getAccessToken();
      if (token) {
        await trashThread(token, thread.id);
        onArchive();
      }
    } catch (err) {
      console.error('Failed to trash:', err);
    }
  };

  const handleSendDraft = async () => {
    if (!currentDraft) return;
    
    setSending(true);
    setSendError(null);
    
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      
      await sendEmail(token, currentDraft);
      onClearDraft?.();
      // Optionally refresh the thread
    } catch (err: any) {
      console.error('Failed to send:', err);
      setSendError(err.message || 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-3 border-b border-slate-800/50 bg-slate-900/80 backdrop-blur-lg">
        <div className="flex items-center gap-2">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onBack}
            className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-300" />
          </motion.button>
        </div>

        <div className="flex items-center gap-1">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleArchive}
            className="p-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <Archive className="w-5 h-5 text-slate-400" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleTrash}
            className="p-2 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-5 h-5 text-red-400" />
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onOpenChat}
            className="p-2 rounded-lg bg-gradient-to-r from-purple-500/20 to-cyan-500/20 hover:from-purple-500/30 hover:to-cyan-500/30 transition-colors"
          >
            <Reply className="w-5 h-5 text-purple-300" />
          </motion.button>
        </div>
      </div>

      {/* Subject */}
      <div className="px-4 py-3 border-b border-slate-800/30">
        <h1 className="text-lg font-semibold text-slate-100">
          {thread.subject || '(No Subject)'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {thread.messages.map((message, index) => (
          <MessageCard
            key={message.id}
            message={message}
            isExpanded={expandedMessages.has(message.id)}
            isLast={index === thread.messages.length - 1}
            onToggle={() => toggleMessage(message.id)}
          />
        ))}
      </div>

      {/* Draft Preview */}
      <AnimatePresence>
        {currentDraft && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="border-t border-slate-800/50 bg-slate-900/95 backdrop-blur-lg"
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-slate-300">Draft Reply</h3>
                <button
                  onClick={onClearDraft}
                  className="p-1 rounded hover:bg-slate-800 transition-colors"
                >
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
              
              <div className="bg-slate-800/50 rounded-lg p-3 mb-3 max-h-32 overflow-y-auto">
                <p className="text-sm text-slate-300 whitespace-pre-wrap">
                  {currentDraft.body}
                </p>
              </div>

              {sendError && (
                <p className="text-red-400 text-sm mb-3">{sendError}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={onOpenChat}
                  className="flex-1 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-colors"
                >
                  Edit in Chat
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSendDraft}
                  disabled={sending}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-cyan-500 text-white text-sm font-medium disabled:opacity-50"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reply FAB */}
      {!currentDraft && (
        <div className="p-4 border-t border-slate-800/50">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onOpenChat}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 text-white font-medium shadow-lg shadow-purple-500/20"
          >
            <Reply className="w-5 h-5" />
            Reply with AI
          </motion.button>
        </div>
      )}
    </div>
  );
}

// Message Card Component
function MessageCard({
  message,
  isExpanded,
  isLast,
  onToggle,
}: {
  message: EmailMessage;
  isExpanded: boolean;
  isLast: boolean;
  onToggle: () => void;
}) {
  const senderName = message.from.name || message.from.email.split('@')[0];
  const senderInitial = senderName.charAt(0).toUpperCase();

  // Generate a consistent color based on email
  const getAvatarColor = (email: string) => {
    const colors = [
      'from-purple-500 to-pink-500',
      'from-cyan-500 to-blue-500',
      'from-green-500 to-emerald-500',
      'from-orange-500 to-red-500',
      'from-indigo-500 to-purple-500',
    ];
    const hash = email.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  return (
    <div className={`border-b border-slate-800/30 ${isLast ? 'bg-slate-900/30' : ''}`}>
      {/* Collapsed header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/30 transition-colors text-left"
      >
        {/* Avatar */}
        <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${getAvatarColor(message.from.email)} flex items-center justify-center flex-shrink-0`}>
          <span className="text-white font-semibold text-sm">{senderInitial}</span>
        </div>

        {/* Header info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-slate-200 truncate">{senderName}</span>
            <span className="text-xs text-slate-500 flex-shrink-0">
              {new Date(message.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          {!isExpanded && (
            <p className="text-sm text-slate-500 truncate">{message.snippet}</p>
          )}
        </div>

        {/* Expand icon */}
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-slate-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-500 flex-shrink-0" />
        )}
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              {/* Email metadata */}
              <div className="text-xs text-slate-500 mb-3 pl-13">
                <p>From: {message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email}</p>
                <p>To: {message.to.map((t) => t.email).join(', ')}</p>
                {message.cc && message.cc.length > 0 && (
                  <p>Cc: {message.cc.map((c) => c.email).join(', ')}</p>
                )}
                <p>Date: {new Date(message.date).toLocaleString()}</p>
              </div>

              {/* Email body */}
              <div className="bg-slate-800/30 rounded-lg p-4 ml-13">
                <div className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {message.body}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

