'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic,
  MicOff,
  Loader2,
  X,
  AlertCircle,
  MessageSquare,
  ChevronDown,
  Send,
  Keyboard,
} from 'lucide-react';
import { useConversation } from '@elevenlabs/react';
import { DraftCard } from './DraftCard';
import { EmailThread, EmailDraft, AIProvider, AIDraftingPreferences } from '@/types';
import { buildDraftFromToolCall } from '@/lib/agent-tools';
import { buildVoiceAgentPrompt } from '@/lib/voice-agent';
import { VoiceSoundEffects } from '@/lib/voice-agent';
import { useAuth } from '@/contexts/AuthContext';
import { fetchInbox } from '@/lib/gmail';
import { MailFolder } from './InboxList';

// ============================================================
// TYPES
// ============================================================

interface VoiceMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isToolAction?: boolean;
  toolName?: string;
}

interface VoiceModeInterfaceProps {
  thread?: EmailThread;
  folder?: MailFolder;
  threadLabels?: string[];
  provider?: AIProvider;
  model?: string;
  draftingPreferences?: AIDraftingPreferences;
  onDraftCreated?: (draft: EmailDraft) => void;
  onSendEmail?: (draft: EmailDraft) => Promise<void>;
  onSaveDraft?: (draft: EmailDraft) => Promise<EmailDraft>;
  onDeleteDraft?: (draftId: string) => Promise<void>;
  onArchive?: () => void;
  onMoveToInbox?: () => void;
  onStar?: () => void;
  onUnstar?: () => void;
  onSnooze?: (snoozeUntil: Date) => Promise<void>;
  onNextEmail?: () => void;
  onGoToInbox?: () => void;
  onExitVoiceMode: () => void;
}

// ============================================================
// VOICE ORB - on-brand purple/cyan gradient
// ============================================================

