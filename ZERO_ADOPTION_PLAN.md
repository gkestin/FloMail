# Zero → FloMail Adoption Plan

## Status: Phase 1 & 2 Complete ✅

**Last Updated**: January 10, 2026

### Completed Features:
- ✅ Email parsing utilities (RFC-compliant address parsing)
- ✅ Mail driver abstraction layer (MailDriver interface)
- ✅ Gmail driver implementation
- ✅ List-unsubscribe functionality (one-click unsubscribe)
- ✅ TLS encryption indicator
- ✅ Low-contrast color fixing for dark mode
- ✅ Enhanced attachment handling with file type icons

### Files Created:
- `src/lib/email-parsing.ts` - Email parsing utilities
- `src/lib/mail-driver/types.ts` - Provider-agnostic interface
- `src/lib/mail-driver/gmail-driver.ts` - Gmail implementation
- `src/lib/mail-driver/index.ts` - Module exports
- `src/components/UnsubscribeButton.tsx` - One-click unsubscribe UI
- `src/app/api/unsubscribe/route.ts` - Unsubscribe proxy API

---

## Executive Summary

After thorough analysis of Zero's 366-file codebase, I recommend a **selective adoption strategy** - extracting specific utilities and patterns while keeping FloMail's simpler architecture.

**Key Decision: Keep FloMail architecture, adopt specific components**

### Why NOT Full Migration to Zero:
1. **Different Framework**: Zero uses React Router + Vite, we use Next.js
2. **Different Backend**: Zero uses Cloudflare Workers, we use Next.js API routes
3. **Different Database**: Zero uses PostgreSQL + Drizzle, we use Firebase/Firestore
4. **Different State Management**: Zero uses Jotai, we use React state + context
5. **Massive Complexity**: 366 files vs our 24 files - would take weeks to understand

### What Zero Does Well (to adopt):
1. Multi-provider abstraction (Gmail + Outlook)
2. Email parsing utilities
3. List-unsubscribe handling
4. TipTap rich text editor
5. Email content sanitization

---

## Adoption Categories

### 🟢 CATEGORY A: Direct Copy (Minimal Modifications)
Files that can be copied almost verbatim with minor import adjustments.

### 🟡 CATEGORY B: Copy & Modify
Files that need significant adaptation but logic can be preserved.

### 🔴 CATEGORY C: Rewrite Based on Logic
Components where only the concepts/patterns should be adopted.

---

## Detailed Component Analysis

### 1. EMAIL PROVIDER ABSTRACTION (Multi-Provider Support)

**Goal**: Support Gmail now, Outlook later, with same interface

**Zero's Approach**:
```
apps/server/src/lib/driver/
├── index.ts      # Factory: createDriver('google', config)
├── types.ts      # MailManager interface (54 methods!)
├── google.ts     # GoogleMailManager (1,500 lines)
├── microsoft.ts  # OutlookMailManager (1,300 lines)
└── utils.ts      # Shared utilities
```

**Adoption Strategy**: 🟡 CATEGORY B - Copy & Modify

**What to copy**:
- `types.ts` - The `MailManager` interface (simplified version)
- `utils.ts` - Helper functions (fromBase64Url, findHtmlBody, etc.)
- `index.ts` - Factory pattern for creating drivers

**What to modify**:
- Remove Cloudflare Workers dependencies
- Remove Hono context dependencies  
- Adapt to use our existing auth system (Firebase)
- Remove methods we don't need yet (bulk delete spam, etc.)

**New files to create**:
```
src/lib/
├── mail-driver/
│   ├── index.ts       # Factory function
│   ├── types.ts       # MailManager interface
│   ├── google.ts      # Gmail implementation (refactor existing gmail.ts)
│   ├── microsoft.ts   # Outlook implementation (future)
│   └── utils.ts       # Shared utilities
```

**Estimated effort**: 4-6 hours

---

### 2. EMAIL PARSING UTILITIES

**Goal**: Better email address parsing, list-unsubscribe support

**Zero's Files**:
```
apps/server/src/lib/email-utils.ts  # 159 lines - CLEAN, USEFUL
apps/mail/lib/email-utils.ts        # 250 lines - Client-side version
```

**Adoption Strategy**: 🟢 CATEGORY A - Direct Copy

