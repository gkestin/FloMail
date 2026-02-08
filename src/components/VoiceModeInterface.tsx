'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic,
  MicOff,
  Loader2,
  X,
  AlertCircle,
  Send,
  Keyboard,
  ArrowRight,
  Pause,
  Play,
} from 'lucide-react';
import { useConversation } from '@elevenlabs/react';
import { DraftCard } from './DraftCard';
import { EmailThread, EmailDraft, AIProvider, AIDraftingPreferences } from '@/types';
import { buildDraftFromToolCall } from '@/lib/agent-tools';
import { buildVoiceAgentPrompt, extractTextFromHtml } from '@/lib/voice-agent';
import { VoiceSoundEffects } from '@/lib/voice-agent';
import { useAuth } from '@/contexts/AuthContext';
import { MailFolder } from './InboxList';
import {
  generateSessionId,
  loadVoiceChat,
  saveVoiceChat,
  segmentMessagesByThread,
  PersistedVoiceMessage,
} from '@/lib/voice-chat-persistence';

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
  isContextSwitch?: boolean;
  _threadId?: string; // Which thread this message belongs to (for segmentation)
  isHistory?: boolean; // Loaded from Firestore (not from current session)
  isSessionDivider?: boolean; // Visual divider between sessions
  sessionDate?: string; // Human-readable date for session dividers
}

type VoiceStatus = 'disconnected' | 'connecting' | 'listening' | 'speaking' | 'processing' | 'paused';

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
  onPreviousEmail?: () => void;
  onNextEmail?: () => void;
  onGoToInbox?: () => void;
  onExitVoiceMode: () => void;
  onVoiceHistoryChange?: (threadId: string, hasHistory: boolean) => void;
}

// ============================================================
// ANIMATED STATUS BAR — thin gradient line with mode-aware animation
// ============================================================