function VoiceOrb({
  status,
  isSpeaking,
  isProcessing,
  inputVolume,
  outputVolume,
}: {
  status: string;
  isSpeaking: boolean;
  isProcessing: boolean;
  inputVolume: number;
  outputVolume: number;
}) {
  const isConnected = status === 'connected';
  const isListening = isConnected && !isSpeaking && !isProcessing;
  const activeVolume = isSpeaking ? outputVolume : inputVolume;
  const pulseScale = 1 + activeVolume * 0.5;

  return (
    <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>
      {/* Outer ambient glow */}
      <motion.div
        className="absolute inset-0 rounded-full blur-xl"
        animate={{
          scale: isConnected ? [1, 1.2, 1] : 1,
          opacity: isConnected ? [0.3, 0.1, 0.3] : 0.05,
        }}
        transition={{
          duration: isProcessing ? 0.8 : isSpeaking ? 1.2 : 2.5,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        style={{
          background: isConnected
            ? isProcessing
              ? 'radial-gradient(circle, rgba(192,132,252,0.5) 0%, rgba(168,85,247,0.3) 50%, transparent 70%)'
              : 'radial-gradient(circle, rgba(168,85,247,0.5) 0%, rgba(6,182,212,0.3) 50%, transparent 70%)'
            : 'radial-gradient(circle, rgba(100,100,100,0.15) 0%, transparent 70%)',
        }}
      />

      {/* Middle volume-reactive ring */}
      <motion.div
        className="absolute rounded-full"
        style={{ inset: 20 }}
        animate={{
          scale: isConnected ? (isProcessing ? [1, 1.1, 1] : pulseScale) : 1,
          opacity: isConnected ? 0.4 : 0.08,
        }}
        transition={isProcessing
          ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.12, ease: 'easeOut' }}
      >
        <div
          className="w-full h-full rounded-full"
          style={{
            background: isConnected
              ? isProcessing
                ? 'radial-gradient(circle, rgba(192,132,252,0.35) 0%, rgba(168,85,247,0.2) 100%)'
                : 'radial-gradient(circle, rgba(168,85,247,0.35) 0%, rgba(6,182,212,0.2) 100%)'
              : 'radial-gradient(circle, rgba(100,100,100,0.2) 0%, transparent 100%)',
          }}
        />
      </motion.div>

      {/* Core orb with FloMail gradient */}
      <motion.div
        className="absolute rounded-full"
        style={{ inset: 38 }}
        animate={{
          scale: isConnected ? (isProcessing ? [0.95, 1.02, 0.95] : 0.95 + activeVolume * 0.12) : 1,
        }}
        transition={isProcessing
          ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.08 }}
      >
        <div
          className="w-full h-full rounded-full flex items-center justify-center"
          style={{
            background: isConnected
              ? isProcessing
                ? 'linear-gradient(135deg, rgb(192,132,252) 0%, rgb(168,85,247) 40%, rgb(139,92,246) 100%)'
                : isSpeaking
                  ? 'linear-gradient(135deg, rgb(168,85,247) 0%, rgb(139,92,246) 40%, rgb(6,182,212) 100%)'
                  : 'linear-gradient(135deg, rgb(139,92,246) 0%, rgb(59,130,246) 40%, rgb(6,182,212) 100%)'
              : status === 'connecting'
              ? 'linear-gradient(135deg, rgb(168,85,247) 0%, rgb(107,114,128) 100%)'
              : 'linear-gradient(135deg, rgb(75,85,99) 0%, rgb(55,65,81) 100%)',
            boxShadow: isConnected
              ? isProcessing
                ? '0 0 40px rgba(192,132,252,0.4), 0 0 80px rgba(168,85,247,0.2)'
                : '0 0 40px rgba(168,85,247,0.3), 0 0 80px rgba(6,182,212,0.15)'
              : 'none',
          }}
        >
          {status === 'connecting' ? (
            <Loader2 className="w-8 h-8 text-white/90 animate-spin" />
          ) : isProcessing ? (
            // Pulsing dots for processing
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-2 h-2 rounded-full bg-white/90"
                  animate={{
                    scale: [1, 1.4, 1],
                    opacity: [0.5, 1, 0.5],
                  }}
                  transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    delay: i * 0.2,
                  }}
                />
              ))}
            </div>
          ) : isListening ? (
            <Mic className="w-8 h-8 text-white/90" />
          ) : isSpeaking ? (
            // Animated bars for speaking
            <div className="flex items-end gap-1 h-8">
              {[0, 1, 2, 3].map((i) => (
                <motion.div
                  key={i}
                  className="w-1.5 rounded-full bg-white/90"
                  animate={{
                    height: [8, 20 + Math.random() * 12, 8],
                  }}
                  transition={{
                    duration: 0.4 + i * 0.1,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    delay: i * 0.08,
                  }}
                />
              ))}
            </div>
          ) : (
            <Mic className="w-8 h-8 text-white/40" />
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function VoiceModeInterface({
  thread,
  folder = 'inbox',
  threadLabels = [],
  provider = 'anthropic',
  model,
  draftingPreferences,
  onDraftCreated,
  onSendEmail,
  onSaveDraft,
  onDeleteDraft,
  onArchive,
  onMoveToInbox,
  onStar,
  onUnstar,
  onSnooze,
  onNextEmail,
  onGoToInbox,
  onExitVoiceMode,
}: VoiceModeInterfaceProps) {
  const { user, getAccessToken } = useAuth();

  // State
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [tentativeTranscript, setTentativeTranscript] = useState('');
  const [currentDraft, setCurrentDraft] = useState<EmailDraft | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [processingTool, setProcessingTool] = useState<string | null>(null);
  const [inputVolume, setInputVolume] = useState(0);
  const [outputVolume, setOutputVolume] = useState(0);
  const [showTranscript, setShowTranscript] = useState(true);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const soundsRef = useRef<VoiceSoundEffects>(new VoiceSoundEffects());
  const volumeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const hasAutoStarted = useRef(false);

  // Build the dynamic prompt for this thread
  const voicePrompt = useMemo(
    () => buildVoiceAgentPrompt(thread, folder, draftingPreferences),
    [thread?.id, folder, draftingPreferences]
  );

  // ============================================================
  // CLIENT TOOL HANDLERS
  // ============================================================

  // Helper to add a tool action message to the transcript
  const addToolMessage = useCallback((toolName: string, content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `tool-${toolName}-${Date.now()}`,
        role: 'assistant',
        content,
        timestamp: new Date(),
        isToolAction: true,
        toolName,
      },
    ]);
  }, []);

  const clientTools = useMemo(
    () => ({
      prepare_draft: async (params: any) => {
        setProcessingTool('Drafting...');
        soundsRef.current.playDraftReady();
        const draft = buildDraftFromToolCall(params, thread, user?.email);
        setCurrentDraft(draft);
        onDraftCreated?.(draft);
        addToolMessage('prepare_draft', `Draft ${draft.type === 'reply' ? 'reply' : draft.type === 'forward' ? 'forward' : 'email'} prepared.`);
        setProcessingTool(null);
        return `Draft prepared. Type: ${draft.type}, To: ${draft.to.join(', ')}, Subject: ${draft.subject}. The draft is now displayed to the user for review.`;
      },

      send_email: async (params: any) => {
        if (!currentDraft) return 'No draft to send.';
        setProcessingTool('Sending...');
        soundsRef.current.playSend();
        setIsSending(true);
        try {
          await onSendEmail?.(currentDraft);
          addToolMessage('send_email', 'Email sent successfully.');
          setCurrentDraft(null);
          return 'Email sent successfully.';
        } catch (err: any) {
          soundsRef.current.playError();
          return `Failed to send: ${err.message}`;
        } finally {
          setIsSending(false);
          setProcessingTool(null);
        }
      },

      archive_email: async () => {
        setProcessingTool('Archiving...');
        soundsRef.current.playSend();
        onArchive?.();
        addToolMessage('archive_email', 'Email archived.');
        setProcessingTool(null);
        return 'Email archived.';
      },

      move_to_inbox: async () => {
        setProcessingTool('Moving...');
        soundsRef.current.playToolStart();
        onMoveToInbox?.();
        addToolMessage('move_to_inbox', 'Moved to inbox.');
        setProcessingTool(null);
        return 'Email moved to inbox.';
      },

      star_email: async () => {
        soundsRef.current.playToolStart();
        onStar?.();
        addToolMessage('star_email', 'Email starred.');
        return 'Email starred.';
      },

      unstar_email: async () => {
        soundsRef.current.playToolStart();
        onUnstar?.();
        addToolMessage('unstar_email', 'Star removed.');
        return 'Star removed.';
      },

      snooze_email: async (params: any) => {
        if (!onSnooze) return 'Snooze not available.';
        setProcessingTool('Snoozing...');
        soundsRef.current.playToolStart();
        const snoozeUntilArg = params.snooze_until as string;
        const customDate = params.custom_date as string | undefined;

        let snoozeDate: Date;
        const now = new Date();
        switch (snoozeUntilArg) {
          case 'later_today':
            snoozeDate = new Date(now);
            snoozeDate.setHours(18, 0, 0, 0);
            if (snoozeDate <= now) snoozeDate.setDate(snoozeDate.getDate() + 1);
            break;
          case 'tomorrow':
            snoozeDate = new Date(now);
            snoozeDate.setDate(snoozeDate.getDate() + 1);
            snoozeDate.setHours(8, 0, 0, 0);
            break;
          case 'this_weekend':
            snoozeDate = new Date(now);
            const daysUntilSat = (6 - snoozeDate.getDay() + 7) % 7 || 7;
            snoozeDate.setDate(snoozeDate.getDate() + daysUntilSat);
            snoozeDate.setHours(8, 0, 0, 0);
            break;
          case 'next_week':
            snoozeDate = new Date(now);
            const daysUntilMon = (8 - snoozeDate.getDay()) % 7 || 7;
            snoozeDate.setDate(snoozeDate.getDate() + daysUntilMon);
            snoozeDate.setHours(8, 0, 0, 0);
            break;
          case 'custom':
            snoozeDate = customDate ? new Date(customDate) : new Date(now.getTime() + 86400000);
            break;
          default:
            snoozeDate = new Date(now.getTime() + 86400000);
        }

        try {
          await onSnooze(snoozeDate);
          addToolMessage('snooze_email', `Snoozed until ${snoozeDate.toLocaleString()}.`);
          return `Email snoozed until ${snoozeDate.toLocaleString()}.`;
        } catch (err: any) {
          soundsRef.current.playError();
          return `Failed to snooze: ${err.message}`;
        } finally {
          setProcessingTool(null);
        }
      },

      go_to_next_email: async () => {
        soundsRef.current.playToolStart();
        addToolMessage('go_to_next_email', 'Moving to next email...');
        onNextEmail?.();
        return 'Navigating to next email.';
      },

      go_to_inbox: async () => {
        soundsRef.current.playToolStart();
        addToolMessage('go_to_inbox', 'Returning to inbox...');
        onGoToInbox?.();
        return 'Returning to inbox.';
      },

      web_search: async (params: any) => {
        setProcessingTool('Searching the web...');
        soundsRef.current.playToolStart();
        addToolMessage('web_search', `Searching: "${params.query}"...`);
        try {
          const res = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: params.query }),
          });
          if (!res.ok) {
            addToolMessage('web_search', 'Search failed.');
            return 'Search failed.';
          }
          const data = await res.json();
          const results = data.results
            ?.slice(0, 3)
            .map((r: any) => `${r.title}: ${r.content?.slice(0, 200)}`)
            .join('\n');
          return results || 'No results found.';
        } catch {
          return 'Search failed.';
        } finally {
          setProcessingTool(null);
        }
      },

      browse_url: async (params: any) => {
        setProcessingTool('Fetching page...');
        soundsRef.current.playToolStart();
        addToolMessage('browse_url', `Opening link...`);
        try {
          const res = await fetch('/api/browse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: params.url }),
          });
          if (!res.ok) return 'Failed to fetch URL.';
          const data = await res.json();
          return (data.content || '').slice(0, 1000) || 'No content found.';
        } catch {
          return 'Failed to fetch URL.';
        } finally {
          setProcessingTool(null);
        }
      },

      search_emails: async (params: any) => {
        setProcessingTool('Searching emails...');
        soundsRef.current.playToolStart();
        addToolMessage('search_emails', `Searching emails: "${params.query}"...`);
        try {
          const token = await getAccessToken();
          if (!token) return 'Not authenticated. Please sign in again.';
          const result = await fetchInbox(token, { query: params.query, maxResults: 5 });
          if (!result?.threads?.length) return 'No emails found matching that search.';
          const summaries = result.threads
            .slice(0, 5)
            .map((t: any, i: number) => `${i + 1}. "${t.subject}" from ${t.participants?.[0]?.name || t.participants?.[0]?.email || 'unknown'}`)
            .join('. ');
          return `Found ${result.threads.length} emails. Top results: ${summaries}`;
        } catch {
          return 'Email search failed. Please try again.';
        } finally {
          setProcessingTool(null);
        }
      },
    }),
    [thread, user?.email, currentDraft, onDraftCreated, onSendEmail, onArchive, onMoveToInbox, onStar, onUnstar, onSnooze, onNextEmail, onGoToInbox, getAccessToken, addToolMessage]
  );

  // ============================================================
  // ELEVENLABS CONVERSATION
  // ============================================================

  // Catch unhandled SDK errors (e.g. malformed error events from server)
  // that crash inside BaseConversation.handleErrorEvent before reaching onError
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      if (
        event.reason instanceof TypeError &&
        event.reason.message?.includes("reading 'error_type'")
      ) {
        event.preventDefault();
        console.warn('[Voice] Suppressed SDK error_event crash:', event.reason.message);
      }
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  const conversation = useConversation({
    clientTools,
    onConnect: () => {
      setError(null);
      setIsInitializing(false);
      soundsRef.current.playConnect();
    },
    onDisconnect: () => {
      if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
        volumeIntervalRef.current = null;
      }
      stopBrowserRecognition();
    },
    onMessage: ({ message, source }: any) => {
      if (source === 'user') {
        setTentativeTranscript('');
      }

      let content = '';
      if (typeof message === 'string') {
        content = message;
      } else if (typeof message === 'object' && message !== null) {
        const msgObj = message as any;
        content = msgObj.text || msgObj.content || JSON.stringify(message);
      } else {
        content = String(message);
      }

      if (content?.trim()) {
        setMessages((prev) => [
          ...prev,
          {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: source === 'user' ? 'user' : 'assistant',
            content,
            timestamp: new Date(),
          },
        ]);
      }
    },
    onError: (err: any) => {
      const errorMessage = typeof err === 'string' ? err : err?.message || 'Unknown error';
      // Don't show transient server errors that don't kill the connection
      if (errorMessage.includes('Server error') && conversation.status === 'connected') {
        console.warn('[Voice] Non-fatal server error:', errorMessage);
        return;
      }
      setError(errorMessage);
      setIsInitializing(false);
      soundsRef.current.playError();
    },
    onModeChange: ({ mode }: any) => {
      if (conversation.status === 'connected' && recognitionRef.current) {
        if (mode === 'listening') {
          startBrowserRecognition();
        } else if (mode === 'speaking') {
          stopBrowserRecognition();
        }
      }
    },
  });

  // ============================================================
  // BROWSER SPEECH RECOGNITION (for interim transcripts)
  // ============================================================

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognition =
      (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) {
          interim += event.results[i][0].transcript;
        }
      }
      if (interim) {
        setTentativeTranscript(interim);
      }
    };

    recognition.onerror = () => {
      if (conversation.status === 'connected') {
        setTimeout(() => {
          try { recognition.start(); } catch {}
        }, 500);
      }
    };

    recognition.onend = () => {
      if (conversation.status === 'connected' && !conversation.isSpeaking) {
        setTimeout(() => {
          try { recognition.start(); } catch {}
        }, 50);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try { recognition.stop(); } catch {}
    };
  }, [conversation.status, conversation.isSpeaking]);

  const startBrowserRecognition = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
    } catch (e: any) {
      if (!e.message?.includes('already started')) {
        setTimeout(() => {
          try { recognitionRef.current?.start(); } catch {}
        }, 200);
      }
    }
  }, []);

  const stopBrowserRecognition = useCallback(() => {
    if (!recognitionRef.current) return;
    try { recognitionRef.current.stop(); } catch {}
  }, []);

  // ============================================================
  // VOLUME MONITORING
  // ============================================================

  useEffect(() => {
    if (conversation.status === 'connected') {
      volumeIntervalRef.current = setInterval(() => {
        setInputVolume(conversation.getInputVolume());
        setOutputVolume(conversation.getOutputVolume());
      }, 50);
    }

    return () => {
      if (volumeIntervalRef.current) {
        clearInterval(volumeIntervalRef.current);
        volumeIntervalRef.current = null;
      }
    };
  }, [conversation.status]);

  // ============================================================
  // AGENT INITIALIZATION
  // ============================================================

  const initializeAgent = useCallback(async () => {
    if (agentId) return agentId;

    setIsInitializing(true);
    try {
      const res = await fetch('/api/voice/elevenlabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_agent' }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to initialize voice agent');
      }

      const data = await res.json();
      setAgentId(data.agentId);
      return data.agentId;
    } catch (err: any) {
      setError(err.message);
      setIsInitializing(false);
      return null;
    }
  }, [agentId]);

  // ============================================================
  // START / END SESSION
  // ============================================================

  const startSession = useCallback(async () => {
    setError(null);
    setIsInitializing(true);

    const id = await initializeAgent();
    if (!id) return;

    try {
      await conversation.startSession({
        agentId: id,
        connectionType: 'webrtc',
      });

      // Send email context after connection is established
      // (overrides for firstMessage/prompt are not allowed by the agent config)
      if (voicePrompt) {
        conversation.sendContextualUpdate(voicePrompt);
      }

      startBrowserRecognition();
    } catch (err: any) {
      setError(`Failed to connect: ${err.message}`);
      setIsInitializing(false);
      soundsRef.current.playError();
    }
  }, [initializeAgent, conversation, voicePrompt, thread, startBrowserRecognition]);

  const endSession = useCallback(async () => {
    stopBrowserRecognition();
    setTentativeTranscript('');
    soundsRef.current.playDisconnect();

    if (conversation.status === 'connected') {
      await conversation.endSession();
    }
  }, [conversation, stopBrowserRecognition]);

  // ============================================================
  // AUTO-START: connect immediately when voice mode opens
  // ============================================================

  useEffect(() => {
    if (!hasAutoStarted.current) {
      hasAutoStarted.current = true;
      startSession();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      soundsRef.current.dispose();
      if (volumeIntervalRef.current) clearInterval(volumeIntervalRef.current);
    };
  }, []);

  // ============================================================
  // AUTO-SCROLL
  // ============================================================

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, tentativeTranscript]);

  // ============================================================
  // DRAFT HANDLERS
  // ============================================================

  const handleSendDraft = useCallback(
    async (draft: EmailDraft) => {
      setIsSending(true);
      try {
        await onSendEmail?.(draft);
        soundsRef.current.playSend();
        setCurrentDraft(null);
        if (conversation.status === 'connected') {
          conversation.sendContextualUpdate('The user just sent the draft email successfully.');
        }
      } catch (err: any) {
        soundsRef.current.playError();
        setError(`Send failed: ${err.message}`);
      } finally {
        setIsSending(false);
      }
    },
    [onSendEmail, conversation]
  );

  const handleSaveDraft = useCallback(
    async (draft: EmailDraft) => {
      setIsSaving(true);
      try {
        const saved = await onSaveDraft?.(draft);
        if (saved) setCurrentDraft(saved);
      } catch (err: any) {
        setError(`Save failed: ${err.message}`);
      } finally {
        setIsSaving(false);
      }
    },
    [onSaveDraft]
  );

  const handleDiscardDraft = useCallback(
    async (draft: EmailDraft) => {
      if (draft.gmailDraftId) {
        setIsDeleting(true);
        try { await onDeleteDraft?.(draft.gmailDraftId); } catch {}
        setIsDeleting(false);
      }
      setCurrentDraft(null);
      if (conversation.status === 'connected') {
        conversation.sendContextualUpdate('The user discarded the draft.');
      }
    },
    [onDeleteDraft, conversation]
  );

  const handleDraftChange = useCallback((draft: EmailDraft) => {
    setCurrentDraft(draft);
  }, []);

  // ============================================================
  // RENDER
  // ============================================================

  const isConnected = conversation.status === 'connected';
  const isConnecting = conversation.status === 'connecting' || isInitializing;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* Minimal header - just subject context and close */}
      <div
        className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* FloMail gradient dot */}
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{
              background: isConnected
                ? 'linear-gradient(135deg, rgb(168,85,247), rgb(6,182,212))'
                : isConnecting
                ? 'rgb(168,85,247)'
                : 'rgb(107,114,128)',
              boxShadow: isConnected ? '0 0 8px rgba(168,85,247,0.5)' : 'none',
            }}
          />
          {thread ? (
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {thread.subject}
            </p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Voice Mode
            </p>
          )}
        </div>

        <button
          onClick={() => {
            endSession();
            onExitVoiceMode();
          }}
          className="p-1.5 rounded-lg hover:bg-white/5 transition-colors flex-shrink-0"
          style={{ color: 'var(--text-muted)' }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden flex-shrink-0"
          >
            <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              <span className="text-xs text-red-300 flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center overflow-hidden">
        {/* Voice Orb */}
        <div className="flex-shrink-0 pt-6 pb-2">
          <VoiceOrb
            status={isConnecting ? 'connecting' : conversation.status}
            isSpeaking={conversation.isSpeaking}
            isProcessing={!!processingTool}
            inputVolume={inputVolume}
            outputVolume={outputVolume}
          />
        </div>

        {/* Status text below orb */}
        <motion.p
          className="text-xs mb-3 flex-shrink-0"
          animate={{ opacity: isConnected ? 0.7 : 0.4 }}
          style={{ color: processingTool ? 'rgb(192,132,252)' : 'var(--text-muted)' }}
        >
          {isConnecting
            ? 'Connecting...'
            : isConnected
            ? processingTool
              ? processingTool
              : conversation.isSpeaking
                ? 'Speaking...'
                : 'Listening...'
            : 'Disconnected'}
        </motion.p>

        {/* Transcript area */}
        <div className="flex-1 w-full overflow-hidden flex flex-col">
          {/* Toggle */}
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="flex items-center gap-1.5 px-3 py-1 mx-auto rounded-full text-xs transition-colors hover:bg-white/5 flex-shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            <MessageSquare className="w-3 h-3" />
            <span>Transcript</span>
            <ChevronDown
              className={`w-3 h-3 transition-transform ${showTranscript ? 'rotate-180' : ''}`}
            />
          </button>

          <AnimatePresence>
            {showTranscript && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="flex-1 w-full overflow-hidden"
              >
                <div
                  className="h-full overflow-y-auto px-4 py-2 space-y-2.5"
                  style={{ maxHeight: currentDraft ? '25vh' : '40vh' }}
                >
                  {messages.length === 0 && !tentativeTranscript && (
                    <div className="text-center py-6">
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {isConnected
                          ? 'Just start speaking...'
                          : isConnecting
                          ? 'Getting ready...'
                          : 'Voice mode is off'}
                      </p>
                    </div>
                  )}

                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] px-3 py-1.5 rounded-2xl text-sm ${
                          msg.isToolAction
                            ? 'border'
                            : msg.role === 'user'
                            ? 'border'
                            : 'border'
                        }`}
                        style={{
                          borderColor: msg.isToolAction
                            ? 'rgba(168,85,247,0.3)'
                            : msg.role === 'user'
                            ? 'rgba(6,182,212,0.3)'
                            : 'var(--border-subtle)',
                          color: msg.isToolAction
                            ? 'rgb(192,132,252)'
                            : 'var(--text-primary)',
                          background: msg.isToolAction
                            ? 'rgba(168,85,247,0.08)'
                            : msg.role === 'user'
                            ? 'rgba(6,182,212,0.08)'
                            : 'var(--bg-elevated)',
                        }}
                      >
                        <p className="leading-relaxed">{msg.content}</p>
                      </div>
                    </motion.div>
                  ))}

                  {/* Tentative transcript */}
                  {tentativeTranscript?.trim() && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex justify-end"
                    >
                      <div
                        className="max-w-[85%] px-3 py-1.5 rounded-2xl text-sm border"
                        style={{
                          borderColor: 'rgba(6,182,212,0.2)',
                          background: 'rgba(6,182,212,0.05)',
                        }}
                      >
                        <p className="italic" style={{ color: 'rgba(6,182,212,0.7)' }}>
                          {tentativeTranscript}...
                        </p>
                      </div>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Draft Card */}
        <AnimatePresence>
          {currentDraft && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="w-full px-4 py-2 flex-shrink-0"
            >
              <DraftCard
                draft={currentDraft}
                thread={thread}
                userEmail={user?.email}
                onSend={handleSendDraft}
                onSaveDraft={onSaveDraft ? handleSaveDraft : undefined}
                onDiscard={handleDiscardDraft}
                onDraftChange={handleDraftChange}
                isSending={isSending}
                isSaving={isSaving}
                isDeleting={isDeleting}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom controls - minimal, on-brand */}
      <div
        className="flex items-center justify-center gap-3 px-4 py-3 flex-shrink-0"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        {isConnected && (
          <>
            {/* Mute toggle */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                // Toggle mic mute via the conversation API
                if (conversation.status === 'connected') {
                  // @ts-ignore - setMicMuted exists at runtime
                  conversation.setMicMuted?.(!conversation.micMuted);
                }
              }}
              className="p-2.5 rounded-full transition-colors"
              style={{
                background: conversation.micMuted ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
                color: conversation.micMuted ? 'rgb(248,113,113)' : 'var(--text-secondary)',
              }}
              title={conversation.micMuted ? 'Unmute' : 'Mute'}
            >
              {conversation.micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </motion.button>

            {/* Type a message */}
            <TextInputButton conversation={conversation} />

            {/* End voice mode */}
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                endSession();
                onExitVoiceMode();
              }}
              className="px-4 py-2 rounded-full text-xs font-medium transition-colors"
              style={{
                background: 'rgba(255,255,255,0.05)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              End
            </motion.button>
          </>
        )}

        {!isConnected && !isConnecting && (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={startSession}
            className="px-5 py-2.5 rounded-full text-sm font-medium text-white transition-colors"
            style={{
              background: 'linear-gradient(135deg, rgb(168,85,247), rgb(6,182,212))',
            }}
          >
            Reconnect
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================
// TEXT INPUT (for typing during voice session)
// ============================================================

function TextInputButton({ conversation }: { conversation: any }) {
  const [showInput, setShowInput] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showInput) inputRef.current?.focus();
  }, [showInput]);

  const handleSend = () => {
    if (!text.trim() || conversation.status !== 'connected') return;
    conversation.sendUserMessage(text.trim());
    setText('');
    setShowInput(false);
  };

  if (!showInput) {
    return (
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={() => setShowInput(true)}
        className="p-2.5 rounded-full transition-colors"
        style={{
          background: 'rgba(255,255,255,0.05)',
          color: 'var(--text-secondary)',
        }}
        title="Type a message"
      >
        <Keyboard className="w-5 h-5" />
      </motion.button>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-1 max-w-xs">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        placeholder="Type a message..."
        className="flex-1 px-3 py-2 rounded-full text-sm border focus:outline-none focus:ring-1"
        style={{
          background: 'rgba(255,255,255,0.05)',
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-primary)',
        }}
      />
      <button
        onClick={handleSend}
        disabled={!text.trim()}
        className="p-2 rounded-full text-white disabled:opacity-30 transition-colors"
        style={{ background: 'linear-gradient(135deg, rgb(168,85,247), rgb(6,182,212))' }}
      >
        <Send className="w-4 h-4" />
      </button>
      <button
        onClick={() => { setShowInput(false); setText(''); }}
        className="p-2 rounded-full hover:bg-white/5 transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
