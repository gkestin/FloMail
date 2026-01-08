import { EmailMessage, EmailThread, EmailDraft, EmailAddress } from '@/types';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Helper to parse email address string
function parseEmailAddress(str: string): EmailAddress {
  const match = str.match(/^(?:"?([^"]*)"?\s)?<?([^>]+)>?$/);
  if (match) {
    return {
      name: match[1]?.trim() || undefined,
      email: match[2].trim(),
    };
  }
  return { email: str.trim() };
}

// Helper to get header value
function getHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// Helper to decode base64url
function decodeBase64Url(str: string): string {
  // Replace URL-safe characters
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    return atob(base64);
  }
}

// Helper to extract body from message parts
function extractBody(payload: any): { text: string; html: string } {
  let text = '';
  let html = '';

  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') {
      html = decoded;
    } else {
      text = decoded;
    }
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        text = decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        html = decodeBase64Url(part.body.data);
      } else if (part.parts) {
        const nested = extractBody(part);
        if (!text && nested.text) text = nested.text;
        if (!html && nested.html) html = nested.html;
      }
    }
  }

  return { text, html };
}

// Helper to check if message has attachments
function hasAttachments(payload: any): boolean {
  if (payload.filename && payload.filename.length > 0) {
    return true;
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.filename && part.filename.length > 0) {
        return true;
      }
      if (part.parts && hasAttachments(part)) {
        return true;
      }
    }
  }
  return false;
}

// Fetch inbox messages
export async function fetchInbox(
  accessToken: string,
  options: { maxResults?: number; pageToken?: string; query?: string } = {}
): Promise<{ threads: EmailThread[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    maxResults: String(options.maxResults || 20),
    q: options.query || 'in:inbox',
  });
  if (options.pageToken) {
    params.set('pageToken', options.pageToken);
  }

  const response = await fetch(`${GMAIL_API_BASE}/threads?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch inbox: ${response.statusText}`);
  }

  const data = await response.json();
  const threads: EmailThread[] = [];

  if (data.threads) {
    // Fetch thread details in parallel (batch of 10)
    const batchSize = 10;
    for (let i = 0; i < data.threads.length; i += batchSize) {
      const batch = data.threads.slice(i, i + batchSize);
      const threadDetails = await Promise.all(
        batch.map((t: { id: string }) => fetchThread(accessToken, t.id))
      );
      threads.push(...threadDetails);
    }
  }

  return {
    threads,
    nextPageToken: data.nextPageToken,
  };
}