**What to copy verbatim**:
```typescript
// From apps/server/src/lib/email-utils.ts
- getListUnsubscribeAction()  // Parse unsubscribe headers
- parseFrom()                  // Parse "From" header properly
- parseAddressList()           // Parse To/CC/BCC
- cleanEmailAddresses()        // Remove angle brackets
- formatRecipients()           // Format for display
- formatMimeRecipients()       // Format for MIME messages
- wasSentWithTLS()            // Check email security
```

**Dependencies to add**:
```bash
npm install email-addresses
```

**New file**:
```
src/lib/email-parsing.ts  # Copy Zero's utilities
```

**Estimated effort**: 1-2 hours

---

### 3. LIST-UNSUBSCRIBE FUNCTIONALITY

**Goal**: One-click unsubscribe from mailing lists

**Zero's Approach**:
- Parse `List-Unsubscribe` and `List-Unsubscribe-Post` headers
- Support HTTP GET, HTTP POST, and mailto: unsubscribe methods
- Display unsubscribe button in UI

**Files to reference**:
```
apps/server/src/lib/email-utils.ts  # getListUnsubscribeAction()
apps/mail/lib/email-utils.ts        # Client-side version
```

**Adoption Strategy**: 🟢 CATEGORY A - Direct Copy

**Implementation**:
1. Add header extraction in `gmail.ts`
2. Create `/api/unsubscribe` route
3. Add UI button in thread view

**Estimated effort**: 3-4 hours

---

### 4. TIPTAP RICH TEXT EDITOR

**Goal**: Rich text email composition (bold, italic, links, images)

**Zero's Implementation**:
```
apps/mail/components/create/
├── editor.tsx           # Main editor component (369 lines)
├── extensions.ts        # TipTap extensions (171 lines)
├── editor-menu.tsx      # Formatting toolbar
├── toolbar.tsx          # Toolbar component
├── slash-command.tsx    # Slash commands for formatting
├── email-composer.tsx   # Full composer (1,171 lines!)
└── prosemirror.css      # Editor styles
```

**Adoption Strategy**: 🔴 CATEGORY C - Rewrite Based on Logic

**Why rewrite**:
- email-composer.tsx has 1,171 lines - too complex
- Uses Novel library (TipTap wrapper)
- Tightly integrated with their tRPC routes
- We can build a simpler version

**What to adopt**:
1. Install TipTap core packages
2. Copy `extensions.ts` (minimal modifications)
3. Build simpler editor component

**Dependencies**:
```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-placeholder @tiptap/extension-image novel
```

**Estimated effort**: 8-12 hours (can be deferred)

---

### 5. EMAIL HTML RENDERING

**Goal**: Safe rendering of HTML emails with external image handling

**Zero's Approach**:
```
apps/mail/components/mail/mail-content.tsx  # Uses Shadow DOM
apps/mail/lib/email-utils.ts                # cleanHtml() with DOMPurify
apps/mail/lib/sanitize-tip-tap-html.tsx     # Output sanitization
```

**Adoption Strategy**: 🟡 ALREADY DONE! 

We already created `EmailHtmlViewer.tsx` with:
- DOMPurify sanitization
- Sandboxed iframe
- Auto-height adjustment

