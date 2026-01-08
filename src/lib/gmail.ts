import { EmailMessage, EmailThread, EmailDraft, EmailAddress, DraftAttachment } from '@/types';
import { createMimeMessage } from 'mimetext';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ============================================================================
// EMAIL BUILDING WITH MIMETEXT (RFC-COMPLIANT)
// ============================================================================
// Using mimetext library for proper RFC 5322, 2047, 2045-2049 compliance.
// This handles all the edge cases: UTF-8 headers, line wrapping, encoding, etc.

/**
 * Convert plain text to HTML, preserving line breaks and paragraphs.
 * This prevents Gmail API from inserting unwanted line wraps.
 */
function textToHtml(text: string): string {
  // Escape HTML special characters
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  
  // Normalize to \n, then process
  const normalized = escaped.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Split by double newlines (paragraphs)
  const paragraphs = normalized.split(/\n\n+/);
  
  // Wrap each paragraph and convert single newlines to <br>
  const htmlParagraphs = paragraphs.map(p => {
    const withBreaks = p.replace(/\n/g, '<br>\n');
    return `<p style="margin: 0 0 1em 0;">${withBreaks}</p>`;
  });
  
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #333;">
${htmlParagraphs.join('\n')}
</body>
</html>`;
}

/**
 * Build a properly formatted email using mimetext library.
 * Returns base64url encoded string ready for Gmail API.
 */
function buildEmailForGmail(draft: EmailDraft): string {
  const msg = createMimeMessage();
  
  // Set sender (will be overwritten by Gmail to authenticated user)
  msg.setSender({ addr: 'me@gmail.com' });
  
  // Set recipients
  msg.setRecipients(draft.to.map(addr => ({ addr })));
  
  // Set CC if present
  if (draft.cc && draft.cc.length > 0) {
    msg.setCc(draft.cc.map(addr => ({ addr })));
  }
  
  // Set BCC if present
  if (draft.bcc && draft.bcc.length > 0) {
    msg.setBcc(draft.bcc.map(addr => ({ addr })));
  }
  
  // Set subject (mimetext handles RFC 2047 encoding automatically)
  msg.setSubject(draft.subject);
  
  // Set threading headers if replying/forwarding
  if (draft.inReplyTo) {
    msg.setHeader('In-Reply-To', draft.inReplyTo);
  }
  if (draft.references) {
    msg.setHeader('References', draft.references);
  }
  
  // Prepare body content
  const rawBody = draft.quotedContent 
    ? draft.body.trim() + '\n\n' + draft.quotedContent.trim() 
    : draft.body.trim();
  
  // Convert to HTML to prevent Gmail's line wrapping issues
  const htmlBody = textToHtml(rawBody);
  
  // Add HTML content (mimetext handles encoding properly)
  msg.addMessage({
    contentType: 'text/html',
    data: htmlBody,
  });
  
  // Add attachments if present
  if (draft.attachments && draft.attachments.length > 0) {
    for (const attachment of draft.attachments) {
      if (attachment.data) {
        // Attachment data is already base64 encoded
        msg.addAttachment({
          filename: attachment.filename,
          contentType: attachment.mimeType,
          data: attachment.data,
          encoding: 'base64',
        });
      }
    }
  }
  
  // Get the raw MIME message and encode for Gmail API
  const rawMessage = msg.asRaw();
  
  // Convert to base64url for Gmail API
  const bytes = new TextEncoder().encode(rawMessage);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

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

// Extract attachment details from message payload
interface AttachmentInfo {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

function extractAttachments(payload: any): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  
  function processPayload(part: any) {
    // Check if this part is an attachment
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      attachments.push({
        id: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
      });
    }
    // Recursively process nested parts
    if (part.parts) {
      for (const subpart of part.parts) {
        processPayload(subpart);
      }
    }
  }
  
  processPayload(payload);
  return attachments;
}

// Fetch threads by label or query
// Gmail API supports:
// - labelIds: Array of system label IDs (INBOX, SENT, STARRED, etc.)
// - q: Search query for complex filtering (like archive: -in:inbox)
export async function fetchInbox(
  accessToken: string,
  options: { maxResults?: number; pageToken?: string; query?: string; labelIds?: string[] } = {}
): Promise<{ threads: EmailThread[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    maxResults: String(options.maxResults || 20),
  });
  
  // Use labelIds if provided (preferred Gmail API approach)
  if (options.labelIds && options.labelIds.length > 0) {
    options.labelIds.forEach(label => params.append('labelIds', label));
  } else if (options.query) {
    // Fall back to query for complex filtering (like archive)
    params.set('q', options.query);
  }
  // If neither is provided, fetch all mail (no filter)
  
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

    // Extract attachment details
    const attachments = extractAttachments(msg.payload);
    
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
      hasAttachments: attachments.length > 0,
      attachments: attachments.length > 0 ? attachments : undefined,
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

// Send email using mimetext library for proper RFC compliance
export async function sendEmail(accessToken: string, draft: EmailDraft): Promise<void> {
  // Build properly formatted email using mimetext library
  const encodedEmail = buildEmailForGmail(draft);

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

// Download attachment content from Gmail
export async function getAttachment(
  accessToken: string, 
  messageId: string, 
  attachmentId: string
): Promise<string> {
  const response = await fetch(
    `${GMAIL_API_BASE}/messages/${messageId}/attachments/${attachmentId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to download attachment');
  }

  const data = await response.json();
  // Gmail returns base64url encoded data, convert to standard base64
  const base64 = data.data
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  return base64;
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

// Move thread to inbox (unarchive)
export async function moveToInbox(accessToken: string, threadId: string): Promise<void> {
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      addLabelIds: ['INBOX'],
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to move to inbox');
  }
}

// Star a thread
export async function starThread(accessToken: string, threadId: string): Promise<void> {
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      addLabelIds: ['STARRED'],
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to star thread');
  }
}

// Unstar a thread
export async function unstarThread(accessToken: string, threadId: string): Promise<void> {
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      removeLabelIds: ['STARRED'],
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to unstar thread');
  }
}

// Get thread labels (to check current state)
export async function getThreadLabels(accessToken: string, threadId: string): Promise<string[]> {
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}?format=minimal`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to get thread labels');
  }

  const data = await response.json();
  // Collect all unique labels from all messages in the thread
  const labels = new Set<string>();
  for (const msg of data.messages || []) {
    for (const label of msg.labelIds || []) {
      labels.add(label);
    }
  }
  return Array.from(labels);
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

// Create Gmail draft using mimetext library for proper RFC compliance
export async function createGmailDraft(accessToken: string, draft: EmailDraft): Promise<string> {
  // Build properly formatted email using mimetext library
  const encodedEmail = buildEmailForGmail(draft);

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