// Fetch single thread with all messages
export async function fetchThread(accessToken: string, threadId: string): Promise<EmailThread> {
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch thread: ${response.statusText}`);
  }

  const data = await response.json();
  const messages: EmailMessage[] = [];
  const participants = new Map<string, EmailAddress>();

  for (const msg of data.messages || []) {
    const headers = msg.payload?.headers || [];
    const { text, html } = extractBody(msg.payload);
    
    const from = parseEmailAddress(getHeader(headers, 'From'));
    const toRaw = getHeader(headers, 'To');
    const to = toRaw ? toRaw.split(',').map(parseEmailAddress) : [];
    const ccRaw = getHeader(headers, 'Cc');
    const cc = ccRaw ? ccRaw.split(',').map(parseEmailAddress) : undefined;

    // Track participants
    if (from.email) participants.set(from.email, from);
    to.forEach((t) => participants.set(t.email, t));
    cc?.forEach((c) => participants.set(c.email, c));

    messages.push({
      id: msg.id,
      threadId: msg.threadId,
      messageId: getHeader(headers, 'Message-ID') || getHeader(headers, 'Message-Id'),
      snippet: msg.snippet || '',
      subject: getHeader(headers, 'Subject'),
      from,
      to,
      cc,
      date: getHeader(headers, 'Date'),
      body: text || html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      bodyHtml: html || undefined,
      isRead: !msg.labelIds?.includes('UNREAD'),
      labels: msg.labelIds || [],
      hasAttachments: hasAttachments(msg.payload),
    });
  }

  const lastMessage = messages[messages.length - 1];

  return {
    id: data.id,
    messages,
    subject: lastMessage?.subject || '(No Subject)',
    snippet: lastMessage?.snippet || '',
    lastMessageDate: lastMessage?.date || '',
    participants: Array.from(participants.values()),
    isRead: !data.messages?.some((m: any) => m.labelIds?.includes('UNREAD')),
    labels: [...new Set(data.messages?.flatMap((m: any) => m.labelIds || []) || [])] as string[],
  };
}

// Send email
export async function sendEmail(accessToken: string, draft: EmailDraft): Promise<void> {
  // Build headers array, filtering out empty optional headers
  // For replies/forwards, include threading headers
  const headers = [
    `To: ${draft.to.join(', ')}`,
    draft.cc?.length ? `Cc: ${draft.cc.join(', ')}` : null,
    draft.bcc?.length ? `Bcc: ${draft.bcc.join(', ')}` : null,
    `Subject: ${draft.subject}`,
    // Threading headers - In-Reply-To should be the Message-ID of the email being replied to
    draft.inReplyTo ? `In-Reply-To: ${draft.inReplyTo}` : null,
    // References should be the chain of Message-IDs for proper threading
    draft.references ? `References: ${draft.references}` : (draft.inReplyTo ? `References: ${draft.inReplyTo}` : null),
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ].filter((h): h is string => h !== null);
  
  // RFC 2822: headers + blank line + body (including quoted content for replies/forwards)
  const fullBody = draft.quotedContent 
    ? draft.body + draft.quotedContent 
    : draft.body;
  const email = headers.join('\r\n') + '\r\n\r\n' + fullBody;

  const encodedEmail = btoa(unescape(encodeURIComponent(email)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await fetch(`${GMAIL_API_BASE}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: encodedEmail,
      threadId: draft.threadId,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to send email');
  }
}

// Archive thread (remove from inbox)
export async function archiveThread(accessToken: string, threadId: string): Promise<void> {
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      removeLabelIds: ['INBOX'],
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to archive thread');
  }
}

// Mark thread as read
export async function markAsRead(accessToken: string, threadId: string): Promise<void> {
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      removeLabelIds: ['UNREAD'],
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to mark as read');
  }
}

// Trash thread
export async function trashThread(accessToken: string, threadId: string): Promise<void> {
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}/trash`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to trash thread');
  }
}

// Create Gmail draft
export async function createGmailDraft(accessToken: string, draft: EmailDraft): Promise<string> {
  // Build headers array, filtering out empty optional headers
  const headers = [
    `To: ${draft.to.join(', ')}`,
    draft.cc?.length ? `Cc: ${draft.cc.join(', ')}` : null,
    draft.bcc?.length ? `Bcc: ${draft.bcc.join(', ')}` : null,
    `Subject: ${draft.subject}`,
    draft.inReplyTo ? `In-Reply-To: ${draft.inReplyTo}` : null,
    draft.references ? `References: ${draft.references}` : (draft.inReplyTo ? `References: ${draft.inReplyTo}` : null),
    'Content-Type: text/plain; charset=utf-8',
    'MIME-Version: 1.0',
  ].filter((h): h is string => h !== null);
  
  // RFC 2822: headers + blank line + body (including quoted content for replies/forwards)
  const fullBody = draft.quotedContent 
    ? draft.body + draft.quotedContent 
    : draft.body;
  const email = headers.join('\r\n') + '\r\n\r\n' + fullBody;

  const encodedEmail = btoa(unescape(encodeURIComponent(email)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const response = await fetch(`${GMAIL_API_BASE}/drafts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        raw: encodedEmail,
        threadId: draft.threadId,
      },
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to create draft');
  }

  const data = await response.json();
  return data.id;
}

