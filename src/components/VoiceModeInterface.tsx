'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  X,
  AlertCircle,
  Send,
  Keyboard,
  ArrowRight,
  Pause,
  Play,
  Ghost,
  Trash2,
  Clock,
  Archive,
  ChevronDown,
  Mail,
} from 'lucide-react';
import { useConversation } from '@elevenlabs/react';
import { DraftCard } from './DraftCard';
import { EmailThread, EmailDraft, AIProvider, AIDraftingPreferences } from '@/types';
import { buildDraftFromToolCall } from '@/lib/agent-tools';
import { getDraftForThread } from '@/lib/gmail';
import { buildVoiceAgentPrompt, buildDynamicFirstMessage, extractTextFromHtml } from '@/lib/voice-agent';
import { VoiceSoundEffects } from '@/lib/voice-agent';
import { useAuth } from '@/contexts/AuthContext';
import { MailFolder } from './InboxList';
import {
  generateSessionId,
  loadVoiceChat,
  saveVoiceChat,
  clearVoiceChat,
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
  isSentConfirmation?: boolean; // Green "sent" feedback message
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
  voiceModeSettings?: {
    voiceId?: string;
    speed?: number;
    stability?: number;
    llmModel?: string;
  };
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
  voiceModeSettings,
}: VoiceModeInterfaceProps) {
  const { user, getAccessToken } = useAuth();

  // State
  const [messages, setMessages] = useState<VoiceMessage[]>([]);
  const [tentativeTranscript, setTentativeTranscript] = useState('');
  const [currentDraft, setCurrentDraft] = useState<EmailDraft | null>(null);
  const [sentDraft, setSentDraft] = useState<EmailDraft | null>(null);
  const [draftKey, setDraftKey] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [processingTool, setProcessingTool] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  // Note: isAgentSpeaking was previously used for mic muting (echo prevention).
  // Removed — WebRTC AEC handles echo, and muting killed interruptions.
  // Browser SpeechRecognition echo is handled via isSpeakingRef guard in onresult.
  const [inputVolume, setInputVolume] = useState(0);
  const [speechRecognitionWorking, setSpeechRecognitionWorking] = useState(false);
  const [isIncognito, setIsIncognito] = useState(false);
  const [collapsedHistory, setCollapsedHistory] = useState<VoiceMessage[]>([]);
  const [emailPreviewExpanded, setEmailPreviewExpanded] = useState(false);
  const isIncognitoRef = useRef(false);

  // Computed mic mute: only muted when paused.
  // Echo prevention is handled by WebRTC's built-in AEC (echoCancellation: true in SDK).
  // We do NOT mute during agent speech — this allows natural interruptions via server-side VAD.
  // Browser SpeechRecognition echo is handled separately (isSpeakingRef guard in onresult).
  const effectiveMicMuted = isPaused;

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const soundsRef = useRef<VoiceSoundEffects>(new VoiceSoundEffects());
  const volumeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const accumulatedFinalTranscriptRef = useRef('');
  const isSpeakingRef = useRef(false);
  const hasAutoStarted = useRef(false);
  const prevThreadIdRef = useRef<string | undefined>(thread?.id);

  // Session tracking for persistence
  const sessionIdRef = useRef(generateSessionId());
  const initialThreadIdRef = useRef<string | undefined>(thread?.id);
  // Tracks the last action that triggered a thread change (e.g., "snoozed email from X about Y")
  // so the thread-change contextual update can reference it accurately
  const lastNavigationActionRef = useRef<string | null>(null);
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
  useEffect(() => { isIncognitoRef.current = isIncognito; }, [isIncognito]);

  // Track whether the user has already discussed this thread (for opening behavior)
  const threadHasHistoryRef = useRef<Set<string>>(new Set());

  // Build the dynamic prompt and first message for this thread
  const isReturningToThread = thread?.id ? threadHasHistoryRef.current.has(thread.id) : false;
  const voicePrompt = useMemo(
    () => buildVoiceAgentPrompt(thread, folder, draftingPreferences, { isReturningToThread }),
    [thread?.id, folder, draftingPreferences, isReturningToThread]
  );
  const dynamicFirstMessage = useMemo(
    () => buildDynamicFirstMessage(thread, { isReturningToThread }),
    [thread?.id, isReturningToThread]
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

  // Handler for typed text input — adds user message to transcript and clears interim display
  const handleTextSend = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `typed-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'user' as const,
        content: text,
        timestamp: new Date(),
        _threadId: threadRef.current?.id,
      },
    ]);
    accumulatedFinalTranscriptRef.current = '';
    setTentativeTranscript('');
  }, []);


  // Helper to get brief thread context for action messages (e.g. "from John about Meeting")
  const getThreadContext = useCallback(() => {
    const t = threadRef.current;
    if (!t) return '';
    const lastMsg = t.messages?.[t.messages.length - 1];
    const sender = lastMsg?.from?.name || lastMsg?.from?.email?.split('@')[0] || '';
    const subject = t.subject?.replace(/^(Re|Fwd|Fw):\s*/gi, '').slice(0, 40) || '';
    if (sender && subject) return ` from ${sender} re "${subject}"`;
    if (sender) return ` from ${sender}`;
    if (subject) return ` re "${subject}"`;
    return '';
  }, []);

  const clientTools = useMemo(
    () => ({
      // ── Draft ────────────────────────────────────────────
      prepare_draft: async (params: any) => {
        setProcessingTool('Drafting...');
        soundsRef.current.playDraftReady();
        const draft = buildDraftFromToolCall(params, threadRef.current, user?.email);

        // Preserve gmailDraftId from existing draft (e.g. restored from Gmail)
        // so subsequent saves update the same Gmail draft instead of creating a new one
        const existingDraftId = currentDraftRef.current?.gmailDraftId;
        if (existingDraftId) draft.gmailDraftId = existingDraftId;

        // Clean draft transition: clear → re-key → set new (setTimeout ensures React commits the null state)
        setSentDraft(null); // Clear any previous sent preview
        setCurrentDraft(null);
        setDraftKey((k) => k + 1);
        setTimeout(() => {
          setCurrentDraft(draft);
          onDraftCreatedRef.current?.(draft);
        }, 0);

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
          // Collapse draft card into sent preview (keep it visible like non-voice mode)
          setSentDraft(draft);
          setCurrentDraft(null);
          setIsSending(false);
          setProcessingTool(null);
          addToolMessage('send_email', `Sent to ${draft.to?.[0] || 'recipient'}.`);
          return 'Email sent successfully. What would you like to do next?';
        } catch (err: any) {
          soundsRef.current.playError();
          setIsSending(false);
          setProcessingTool(null);
          return `Failed to send: ${err.message}`;
        }
      },

      // ── Thread actions ───────────────────────────────────
      archive_email: async () => {
        const ctx = getThreadContext();
        setProcessingTool('Archiving...');
        soundsRef.current.playSend();
        lastNavigationActionRef.current = `Archived the email${ctx}`;
        try {
          await onArchiveRef.current?.();
        } catch (err: any) {
          soundsRef.current.playError();
          setProcessingTool(null);
          lastNavigationActionRef.current = null;
          return `Failed to archive: ${err.message}`;
        }
        addToolMessage('archive_email', `Archived${ctx}.`);
        setProcessingTool(null);
        return 'Email archived. The next email is now loading.';
      },

      move_to_inbox: async () => {
        const ctx = getThreadContext();
        setProcessingTool('Moving...');
        soundsRef.current.playToolStart();
        try {
          await onMoveToInboxRef.current?.();
        } catch (err: any) {
          soundsRef.current.playError();
          setProcessingTool(null);
          return `Failed to move to inbox: ${err.message}`;
        }
        addToolMessage('move_to_inbox', `Moved to inbox${ctx}.`);
        setProcessingTool(null);
        return 'Email moved to inbox.';
      },

      star_email: async () => {
        const ctx = getThreadContext();
        soundsRef.current.playToolStart();
        try {
          await onStarRef.current?.();
        } catch (err: any) {
          soundsRef.current.playError();
          return `Failed to star: ${err.message}`;
        }
        addToolMessage('star_email', `Starred${ctx}.`);
        return 'Email starred.';
      },

      unstar_email: async () => {
        const ctx = getThreadContext();
        soundsRef.current.playToolStart();
        try {
          await onUnstarRef.current?.();
        } catch (err: any) {
          soundsRef.current.playError();
          return `Failed to unstar: ${err.message}`;
        }
        addToolMessage('unstar_email', `Unstarred${ctx}.`);
        return 'Star removed.';
      },

      snooze_email: async (params: any) => {
        if (!onSnoozeRef.current) return 'Snooze not available.';
        const ctx = getThreadContext();
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

        lastNavigationActionRef.current = `Snoozed the email${ctx} until ${snoozeDate.toLocaleString()}`;
        try {
          await onSnoozeRef.current!(snoozeDate);
          addToolMessage('snooze_email', `Snoozed${ctx} until ${snoozeDate.toLocaleString()}.`);
          return `Email snoozed until ${snoozeDate.toLocaleString()}.`;
        } catch (err: any) {
          soundsRef.current.playError();
          lastNavigationActionRef.current = null;
          return `Failed to snooze: ${err.message}`;
        } finally {
          setProcessingTool(null);
        }
      },

      // ── Navigation ───────────────────────────────────────
      go_to_previous_email: async () => {
        soundsRef.current.playToolStart();
        lastNavigationActionRef.current = `Navigated to previous email${getThreadContext() ? ' (was viewing' + getThreadContext() + ')' : ''}`;
        addToolMessage('go_to_previous_email', 'Going to previous email...');
        onPreviousEmailRef.current?.();
        return 'Navigating to previous email. Wait for the new email context before speaking about it.';
      },

      go_to_next_email: async () => {
        soundsRef.current.playToolStart();
        lastNavigationActionRef.current = `Navigated to next email${getThreadContext() ? ' (was viewing' + getThreadContext() + ')' : ''}`;
        addToolMessage('go_to_next_email', 'Moving to next email...');
        onNextEmailRef.current?.();
        return 'Navigating to next email. Wait for the new email context before speaking about it.';
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
        soundsRef.current.startProcessingLoop();
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
          soundsRef.current.stopProcessingLoop();
          setProcessingTool(null);
        }
      },

      browse_url: async (params: any) => {
        setProcessingTool('Fetching page...');
        soundsRef.current.startProcessingLoop();
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
          soundsRef.current.stopProcessingLoop();
          setProcessingTool(null);
        }
      },

      search_emails: async (params: any) => {
        setProcessingTool('Searching emails...');
        soundsRef.current.startProcessingLoop();
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
          soundsRef.current.stopProcessingLoop();
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
              // Primary: regex-based extraction
              const htmlText = extractTextFromHtml(msg.bodyHtml);

              // Fallback: DOM-based extraction (catches cases regex misses)
              let domText = '';
              if (typeof document !== 'undefined') {
                try {
                  const tmp = document.createElement('div');
                  tmp.innerHTML = msg.bodyHtml;
                  tmp.querySelectorAll('style, script, noscript, head').forEach(el => el.remove());
                  domText = (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
                } catch {}
              }

              // Use whichever extraction yielded more content
              const bestHtmlText = domText.length > htmlText.length ? domText : htmlText;

              if (bestHtmlText.length > bodyText.length * 1.2 || bodyText.length < 50) {
                bodyText = bestHtmlText;
              }
            }

            // If body is still suspiciously short but HTML exists, note it
            const seemsTruncated = bodyText.length < 30 && msg.bodyHtml && msg.bodyHtml.length > 200;

            return `[Message ${i + 1}] From: ${msg.from.name || msg.from.email}\nDate: ${new Date(msg.date).toLocaleString()}\n\n${bodyText}${seemsTruncated ? '\n\n[Note: This message may contain content in images or complex formatting that could not be extracted as text.]' : ''}`;
          })
          .join('\n\n---\n\n');

        addToolMessage('get_email_content', 'Reading full email content...');
        setProcessingTool(null);
        return content || 'No content found.';
      },

      // ── Draft content (for reading back verbatim) ──────────
      get_draft_content: async () => {
        const draft = currentDraftRef.current;
        if (!draft) return 'No draft currently exists.';

        setProcessingTool('Reading draft...');
        const bodyText = draft.body || '';
        const result = `To: ${draft.to.join(', ')}\nSubject: ${draft.subject}\n\n${bodyText}`;
        setProcessingTool(null);
        return result;
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
    micMuted: effectiveMicMuted,
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
      // Save conversation on unexpected disconnect (uses ref to avoid stale closure)
      saveCurrentSessionRef.current();
    },
    onMessage: ({ message, source }: any) => {
      if (source === 'user') {
        // ElevenLabs captured the full user transcript - clear browser interim display
        accumulatedFinalTranscriptRef.current = '';
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
        // Suppress agent messages while paused — the agent may still generate
        // text after the pause contextual update, but we don't show or record it
        if (source !== 'user' && isPausedRef.current) return;

        setMessages((prev) => {
          // Dedup: if SDK echoes a recently typed message, skip adding it again
          if (source === 'user') {
            const lastUserMsg = [...prev].reverse().find(m => m.role === 'user');
            if (lastUserMsg && lastUserMsg.content === content?.trim() &&
                Date.now() - lastUserMsg.timestamp.getTime() < 3000) {
              return prev;
            }
          }

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
    // Capture tentative_user_transcript events from ElevenLabs ASR
    // These arrive via onDebug since the SDK doesn't have a dedicated callback
    // This is the primary interim transcript source (works on mobile where browser SpeechRecognition fails)
    onDebug: (event: any) => {
      if (event?.type === 'tentative_user_transcript') {
        const text = event.tentative_user_transcription_event?.user_transcript;
        if (text?.trim()) {
          // ElevenLabs ASR is providing tentative transcripts — mark as working
          if (!speechRecognitionWorking) setSpeechRecognitionWorking(true);
          setTentativeTranscript(text.trim());
        }
      }
    },
  });

  // Sync isSpeaking ref for use in SpeechRecognition callback.
  // Also clear tentative transcript when agent starts speaking — any leftover
  // interim text is likely echo from the speakers, not the user.
  useEffect(() => {
    isSpeakingRef.current = conversation.isSpeaking ?? false;
    if (conversation.isSpeaking) {
      accumulatedFinalTranscriptRef.current = '';
      setTentativeTranscript('');
    }
  }, [conversation.isSpeaking]);

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

    // Track consecutive errors for backoff — reset on successful result
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    recognition.onresult = (event: any) => {
      // Working — reset error count and mark as functional
      consecutiveErrors = 0;
      setSpeechRecognitionWorking(true);

      // While agent is speaking, suppress interim transcripts to avoid echo.
      if (isSpeakingRef.current) return;

      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          accumulatedFinalTranscriptRef.current += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      const full = (accumulatedFinalTranscriptRef.current + interim).trim();
      if (full) {
        setTentativeTranscript(full);
      }
    };

    recognition.onerror = (e: any) => {
      const ignorable = ['no-speech', 'aborted', 'network'];
      if (!e.error || ignorable.includes(e.error)) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.warn('[Voice] SpeechRecognition: max retries reached, stopping');
          setSpeechRecognitionWorking(false);
        }
      }
    };

    recognition.onend = () => {
      // Restart while connected, with backoff on repeated errors
      if (conversation.status === 'connected' && consecutiveErrors < MAX_CONSECUTIVE_ERRORS) {
        const delay = consecutiveErrors > 0 ? Math.min(500 * consecutiveErrors, 5000) : 50;
        setTimeout(() => {
          try { recognition.start(); } catch {}
        }, delay);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      // Null out handlers BEFORE stop() to prevent onend from restarting
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.stop(); } catch {}
    };
  }, [conversation.status]); // Don't depend on isSpeaking — handlers use isSpeakingRef instead

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
      }, 100);
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
        body: JSON.stringify({
          action: 'get_agent',
          voiceId: voiceModeSettings?.voiceId,
          llmModel: model, // Use the main AI model setting (mapped to ElevenLabs ID server-side)
        }),
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
      // Use overrides to set the full email context prompt AND a contextual first message.
      // This replaces the agent's default "How can I help?" with a greeting that knows
      // which email the user is looking at (e.g. "You have a message from John about ...").
      await conversation.startSession({
        agentId: id,
        connectionType: 'webrtc',
        overrides: {
          agent: {
            prompt: { prompt: voicePrompt },
            firstMessage: dynamicFirstMessage,
          },
        },
      });

      startBrowserRecognition();

      // If a draft card is already showing (e.g. restored from Gmail, or from before disconnect),
      // notify the agent so it knows about the draft context
      if (currentDraftRef.current) {
        const d = currentDraftRef.current;
        setTimeout(() => {
          conversation.sendContextualUpdate(
            `[SYSTEM] There is an existing draft displayed to the user. To: ${d.to?.join(', ')}, Subject: ${d.subject}. The user can review, edit, send, or discard it.`
          );
        }, 2000); // Delay to let first message finish
      }
    } catch (err: any) {
      setError(`Failed to connect: ${err.message}`);
      setIsInitializing(false);
      soundsRef.current.playError();
    }
  }, [initializeAgent, conversation, voicePrompt, dynamicFirstMessage, startBrowserRecognition]);

  const endSession = useCallback(async () => {
    stopBrowserRecognition();
    soundsRef.current.stopProcessingLoop();
    accumulatedFinalTranscriptRef.current = '';
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
    isPausedRef.current = true;
    // Mic mutes automatically via controlled state (effectiveMicMuted includes isPaused)
    // Silence agent output so it stops talking
    conversation.setVolume({ volume: 0 });
    stopBrowserRecognition();
    // Tell the agent to stop — it should cease speaking immediately
    conversation.sendContextualUpdate(
      '[SYSTEM] The user has PAUSED the conversation. STOP talking immediately. Do NOT say anything until they resume. Wait silently.'
    );
    // Clear transcripts so nothing lingers while paused
    accumulatedFinalTranscriptRef.current = '';
    setTentativeTranscript('');
  }, [conversation, stopBrowserRecognition]);

  const resumeConversation = useCallback(() => {
    if (conversation.status !== 'connected') return;
    setIsPaused(false);
    isPausedRef.current = false;
    // Mic unmutes automatically via controlled state
    // Restore agent output volume
    conversation.setVolume({ volume: 1 });
    startBrowserRecognition();
    // Let the agent know we're back
    conversation.sendContextualUpdate(
      '[SYSTEM] The user has RESUMED the conversation. You may respond normally again. Say "I\'m here" or similar brief acknowledgment.'
    );
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

    // Clear old draft and stale collapsed history from previous thread
    setCurrentDraft(null);
    setSentDraft(null);
    setCollapsedHistory([]);
    setEmailPreviewExpanded(false);

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

    // Send the updated email context to the ElevenLabs agent and trigger a contextual greeting
    if (conversation.status === 'connected') {
      const isReturning = thread?.id ? threadHasHistoryRef.current.has(thread.id) : false;
      const newPrompt = buildVoiceAgentPrompt(thread, folder, draftingPreferences, { isReturningToThread: isReturning });
      conversation.sendContextualUpdate(newPrompt);

      // Build a contextual greeting that includes what just happened and describes the new thread
      const lastAction = lastNavigationActionRef.current;
      lastNavigationActionRef.current = null; // Consume it

      const lastMessage = thread.messages?.[thread.messages.length - 1];
      const senderName = lastMessage?.from?.name || lastMessage?.from?.email?.split('@')[0] || 'someone';
      const subject = thread.subject?.replace(/^(Re|Fwd|Fw):\s*/gi, '').trim() || 'no subject';

      let systemInstruction: string;
      if (isReturning) {
        systemInstruction = lastAction
          ? `[SYSTEM] ${lastAction}. Now back to a previously discussed email from ${senderName} about "${subject}". Briefly acknowledge the action and ask how you can help with this email.`
          : `[SYSTEM] The user navigated back to a previously discussed email from ${senderName} about "${subject}". Just ask how you can help.`;
      } else {
        systemInstruction = lastAction
          ? `[SYSTEM] ${lastAction}. Now viewing a new email from ${senderName} about "${subject}". Briefly acknowledge the action, then introduce this new email — mention who it's from and the topic, and offer to read it.`
          : `[SYSTEM] The user navigated to a new email from ${senderName} about "${subject}". Introduce this email — mention who it's from and the topic, and offer to read it. Example: "Next up, you have a message from ${senderName} about ${subject}. Want me to read it?"`;
      }
      conversation.sendContextualUpdate(systemInstruction);
    }

    // After navigating away and back, mark the thread as "discussed"
    if (thread?.id) {
      threadHasHistoryRef.current.add(thread.id);
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
    if (!user?.uid || isIncognitoRef.current) return;

    // Get only messages from this session (not loaded history)
    const sessionMessages = messages.filter((m) => !m.isHistory && !m.isSessionDivider);
    if (sessionMessages.length === 0) return;
    if (sessionMessages.length === lastSavedCountRef.current) return; // Nothing new

    const segments = segmentMessagesByThread(
      sessionMessages,
      initialThreadIdRef.current,
      sessionIdRef.current
    );

    // Save each thread's segment, including the latest email message ID for new-email detection
    const savePromises: Promise<void>[] = [];
    segments.forEach((msgs, threadId) => {
      if (msgs.length > 0) {
        const lastEmailMsgId = threadRef.current?.id === threadId
          ? threadRef.current.messages?.[threadRef.current.messages.length - 1]?.id
          : undefined;
        savePromises.push(
          saveVoiceChat(user.uid, threadId, msgs, lastEmailMsgId).then(() => {
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
      if (!user?.uid || isIncognitoRef.current || historyLoadedForRef.current === threadId) return;
      historyLoadedForRef.current = threadId;

      const { messages: history, lastEmailMessageId: savedEmailMsgId } = await loadVoiceChat(user.uid, threadId);
      if (history.length === 0) return;

      // Detect whether new emails have arrived since the last voice chat
      const currentThread = threadRef.current;
      const latestEmailMsgId = currentThread?.messages?.[currentThread.messages.length - 1]?.id;
      const hasNewEmailsSinceChat = savedEmailMsgId && latestEmailMsgId && savedEmailMsgId !== latestEmailMsgId;

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
        // Mark this thread as having prior discussion (so opening greeting is brief)
        threadHasHistoryRef.current.add(threadId);

        if (hasNewEmailsSinceChat) {
          // New emails arrived since last voice chat — collapse old history
          // behind a "Load earlier messages" button (matches ChatInterface behavior)
          setCollapsedHistory(historyMessages);
        } else {
          // No new emails — show history inline with a "Now" divider
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

  // Restore unsent Gmail drafts for the current thread (matches ChatInterface behavior)
  useEffect(() => {
    if (!thread?.id || currentDraft) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token || cancelled) return;
        const gmailDraft = await getDraftForThread(token, thread.id);
        if (!gmailDraft || cancelled) return;
        // Strip quoted content from reply bodies to avoid showing the full chain
        let cleanBody = gmailDraft.body;
        if (gmailDraft.type === 'reply' && thread) {
          const quoteIdx = cleanBody.indexOf('<div class="gmail_quote">');
          if (quoteIdx > 0) cleanBody = cleanBody.slice(0, quoteIdx).trim();
          const onWroteIdx = cleanBody.search(/\nOn .+ wrote:\n/);
          if (onWroteIdx > 0) cleanBody = cleanBody.slice(0, onWroteIdx).trim();
        }
        const restoredDraft: EmailDraft = {
          to: gmailDraft.to,
          cc: gmailDraft.cc,
          bcc: gmailDraft.bcc,
          subject: gmailDraft.subject,
          body: cleanBody,
          type: gmailDraft.type,
          threadId: gmailDraft.threadId,
          inReplyTo: gmailDraft.inReplyTo,
          references: gmailDraft.references,
          gmailDraftId: gmailDraft.id,
        };
        setCurrentDraft(restoredDraft);
        addToolMessage('restore_draft', 'Restored unsent draft from Gmail.');
        // Let the AI know about the restored draft
        if (conversation.status === 'connected') {
          conversation.sendContextualUpdate(
            `[SYSTEM] An unsent draft has been restored from Gmail for this thread. The user can review and send it, or ask you to modify it.`
          );
        }
      } catch {
        // Silently fail — draft restoration is best-effort
      }
    })();
    return () => { cancelled = true; };
  }, [thread?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save every 30 seconds during active session (uses ref to avoid interval churn)
  useEffect(() => {
    if (conversation.status === 'connected') {
      saveTimerRef.current = setInterval(() => {
        saveCurrentSessionRef.current();
      }, 30000);
    }
    return () => {
      if (saveTimerRef.current) {
        clearInterval(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [conversation.status]);

  // Save and disconnect on unmount (e.g., parent sets isVoiceMode=false)
  useEffect(() => {
    return () => {
      saveCurrentSessionRef.current();
      // End WebRTC session if still connected
      try { conversation.endSession(); } catch {}
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        // Collapse draft card into sent preview
        setSentDraft(draft);
        setCurrentDraft(null);
        setIsSending(false);
        addToolMessage('send_email', `Sent to ${draft.to?.[0] || 'recipient'}.`);
        if (conversation.status === 'connected') {
          conversation.sendContextualUpdate('The user just sent the draft email successfully via the UI. Ask what they want to do next.');
        }
      } catch (err: any) {
        soundsRef.current.playError();
        setError(`Send failed: ${err.message}`);
        setIsSending(false);
      }
    },
    [onSendEmail, conversation, addToolMessage]
  );

  const handleSaveDraft = useCallback(
    async (draft: EmailDraft) => {
      setIsSaving(true);
      try {
        const saved = await onSaveDraft?.(draft);
        if (saved) setCurrentDraft(saved);
        // Notify the AI and show in conversation
        addToolMessage('save_draft', 'Draft saved.');
        if (conversation.status === 'connected') {
          conversation.sendContextualUpdate('The user saved the draft via the UI.');
        }
      } catch (err: any) {
        setError(`Save failed: ${err.message}`);
      } finally {
        setIsSaving(false);
      }
    },
    [onSaveDraft, conversation, addToolMessage]
  );

  const handleDiscardDraft = useCallback(
    async (draft: EmailDraft) => {
      if (draft.gmailDraftId) {
        setIsDeleting(true);
        try { await onDeleteDraft?.(draft.gmailDraftId); } catch {}
        setIsDeleting(false);
      }
      setCurrentDraft(null);
      // Notify the AI and show in conversation
      addToolMessage('discard_draft', 'Draft discarded.');
      if (conversation.status === 'connected') {
        conversation.sendContextualUpdate('The user discarded the draft via the UI.');
      }
    },
    [onDeleteDraft, conversation, addToolMessage]
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

  // Detect user speaking via volume when no text transcript source is available (mobile fallback)
  const userSpeakingByVolume =
    isConnected &&
    !isPaused &&
    !conversation.isSpeaking &&
    !speechRecognitionWorking &&
    !tentativeTranscript &&
    inputVolume > 0.05;

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

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Close voice mode */}
          <button
            onClick={() => {
              endSession();
              onExitVoiceMode();
            }}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Incognito indicator bar */}
      <AnimatePresence>
        {isIncognito && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden flex-shrink-0"
          >
            <div className="px-4 py-1.5 flex items-center justify-center gap-1.5"
              style={{
                background: 'rgba(139,92,246,0.08)',
                borderBottom: '1px solid rgba(139,92,246,0.15)',
              }}
            >
              <Ghost className="w-3 h-3 text-purple-400" />
              <span className="text-[11px] text-purple-400 font-medium">Incognito — chat won&apos;t be saved</span>
              <button
                onClick={() => setIsIncognito(false)}
                className="ml-1 text-purple-400 hover:text-purple-300"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Collapsible email preview ──────────────────────── */}
      {thread && thread.messages.length > 0 && (
        <div className="flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <button
            onClick={() => setEmailPreviewExpanded((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-white/[0.02]"
          >
            <Mail className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
              {thread.messages[thread.messages.length - 1]?.from?.name || thread.messages[thread.messages.length - 1]?.from?.email}
              {' — '}
              {thread.messages[thread.messages.length - 1]?.snippet || thread.subject}
            </span>
            <motion.div
              animate={{ rotate: emailPreviewExpanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            </motion.div>
          </button>
          <AnimatePresence>
            {emailPreviewExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div
                  className="px-4 pb-3 overflow-y-auto space-y-3"
                  style={{ maxHeight: '40vh' }}
                >
                  {thread.messages.map((msg, idx) => {
                    const fromName = msg.from?.name || msg.from?.email || 'Unknown';
                    let bodyText = msg.body || '';
                    if (msg.bodyHtml) {
                      const htmlText = extractTextFromHtml(msg.bodyHtml);
                      if (htmlText.length > bodyText.length * 1.2 || bodyText.length < 50) {
                        bodyText = htmlText;
                      }
                    }
                    return (
                      <div key={msg.id || idx}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                            {fromName}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {new Date(msg.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        <p
                          className="text-xs leading-relaxed whitespace-pre-wrap"
                          style={{ color: 'var(--text-primary)', opacity: 0.8 }}
                        >
                          {bodyText.slice(0, 2000) || '(No text content)'}
                        </p>
                        {idx < thread.messages.length - 1 && (
                          <div className="h-px mt-3" style={{ background: 'var(--border-subtle)', opacity: 0.5 }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

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
        {/* Chat controls — incognito + clear (at top of chat area for clarity) */}
        <div className="flex items-center justify-end gap-1 -mt-1 mb-1">
          <button
            onClick={() => setIsIncognito((v) => !v)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] transition-colors"
            style={{
              color: isIncognito ? 'rgb(139,92,246)' : 'var(--text-muted)',
              background: isIncognito ? 'rgba(139,92,246,0.15)' : 'transparent',
              opacity: isIncognito ? 1 : 0.6,
            }}
            title={isIncognito ? 'Incognito mode ON — chat not saved' : 'Enable incognito mode'}
          >
            <Ghost className="w-3 h-3" />
            {isIncognito && <span>Incognito</span>}
          </button>
          {messages.length > 0 && (
            <button
              onClick={() => {
                if (confirm('Clear all voice chat messages?')) {
                  setMessages([]);
                  setCollapsedHistory([]);
                  setCurrentDraft(null);
                  lastSavedCountRef.current = 0;
                  historyLoadedForRef.current = null;
                  if (!isIncognito && thread?.id && user?.uid) {
                    clearVoiceChat(user.uid, thread.id);
                    onVoiceHistoryChange?.(thread.id, false);
                  }
                }
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] transition-colors group"
              style={{ color: 'var(--text-muted)', opacity: 0.6 }}
              title="Clear chat history"
            >
              <Trash2 className="w-3 h-3 group-hover:text-red-400 transition-colors" />
            </button>
          )}
        </div>

        {/* Load earlier messages — shown when history is collapsed due to new emails */}
        {collapsedHistory.length > 0 && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => {
              // Prepend collapsed history + "Now" divider to current messages
              const withDivider = [
                ...collapsedHistory,
                {
                  id: `divider-current-${Date.now()}`,
                  role: 'assistant' as const,
                  content: 'Now',
                  timestamp: new Date(),
                  isSessionDivider: true,
                  sessionDate: 'Now',
                },
              ];
              setMessages((prev) => [...withDivider, ...prev]);
              setCollapsedHistory([]);
            }}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs transition-colors"
            style={{
              background: 'rgba(147,197,253,0.08)',
              border: '1px solid rgba(147,197,253,0.15)',
              color: 'rgba(147,197,253,0.7)',
            }}
          >
            <Clock className="w-3.5 h-3.5" />
            Load earlier messages
            {collapsedHistory.find((m) => m.isSessionDivider) && (
              <span className="opacity-60">
                ({collapsedHistory.find((m) => m.isSessionDivider)?.sessionDate})
              </span>
            )}
          </motion.button>
        )}

        {messages.length === 0 && !tentativeTranscript && collapsedHistory.length === 0 && (
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

        {messages.map((msg, msgIdx) => (
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
                  borderColor: msg.isSentConfirmation
                    ? 'rgba(34,197,94,0.4)'
                    : msg.isToolAction
                    ? 'rgba(168,85,247,0.3)'
                    : msg.role === 'user'
                    ? 'rgba(6,182,212,0.3)'
                    : 'var(--border-subtle)',
                  color: msg.isSentConfirmation
                    ? 'rgb(74,222,128)'
                    : msg.isToolAction ? 'rgb(192,132,252)' : 'var(--text-primary)',
                  background: msg.isSentConfirmation
                    ? 'rgba(34,197,94,0.1)'
                    : msg.isToolAction
                    ? 'rgba(168,85,247,0.08)'
                    : msg.role === 'user'
                    ? 'rgba(6,182,212,0.08)'
                    : 'var(--bg-elevated)',
                }}
              >
                <p className="leading-relaxed flex items-center gap-1.5">
                  {msg.isSentConfirmation && <Send className="w-3 h-3 flex-shrink-0" />}
                  {msg.content}
                </p>
                {/* Post-send quick actions — shown on the last sent confirmation */}
                {msg.isSentConfirmation && msgIdx === messages.length - 1 && (
                  <div className="flex items-center gap-1.5 mt-1.5 -mb-0.5">
                    {folder === 'inbox' && (
                      <button
                        onClick={() => onArchiveRef.current?.()}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors hover:bg-green-500/15"
                        style={{
                          color: 'rgb(74,222,128)',
                          border: '1px solid rgba(34,197,94,0.3)',
                        }}
                      >
                        <Archive className="w-3 h-3" />
                        Archive
                      </button>
                    )}
                    <button
                      onClick={() => onNextEmailRef.current?.()}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors hover:bg-white/5"
                      style={{
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      Next
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        ))}

        {/* Volume-based speaking indicator (mobile fallback when no text transcript available) */}
        {userSpeakingByVolume && !isPaused && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex justify-end"
          >
            <div
              className="px-4 py-2 rounded-2xl border flex items-center gap-1.5"
              style={{
                borderColor: 'rgba(6,182,212,0.2)',
                background: 'rgba(6,182,212,0.05)',
              }}
            >
              {/* Animated volume dots */}
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: 'rgb(6,182,212)' }}
                  animate={{
                    scale: [1, 1.2 + inputVolume * 3, 1],
                    opacity: [0.4, 0.6 + inputVolume * 2, 0.4],
                  }}
                  transition={{
                    duration: 0.5,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    delay: i * 0.15,
                  }}
                />
              ))}
            </div>
          </motion.div>
        )}

        {/* Tentative transcript (hidden while paused) */}
        {tentativeTranscript?.trim() && !isPaused && (
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
        {currentDraft ? (
          <motion.div
            key={`draft-${draftKey}`}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="w-full px-4 py-2 flex-shrink-0 overflow-y-auto"
            style={{ maxHeight: '50vh' }}
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
        ) : sentDraft ? (
          <motion.div
            key="sent-preview"
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
            className="w-full px-4 py-2 flex-shrink-0"
          >
            <SentDraftPreview draft={sentDraft} onDismiss={() => setSentDraft(null)} />
          </motion.div>
        ) : null}
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

                {/* Type a message */}
                {!isPaused && <TextInputButton conversation={conversation} onSendText={handleTextSend} />}
              </div>

              {/* Status label — centered, with spinner during processing */}
              <motion.span
                className="flex-1 text-center text-xs font-medium flex items-center justify-center gap-1.5"
                animate={{ opacity: 0.7 }}
                style={{ color: statusColor, transition: 'color 0.5s ease' }}
              >
                {voiceStatus === 'processing' && (
                  <Loader2 className="w-3 h-3 animate-spin" />
                )}
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
// SENT DRAFT PREVIEW (collapsed confirmation after sending)
// ============================================================

function SentDraftPreview({ draft, onDismiss }: { draft: EmailDraft; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const hasCc = draft.cc && draft.cc.length > 0;

  return (
    <div className="rounded-xl border overflow-hidden opacity-80"
      style={{ borderColor: 'rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.08)' }}
    >
      <div className="w-full flex items-center justify-between px-3 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 flex items-center gap-2 min-w-0 text-left"
        >
          <Send className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'rgb(74,222,128)' }} />
          <span className="text-xs font-medium" style={{ color: 'rgb(74,222,128)' }}>Sent</span>
          <span className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
            • {draft.to.join(', ').slice(0, 25)}{draft.to.join(', ').length > 25 ? '...' : ''}
          </span>
        </button>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 hover:bg-white/5 rounded transition-colors"
          >
            <ChevronDown
              className="w-3.5 h-3.5 transition-transform"
              style={{ color: 'var(--text-muted)', transform: expanded ? 'rotate(180deg)' : undefined }}
            />
          </button>
          <button
            onClick={onDismiss}
            className="p-0.5 hover:bg-white/5 rounded transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2 pt-1 space-y-1 text-xs" style={{ borderTop: '1px solid rgba(34,197,94,0.15)' }}>
              <div className="flex gap-2">
                <span style={{ color: 'var(--text-muted)' }}>To:</span>
                <span style={{ color: 'var(--text-secondary)' }}>{draft.to.join(', ')}</span>
              </div>
              {hasCc && (
                <div className="flex gap-2">
                  <span style={{ color: 'var(--text-muted)' }}>CC:</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{draft.cc!.join(', ')}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span style={{ color: 'var(--text-muted)' }}>Subj:</span>
                <span style={{ color: 'var(--text-secondary)' }}>{draft.subject}</span>
              </div>
              <div className="mt-1 p-1.5 rounded-lg text-[11px] whitespace-pre-wrap max-h-24 overflow-y-auto"
                style={{ background: 'rgba(0,0,0,0.2)', color: 'var(--text-secondary)' }}
              >
                {draft.body}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// TEXT INPUT (for typing during voice session)
// ============================================================

function TextInputButton({ conversation, onSendText }: { conversation: any; onSendText: (text: string) => void }) {
  const [showInput, setShowInput] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showInput) inputRef.current?.focus();
  }, [showInput]);

  const handleSend = () => {
    if (!text.trim() || conversation.status !== 'connected') return;
    const trimmed = text.trim();
    onSendText(trimmed); // Add to transcript immediately
    conversation.sendUserMessage(trimmed); // Send to agent
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