function StatusBar({ status }: { status: VoiceStatus }) {
  const isActive = status !== 'disconnected';

  // Color configs per mode
  const colors: Record<VoiceStatus, { from: string; via: string; to: string }> = {
    disconnected: { from: 'rgb(75,85,99)', via: 'rgb(107,114,128)', to: 'rgb(75,85,99)' },
    connecting: { from: 'rgb(168,85,247)', via: 'rgb(139,92,246)', to: 'rgb(168,85,247)' },
    listening: { from: 'rgba(6,182,212,0.3)', via: 'rgb(6,182,212)', to: 'rgba(6,182,212,0.3)' },
    speaking: { from: 'rgb(168,85,247)', via: 'rgb(6,182,212)', to: 'rgb(168,85,247)' },
    processing: { from: 'rgb(168,85,247)', via: 'rgb(251,191,36)', to: 'rgb(168,85,247)' },
    paused: { from: 'rgb(107,114,128)', via: 'rgb(156,163,175)', to: 'rgb(107,114,128)' },
  };

  const c = colors[status];
  const gradient = `linear-gradient(90deg, ${c.from} 0%, ${c.via} 50%, ${c.to} 100%)`;

  const speed = status === 'processing' ? 1.2 : status === 'speaking' ? 2 : 3;

  return (
    <div className="h-[2px] w-full relative overflow-hidden">
      {/* Base bar */}
      <motion.div
        className="absolute inset-0"
        animate={{
          opacity: isActive ? [0.5, 1, 0.5] : 0.2,
        }}
        transition={{
          opacity: { duration: speed, repeat: Infinity, ease: 'easeInOut' },
        }}
        style={{ background: gradient }}
      />
      {/* Scanning highlight */}
      {isActive && (
        <motion.div
          className="absolute inset-y-0 w-1/4"
          animate={{ left: ['-25%', '100%'] }}
          transition={{
            duration: speed * 0.8,
            repeat: Infinity,
            ease: 'linear',
          }}
          style={{
            background: `linear-gradient(90deg, transparent, ${c.via}, transparent)`,
            opacity: 0.8,
          }}
        />
      )}
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
  onPreviousEmail,
  onNextEmail,
  onGoToInbox,
  onExitVoiceMode,
  onVoiceHistoryChange,
}: VoiceModeInterfaceProps) {
  const { user, getAccessToken } = useAuth();

  // State
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [tentativeTranscript, setTentativeTranscript] = useState('');
  const [currentDraft, setCurrentDraft] = useState<EmailDraft | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [processingTool, setProcessingTool] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [inputVolume, setInputVolume] = useState(0);
  const [outputVolume, setOutputVolume] = useState(0);

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const soundsRef = useRef<VoiceSoundEffects>(new VoiceSoundEffects());
  const volumeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const hasAutoStarted = useRef(false);
  const prevThreadIdRef = useRef<string | undefined>(thread?.id);

  // Session tracking for persistence
  const sessionIdRef = useRef(generateSessionId());
  const initialThreadIdRef = useRef<string | undefined>(thread?.id);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedCountRef = useRef(0);
  const historyLoadedForRef = useRef<string | null>(null);
  const saveCurrentSessionRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Stale-closure protection — refs for values accessed inside tool handlers.
  // useConversation holds the initial clientTools reference and doesn't update,
  // so ALL values accessed inside handlers must go through refs.
  const threadRef = useRef(thread);
  const currentDraftRef = useRef(currentDraft);
  const onArchiveRef = useRef(onArchive);
  const onMoveToInboxRef = useRef(onMoveToInbox);
  const onStarRef = useRef(onStar);
  const onUnstarRef = useRef(onUnstar);
  const onSnoozeRef = useRef(onSnooze);
  const onPreviousEmailRef = useRef(onPreviousEmail);
  const onNextEmailRef = useRef(onNextEmail);
  const onGoToInboxRef = useRef(onGoToInbox);
  const onDraftCreatedRef = useRef(onDraftCreated);
  const onSendEmailRef = useRef(onSendEmail);
  useEffect(() => { threadRef.current = thread; }, [thread]);
  useEffect(() => { currentDraftRef.current = currentDraft; }, [currentDraft]);
  useEffect(() => { onArchiveRef.current = onArchive; }, [onArchive]);
  useEffect(() => { onMoveToInboxRef.current = onMoveToInbox; }, [onMoveToInbox]);
  useEffect(() => { onStarRef.current = onStar; }, [onStar]);
  useEffect(() => { onUnstarRef.current = onUnstar; }, [onUnstar]);
  useEffect(() => { onSnoozeRef.current = onSnooze; }, [onSnooze]);
  useEffect(() => { onPreviousEmailRef.current = onPreviousEmail; }, [onPreviousEmail]);
  useEffect(() => { onNextEmailRef.current = onNextEmail; }, [onNextEmail]);
  useEffect(() => { onGoToInboxRef.current = onGoToInbox; }, [onGoToInbox]);
  useEffect(() => { onDraftCreatedRef.current = onDraftCreated; }, [onDraftCreated]);
  useEffect(() => { onSendEmailRef.current = onSendEmail; }, [onSendEmail]);

  // Build the dynamic prompt for this thread
  const voicePrompt = useMemo(
    () => buildVoiceAgentPrompt(thread, folder, draftingPreferences),
    [thread?.id, folder, draftingPreferences]
  );

  // ============================================================
  // CLIENT TOOL HANDLERS
  // ============================================================

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
        _threadId: threadRef.current?.id,
      },
    ]);
  }, []);

  const clientTools = useMemo(
    () => ({
      // ── Draft ────────────────────────────────────────────
      prepare_draft: async (params: any) => {
        setProcessingTool('Drafting...');
        soundsRef.current.playDraftReady();
        const draft = buildDraftFromToolCall(params, threadRef.current, user?.email);

        // Clean draft transition: clear → re-key → set new
        setCurrentDraft(null);
        setDraftKey((k) => k + 1);
        requestAnimationFrame(() => {
          setCurrentDraft(draft);
          onDraftCreatedRef.current?.(draft);
        });

        addToolMessage(
          'prepare_draft',
          `Draft ${draft.type === 'reply' ? 'reply' : draft.type === 'forward' ? 'forward' : 'email'} prepared.`
        );
        setProcessingTool(null);
        return `Draft prepared. Type: ${draft.type}, To: ${draft.to.join(', ')}, Subject: ${draft.subject}. The draft is now displayed to the user for review.`;
      },

      send_email: async (params: any) => {
        const draft = currentDraftRef.current;
        if (!draft) return 'No draft to send.';
        setProcessingTool('Sending...');
        soundsRef.current.playSend();
        setIsSending(true);
        try {
          await onSendEmailRef.current?.(draft);
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

      // ── Thread actions ───────────────────────────────────
      archive_email: async () => {
        setProcessingTool('Archiving...');
        soundsRef.current.playSend();
        onArchiveRef.current?.();
        addToolMessage('archive_email', 'Email archived.');
        setProcessingTool(null);
        return 'Email archived. The next email is now loading.';
      },

      move_to_inbox: async () => {
        setProcessingTool('Moving...');
        soundsRef.current.playToolStart();
        onMoveToInboxRef.current?.();
        addToolMessage('move_to_inbox', 'Moved to inbox.');
        setProcessingTool(null);
        return 'Email moved to inbox.';
      },

      star_email: async () => {
        soundsRef.current.playToolStart();
        onStarRef.current?.();
        addToolMessage('star_email', 'Email starred.');
        return 'Email starred.';
      },

      unstar_email: async () => {
        soundsRef.current.playToolStart();
        onUnstarRef.current?.();
        addToolMessage('unstar_email', 'Star removed.');
        return 'Star removed.';
      },

      snooze_email: async (params: any) => {
        if (!onSnoozeRef.current) return 'Snooze not available.';
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
          await onSnoozeRef.current!(snoozeDate);
          addToolMessage('snooze_email', `Snoozed until ${snoozeDate.toLocaleString()}.`);
          return `Email snoozed until ${snoozeDate.toLocaleString()}.`;
        } catch (err: any) {
          soundsRef.current.playError();
          return `Failed to snooze: ${err.message}`;
        } finally {
          setProcessingTool(null);
        }
      },

      // ── Navigation ───────────────────────────────────────
      go_to_previous_email: async () => {
        soundsRef.current.playToolStart();
        addToolMessage('go_to_previous_email', 'Going to previous email...');
        onPreviousEmailRef.current?.();
        return 'Navigating to previous email.';
      },

      go_to_next_email: async () => {
        soundsRef.current.playToolStart();
        addToolMessage('go_to_next_email', 'Moving to next email...');
        onNextEmailRef.current?.();
        return 'Navigating to next email.';
      },

      go_to_inbox: async () => {
        soundsRef.current.playToolStart();
        addToolMessage('go_to_inbox', 'Returning to inbox...');
        onGoToInboxRef.current?.();
        return 'Returning to inbox.';
      },

      // ── Search & Browse ──────────────────────────────────
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

          // Build result text — include Tavily AI summary + top results
          let resultText = '';
          if (data.answer) {
            resultText = `Summary: ${data.answer}\n\n`;
          }
          const snippets = data.results
            ?.slice(0, 3)
            .map((r: any) => `${r.title}: ${r.snippet?.slice(0, 200) || r.content?.slice(0, 200) || ''}`)
            .join('\n');
          resultText += snippets || 'No results found.';
          return resultText || 'No results found.';
        } catch {
          return 'Search failed.';
        } finally {
          setProcessingTool(null);
        }
      },

      browse_url: async (params: any) => {
        setProcessingTool('Fetching page...');
        soundsRef.current.playToolStart();
        addToolMessage('browse_url', 'Opening link...');
        try {
          const res = await fetch('/api/browse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: params.url }),
          });
          if (!res.ok) return 'Failed to fetch URL.';
          const data = await res.json();
          return (data.content || '').slice(0, 2000) || 'No content found.';
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
          const maxResults = params.max_results ? parseInt(params.max_results) : 5;
          const res = await fetch('/api/gmail/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: params.query, accessToken: token, maxResults }),
          });
          if (!res.ok) return 'Email search failed.';
          const data = await res.json();
          if (!data.threads?.length) return `No emails found matching: "${params.query}"`;
          // Return the full formatted results with body content so the agent can verify matches
          return data.formatted || 'No results found.';
        } catch {
          return 'Email search failed. Please try again.';
        } finally {
          setProcessingTool(null);
        }
      },

      // ── Full email content (voice-only) ──────────────────
      get_email_content: async (params: any) => {
        const currentThread = threadRef.current;
        if (!currentThread) return 'No email thread is currently open.';

        setProcessingTool('Reading email...');
        soundsRef.current.playToolStart();

        let targetMessages = currentThread.messages;
        const msgNum = params.message_number;

        if (msgNum === 'last') {
          targetMessages = [currentThread.messages[currentThread.messages.length - 1]];
        } else if (msgNum && !isNaN(parseInt(msgNum))) {
          const idx = parseInt(msgNum) - 1;
          if (idx >= 0 && idx < currentThread.messages.length) {
            targetMessages = [currentThread.messages[idx]];
          }
        }

        const content = targetMessages
          .map((msg, i) => {
            let bodyText = msg.body || '';
            if (msg.bodyHtml) {
              const htmlText = extractTextFromHtml(msg.bodyHtml);
              if (htmlText.length > bodyText.length * 1.5 || bodyText.length < 50) {
                bodyText = htmlText;
              }
            }
            return `[Message ${i + 1}] From: ${msg.from.name || msg.from.email}\nDate: ${new Date(msg.date).toLocaleString()}\n\n${bodyText}`;
          })
          .join('\n\n---\n\n');

        addToolMessage('get_email_content', 'Reading full email content...');
        setProcessingTool(null);
        return content || 'No content found.';
      },
    }),
    // All callback props and thread/draft are accessed via refs — clientTools stays stable
    // so the ElevenLabs SDK always calls the latest handlers
    [user?.email, getAccessToken, addToolMessage]
  );

  // ============================================================
  // ELEVENLABS CONVERSATION
  // ============================================================

  // Suppress unhandled SDK errors (e.g. malformed error events from server)
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
        setMessages((prev) => {
          const newMsg: VoiceMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: source === 'user' ? 'user' : 'assistant',
            content,
            timestamp: new Date(),
            _threadId: threadRef.current?.id,
          };

          // FIX: Message ordering — when a user message arrives, ensure it
          // appears before any recent tool-action messages that the SDK may
          // have delivered out of order (tool call firing before transcript).
          if (source === 'user') {
            const now = Date.now();
            let insertIdx = prev.length;
            // Walk backwards to find tool messages from the last 3 seconds
            for (let i = prev.length - 1; i >= 0; i--) {
              if (prev[i].isToolAction && now - prev[i].timestamp.getTime() < 3000) {
                insertIdx = i;
              } else {
                break;
              }
            }
            if (insertIdx < prev.length) {
              // Insert user message before the trailing tool messages
              return [...prev.slice(0, insertIdx), newMsg, ...prev.slice(insertIdx)];
            }
          }

          return [...prev, newMsg];
        });
      }
    },
    onError: (err: any) => {
      const errorMessage = typeof err === 'string' ? err : err?.message || 'Unknown error';
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
    setIsPaused(false);
    soundsRef.current.playDisconnect();

    // Save conversation before disconnecting
    saveCurrentSessionRef.current();

    if (conversation.status === 'connected') {
      await conversation.endSession();
    }
  }, [conversation, stopBrowserRecognition]);

  // ============================================================
  // PAUSE / RESUME
  // ============================================================

  const pauseConversation = useCallback(() => {
    if (conversation.status !== 'connected') return;
    setIsPaused(true);
    // Mute mic so agent stops hearing us
    // @ts-ignore - setMicMuted exists at runtime
    conversation.setMicMuted?.(true);
    // Silence agent output so it stops talking
    // @ts-ignore - setVolume exists at runtime
    conversation.setVolume?.({ volume: 0 });
    stopBrowserRecognition();
    setTentativeTranscript('');
  }, [conversation, stopBrowserRecognition]);

  const resumeConversation = useCallback(() => {
    if (conversation.status !== 'connected') return;
    setIsPaused(false);
    // Unmute mic
    // @ts-ignore - setMicMuted exists at runtime
    conversation.setMicMuted?.(false);
    // Restore agent output volume
    // @ts-ignore - setVolume exists at runtime
    conversation.setVolume?.({ volume: 1 });
    startBrowserRecognition();
  }, [conversation, startBrowserRecognition]);

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
  // THREAD CHANGE DETECTION — update context when navigating
  // ============================================================

  useEffect(() => {
    if (!thread?.id || thread.id === prevThreadIdRef.current) return;

    const wasFirstThread = !prevThreadIdRef.current;
    prevThreadIdRef.current = thread.id;

    // Don't add divider for the initial thread
    if (wasFirstThread) return;

    // Save before switching threads (fire-and-forget)
    saveCurrentSessionRef.current();

    // Clear old draft
    setCurrentDraft(null);

    // Load history for the new thread
    loadHistoryForThread(thread.id);

    // Add a visual context-switch divider in the transcript
    setMessages((prev) => [
      ...prev,
      {
        id: `switch-${Date.now()}`,
        role: 'assistant',
        content: `Now viewing: ${thread.subject}`,
        timestamp: new Date(),
        isContextSwitch: true,
        isToolAction: true,
        toolName: 'context_switch',
        _threadId: thread.id, // Tag with the NEW thread
      },
    ]);

    // Send the updated email context to the ElevenLabs agent
    if (conversation.status === 'connected') {
      const newPrompt = buildVoiceAgentPrompt(thread, folder, draftingPreferences);
      conversation.sendContextualUpdate(newPrompt);
    }
  }, [thread?.id, thread?.subject, folder, draftingPreferences, conversation.status]);

  // ============================================================
  // VOICE CHAT PERSISTENCE — auto-save & load
  // ============================================================

  /**
   * Save current session messages, segmented by thread.
   * Only saves non-history messages (new ones from this session).
   */
  const saveCurrentSession = useCallback(async () => {
    if (!user?.uid) return;

    // Get only messages from this session (not loaded history)
    const sessionMessages = messages.filter((m) => !m.isHistory && !m.isSessionDivider);
    if (sessionMessages.length === 0) return;
    if (sessionMessages.length === lastSavedCountRef.current) return; // Nothing new

    const segments = segmentMessagesByThread(
      sessionMessages,
      initialThreadIdRef.current,
      sessionIdRef.current
    );

    // Save each thread's segment
    const savePromises: Promise<void>[] = [];
    segments.forEach((msgs, threadId) => {
      if (msgs.length > 0) {
        savePromises.push(
          saveVoiceChat(user.uid, threadId, msgs).then(() => {
            onVoiceHistoryChange?.(threadId, true);
          })
        );
      }
    });

    await Promise.all(savePromises);
    lastSavedCountRef.current = sessionMessages.length;
  }, [user?.uid, messages, onVoiceHistoryChange]);

  // Keep ref in sync so endSession (defined earlier) can call it
  useEffect(() => { saveCurrentSessionRef.current = saveCurrentSession; }, [saveCurrentSession]);

  /**
   * Load voice history for a thread and prepend to messages.
   */
  const loadHistoryForThread = useCallback(
    async (threadId: string) => {
      if (!user?.uid || historyLoadedForRef.current === threadId) return;
      historyLoadedForRef.current = threadId;

      const history = await loadVoiceChat(user.uid, threadId);
      if (history.length === 0) return;

      // Group by sessionId for session dividers
      const sessionGroups: { sessionId: string; date: Date; msgs: PersistedVoiceMessage[] }[] = [];
      let currentGroup: (typeof sessionGroups)[0] | null = null;

      for (const msg of history) {
        if (!currentGroup || currentGroup.sessionId !== msg.sessionId) {
          currentGroup = { sessionId: msg.sessionId, date: new Date(msg.timestamp), msgs: [] };
          sessionGroups.push(currentGroup);
        }
        currentGroup.msgs.push(msg);
      }

      // Convert to VoiceMessage format with session dividers
      const historyMessages: VoiceMessage[] = [];

      for (const group of sessionGroups) {
        // Add session divider
        const dateStr = group.date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
        historyMessages.push({
          id: `divider-${group.sessionId}`,
          role: 'assistant',
          content: dateStr,
          timestamp: group.date,
          isSessionDivider: true,
          isHistory: true,
          sessionDate: dateStr,
        });

        // Add the session's messages
        for (const pm of group.msgs) {
          historyMessages.push({
            id: pm.id,
            role: pm.role,
            content: pm.content,
            timestamp: new Date(pm.timestamp),
            isToolAction: pm.isToolAction,
            toolName: pm.toolName,
            isHistory: true,
            _threadId: threadId,
          });
        }
      }

      if (historyMessages.length > 0) {
        // Add a "current session" divider
        historyMessages.push({
          id: `divider-current-${Date.now()}`,
          role: 'assistant',
          content: 'Now',
          timestamp: new Date(),
          isSessionDivider: true,
          sessionDate: 'Now',
        });

        setMessages((prev) => {
          // Remove any existing history (in case of reload)
          const nonHistory = prev.filter((m) => !m.isHistory && !m.isSessionDivider);
          return [...historyMessages, ...nonHistory];
        });
      }
    },
    [user?.uid]
  );

  // Load history when component mounts or thread changes
  useEffect(() => {
    if (thread?.id) {
      loadHistoryForThread(thread.id);
    }
  }, [thread?.id, loadHistoryForThread]);

  // Auto-save every 30 seconds during active session
  useEffect(() => {
    if (conversation.status === 'connected') {
      saveTimerRef.current = setInterval(() => {
        saveCurrentSession();
      }, 30000);
    }
    return () => {
      if (saveTimerRef.current) {
        clearInterval(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [conversation.status, saveCurrentSession]);

  // Save on unmount (session end)
  useEffect(() => {
    return () => {
      // Fire-and-forget save on cleanup
      saveCurrentSession();
    };
  }, [saveCurrentSession]);

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
  // COMPUTED STATUS
  // ============================================================

  const isConnected = conversation.status === 'connected';
  const isConnecting = conversation.status === 'connecting' || isInitializing;

  const voiceStatus: VoiceStatus = isConnecting
    ? 'connecting'
    : !isConnected
    ? 'disconnected'
    : isPaused
    ? 'paused'
    : processingTool
    ? 'processing'
    : conversation.isSpeaking
    ? 'speaking'
    : 'listening';

  const statusLabel =
    voiceStatus === 'connecting'
      ? 'Connecting...'
      : voiceStatus === 'disconnected'
      ? 'Disconnected'
      : voiceStatus === 'paused'
      ? 'Paused'
      : processingTool
      ? processingTool
      : conversation.isSpeaking
      ? 'Speaking...'
      : 'Listening...';

  const statusColor =
    voiceStatus === 'paused'
      ? 'rgb(156,163,175)'
      : voiceStatus === 'processing'
      ? 'rgb(192,132,252)'
      : voiceStatus === 'speaking'
      ? 'rgb(168,85,247)'
      : voiceStatus === 'listening'
      ? 'rgb(6,182,212)'
      : 'var(--text-muted)';

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col h-full"
      style={{ background: 'var(--bg-primary)' }}
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Animated status dot */}
          <motion.div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            animate={{
              scale:
                voiceStatus === 'paused'
                  ? 1
                  : voiceStatus === 'listening'
                  ? [1, 1.3, 1]
                  : voiceStatus === 'speaking'
                  ? [1, 1.2, 1]
                  : voiceStatus === 'processing'
                  ? [1, 1.4, 1]
                  : 1,
              opacity: voiceStatus === 'disconnected' ? 0.4 : voiceStatus === 'paused' ? 0.6 : 1,
            }}
            transition={{
              scale: {
                duration: voiceStatus === 'processing' ? 0.8 : voiceStatus === 'speaking' ? 0.8 : 2,
                repeat: Infinity,
                ease: 'easeInOut',
              },
            }}
            style={{
              background:
                voiceStatus === 'paused'
                  ? 'rgb(156,163,175)'
                  : voiceStatus === 'listening'
                  ? 'rgb(6,182,212)'
                  : voiceStatus === 'speaking'
                  ? 'rgb(168,85,247)'
                  : voiceStatus === 'processing'
                  ? 'rgb(251,191,36)'
                  : voiceStatus === 'connecting'
                  ? 'rgb(168,85,247)'
                  : 'rgb(107,114,128)',
              boxShadow:
                voiceStatus === 'disconnected' || voiceStatus === 'paused'
                  ? 'none'
                  : `0 0 8px ${
                      voiceStatus === 'listening'
                        ? 'rgba(6,182,212,0.5)'
                        : voiceStatus === 'speaking'
                        ? 'rgba(168,85,247,0.5)'
                        : voiceStatus === 'processing'
                        ? 'rgba(251,191,36,0.5)'
                        : 'rgba(168,85,247,0.3)'
                    }`,
              transition: 'background 0.6s ease, box-shadow 0.6s ease',
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

      {/* ── Error banner ───────────────────────────────────── */}
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

      {/* ── Transcript (fills all available space) ─────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
        {messages.length === 0 && !tentativeTranscript && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {voiceStatus === 'listening'
                ? 'Just start speaking...'
                : voiceStatus === 'connecting'
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
            className={`flex ${
              msg.isSessionDivider || msg.isContextSwitch
                ? 'justify-center'
                : msg.role === 'user'
                ? 'justify-end'
                : 'justify-start'
            }`}
          >
            {msg.isSessionDivider ? (
              /* Session divider (history) */
              <div className="flex items-center gap-3 py-1.5 w-full">
                <div className="h-px flex-1" style={{ background: 'var(--border-subtle)', opacity: 0.5 }} />
                <span
                  className="text-[11px] font-medium px-2"
                  style={{ color: 'var(--text-muted)', opacity: 0.7 }}
                >
                  {msg.sessionDate}
                </span>
                <div className="h-px flex-1" style={{ background: 'var(--border-subtle)', opacity: 0.5 }} />
              </div>
            ) : msg.isContextSwitch ? (
              /* Context-switch divider */
              <div className="flex items-center gap-2 py-1 w-full">
                <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
                <div
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full flex-shrink-0"
                  style={{
                    background: 'rgba(168,85,247,0.1)',
                    border: '1px solid rgba(168,85,247,0.2)',
                  }}
                >
                  <ArrowRight className="w-3 h-3 text-purple-400" />
                  <span className="text-xs text-purple-300 truncate max-w-[200px]">
                    {msg.content}
                  </span>
                </div>
                <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
              </div>
            ) : (
              /* Normal message bubble */
              <div
                className={`max-w-[85%] px-3 py-1.5 rounded-2xl text-sm border ${
                  msg.isHistory ? 'opacity-60' : ''
                }`}
                style={{
                  borderColor: msg.isToolAction
                    ? 'rgba(168,85,247,0.3)'
                    : msg.role === 'user'
                    ? 'rgba(6,182,212,0.3)'
                    : 'var(--border-subtle)',
                  color: msg.isToolAction ? 'rgb(192,132,252)' : 'var(--text-primary)',
                  background: msg.isToolAction
                    ? 'rgba(168,85,247,0.08)'
                    : msg.role === 'user'
                    ? 'rgba(6,182,212,0.08)'
                    : 'var(--bg-elevated)',
                }}
              >
                <p className="leading-relaxed">{msg.content}</p>
              </div>
            )}
          </motion.div>
        ))}

        {/* Tentative transcript */}
        {tentativeTranscript?.trim() && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-end">
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

      {/* ── Draft Card ─────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {currentDraft && (
          <motion.div
            key={`draft-${draftKey}`}
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

      {/* ── Bottom section: ambient glow + status bar + controls */}
      <div className="flex-shrink-0 relative">
        {/* Ambient glow — subtle upward gradient matching current mode */}
        <motion.div
          className="absolute inset-x-0 bottom-full h-12 pointer-events-none"
          animate={{
            opacity: isConnected ? 1 : 0,
          }}
          transition={{ duration: 0.8 }}
          style={{
            background: `linear-gradient(to top, ${
              voiceStatus === 'paused'
                ? 'transparent'
                : voiceStatus === 'listening'
                ? 'rgba(6,182,212,0.06)'
                : voiceStatus === 'speaking'
                ? 'rgba(168,85,247,0.06)'
                : voiceStatus === 'processing'
                ? 'rgba(251,191,36,0.04)'
                : 'transparent'
            } 0%, transparent 100%)`,
            transition: 'background 0.8s ease',
          }}
        />

        {/* Animated status bar */}
        <StatusBar status={voiceStatus} />

        {/* Controls */}
        <div
          className="flex items-center px-4 py-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          {isConnected && (
            <>
              <div className="flex items-center gap-2">
                {/* Pause / Resume toggle */}
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={isPaused ? resumeConversation : pauseConversation}
                  className="p-2.5 rounded-full transition-colors"
                  style={{
                    background: isPaused
                      ? 'rgba(6,182,212,0.15)'
                      : 'rgba(255,255,255,0.05)',
                    color: isPaused ? 'rgb(6,182,212)' : 'var(--text-secondary)',
                  }}
                  title={isPaused ? 'Resume' : 'Pause'}
                >
                  {isPaused ? (
                    <Play className="w-5 h-5" />
                  ) : (
                    <Pause className="w-5 h-5" />
                  )}
                </motion.button>

                {/* Mute toggle (only when not paused) */}
                {!isPaused && (
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                      if (conversation.status === 'connected') {
                        // @ts-ignore - setMicMuted exists at runtime
                        conversation.setMicMuted?.(!conversation.micMuted);
                      }
                    }}
                    className="p-2.5 rounded-full transition-colors"
                    style={{
                      background: conversation.micMuted
                        ? 'rgba(239,68,68,0.15)'
                        : 'rgba(255,255,255,0.05)',
                      color: conversation.micMuted ? 'rgb(248,113,113)' : 'var(--text-secondary)',
                    }}
                    title={conversation.micMuted ? 'Unmute' : 'Mute'}
                  >
                    {conversation.micMuted ? (
                      <MicOff className="w-5 h-5" />
                    ) : (
                      <Mic className="w-5 h-5" />
                    )}
                  </motion.button>
                )}

                {/* Type a message */}
                {!isPaused && <TextInputButton conversation={conversation} />}
              </div>

              {/* Status label — centered */}
              <motion.span
                className="flex-1 text-center text-xs font-medium"
                animate={{ opacity: 0.7 }}
                style={{ color: statusColor, transition: 'color 0.5s ease' }}
              >
                {statusLabel}
              </motion.span>

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
              className="w-full px-5 py-2.5 rounded-full text-sm font-medium text-white transition-colors"
              style={{
                background: 'linear-gradient(135deg, rgb(168,85,247), rgb(6,182,212))',
              }}
            >
              Reconnect
            </motion.button>
          )}

          {isConnecting && (
            <div className="w-full flex items-center justify-center gap-2 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
              <span className="text-sm text-purple-300">Connecting...</span>
            </div>
          )}
        </div>
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
        onClick={() => {
          setShowInput(false);
          setText('');
        }}
        className="p-2 rounded-full hover:bg-white/5 transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
