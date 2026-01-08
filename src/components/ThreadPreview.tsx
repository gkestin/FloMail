'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Mail, User, Clock, Maximize2, Minimize2 } from 'lucide-react';
import { EmailThread, EmailMessage } from '@/types';

interface ThreadPreviewProps {
  thread: EmailThread;
  defaultExpanded?: boolean;
}

export function ThreadPreview({ thread, defaultExpanded = false }: ThreadPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    // By default, expand the last message
    new Set([thread.messages[thread.messages.length - 1]?.id])
  );

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
    <div className="border-b border-slate-800/50 bg-slate-900/50">
      {/* Collapsed Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/30 transition-colors text-left"
      >
        <div className="p-2 rounded-lg bg-purple-500/20">
          <Mail className="w-4 h-4 text-purple-400" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-200 truncate">
              {thread.subject || '(No Subject)'}
            </span>
            <span className="flex-shrink-0 text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
              {thread.messages.length} {thread.messages.length === 1 ? 'message' : 'messages'}
            </span>
          </div>
          <p className="text-sm text-slate-400 truncate mt-0.5">
            {thread.participants.map((p) => p.name || p.email.split('@')[0]).join(', ')}
          </p>
        </div>

        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown className="w-5 h-5 text-slate-400" />
        </motion.div>
      </button>

      {/* Expanded Content - Email Thread */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {/* Controls */}
            <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-slate-800/30">
              <button
                onClick={expandAll}
                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-300 hover:bg-slate-800/50 rounded transition-colors"
              >
                <Maximize2 className="w-3 h-3" />
                Expand all
              </button>
              <button
                onClick={collapseAll}
                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-300 hover:bg-slate-800/50 rounded transition-colors"
              >
                <Minimize2 className="w-3 h-3" />
                Collapse all
              </button>
            </div>

            {/* Messages */}
            <div className="max-h-[50vh] overflow-y-auto">
              {thread.messages.map((message, index) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  isExpanded={expandedMessages.has(message.id)}
                  isLast={index === thread.messages.length - 1}
                  onToggle={() => toggleMessage(message.id)}
                  formatDate={formatDate}
                  getAvatarColor={getAvatarColor}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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

  return (
    <div className={`border-t border-slate-800/30 ${isLast ? 'bg-slate-800/20' : ''}`}>
      {/* Message Header - Clickable to expand/collapse */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/20 transition-colors text-left"
      >
        {/* Avatar */}
        <div
          className={`w-8 h-8 rounded-full bg-gradient-to-br ${getAvatarColor(message.from.email)} flex items-center justify-center flex-shrink-0`}
        >
          <span className="text-white font-medium text-xs">{senderInitial}</span>
        </div>

        {/* Sender & Preview */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-medium text-sm ${isLast ? 'text-slate-200' : 'text-slate-300'}`}>
              {senderName}
            </span>
            <span className="text-xs text-slate-500">
              {formatDate(message.date)}
            </span>
          </div>
          {!isExpanded && (
            <p className="text-xs text-slate-500 truncate mt-0.5">
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
            <div className="px-4 pb-4">
              {/* Recipients info */}
              <div className="text-xs text-slate-500 mb-3 ml-11 space-y-0.5">
                <p>
                  <span className="text-slate-600">To:</span> {message.to.map((t) => t.email).join(', ')}
                </p>
                {message.cc && message.cc.length > 0 && (
                  <p>
                    <span className="text-slate-600">Cc:</span> {message.cc.map((c) => c.email).join(', ')}
                  </p>
                )}
              </div>

              {/* Email body */}
              <div className="ml-11 bg-slate-800/40 rounded-xl p-4">
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

