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
    <div>
      {/* Main content with background */}
      <div className="relative bg-slate-800/70">
        {/* Top gradient overlay for purple tint */}
        <div className="absolute inset-0 bg-gradient-to-b from-purple-950/50 via-purple-950/20 to-transparent pointer-events-none z-0"></div>
        
        {/* Header row - contains subject AND expand/collapse controls */}
        <div className="relative z-10 flex items-center gap-3 px-4 py-2.5">
        {/* Clickable subject area */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity text-left"
        >
          <div className="p-1.5 rounded-lg bg-purple-500/20">
            <Mail className="w-4 h-4 text-purple-400" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-100 truncate">
                {thread.subject || '(No Subject)'}
              </span>
              <span className="flex-shrink-0 text-xs text-purple-300/70 bg-purple-500/10 px-1.5 py-0.5 rounded">
                {thread.messages.length}
              </span>
            </div>
            <p className="text-xs text-slate-500 truncate">
              {thread.participants.map((p) => p.name || p.email.split('@')[0]).join(', ')}
            </p>
          </div>

          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="w-4 h-4 text-purple-400/60" />
          </motion.div>
        </button>

        {/* Expand/Collapse controls - only show when expanded, inline */}
        {isExpanded && thread.messages.length > 1 && (
          <div className="flex items-center gap-1 flex-shrink-0 border-l border-slate-700/50 pl-3">
            <button
              onClick={(e) => { e.stopPropagation(); expandAll(); }}
              className="p-1.5 text-slate-500 hover:text-purple-400 transition-colors"
              title="Expand all"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); collapseAll(); }}
              className="p-1.5 text-slate-500 hover:text-purple-400 transition-colors"
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
              <div className="max-h-[50vh] overflow-y-auto px-4 pb-3">
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
      
      {/* Bottom gradient line - in normal flow, always at bottom of content */}
      <div className="h-[2px] bg-gradient-to-r from-purple-500/50 via-blue-500/50 to-purple-500/50"></div>
      
      {/* Shadow below */}
      <div className="h-3 bg-gradient-to-b from-black/30 to-transparent"></div>
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
    <div className={`${isLast ? '' : 'border-b border-slate-800/50'}`}>
      {/* Message Header - Clickable to expand/collapse */}
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-3 py-2 hover:bg-white/5 transition-colors text-left ${isExpanded ? 'bg-white/[0.03]' : ''}`}
      >
        {/* Avatar */}
        <div
          className={`w-8 h-8 rounded-full bg-gradient-to-br ${getAvatarColor(message.from.email)} flex items-center justify-center flex-shrink-0 shadow-sm`}
        >
          <span className="text-white font-medium text-xs">{senderInitial}</span>
        </div>

        {/* Sender & Preview */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-medium text-sm ${isLast ? 'text-slate-100' : 'text-slate-300'}`}>
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
            <div className="pl-11 pb-3">
              {/* Recipients info - inline, minimal */}
              <div className="text-xs text-slate-500 mb-1.5">
                To: {message.to.map((t) => t.email).join(', ')}
                {message.cc && message.cc.length > 0 && (
                  <span className="ml-2">· Cc: {message.cc.map((c) => c.email).join(', ')}</span>
                )}
              </div>

              {/* Email body - left border accent */}
              <div className="border-l-2 border-purple-500/25 pl-3 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
                {message.body}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

