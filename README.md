# FloMail

**Repository:** https://github.com/gkestin/FloMail

A **voice-first, AI-powered email assistant** that integrates with Gmail. The core concept is "flow" - seamlessly chat, draft, send, and navigate emails without friction.

## Intent

- **Voice-first**: Tap mic, speak, send - one-click voice input with waveform visualization
- **AI Agent**: Uses Claude/GPT with tool calling to draft, send, archive, navigate
- **Flow UX**: Chat with emails, draft inline, edit fields by clicking, minimal clicks throughout
- **Gmail Integration**: Read inbox, reply/forward (threaded), archive, send via Gmail API

## Tech Stack

- **Next.js 15** with TypeScript, Tailwind CSS, Framer Motion
- **Firebase**: Authentication (Google Sign-In with Gmail scopes)
- **AI**: Anthropic Claude + OpenAI GPT (switchable), Whisper for transcription
- **Gmail API**: OAuth 2.0 for email operations

## Project Structure

```
src/
├── app/
│   ├── api/ai/
│   │   ├── chat/route.ts      # AI chat endpoint (Claude/GPT with tools)
│   │   └── transcribe/route.ts # Whisper transcription endpoint
│   ├── page.tsx               # Main app entry
│   └── layout.tsx             # Root layout with PWA manifest
├── components/
│   ├── ChatInterface.tsx      # Main chat UI, voice recording, message handling
│   ├── DraftCard.tsx          # Inline-editable email draft UI
│   ├── InboxList.tsx          # Gmail inbox with thread counts, attachments
│   ├── ThreadPreview.tsx      # Collapsible email thread viewer
│   └── FloMailApp.tsx         # App orchestration (inbox ↔ chat views)
├── contexts/
│   └── AuthContext.tsx        # Firebase auth + Gmail token management
├── lib/
│   ├── firebase.ts            # Firebase initialization
│   ├── gmail.ts               # Gmail API functions (fetch, send, archive)
│   ├── anthropic.ts           # Claude API with agent tools
│   ├── openai.ts              # GPT API with agent tools
│   └── agent-tools.ts         # Tool definitions (prepare_draft, send_email, etc.)
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
```

**`FirebaseConfig.txt`** - Reference copy of Firebase web config (for setup reference)

### Firebase Setup
- Project: `flomail25`
- Auth: Google Sign-In enabled
- Gmail scopes requested: `gmail.readonly`, `gmail.send`, `gmail.modify`

### Google Cloud Console
- OAuth consent screen configured
- OAuth 2.0 credentials with authorized origins/redirects

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
2. **AI Agent Tools**: `prepare_draft`, `send_email`, `archive_email`, `go_to_next_email`, `go_to_inbox`
3. **Inline Draft Editing**: Click any field (To, Subject, Body) to edit in place
4. **Email Threading**: Replies/forwards stay in Gmail thread with proper headers
5. **Model Selection**: Switch between Claude/GPT models via settings popover

## Future Plans

- Task manager integration
- Labels, star, snooze actions
- Keyboard shortcuts
- GCP deployment for scalability

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
