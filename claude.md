# FloMail - Claude Code Context

**AI-Powered Voice-First Email Assistant**

This document provides comprehensive context about the FloMail codebase for AI assistants working on the project.

---

## Project Overview

FloMail is a voice-first, AI-powered email assistant built as a Next.js PWA that integrates with Gmail. The core philosophy is "flow" - enabling users to seamlessly chat with emails, draft responses, and manage their inbox through natural conversation with minimal friction.

**Key Stats:**
- ~16,800 lines of TypeScript/TSX
- Next.js 15 with React 19
- Production deployment on Google Cloud Run
- Live at: https://flomail-n6a6ot4xyq-uc.a.run.app

---

## Core Concepts

### 1. Voice-First Interaction
- Tap mic → speak → AI transcribes (Whisper) → AI responds
- Waveform visualization during recording
- One-click voice input flow

### 2. AI Agent Architecture
- Uses Anthropic Claude (primary) or OpenAI GPT (switchable)
- Tool-calling paradigm for email actions
- Streaming responses for real-time feedback
- Multi-step workflows (e.g., search web → draft email)

### 3. Flow UX
- Minimal clicks throughout
- Inline editing of draft fields (click to edit)
- Direct thread navigation (Previous/Next)
- Chat interface for each email thread
- Per-thread conversation history with Firestore sync

### 4. Gmail Integration
- Full OAuth 2.0 flow with Gmail API
- Read inbox, reply/forward (threaded), archive, send
- Proper RFC 5322 email threading with Message-ID headers
- Draft sync with Gmail
- Snooze with Gmail labels + Firestore tracking

---

## Tech Stack

### Frontend
- **Next.js 15** (App Router) with TypeScript
- **React 19** with hooks
- **Tailwind CSS 4** for styling
- **Framer Motion** for animations
- **Lucide React** for icons
- **WaveSurfer.js** for audio visualization
- **DOMPurify** for HTML sanitization

### Backend/APIs
- **Firebase Auth** (Google Sign-In with Gmail scopes)
- **Firestore** (chat history, snooze tracking, OAuth tokens)
- **Gmail API** (email operations via googleapis package)
- **Anthropic Claude SDK** (@anthropic-ai/sdk)
- **OpenAI SDK** (GPT + Whisper)
- **Tavily API** (web search, optional)
- **MIMEText** (RFC-compliant email composition)

### Deployment
- **Google Cloud Run** (serverless, streaming support)
- **Cloud Build** (remote Docker builds for AMD64)
- **Artifact Registry** (Docker images)

---

## Project Structure

```
src/
├── app/                         # Next.js App Router
│   ├── api/                     # Server-side API routes
│   │   ├── ai/
│   │   │   ├── chat/           # Streaming AI chat endpoint
│   │   │   ├── transcribe/     # Whisper transcription
│   │   │   └── tts/            # Text-to-speech
│   │   ├── auth/               # OAuth refresh & callbacks
│   │   ├── gmail/              # Gmail proxy endpoints
│   │   ├── snooze/             # Snooze operations
│   │   ├── search/             # Web search (Tavily)
│   │   ├── browse/             # URL fetching
│   │   └── unsubscribe/        # List-Unsubscribe proxy
│   ├── page.tsx                # Main app entry
│   └── layout.tsx              # Root layout + PWA manifest
├── components/                  # React components
│   ├── FloMailApp.tsx          # App orchestration (main container)
│   ├── ChatInterface.tsx       # Chat UI with voice input
│   ├── InboxList.tsx           # Gmail inbox/folders view
│   ├── ThreadPreview.tsx       # Email thread viewer
│   ├── DraftCard.tsx           # Editable draft UI
│   ├── VoiceRecorderButton.tsx # Voice recording controls
│   ├── WaveformVisualizer.tsx  # Audio waveform
│   ├── TTSController.tsx       # Text-to-speech playback
│   ├── EmailHtmlViewer.tsx     # Secure HTML email rendering
│   ├── SnoozePicker.tsx        # Snooze time selection modal
│   ├── UnsubscribeButton.tsx   # One-click unsubscribe
│   └── LoginScreen.tsx         # Firebase auth UI
├── contexts/
│   └── AuthContext.tsx         # Firebase auth + Gmail token management
├── lib/                        # Core business logic
│   ├── firebase.ts             # Firebase SDK initialization
│   ├── gmail.ts                # Gmail API functions
│   ├── anthropic.ts            # Claude API + agent system
│   ├── openai.ts               # GPT API + agent system
│   ├── agent-tools.ts          # Tool definitions for AI
│   ├── email-cache.ts          # Client-side email caching
│   ├── email-parsing.ts        # Email utilities (RFC 5322, TLS, etc.)
│   ├── chat-persistence.ts     # Firestore chat history
│   ├── snooze-persistence.ts   # Firestore snooze tracking
│   ├── snooze-server.ts        # Server-side snooze helpers
│   └── mail-driver/            # Multi-provider abstraction
│       ├── types.ts            # Provider-agnostic interfaces
│       ├── gmail-driver.ts     # Gmail implementation
│       └── index.ts            # Driver factory
├── hooks/
│   └── useVoiceRecorder.ts     # Voice recording hook
└── types/
    └── index.ts                # TypeScript type definitions
```

