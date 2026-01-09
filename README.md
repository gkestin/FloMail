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
2. **AI Agent Tools**: `prepare_draft`, `send_email`, `archive_email`, `go_to_next_email`, `go_to_inbox`
3. **Inline Draft Editing**: Click any field (To, Subject, Body) to edit in place
4. **Email Threading**: Replies/forwards stay in Gmail thread with proper headers
5. **Model Selection**: Switch between Claude/GPT models via settings popover

## Deployment (GCP Cloud Run)

FloMail is configured for deployment to **Google Cloud Run** - a serverless platform that scales automatically and supports streaming AI responses.

### Prerequisites

1. **Google Cloud CLI** installed: https://cloud.google.com/sdk/docs/install
2. **Docker** installed: https://docs.docker.com/get-docker/
3. GCP project `flomail25` (or update in deploy.sh)

### Quick Deploy

```bash
# One-command deployment (reads .env.local for env vars)
./deploy.sh
```

### Manual Deploy

```bash
# 1. Set your project
gcloud config set project flomail25

# 2. Create Artifact Registry (first time only)
gcloud artifacts repositories create flomail \
    --repository-format=docker \
    --location=us-central1

# 3. Configure Docker auth
gcloud auth configure-docker us-central1-docker.pkg.dev

# 4. Build and push
docker build -t us-central1-docker.pkg.dev/flomail25/flomail/flomail:latest .
docker push us-central1-docker.pkg.dev/flomail25/flomail/flomail:latest

# 5. Deploy to Cloud Run
gcloud run deploy flomail \
    --image us-central1-docker.pkg.dev/flomail25/flomail/flomail:latest \
    --region us-central1 \
    --platform managed \
    --allow-unauthenticated \
    --timeout 300 \
    --memory 512Mi \
    --set-env-vars "OPENAI_API_KEY=...,ANTHROPIC_API_KEY=...,..."
```

### Post-Deployment Setup

After deploying, you'll get a URL like `https://flomail-xxxxx-uc.a.run.app`. You need to:

1. **Firebase Console** → Authentication → Settings → Authorized domains
   - Add your Cloud Run URL

2. **Google Cloud Console** → APIs & Services → Credentials → OAuth 2.0 Client
   - Add to Authorized JavaScript origins: `https://flomail-xxxxx-uc.a.run.app`
   - Add to Authorized redirect URIs: `https://flomail-xxxxx-uc.a.run.app`

3. **Environment Variables** (if not set via deploy.sh)
   - Go to Cloud Run → flomail → Edit → Variables & Secrets
   - Add all env vars from your `.env.local`

### CI/CD with Cloud Build

For automatic deployments on git push:

1. Enable Cloud Build API
2. Connect your GitHub repo in Cloud Build
3. Create a trigger using `cloudbuild.yaml`

### Custom Domain

```bash
gcloud run domain-mappings create \
    --service flomail \
    --domain flomail.app \
    --region us-central1
```

Then update DNS records as instructed.

## Future Plans

- Task manager integration
- Labels, star, snooze actions
- Keyboard shortcuts

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