**Remaining work**:
- Add external image blocking option
- Add "trusted sender" concept
- Add color contrast fixing (from Zero's `fixNonReadableColors`)

**Estimated effort**: 2-3 hours (enhancements)

---

### 6. SNOOZE FUNCTIONALITY

**Your current implementation**: ✅ Keep as-is

**Zero's snooze-dialog.tsx**: Simpler (just date/time picker)

**Decision**: Keep your implementation - it's more feature-rich

---

### 7. DRAFT MANAGEMENT

**Goal**: Better draft creation, updating, sending

**Zero's Pattern**:
```typescript
// From google.ts
public sendDraft(draftId: string, data: IOutgoingMessage) {
  const { raw } = await this.parseOutgoing(data);
  await this.gmail.users.drafts.send({
    userId: 'me',
    requestBody: {
      id: draftId,
      message: { raw, id: draftId },
    },
  });
}
```

**Adoption Strategy**: 🟡 CATEGORY B - Already incorporated patterns

We already updated our `sendEmail` to use `drafts.send` properly.

---

### 8. AI COMPOSE FUNCTIONALITY

**Goal**: AI-assisted email writing

**Zero's Approach**:
```
apps/server/src/trpc/routes/ai/compose.ts  # 291 lines
apps/server/src/lib/prompts.ts             # System prompts
apps/server/src/services/writing-style-service.ts  # Style learning
```

**Adoption Strategy**: 🔴 CATEGORY C - Concepts only

**What to learn**:
- Writing style matrix concept
- How they structure prompts for email composition
- Thread context injection

**Our current implementation**: Already good! Just enhance prompts.

---

## Implementation Order (Prioritized)

### Phase 1: Foundation ✅ COMPLETED
| Priority | Task | Category | Status | Notes |
|----------|------|----------|--------|-------|
| 1 | Email parsing utilities | 🟢 Copy | ✅ Done | `src/lib/email-parsing.ts` |
| 2 | Driver abstraction types | 🟡 Modify | ✅ Done | `src/lib/mail-driver/types.ts` |
| 3 | Gmail driver implementation | 🟡 Modify | ✅ Done | `src/lib/mail-driver/gmail-driver.ts` |
| 4 | List-unsubscribe parsing | 🟢 Copy | ✅ Done | In `email-parsing.ts` |

### Phase 2: Enhancements ✅ COMPLETED
| Priority | Task | Category | Status | Notes |
|----------|------|----------|--------|-------|
| 5 | List-unsubscribe UI & API | 🟡 New | ✅ Done | `UnsubscribeButton.tsx`, `/api/unsubscribe` |
| 6 | Email color contrast fixing | 🟡 Copy+Modify | ✅ Done | `fixLowContrastColors()` in EmailHtmlViewer |
| 7 | Enhanced types with TLS/headers | 🟡 New | ✅ Done | Updated `types/index.ts` |

### Phase 3: Rich Text (Later)
| Priority | Task | Category | Status | Notes |
|----------|------|----------|--------|-------|
| 8 | TipTap editor setup | 🔴 Rewrite | ⏳ Pending | Optional enhancement |
| 9 | Rich text composer | 🔴 Rewrite | ⏳ Pending | Optional enhancement |
| 10 | Outlook provider | 🟡 Copy+Modify | ⏳ Pending | Future multi-provider support |

---

## Files to Create/Modify

### New Files:
```
src/lib/
├── mail-driver/
│   ├── index.ts           # Driver factory
│   ├── types.ts           # MailManager interface  
│   ├── google.ts          # Gmail driver (from gmail.ts)
│   ├── microsoft.ts       # Outlook driver (future)
│   └── utils.ts           # Shared utilities
├── email-parsing.ts       # From Zero's email-utils.ts
└── unsubscribe.ts         # List-unsubscribe handling

src/app/api/
└── unsubscribe/
    └── route.ts           # Unsubscribe API endpoint

src/components/
├── RichTextEditor.tsx     # TipTap wrapper (future)
└── UnsubscribeButton.tsx  # UI component
```

### Files to Modify:
```
src/lib/gmail.ts           # Refactor to implement MailManager interface
src/components/ThreadPreview.tsx  # Add unsubscribe button
src/types/index.ts         # Add new types
```

---

## Dependencies to Add

```bash
# Phase 1 - Email parsing
npm install email-addresses

# Phase 3 - Rich text (later)
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-placeholder @tiptap/extension-image
```

---

## Risk Assessment

### Low Risk:
- Email parsing utilities (isolated, well-tested in Zero)
- List-unsubscribe (standalone feature)

### Medium Risk:
- Driver abstraction (touches core gmail.ts)
- Need thorough testing after refactor

### High Risk:
- TipTap editor (complex, many edge cases)
- Outlook provider (new integration, different API)

---

## Testing Strategy

1. **For each copied utility**: Write unit tests before integrating
2. **For driver refactor**: Keep existing tests passing
3. **For new features**: Manual testing + integration tests

---

## Summary

**Total Estimated Effort**: 
- Phase 1: 10 hours
- Phase 2: 8 hours  
- Phase 3: 20 hours

**Recommendation**: Start with Phase 1 to get immediate benefits while maintaining stability.

Would you like me to start with Phase 1, Task 1 (Email parsing utilities)?