---

## Key Components & Data Flow

### FloMailApp.tsx
**Role:** Main container - orchestrates all views and state

**Responsibilities:**
- View management (inbox ↔ chat)
- Thread navigation (next/previous)
- AI model selection (Claude/GPT + model picker)
- User preferences (drafting style, TTS settings)
- URL state sync (folder, thread ID)
- Snooze handling + expiry polling
- Email actions (send, archive, star, etc.)

**State:**
```typescript
- currentView: 'inbox' | 'chat'
- selectedThread: EmailThread | null
- currentDraft: EmailDraft | null
- currentMailFolder: 'inbox' | 'sent' | 'snoozed' | etc.
- aiProvider: 'anthropic' | 'openai'
- aiModel: string
- aiDraftingPreferences: AIDraftingPreferences
```

### ChatInterface.tsx
**Role:** Conversational UI for interacting with emails

**Responsibilities:**
- Display chat messages (user + assistant)
- Voice recording with waveform
- Text input
- Draft card rendering
- Tool call handling (prepare_draft, send_email, etc.)
- Streaming AI responses
- Chat history persistence to Firestore
- Incognito mode (disable saving)
- TTS playback with controls

**Flow:**
1. User speaks or types → sends to `/api/ai/chat`
2. API calls Claude/GPT with email context + tools
3. Stream tokens back → display in real-time
4. If tool call (e.g., `prepare_draft`) → render draft card
5. User can edit draft fields inline (click to edit)
6. "Send" → `onSendEmail` → `gmail.sendEmail()`

### InboxList.tsx
**Role:** Email list view with folder navigation

**Responsibilities:**
- Fetch & display threads from Gmail API
- Folder tabs (Inbox, Sent, Snoozed, Starred, All)
- Search (Gmail query syntax)
- Infinite scroll (load more)
- Thread previews with metadata
- Snooze badges ("Back!" for recently unsnoozed)
- Thread count indicators

### DraftCard.tsx
**Role:** Editable email draft UI

**Features:**
- Click-to-edit fields (To, Subject, Body)
- Auto-save to Gmail drafts
- Quoted content (replies/forwards)
- Attachment display
- Delete draft
- Keyboard navigation (Tab between fields)

---

## AI Agent System

### Tool Calling Paradigm

FloMail uses function/tool calling to enable the AI to take actions:

**Available Tools** (defined in `agent-tools.ts`):
```typescript
1. prepare_draft      // Create email draft (reply/forward/new)
2. send_email         // Send the prepared draft
3. archive_email      // Archive current thread
4. move_to_inbox      // Unarchive thread
5. snooze_email       // Snooze with time options
6. star_email         // Star thread
7. unstar_email       // Unstar thread
8. go_to_next_email   // Navigate to next
9. go_to_inbox        // Return to inbox
10. web_search        // Search web via Tavily
11. browse_url        // Fetch URL content
12. search_emails     // Search Gmail threads
```

### Agent Prompt

