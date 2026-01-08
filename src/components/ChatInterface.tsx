'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Loader2, Settings, Sparkles, ChevronDown, X, Edit2, RotateCcw, Mic, Square, Archive, Eye } from 'lucide-react';
import { DraftCard } from './DraftCard';
import { ThreadPreview } from './ThreadPreview';
import { WaveformVisualizer } from './WaveformVisualizer';
import { ChatMessage, EmailThread, EmailDraft, AIProvider } from '@/types';
import { ToolCall, buildDraftFromToolCall } from '@/lib/agent-tools';
import { OPENAI_MODELS } from '@/lib/openai';
import { CLAUDE_MODELS } from '@/lib/anthropic';

// Collapsed view for cancelled drafts
function CancelledDraftPreview({ draft }: { draft: EmailDraft }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="bg-slate-800/40 rounded-xl border border-slate-700/30 overflow-hidden opacity-60">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-slate-700/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <X className="w-4 h-4 text-slate-500" />
          <span className="text-sm text-slate-400">Cancelled draft</span>
          <span className="text-xs text-slate-500">• {draft.to.join(', ').slice(0, 20)}{draft.to.join(', ').length > 20 ? '...' : ''}</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      
      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-slate-700/30 space-y-1.5 text-sm">
          <div className="flex gap-2">
            <span className="text-slate-500 w-12">To:</span>
            <span className="text-slate-400">{draft.to.join(', ')}</span>
          </div>
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

// Import folder type
import { MailFolder } from './InboxList';

interface ChatInterfaceProps {
  thread?: EmailThread;
  folder?: MailFolder;
  threadLabels?: string[]; // Current Gmail labels on the thread
  onDraftCreated?: (draft: EmailDraft) => void;
  onSendEmail?: (draft: EmailDraft) => Promise<void>;
  onArchive?: () => void;
  onMoveToInbox?: () => void;
  onStar?: () => void;
  onUnstar?: () => void;
  onNextEmail?: () => void;
  onGoToInbox?: () => void;
  // Callback to register archive handler that includes notification
  onRegisterArchiveHandler?: (handler: () => void) => void;
}

interface UIMessage extends ChatMessage {
  toolCalls?: ToolCall[];
  draft?: EmailDraft;
  isTranscribing?: boolean;
  isEditing?: boolean;
  isCancelled?: boolean;
  draftCancelled?: boolean; // Draft was cancelled but kept for history
  isSystemMessage?: boolean; // For action confirmations (archive, navigate, etc.)
  systemType?: 'archived' | 'sent' | 'navigated' | 'context'; // Type of system message
  // Stored data for system messages (so we don't rely on current thread state)
  systemSnippet?: string;
  systemPreview?: string;
}

export function ChatInterface({
  thread,
  folder = 'inbox',
  threadLabels = [],
  onDraftCreated,
  onSendEmail,
  onArchive,
  onMoveToInbox,
  onStar,
  onUnstar,
  onNextEmail,
  onGoToInbox,
  onRegisterArchiveHandler,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [currentDraft, setCurrentDraft] = useState<EmailDraft | null>(null);
  const [provider, setProvider] = useState<AIProvider>('anthropic');
  const [model, setModel] = useState<string>('claude-sonnet-4-20250514');
  const [showSettings, setShowSettings] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  
  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  
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

  // Get available models based on provider
  const availableModels = provider === 'openai' ? OPENAI_MODELS : CLAUDE_MODELS;

  // Handle thread changes - show context message for new thread (debounced)
  useEffect(() => {
    if (!thread) return;
    
    const prevId = previousThreadIdRef.current;
    const currentId = thread.id;
    
    if (prevId !== currentId) {
      previousThreadIdRef.current = currentId;
      
      // Skip if this is initial load
      if (prevId === null) {
        return;
      }
      
      // Cancel any pending navigation message (debounce)
      if (pendingNavTimeoutRef.current) {
        clearTimeout(pendingNavTimeoutRef.current);
      }
      
      // Store the current thread data
      const navSubject = thread.subject;
      const navLastMsg = thread.messages[thread.messages.length - 1];
      const navSnippet = navLastMsg?.snippet || '';
      const navPreview = navLastMsg?.body || '';
      
      // Wait for state to settle before adding navigation message
      const navTimestamp = Date.now();
      pendingNavTimeoutRef.current = setTimeout(() => {
        pendingNavTimeoutRef.current = null;
        
        setMessages(prev => {
          // Check if the last message is already a nav for this thread (prevent rapid-fire duplicates)
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.isSystemMessage && 
              lastMsg?.systemType === 'navigated' && 
              lastMsg.content?.includes(navSubject)) {
            return prev; // Just navigated here, don't duplicate
          }
          return [...prev, {
            id: `nav-${currentId}-${navTimestamp}`,
            role: 'assistant' as const,
            content: `Now viewing: "${navSubject}"`,
            timestamp: new Date(),
            isSystemMessage: true,
            systemType: 'navigated' as const,
            systemSnippet: navSnippet,
            systemPreview: navPreview,
          }];
        });
      }, 400); // Wait 400ms for state to settle
    }
  }, [thread]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Update model when provider changes
  useEffect(() => {
    const defaultModel = provider === 'openai' ? 'gpt-4.1' : 'claude-sonnet-4-20250514';
    setModel(defaultModel);
  }, [provider]);

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

  // Archive with notification - used by both agent and direct button press
  const archiveWithNotification = useCallback(() => {
    const archiveSubject = thread?.subject || 'Email';
    const lastMsg = thread?.messages[thread.messages.length - 1];
    const archiveSnippet = lastMsg?.snippet || '';
    const archivePreview = lastMsg?.body || '';
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
    onArchive?.();
  }, [thread, onArchive]);

  // Register archive handler with parent so top bar button can use it
  useEffect(() => {
    onRegisterArchiveHandler?.(archiveWithNotification);
  }, [archiveWithNotification, onRegisterArchiveHandler]);

  // Handle tool calls from the agent
  const handleToolCalls = useCallback((toolCalls: ToolCall[]) => {
    for (const toolCall of toolCalls) {
      switch (toolCall.name) {
        case 'prepare_draft':
          const draft = buildDraftFromToolCall(toolCall.arguments, thread);
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
  }, [thread, onDraftCreated, archiveWithNotification, onMoveToInbox, onStar, onUnstar, onNextEmail, onGoToInbox]);

  // Send message to AI
  const sendToAI = useCallback(async (messageId: string, content: string) => {
    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      // Get all messages for context (excluding cancelled ones)
      const contextMessages = messages
        .filter(m => !m.isCancelled && !m.isTranscribing)
        .map(m => ({ role: m.role, content: m.content }));
      
      // Add the current message
      contextMessages.push({ role: 'user' as const, content });

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: contextMessages,
          thread,
          folder,
          provider,
          model,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();

      // Handle tool calls
      if (data.toolCalls && data.toolCalls.length > 0) {
        handleToolCalls(data.toolCalls);
      }

      // Check for prepare_draft in tool calls
      const draftToolCall = data.toolCalls?.find((tc: ToolCall) => tc.name === 'prepare_draft');
      const messageDraft = draftToolCall ? buildDraftFromToolCall(draftToolCall.arguments, thread) : undefined;

      // Generate response content
      let responseContent = data.content || '';
      if (!responseContent && data.toolCalls && data.toolCalls.length > 0) {
        const toolNames = data.toolCalls.map((tc: ToolCall) => tc.name);
        if (toolNames.includes('prepare_draft')) responseContent = "Here's a draft for you:";
        else if (toolNames.includes('archive_email')) responseContent = "Archived!";
        else if (toolNames.includes('go_to_next_email')) responseContent = "Moving to next...";
        else if (toolNames.includes('go_to_inbox')) responseContent = "Back to inbox...";
        else if (toolNames.includes('send_email')) responseContent = "Sending...";
      }

      const assistantMessage: UIMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseContent,
        timestamp: new Date(),
        toolCalls: data.toolCalls,
        draft: messageDraft,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Request was cancelled - don't show error
        return;
      }
      console.error('Chat error:', error);
      const errorMessage: UIMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [messages, thread, provider, model, handleToolCalls]);

  // Send a text message
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const messageId = Date.now().toString();
    const userMessage: UIMessage = {
      id: messageId,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    
    await sendToAI(messageId, content.trim());
  }, [isLoading, sendToAI]);

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
          
          const pendingMessage: UIMessage = {
            id: messageId,
            role: 'user',
            content: '',
            timestamp: new Date(),
            isTranscribing: true,
          };
          setMessages(prev => [...prev, pendingMessage]);

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
                ? { ...m, content: text, isTranscribing: false }
                : m
            ));
            
            // Auto-send to AI
            await sendToAI(messageId, text);
          } catch (error) {
            console.error('Transcription error:', error);
            // Update message to show error
            setMessages(prev => prev.map(m => 
              m.id === messageId 
                ? { ...m, content: 'Failed to transcribe. Tap to retry.', isTranscribing: false }
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

  // Stop voice recording
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

  // Cancel pending message
  const cancelMessage = useCallback((messageId: string) => {
    setMessages(prev => prev.filter(m => m.id !== messageId));
    if (isLoading) {
      abortControllerRef.current?.abort();
      setIsLoading(false);
    }
  }, [isLoading]);

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

  const handleSendDraft = async (updatedDraft: EmailDraft) => {
    if (!updatedDraft || !onSendEmail) return;
    
    setIsSending(true);
    try {
      await onSendEmail(updatedDraft);
      setCurrentDraft(null);
      const recipient = updatedDraft.to[0] || 'recipient';
      const confirmMessage: UIMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Sent to ${recipient}`,
        timestamp: new Date(),
        isSystemMessage: true,
        systemType: 'sent',
      };
      setMessages(prev => [...prev, confirmMessage]);
    } catch (error) {
      console.error('Send error:', error);
      const errorMessage: UIMessage = {
        id: Date.now().toString(),
        role: 'assistant',
        content: '⚠️ Send failed. Try again?',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
    }
  };

  const handleCancelDraft = () => {
    setCurrentDraft(null);
    // Mark any draft in messages as cancelled (keeps it in history but collapsed)
    setMessages(prev => prev.map(m => 
      m.draft ? { ...m, draftCancelled: true } : m
    ));
    // Add brief confirmation
    const cancelMessage: UIMessage = {
      id: Date.now().toString(),
      role: 'assistant',
      content: '↩️ Cancelled. What next?',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, cancelMessage]);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-slate-900 to-slate-950">
      {/* Email Thread Preview */}
      {thread && <ThreadPreview thread={thread} folder={folder} defaultExpanded={false} />}


      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isRecording && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500/20 to-cyan-500/20 flex items-center justify-center mb-4">
              <Sparkles className="w-7 h-7 text-purple-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-200 mb-2">
              {thread ? 'Ready to Help' : 'FloMail Agent'}
            </h3>
            <p className="text-slate-400 text-sm max-w-xs mb-4">
              {thread
                ? 'Tap the mic or type. Say "summarize", "draft reply", or anything!'
                : 'Select an email from your inbox to get started.'}
            </p>
            {thread && (
              <div className="flex flex-wrap gap-2 justify-center">
                {/* AI-powered actions */}
                {['Summarize', 'Draft reply'].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="px-4 py-2.5 rounded-full bg-slate-800/80 text-slate-300 text-sm font-medium hover:bg-slate-700 transition-colors border border-slate-700/50"
                  >
                    {suggestion}
                  </button>
                ))}
                {/* Direct actions - no AI needed */}
                <button
                  onClick={() => archiveWithNotification()}
                  className="px-4 py-2.5 rounded-full bg-slate-800/80 text-slate-300 text-sm font-medium hover:bg-blue-500/20 hover:text-blue-300 hover:border-blue-500/30 transition-colors border border-slate-700/50"
                >
                  Archive
                </button>
                <button
                  onClick={() => onNextEmail?.()}
                  className="px-4 py-2.5 rounded-full bg-slate-800/80 text-slate-300 text-sm font-medium hover:bg-green-500/20 hover:text-green-300 hover:border-green-500/30 transition-colors border border-slate-700/50"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {messages.map((message) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex flex-col ${
              message.isSystemMessage 
                ? 'items-center' 
                : message.role === 'user' 
                  ? 'items-end' 
                  : 'items-start'
            }`}
          >
            {/* System/Action message - horizontal divider with centered badge */}
            {message.isSystemMessage && (
              <div className="w-full flex items-center gap-2 py-2 group overflow-hidden">
                {/* Left line - min width ensures visibility on narrow screens */}
                <div className={`flex-1 min-w-12 h-px ${
                  message.systemType === 'archived' 
                    ? 'bg-gradient-to-r from-transparent to-blue-500/40' 
                    : message.systemType === 'sent'
                      ? 'bg-gradient-to-r from-transparent to-cyan-500/40'
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
                      : 'bg-green-500/15 text-green-300 border border-green-500/25'
                  }
                `}>
                  {message.systemType === 'archived' && <Archive className="w-4 h-4 text-blue-400 flex-shrink-0" />}
                  {message.systemType === 'sent' && <Send className="w-4 h-4 text-cyan-400 flex-shrink-0" />}
                  {message.systemType === 'navigated' && <Eye className="w-4 h-4 text-green-400 flex-shrink-0" />}
                  <div className="flex flex-col min-w-0 overflow-hidden">
                    <span className="font-medium truncate">{message.content}</span>
                    {/* Show stored snippet for navigation and archive */}
                    {message.systemSnippet && (message.systemType === 'navigated' || message.systemType === 'archived') && (
                      <span className="text-xs text-slate-500 leading-relaxed mt-0.5 line-clamp-2">
                        {message.systemSnippet.slice(0, 120)}
                        {message.systemSnippet.length > 120 && '...'}
                      </span>
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
                      : 'bg-gradient-to-l from-transparent to-green-500/40'
                }`} />
              </div>
            )}

            {/* User message with edit/cancel controls */}
            {!message.isSystemMessage && message.role === 'user' && (
              <div className="max-w-[85%] group relative">
                {editingMessageId === message.id ? (
                  // Editing mode
                  <div className="bg-slate-800 rounded-2xl p-3 space-y-2">
                    <textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      className="w-full bg-transparent text-slate-200 text-sm resize-none focus:outline-none min-w-[200px]"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(message.id)}
                        className="px-3 py-1.5 text-xs rounded-lg bg-purple-500 text-white hover:bg-purple-600"
                      >
                        Resend
                      </button>
                    </div>
                  </div>
                ) : (
                  // Normal display
                  <>
                    <div className={`rounded-2xl px-4 py-3 ${
                      message.isTranscribing 
                        ? 'bg-slate-700 border border-slate-600'
                        : 'bg-gradient-to-r from-purple-500 to-cyan-500 text-white'
                    }`}>
                      {message.isTranscribing ? (
                        <div className="flex items-center gap-2 text-slate-300">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-sm">Transcribing...</span>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                    
                    {/* Action buttons - show on hover or when can edit */}
                    {!message.isTranscribing && !isLoading && (
                      <div className="absolute -left-20 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEditing(message.id, message.content)}
                          className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                        <button
                          onClick={() => cancelMessage(message.id)}
                          className="p-1.5 rounded-lg bg-slate-700 hover:bg-red-500/20 transition-colors"
                          title="Delete"
                        >
                          <X className="w-3.5 h-3.5 text-slate-400" />
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

            {/* Assistant message */}
            {!message.isSystemMessage && message.role === 'assistant' && message.content?.trim() && (
              <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-slate-800/80 text-slate-200">
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              </div>
            )}

            {/* Draft card - active or cancelled */}
            {message.draft && message.role === 'assistant' && (
              <div className="w-full max-w-sm mt-3">
                {message.draftCancelled ? (
                  <CancelledDraftPreview draft={message.draft} />
                ) : (
                  <DraftCard
                    draft={message.draft}
                    onSend={handleSendDraft}
                    onCancel={handleCancelDraft}
                    isSending={isSending}
                  />
                )}
              </div>
            )}

            {/* Tool action indicator */}
            {!message.content?.trim() && message.toolCalls && message.toolCalls.length > 0 && !message.draft && message.role === 'assistant' && (
              <div className="bg-slate-800/60 rounded-2xl px-4 py-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span className="text-sm text-slate-400">
                  {message.toolCalls[0].name === 'archive_email' && 'Archived!'}
                  {message.toolCalls[0].name === 'go_to_next_email' && 'Moving to next...'}
                  {message.toolCalls[0].name === 'go_to_inbox' && 'Going to inbox...'}
                  {message.toolCalls[0].name === 'send_email' && 'Sending...'}
                </span>
              </div>
            )}
          </motion.div>
        ))}

        {/* Current draft */}
        {currentDraft && !messages.some(m => m.draft) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-sm mx-auto"
          >
            <DraftCard
              draft={currentDraft}
              onSend={handleSendDraft}
              onCancel={handleCancelDraft}
              isSending={isSending}
            />
          </motion.div>
        )}

        {/* AI Loading indicator with cancel */}
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="bg-slate-800/80 rounded-2xl px-4 py-3 flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
              <span className="text-sm text-slate-400">Thinking...</span>
              <button
                onClick={cancelAIResponse}
                className="p-1 rounded hover:bg-slate-700 transition-colors"
                title="Cancel"
              >
                <X className="w-4 h-4 text-slate-500 hover:text-red-400" />
              </button>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-slate-800/50 bg-slate-900/80 backdrop-blur-lg">
        {/* Recording state */}
        <AnimatePresence>
          {isRecording && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-3 p-3 bg-slate-800/50 rounded-2xl border border-red-500/30"
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
                  <span className="text-xs font-mono text-slate-400">{formatDuration(recordingDuration)}</span>
                </div>
                <button
                  onClick={stopRecording}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 text-white text-sm font-medium hover:opacity-90 transition-all shadow-lg shadow-purple-500/20 flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Text Input with mic and settings */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
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
              className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700/50 rounded-2xl text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/50 focus:ring-2 focus:ring-purple-500/20 resize-none disabled:opacity-50"
            />
          </div>
          
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="submit"
            disabled={!input.trim() || isLoading || isRecording}
            className="p-3 rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
          </motion.button>

          {/* Settings button with popover */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className={`p-3 rounded-xl transition-colors ${
                showSettings
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Settings className="w-5 h-5" />
            </button>

            {/* Settings Popover */}
            <AnimatePresence>
              {showSettings && (
                <>
                  {/* Backdrop to close */}
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setShowSettings(false)}
                  />
                  
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full right-0 mb-2 w-64 p-4 bg-slate-800 border border-slate-700/50 rounded-2xl shadow-xl z-50"
                  >
                    {/* Arrow */}
                    <div className="absolute -bottom-2 right-4 w-4 h-4 bg-slate-800 border-r border-b border-slate-700/50 rotate-45" />
                    
                    <div className="space-y-4 relative">
                      <div>
                        <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wide">Provider</label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setProvider('anthropic')}
                            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                              provider === 'anthropic'
                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/50'
                                : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                            }`}
                          >
                            Claude
                          </button>
                          <button
                            type="button"
                            onClick={() => setProvider('openai')}
                            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                              provider === 'openai'
                                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                                : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                            }`}
                          >
                            GPT
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs text-slate-400 mb-2 uppercase tracking-wide">Model</label>
                        <div className="relative">
                          <select
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-700/50 border border-slate-600/50 text-slate-200 text-sm appearance-none cursor-pointer focus:outline-none focus:border-purple-500/50"
                          >
                            {Object.entries(availableModels).map(([id, name]) => (
                              <option key={id} value={id}>{name}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </form>
      </div>
    </div>
  );
}
