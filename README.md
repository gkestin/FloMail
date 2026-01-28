# FloMail

**Repository:** https://github.com/gkestin/FloMail

**Live App:** https://flomail-n6a6ot4xyq-uc.a.run.app

A **voice-first, AI-powered email assistant** that integrates with Gmail. The core concept is "flow" - seamlessly chat, draft, send, and navigate emails without friction.

## Intent

- **Voice-first**: Tap mic, speak, send - one-click voice input with waveform visualization
- **AI Agent**: Uses Claude/GPT with tool calling to draft, send, archive, navigate
- **Flow UX**: Chat with emails, draft inline, edit fields by clicking, minimal clicks throughout
- **Gmail Integration**: Read inbox, reply/forward (threaded), archive, send via Gmail API

## Tech Stack

- **Next.js 15** with TypeScript, Tailwind CSS, Framer Motion
- **Firebase**: Authentication (Google Sign-In with Gmail scopes), Firestore for persistence
- **AI**: Anthropic Claude + OpenAI GPT (switchable), Whisper for transcription
- **Gmail API**: OAuth 2.0 for email operations
- **DOMPurify**: HTML sanitization for secure email rendering
- **email-addresses**: RFC 5322 compliant email address parsing

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── ai/
│   │   │   ├── chat/route.ts      # AI chat endpoint (Claude/GPT with tools)
│   │   │   └── transcribe/route.ts # Whisper transcription endpoint
│   │   ├── snooze/route.ts        # Snooze/unsnooze Gmail API operations
│   │   ├── search/route.ts        # Web search via Tavily API
│   │   └── browse/route.ts        # URL content fetching
│   ├── page.tsx               # Main app entry
│   └── layout.tsx             # Root layout with PWA manifest
├── components/
│   ├── ChatInterface.tsx      # Main chat UI, voice recording, message handling
│   ├── DraftCard.tsx          # Inline-editable email draft UI
│   ├── InboxList.tsx          # Gmail inbox with thread counts, attachments
│   ├── ThreadPreview.tsx      # Collapsible email thread viewer
│   ├── FloMailApp.tsx         # App orchestration (inbox ↔ chat views)
│   ├── SnoozePicker.tsx       # Snooze time picker modal
│   ├── EmailHtmlViewer.tsx    # Secure HTML email rendering (DOMPurify + iframe)
│   └── UnsubscribeButton.tsx  # One-click list unsubscribe UI
├── contexts/
│   └── AuthContext.tsx        # Firebase auth + Gmail token management
├── lib/
│   ├── firebase.ts            # Firebase initialization
│   ├── gmail.ts               # Gmail API functions (fetch, send, archive, snooze, drafts)
│   ├── anthropic.ts           # Claude API with agent tools
│   ├── openai.ts              # GPT API with agent tools
│   ├── agent-tools.ts         # Tool definitions (prepare_draft, send_email, snooze_email, etc.)
│   ├── email-cache.ts         # Client-side caching for emails
│   ├── email-parsing.ts       # Email utilities (unsubscribe, address parsing, TLS info)
│   ├── chat-persistence.ts    # Firestore persistence for per-thread chat history
│   ├── snooze-persistence.ts  # Firestore persistence for snooze/unsnooze tracking
│   ├── snooze-server.ts       # Server-side snooze utilities
│   └── mail-driver/           # Multi-provider abstraction (Gmail driver, future Outlook)
└── types/
    └── index.ts               # TypeScript interfaces
```

## Configuration

### Required Files

**`.env.local`** - API keys and Firebase config:
```bash
# Firebase
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Google OAuth (for Gmail API)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# AI APIs
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...

# Web Search (optional - enables web_search and browse_url tools)
TAVILY_API_KEY=...  # Get from https://tavily.com (free tier available)
```

**`FirebaseConfig.txt`** - Reference copy of Firebase web config (for setup reference)

### Firebase Setup
- Project: `flomail25`
- Auth: Google Sign-In enabled
- Gmail scopes requested: `gmail.readonly`, `gmail.send`, `gmail.modify`

### Firestore Setup (Chat Persistence & Snooze)

FloMail stores per-thread chat history and snooze data in Firestore. Each thread has its own chat history that syncs across devices.

1. **Enable Firestore** in Firebase Console → Build → Firestore Database → Create database

2. **Set Security Rules** in Firebase Console → Firestore → Rules:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // User profile document - stores OAuth tokens, email, etc.
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // User's chat history per email thread
    match /users/{userId}/threadChats/{threadId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // User's snoozed emails (tracks snooze until time)
    match /users/{userId}/snoozedEmails/{threadId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // User's recently unsnoozed emails (for "Back!" badge)
    match /users/{userId}/recentlyUnsnoozed/{threadId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // User's settings (drafting preferences, TTS settings, etc.)
    match /users/{userId}/settings/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    // Deny all other access by default
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

3. **Data Structure:**
```
/users/{userId}
├── email: string
├── displayName: string
├── accessToken: string (Gmail OAuth)
├── refreshToken: string
└── photoURL: string