The system prompt (`FLOMAIL_AGENT_PROMPT` in `anthropic.ts`) instructs the AI:
- When to use tools vs. respond with text
- Draft type logic (reply is default when viewing email)
- Folder awareness (can't archive archived emails)
- Multi-step workflows
- Current date/time injection for snooze calculations
- User preferences (tone, length, sign-off style)

### Example Multi-Step Flow

**User:** "Search for restaurants near me and draft a reply suggesting we meet there"

**AI Steps:**
1. Calls `web_search(query: "restaurants near me")`
2. Receives search results
3. Calls `prepare_draft(type: "reply", body: "How about [restaurant]?", ...)`
4. User reviews → confirms send
5. Calls `send_email(confirm: "confirmed")`

---

## Email Handling

### Threading
- Uses RFC 5322 `Message-ID`, `In-Reply-To`, `References` headers
- Proper Gmail thread continuity
- Replies stay in same thread

### Draft Types
```typescript
type EmailDraftType = 'reply' | 'forward' | 'new'

// Reply: Sets In-Reply-To + References, quotes last message
// Forward: Includes References, quotes all messages + attachments
// New: Fresh email, no threading
```

### Quoted Content
- **Replies:** Gmail-style blockquote with "On [date], [sender] wrote:"
- **Forwards:** Full message chain with headers

### HTML Rendering
Smart detection (`isRichHtmlContent` in `EmailHtmlViewer.tsx`):
- Default: Dark-themed plain text
- Use white iframe ONLY if email has explicit styling:
  - Loadable images (http/https/data URLs)
  - Non-white background colors
  - Substantial CSS (>100 chars)
  - Tables with visible borders

This prevents false positives where simple HTML text was incorrectly white-boxed.

---

## Snooze Feature

### How It Works
1. **Snooze:** Adds `FloMail/Snoozed` label + removes from inbox
2. **Tracking:** Stores snooze time in Firestore (`snoozedEmails/{threadId}`)
3. **Polling:** Client checks every 60s for expired snoozes
4. **Unsnooze:** Moves back to inbox + adds `FloMail/Unsnoozed` label
5. **Badge:** Shows orange "Unsnoozed" badge for 24 hours

### Snooze Options
- **Quick:** 30 min, 1h, 3h
- **Schedule:** Later today (+4h), Tomorrow (8am), Weekend (Sat 8am), Next week (Mon 8am)
- **Custom:** Date/time picker
- **Repeat:** One-click to reuse last snooze choice

### API Route
`/api/snooze` handles Gmail label operations:
```typescript
POST /api/snooze
Body: { action: 'snooze' | 'unsnooze', threadId, snoozeOption, customDate }
```

---

## Chat Persistence

### Firestore Structure
```
/users/{userId}/threadChats/{gmailThreadId}
├── messages: ChatMessage[]        // Full conversation
├── lastUpdated: Timestamp
├── messageCount: number
└── lastMessagePreview: string
```

### Features
- Auto-save after each AI response
- Cross-device sync (realtime)
- Draft preservation (full content + attachments)
- Incognito mode (eye icon) disables saving for session

### Message Format
```typescript
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  metadata?: {
    draft?: EmailDraft          // Preserved draft state
    action?: 'draft' | 'send'   // What action was taken
  }
}
```

---

## User Preferences

### AI Drafting Preferences
Customizes how AI writes emails:

```typescript
interface AIDraftingPreferences {
  userName: string                  // For sign-offs
  tones: DraftTone[]               // ['professional', 'friendly', etc.]
  length?: 'brief' | 'moderate' | 'detailed'
  useExclamations?: boolean        // Explicit preference
  signOffStyle: 'none' | 'best' | 'thanks' | 'regards' | 'cheers' | 'custom'
  customSignOff?: string
  customInstructions?: string      // Free-form prompt addition
}
```

**Stored in:** `localStorage` (`flomail-drafting-preferences`)

**Usage:** Injected into AI system prompt via `buildUserPreferencesContext()`

### TTS Settings
```typescript
{
  voice: 'nova' | 'alloy' | 'echo' | etc.
  speed: 0.5 - 2.0
  useNaturalVoice: boolean  // AI vs. browser native
}
```

**Stored in:** `localStorage` (`flomail_tts_settings`)

---

## API Routes

### `/api/ai/chat/route.ts`
**Non-streaming AI chat** (legacy, mostly unused now)
- POST with messages + thread context
- Returns full response + tool calls

### `/api/ai/chat/stream/route.ts`
**Streaming AI chat** (primary endpoint)
- POST with messages + thread context
- Server-sent events (SSE)
- Event types: `status`, `text`, `tool_start`, `tool_args`, `tool_done`, `error`

### `/api/ai/transcribe/route.ts`
**Whisper transcription**
- POST with audio file (multipart/form-data)
- Returns `{ text: string }`

### `/api/ai/tts/route.ts`
**Text-to-speech**
- POST with `{ text, voice, speed, useNaturalVoice }`
- Returns audio blob (OpenAI TTS) or streaming audio

### `/api/gmail/send-draft/route.ts`
**Proxy for Gmail drafts.send**
- Bypasses CORS issues
- POST with `{ draftId, accessToken }`

### `/api/snooze/route.ts`
**Snooze/unsnooze operations**
- POST with `{ action, threadId, accessToken, snoozeOption, customDate }`
- Handles Gmail labels (`FloMail/Snoozed`, `FloMail/Unsnoozed`)

### `/api/search/route.ts`
**Web search via Tavily**
- POST with `{ query }`
- Returns search results (optional feature, requires `TAVILY_API_KEY`)

### `/api/browse/route.ts`
**URL content fetching**
- POST with `{ url }`
- Returns webpage text content

### `/api/unsubscribe/route.ts`
**List-Unsubscribe POST proxy**
- POST with `{ url, email }`
- Handles RFC 8058 one-click unsubscribe

---

## Gmail API Functions

### Core Operations (`lib/gmail.ts`)

```typescript
// Fetch inbox/folder threads
fetchInbox(token, options?: { labelIds?, query?, maxResults? }): Promise<{ threads, nextPageToken }>

// Fetch single thread (full content)
fetchThread(token, threadId): Promise<EmailThread>

// Send email (with draft sync)
sendEmail(token, draft: EmailDraft): Promise<void>

// Archive thread (remove INBOX label)
archiveThread(token, threadId): Promise<void>

// Move to inbox (add INBOX label)
moveToInbox(token, threadId): Promise<void>

// Star/unstar
starThread(token, threadId): Promise<void>
unstarThread(token, threadId): Promise<void>

// Snooze labels
snoozeThread(token, threadId): Promise<void>      // Add FloMail/Snoozed, remove INBOX
unsnoozeThread(token, threadId): Promise<void>    // Remove FloMail/Snoozed, add INBOX + FloMail/Unsnoozed

// Draft operations
createGmailDraft(token, draft): Promise<string>   // Returns draftId
updateGmailDraft(token, draftId, draft): Promise<string>
deleteGmailDraft(token, draftId): Promise<void>

// Attachments
getAttachment(token, messageId, attachmentId): Promise<string> // Base64 data
```

### Email Caching
Client-side cache (`lib/email-cache.ts`) to minimize API calls:
- Per-folder caching with 5-minute TTL
- Thread-level caching
- Invalidation on actions (send, archive, etc.)

---

## Multi-Provider Architecture

### Abstraction Layer (`lib/mail-driver/`)

**Goal:** Support multiple email providers (Gmail, Outlook, etc.) without refactoring the app

**Structure:**
```typescript
// types.ts - Provider-agnostic interfaces
interface MailDriver {
  getThreads(folder, options): Promise<ParsedThread[]>
  getMessage(messageId): Promise<ParsedMessage>
  sendMessage(message): Promise<void>
  createDraft(data): Promise<string>
  // ... etc
}

// gmail-driver.ts - Gmail implementation
class GmailDriver implements MailDriver { ... }

// Future: outlook-driver.ts, etc.
```

**Current Status:** Only Gmail implemented. Architecture ready for expansion.

---

## Deployment

### Google Cloud Run

**Current Setup:**
- **GCP Account:** greg.kestin@gmail.com
- **Project:** flomail25
- **Region:** us-central1
- **Service:** flomail
- **URL:** https://flomail-n6a6ot4xyq-uc.a.run.app

### Build Process
Uses **Cloud Build** (not local Docker):
1. `cloudbuild.yaml` defines build steps
2. Builds for AMD64 (Cloud Run architecture)
3. Injects Firebase config as build args (`NEXT_PUBLIC_*`)
4. Pushes to Artifact Registry
5. Deploys to Cloud Run with runtime env vars (API keys)

### Deploy Script
`./deploy.sh` automates:
- Validates `.env.local` vars
- Triggers Cloud Build
- Sets Cloud Run environment variables
- Outputs live URL

### Environment Variables

**Build-time** (baked into Docker image):
```bash
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

**Runtime** (Cloud Run env vars):
```bash
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
TAVILY_API_KEY  # Optional
```

---

## Firebase Setup

### Authentication
- Google Sign-In enabled
- Gmail scopes requested:
  - `gmail.readonly`
  - `gmail.send`
  - `gmail.modify`

### Firestore Collections

```
/users/{userId}
├── email: string
├── displayName: string
├── accessToken: string      // Gmail OAuth token
├── refreshToken: string
└── photoURL: string

/users/{userId}/threadChats/{gmailThreadId}
├── messages: ChatMessage[]
├── lastUpdated: Timestamp
├── messageCount: number
└── lastMessagePreview: string

/users/{userId}/snoozedEmails/{gmailThreadId}
├── threadId: string
├── userId: string
├── snoozeUntil: Timestamp
├── snoozedAt: Timestamp
├── subject: string
├── snippet: string
└── senderName: string

/users/{userId}/recentlyUnsnoozed/{gmailThreadId}
├── threadId: string
├── userId: string
└── unsnoozedAt: Timestamp
```

### Security Rules
```javascript
// User can only read/write their own data
match /users/{userId} {
  allow read, write: if request.auth.uid == userId;

  match /threadChats/{threadId} {
    allow read, write: if request.auth.uid == userId;
  }

  match /snoozedEmails/{threadId} {
    allow read, write: if request.auth.uid == userId;
  }

  match /recentlyUnsnoozed/{threadId} {
    allow read, write: if request.auth.uid == userId;
  }
}
```

---

## Common Workflows

### Replying to an Email
1. User clicks thread in InboxList
2. `FloMailApp.handleSelectThread()` → fetches full thread → sets `selectedThread`
3. URL updates: `?folder=inbox&thread={threadId}`
4. View switches to ChatInterface
5. User speaks/types: "Reply saying I'll be there"
6. `ChatInterface` → `/api/ai/chat/stream`
7. Claude calls `prepare_draft(type: "reply", to: "...", subject: "Re: ...", body: "I'll be there")`
8. Stream returns draft → `DraftCard` renders
9. User clicks "Send"
10. `FloMailApp.handleSendEmail()` → `gmail.sendEmail()`
11. Draft synced to Gmail → sent via Gmail API
12. Thread refreshed to show sent message

### Snoozing an Email
1. User clicks snooze icon in top bar
2. `SnoozePicker` modal opens
3. User selects option (e.g., "Tomorrow 8am")
4. `FloMailApp.handleSnooze()` → `/api/snooze`
5. API adds `FloMail/Snoozed` label, removes `INBOX`
6. Firestore saves snooze record with timestamp
7. Cache invalidated
8. Auto-navigate to next email

### Voice Input
1. User taps mic button
2. `useVoiceRecorder` hook starts recording
3. `WaveformVisualizer` shows real-time waveform
4. User taps stop → audio blob created
5. Upload to `/api/ai/transcribe`
6. Whisper returns text
7. Auto-submit to chat

---

## Architecture Patterns

### State Management
- **React Context:** Auth (`AuthContext`)
- **Component State:** Local UI state (modals, forms)
- **URL State:** Thread/folder navigation (browser history)
- **localStorage:** User preferences (drafting, TTS)
- **Firestore:** Persistent data (chat history, snooze)

### Data Flow
```
User Action
  ↓
Component Handler (FloMailApp/ChatInterface)
  ↓
API Route (/api/ai/chat, /api/gmail/send-draft)
  ↓
External Service (Gmail API, Claude API, Firestore)
  ↓
Response Processing
  ↓
State Update (React state)
  ↓
UI Re-render
```

### Caching Strategy
- **Thread Metadata:** 5-minute TTL (list view)
- **Full Thread Content:** 5-minute TTL (chat view)
- **Invalidation:** On mutations (send, archive, snooze)
- **Folder-level:** Invalidate whole folder on actions

### Error Handling
- API routes catch errors → return JSON with `{ error: message }`
- UI components show error toasts/messages
- Fallback models for AI (Claude 3.5 Sonnet if Sonnet 4 fails)

---

## Performance Optimizations

### Lazy Loading
- Infinite scroll in InboxList (load 20 threads at a time)
- Next.js dynamic imports for heavy components

### Metadata-Only Fetching
- InboxList loads threads with `format=metadata` (no body content)
- Full content fetched on demand when thread opened

### Streaming
- AI responses stream token-by-token for perceived speed
- Server-sent events (SSE) for real-time updates

### Service Worker (PWA)
- Offline support (basic)
- Add to home screen on mobile

---

## Testing & Development

### Local Development
```bash
npm run dev
# Opens at http://localhost:3000
```

### Environment Setup
Create `.env.local`:
```bash
# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# AI
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...

# Optional
TAVILY_API_KEY=...
```

### OAuth Consent Screen
Currently in **TESTING mode**:
- Only test users can sign in
- Add emails in Google Cloud Console → OAuth consent screen → Test users
- To go Production: Submit for verification (requires privacy policy)

---

## Future Enhancements

### Planned Features
- Task manager integration
- Custom labels management
- Keyboard shortcuts
- Background snooze processing (Cloud Functions/Scheduler)
- Outlook/Microsoft 365 provider (architecture ready)

### iOS App
Currently a PWA. For App Store:
```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init FloMail com.flomail.app
npx cap add ios
npx cap open ios
```
No code changes needed - Capacitor wraps the web app.

---

## Code Style & Conventions

### TypeScript
- Strict mode enabled
- Interfaces for all data structures (`types/index.ts`)
- Explicit return types for public functions
- Avoid `any` (use `unknown` or proper types)

### React Patterns
- Functional components only
- Hooks for state/effects
- `useCallback` for event handlers (prevent re-renders)
- `useMemo` for expensive computations
- Props destructuring

### File Organization
- One component per file
- Co-locate related utilities (e.g., `email-parsing.ts` with `gmail.ts`)
- Group by feature (not by type)

### Naming
- Components: PascalCase (`FloMailApp.tsx`)
- Functions: camelCase (`handleSendEmail`)
- Constants: UPPER_SNAKE_CASE (`FLOMAIL_AGENT_PROMPT`)
- Types: PascalCase (`EmailThread`)

---

## Common Gotchas

### 1. Draft Type Confusion
**Problem:** AI often uses `type: "new"` when it should use `type: "reply"`

**Solution:** Prompt emphasizes "DEFAULT IS REPLY" when viewing email thread

### 2. Archived Email Actions
**Problem:** Trying to archive an already-archived email fails silently

**Solution:** Check `thread.labels.includes('INBOX')` before archiving. Prompt teaches AI to check folder.

### 3. HTML Email Rendering
**Problem:** Plain text emails were getting white backgrounds

**Solution:** `isRichHtmlContent()` detection - only use iframe for emails with explicit styling

### 4. Snooze Re-triggering
**Problem:** AI calling `snooze_email` tool multiple times

**Solution:** System message after first call: "[SYSTEM: Snooze already queued...]". Prompt says "ONLY call ONCE".

### 5. OAuth Token Refresh
**Problem:** Access tokens expire after 1 hour

**Solution:** `AuthContext` automatically refreshes using Firebase stored refresh token

### 6. Cross-Device Sync Delay
**Problem:** Chat history takes time to sync across devices

**Solution:** Firestore realtime listeners not implemented yet - currently relies on load/save on mount/unmount

---

## Key Dependencies

### Critical Libraries
```json
{
  "@anthropic-ai/sdk": "^0.71.2",     // Claude API
  "openai": "^6.15.0",                 // GPT + Whisper + TTS
  "firebase": "^12.7.0",               // Auth + Firestore
  "googleapis": "^169.0.0",            // Gmail API
  "mimetext": "^3.0.27",               // RFC-compliant email composition
  "dompurify": "^3.3.1",               // HTML sanitization
  "framer-motion": "^12.24.7",         // Animations
  "wavesurfer.js": "^7.12.1",          // Audio waveform
  "next": "16.1.1",                    // Framework
  "react": "19.2.3"                    // UI library
}
```

---

## Debugging Tips

### Enable Verbose Logging
Add to components:
```typescript
console.log('[Component] Event:', data);
```

Existing logs:
- `[Claude]` - AI responses
- `[Snooze]` - Snooze operations
- `[URL]` - Navigation state
- `[buildDraftFromToolCall]` - Draft creation

### Check Network Tab
- `/api/ai/chat/stream` - SSE events
- Gmail API calls (`gmail.googleapis.com`)

### Inspect Firestore
Firebase Console → Firestore Database
- Check `threadChats` for message persistence
- Check `snoozedEmails` for active snoozes

### Test OAuth Flow
1. Clear localStorage
2. Sign out
3. Delete cookies
4. Sign in fresh

---

## Security Considerations

### HTML Sanitization
All email HTML passed through DOMPurify before rendering:
```typescript
const clean = DOMPurify.sanitize(dirtyHtml, {
  ALLOWED_TAGS: ['div', 'span', 'p', 'br', ...],
  ALLOWED_ATTR: ['style', 'class', 'href', ...]
});
```

### OAuth Tokens
- Access tokens never logged
- Stored in Firestore with security rules (user-only access)
- Refresh tokens encrypted by Firebase

### API Keys
- Server-side only (NEVER in client bundle)
- Environment variables in Cloud Run
- `.env.local` git-ignored

### CORS
- API routes have explicit CORS headers
- Gmail operations proxied through Next.js API (avoid CORS issues)

---

## Contributing Guidelines

### Before Making Changes
1. Read this document thoroughly
2. Understand the data flow for the feature you're modifying
3. Test locally with `.env.local` configured
4. Check for existing patterns (don't reinvent)

### Making Changes
1. Keep functions small and focused
2. Add TypeScript types for new data structures
3. Update `types/index.ts` for new interfaces
4. Comment non-obvious logic
5. Test across different email types (plain text, HTML, threading)

### Testing Checklist
- [ ] OAuth flow works
- [ ] Voice recording → transcription works
- [ ] Draft creation → editing → sending works
- [ ] Thread navigation (next/prev) works
- [ ] Snooze → unsnooze works
- [ ] Chat history persists
- [ ] Works on mobile (PWA)

### Deployment
```bash
./deploy.sh  # Builds & deploys to Cloud Run
```

---

## Troubleshooting

### "Not authenticated" Error
**Cause:** Access token expired
**Fix:** Refresh page (triggers token refresh) or sign out/in

### Draft Not Sending
**Cause:** Missing required fields (to, subject, body)
**Fix:** Check `EmailDraft` object has all fields populated

### AI Not Responding
**Cause:** API key missing/invalid or model doesn't exist
**Fix:** Check `.env.local` or Cloud Run env vars. Try fallback model.

### Snooze Not Unsnoozing
**Cause:** App not open (client-side polling)
**Fix:** Open app. Future: Move to Cloud Scheduler + Cloud Functions.

### HTML Email Not Displaying
**Cause:** `isRichHtmlContent()` returning false
**Fix:** Check email has explicit styling (images, CSS, bgcolor)

---

## Resources

### Documentation
- [Next.js Docs](https://nextjs.org/docs)
- [Gmail API Reference](https://developers.google.com/gmail/api)
- [Anthropic API Docs](https://docs.anthropic.com)
- [Firebase Docs](https://firebase.google.com/docs)

### Related Files
- `README.md` - User-facing documentation
- `cloudbuild.yaml` - Build configuration
- `deploy.sh` - Deployment script
- `Dockerfile` - Container definition

---

## Contact

**Repository:** https://github.com/gkestin/FloMail
**Live App:** https://flomail-n6a6ot4xyq-uc.a.run.app
**Developer:** Greg Kestin (greg.kestin@gmail.com)

---

*Last Updated: 2026-01-24*
*Claude.md - Comprehensive context for AI assistants working on FloMail*