/users/{userId}/threadChats/{gmailThreadId}
├── messages: [{ id, role, content, timestamp, draft?, toolCalls? }]
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

**Features:**
- Chat history is automatically saved per thread
- Drafts are preserved with full content (to, subject, body, attachments)
- Incognito mode (click the eye icon) disables saving for the current session
- Cross-device sync happens automatically

### Google Cloud Console
- OAuth consent screen configured
- OAuth 2.0 credentials with authorized origins/redirects
- **⚠️ Currently in TESTING mode** (not Production)
  - Only test users added to the OAuth consent screen can sign in
  - Add test user emails in: Google Cloud Console → APIs & Services → OAuth consent screen → Test users
  - To go to Production: Submit for verification (requires privacy policy, etc.)

## Setup (from clone)

```bash
git clone https://github.com/gkestin/FloMail.git
cd FloMail
npm install
```

Then create `.env.local` with your API keys (see Configuration section above).

**Note:** `.env.local` is git-ignored and NOT included in the repo. You must create it yourself with your own API keys.

## Running

```bash
npm run dev
# Opens at http://localhost:3000 (or next available port)
```

### Restart the Server

If you need to restart (e.g., after code changes that aren't hot-reloading):

```bash
# Kill existing process and restart
pkill -f "next dev"
npm run dev

# Or specify a port if 3000 is in use
npm run dev -- -p 3001
```

## Key Features

1. **Voice Input**: Mic button → waveform → Send button → transcribes → AI responds
2. **AI Agent Tools**: `prepare_draft`, `send_email`, `archive_email`, `snooze_email`, `unsnooze_email`, `go_to_next_email`, `go_to_inbox`
3. **Inline Draft Editing**: Click any field (To, Subject, Body) to edit in place
4. **Email Threading**: Replies/forwards stay in Gmail thread with proper headers
5. **Model Selection**: Switch between Claude/GPT models via settings popover
6. **Per-Thread Chat History**: Each email thread has its own chat history, saved and synced across devices
7. **Incognito Mode**: Click the eye icon to disable chat saving for the current session
8. **Web Search**: Ask the AI to search the web or browse URLs from emails for real-time information
9. **Email Snooze**: Snooze emails with quick options (30 min, 1h, 3h) or schedule (tomorrow, weekend, custom date)

### Snooze Feature

FloMail implements email snooze using Gmail labels + Firestore:

**How it works:**
- When you snooze an email, it gets a `FloMail/Snoozed` label in Gmail and is removed from inbox
- Snooze timing is tracked in Firestore (`snoozedEmails` collection)
- When the app is open, it polls every 60 seconds to check for expired snoozes
- Expired snoozes are automatically moved back to inbox with a `FloMail/Unsnoozed` label
- Recently unsnoozed emails show an orange "Unsnoozed" badge for 24 hours

**Snooze options:**
- **Quick snooze**: 30 minutes, 1 hour, 3 hours
- **Schedule**: Later today (+4h), Tomorrow (1 PM), This weekend (Sunday 1 PM)
- **Custom**: Pick any date and time
- **Repeat**: One-click to repeat your last snooze choice

**Gmail compatibility:**
- Snoozed emails appear in Gmail with the `FloMail/Snoozed` label
- You can manage snoozes from either FloMail or Gmail
- The `FloMail/Unsnoozed` label helps track which emails returned from snooze

## Deployment (GCP Cloud Run)

FloMail is deployed to **Google Cloud Run** - a serverless platform that scales automatically and supports streaming AI responses.

### Current Deployment

| Setting | Value |
|---------|-------|
| **GCP Account** | greg.kestin@gmail.com |
| **GCP Project** | flomail25 |
| **Region** | us-central1 |
| **Service Name** | flomail |
| **Live URL** | https://flomail-n6a6ot4xyq-uc.a.run.app |
| **Artifact Registry** | us-central1-docker.pkg.dev/flomail25/flomail/flomail |

### Prerequisites

1. **Google Cloud CLI** installed: https://cloud.google.com/sdk/docs/install
2. GCP project with **billing enabled** (required for Cloud Build/Cloud Run)
3. `.env.local` file with all required environment variables

### Quick Deploy

```bash
# Ensure you're logged in to the correct account
gcloud auth login greg.kestin@gmail.com
gcloud config set project flomail25

# One-command deployment (uses Cloud Build - no local Docker needed)
./deploy.sh
```

The deploy script:
- Validates all required env vars from `.env.local`
- Builds the Docker image remotely via Cloud Build (~5 min)
- Deploys to Cloud Run with all environment variables
- Outputs the live URL

### First-Time Setup (Already Done)

These steps were completed during initial deployment:

```bash
# 1. Switch to correct account and project
gcloud auth login greg.kestin@gmail.com
gcloud config set project flomail25

# 2. Enable required APIs
gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    containerregistry.googleapis.com

# 3. Create Artifact Registry repository
gcloud artifacts repositories create flomail \
    --repository-format=docker \
    --location=us-central1 \
    --description="FloMail Docker images"

# 4. Configure Docker authentication
gcloud auth configure-docker us-central1-docker.pkg.dev
```

### How the Build Works

The deployment uses **Cloud Build** (remote build on GCP) instead of local Docker because:
- Apple Silicon Macs build ARM images, but Cloud Run needs AMD64
- Cloud Build automatically builds for the correct architecture
- No local Docker disk space issues

The `cloudbuild.yaml` file:
1. Builds the Docker image with Firebase build args (NEXT_PUBLIC_* vars)
2. Pushes to Artifact Registry
3. Deploys to Cloud Run with runtime env vars (API keys)

### Post-Deployment Setup (One-Time)

After the first deployment, authorize the Cloud Run domain:

1. **Firebase Console** → Authentication → Settings → Authorized domains
   - Add: `flomail-n6a6ot4xyq-uc.a.run.app`

2. **Google Cloud Console** → APIs & Services → Credentials → OAuth 2.0 Client
   - Authorized JavaScript origins: `https://flomail-n6a6ot4xyq-uc.a.run.app`
   - Authorized redirect URIs: `https://flomail-n6a6ot4xyq-uc.a.run.app`

### Environment Variables

**Build-time** (baked into the Docker image via build args):
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

**Runtime** (set as Cloud Run env vars):
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `TAVILY_API_KEY` (optional - for web search)

All are read from `.env.local` by the deploy script.

### Useful Commands

```bash
# Check deployment status
gcloud run services describe flomail --region us-central1

# View logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=flomail" --limit=50

# Get the service URL
gcloud run services describe flomail --region us-central1 --format="value(status.url)"

# View recent builds
gcloud builds list --limit=5
```

### Custom Domain

```bash
gcloud run domain-mappings create \
    --service flomail \
    --domain flomail.app \
    --region us-central1
```

Then update DNS records as instructed.

## Architecture Notes

### HTML Email Rendering

FloMail uses a smart detection system to render emails appropriately for the dark theme:

**The logic (`isRichHtmlContent` in `EmailHtmlViewer.tsx`):**
- **Default:** Render emails as dark-themed plain text (matches app theme)
- **Exception:** Use white-background iframe ONLY if the email explicitly sets its own styling:
  - Loadable images (http/https/data: URLs)
  - Non-white background colors (bgcolor attribute or CSS)
  - Substantial CSS in style tags (>100 chars, excluding Outlook mso- properties)
  - Tables with explicit visible borders (border > 0)

This approach avoids false positives where simple HTML-formatted text (divs, spans, Outlook layout tables) was incorrectly rendered with a white background.

### Multi-Provider Architecture

The `src/lib/mail-driver/` directory contains a provider abstraction layer:

```typescript
// types.ts - Provider-agnostic interfaces
interface MailDriver {
  getThreads(folder, options): Promise<ParsedThread[]>;
  getMessage(messageId): Promise<ParsedMessage>;
  sendMessage(message): Promise<void>;
  createDraft(data): Promise<string>;
  // ... etc
}

// gmail-driver.ts - Gmail implementation
// (Future: outlook-driver.ts, etc.)
```

Currently only Gmail is implemented. The abstraction allows future Outlook/other provider support without major refactoring.

### Draft Sync with Gmail

Drafts are synced bidirectionally with Gmail:
- **Save:** Creates/updates Gmail draft via `drafts.create` or `drafts.update`
- **Send:** Uses server-side proxy (`/api/gmail/send-draft`) to call `drafts/{id}/send` (avoids CORS)
- **Fallback:** If draft send fails (404), falls back to `messages/send` and cleans up stale draft
- **Delete:** Deletes from Gmail via `drafts.delete`

The `gmailDraftId` is tracked in the `EmailDraft` type and persisted in chat history.

### Server-Side API Routes

| Route | Purpose |
|-------|---------|
| `/api/gmail/send-draft` | Proxy for Gmail `drafts.send` (bypasses CORS) |
| `/api/unsubscribe` | Proxy for List-Unsubscribe POST requests |
| `/api/ai/chat/stream` | Streaming AI chat with tool calling |
| `/api/snooze` | Snooze/unsnooze Gmail operations |
| `/api/search` | Web search via Tavily |
| `/api/browse` | URL content fetching |

## Future Plans

- Task manager integration
- Custom labels management
- Keyboard shortcuts
- Background snooze processing (currently only processes when app is open)
- Outlook/Microsoft 365 provider support (mail-driver architecture ready)

## iOS App (When Ready)

The app is currently a **PWA** (add to home screen from Safari). When you need App Store distribution or push notifications, wrap with **Capacitor** - no code changes required:

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init FloMail com.flomail.app
npx cap add ios
npx cap open ios  # Opens in Xcode
```

Add plugins as needed:
```bash
npm install @capacitor/push-notifications  # Push notifications
npm install @capacitor/haptics              # Haptic feedback
```

**Note:** React Native would require a full UI rewrite. Capacitor wraps the existing web app as-is.
