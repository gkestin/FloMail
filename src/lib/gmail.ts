import { EmailMessage, EmailThread, EmailDraft, EmailAddress, DraftAttachment } from '@/types';
import { createMimeMessage } from 'mimetext';
import { parseFrom, parseAddressList, wasSentWithTLS, getListUnsubscribeAction } from './email-parsing';
import type { ListUnsubscribeAction } from './mail-driver/types';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ============================================================================
// HTML ENTITY DECODING
// ============================================================================

/**
 * Decode HTML entities in text (used for snippets from Gmail API)
 */
function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  let decoded = text;
  // Named entities
  decoded = decoded.replace(/&nbsp;/gi, ' ');
  decoded = decoded.replace(/&amp;/gi, '&');
  decoded = decoded.replace(/&lt;/gi, '<');
  decoded = decoded.replace(/&gt;/gi, '>');
  decoded = decoded.replace(/&quot;/gi, '"');
  decoded = decoded.replace(/&#39;/gi, "'");
  decoded = decoded.replace(/&apos;/gi, "'");
  decoded = decoded.replace(/&ndash;/gi, '\u2013');
  decoded = decoded.replace(/&mdash;/gi, '\u2014');
  decoded = decoded.replace(/&lsquo;/gi, '\u2018');
  decoded = decoded.replace(/&rsquo;/gi, '\u2019');
  decoded = decoded.replace(/&ldquo;/gi, '\u201C');
  decoded = decoded.replace(/&rdquo;/gi, '\u201D');
  decoded = decoded.replace(/&hellip;/gi, '\u2026');
  decoded = decoded.replace(/&copy;/gi, '\u00A9');
  decoded = decoded.replace(/&reg;/gi, '\u00AE');
  decoded = decoded.replace(/&trade;/gi, '\u2122');
  // Numeric entities (decimal)
  decoded = decoded.replace(/&#(\d+);/gi, (_, num) => String.fromCharCode(parseInt(num, 10)));
  // Numeric entities (hex)
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return decoded;
}

// Re-export list unsubscribe utilities for use in components
export { getListUnsubscribeAction };
export type { ListUnsubscribeAction };

// ============================================================================
// EMAIL BUILDING WITH MIMETEXT (RFC-COMPLIANT)
// ============================================================================
// Using mimetext library for proper RFC 5322, 2047, 2045-2049 compliance.
// This handles all the edge cases: UTF-8 headers, line wrapping, encoding, etc.

/**
 * Convert plain text to HTML, preserving line breaks and paragraphs.
 * This prevents Gmail API from inserting unwanted line wraps.
 */
/**
 * Convert plain text to HTML paragraphs (body content only, no wrapper)
 */
function textToHtmlBody(text: string): string {
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
  return paragraphs.map(p => {
    const withBreaks = p.replace(/\n/g, '<br>\n');
    return `<div style="margin: 0 0 1em 0;">${withBreaks}</div>`;
  }).join('\n');
}

/**
 * Wrap HTML body content in a full email HTML document
 */
function wrapInEmailHtml(bodyContent: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #333;">
${bodyContent}
</body>
</html>`;
}

/**
 * Build HTML for a reply with Gmail-style quoted content
 */
function buildReplyHtml(userMessageHtml: string, quotedContent: string): string {
  // Gmail uses a div with class "gmail_quote" for quoted content
  // The quoted content is wrapped in a blockquote
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #333;">
${userMessageHtml}
<br>
<div class="gmail_quote">
<blockquote style="margin: 0 0 0 0.8ex; border-left: 1px solid #ccc; padding-left: 1ex;">
${quotedContent}
</blockquote>
</div>
</body>
</html>`;
}

/**
 * Build HTML for a forwarded message
 */
function buildForwardHtml(userMessageHtml: string, forwardedContent: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.5; color: #333;">
${userMessageHtml}
<br>
<div style="border-top: 1px solid #ccc; padding-top: 1em; margin-top: 1em;">
${forwardedContent}
</div>
</body>
</html>`;
}

/**
 * Legacy function for simple text to HTML conversion
 */
function textToHtml(text: string): string {
  return wrapInEmailHtml(textToHtmlBody(text));
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
  
  // Build HTML body with proper quoting
  // User's new message as HTML
  const userMessageHtml = textToHtmlBody(draft.body.trim());
  
  // Build the full HTML email
  let fullHtmlBody: string;
  
  if (draft.type === 'reply' && draft.quotedContent) {
    // For replies, include the original message in a Gmail-style quote block
    // The quotedContent should be the raw HTML of the original message (or cleaned text)
    fullHtmlBody = buildReplyHtml(userMessageHtml, draft.quotedContent);
  } else if (draft.type === 'forward' && draft.quotedContent) {
    // For forwards, include the forwarded content
    fullHtmlBody = buildForwardHtml(userMessageHtml, draft.quotedContent);
  } else {
    // New message or no quoted content
    fullHtmlBody = wrapInEmailHtml(userMessageHtml);
  }
  
  // Add HTML content (mimetext handles encoding properly)
  msg.addMessage({
    contentType: 'text/html',
    data: fullHtmlBody,
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
  if (!payload) return false;
  if (payload.filename && payload.filename.length > 0) {
    return true;
  }
  if (payload.body?.attachmentId) {
    return true;
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.filename && part.filename.length > 0) {
        return true;
      }
      if (part.body?.attachmentId) {
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
    // Fetch ALL thread metadata in parallel (not batched) - much faster!
    const threadDetails = await Promise.all(
      data.threads.map((t: { id: string }) => fetchThreadMetadata(accessToken, t.id))
    );
    threads.push(...threadDetails);
  }

  return {
    threads,
    nextPageToken: data.nextPageToken,
  };
}

/**
 * Fetch thread with METADATA only (fast - for inbox list)
 * Does NOT fetch message bodies, only headers and snippet
 */
async function fetchThreadMetadata(accessToken: string, threadId: string): Promise<EmailThread> {
  // Use format=full with fields mask to include attachment structure but avoid body data
  const fields = [
    'id',
    'messages(id,threadId,labelIds,snippet,payload/headers,payload/filename,payload/parts,payload/body/attachmentId)',
  ].join(',');
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}?format=full&fields=${encodeURIComponent(fields)}&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Cc`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch thread metadata: ${response.statusText}`);
  }

  const data = await response.json();
  const messages: EmailMessage[] = [];
  const participants = new Map<string, EmailAddress>();

  for (const msg of data.messages || []) {
    const headers = msg.payload?.headers || [];
    
    const fromHeader = getHeader(headers, 'From');
    const parsedFrom = parseFrom(fromHeader);
    const from: EmailAddress = { name: parsedFrom.name || undefined, email: parsedFrom.email };
    
    const toRaw = getHeader(headers, 'To');
    const parsedTo = parseAddressList(toRaw);
    const to: EmailAddress[] = parsedTo.map(p => ({ name: p.name || undefined, email: p.email }));
    
    const ccRaw = getHeader(headers, 'Cc');
    const parsedCc = ccRaw ? parseAddressList(ccRaw) : [];
    const cc: EmailAddress[] | undefined = parsedCc.length > 0 
      ? parsedCc.map(p => ({ name: p.name || undefined, email: p.email })) 
      : undefined;

    // Track participants
    if (from.email) participants.set(from.email, from);
    to.forEach((t) => participants.set(t.email, t));
    cc?.forEach((c) => participants.set(c.email, c));

    // Check for attachments in metadata (payload.parts may be available)
    const msgHasAttachments = msg.payload ? hasAttachments(msg.payload) : false;
    
    messages.push({
      id: msg.id,
      threadId: msg.threadId,
      snippet: decodeHtmlEntities(msg.snippet || ''),
      subject: getHeader(headers, 'Subject'),
      from,
      to,
      cc,
      date: getHeader(headers, 'Date'),
      body: msg.snippet || '', // Use snippet as placeholder until full load
      isRead: !msg.labelIds?.includes('UNREAD'),
      labels: msg.labelIds || [],
      hasAttachments: msgHasAttachments,
      // Flag indicating full content not loaded
      _metadataOnly: true,
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
    _metadataOnly: true, // Flag to indicate full content needs loading
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
    
    // Use improved email parsing from email-parsing module
    const fromHeader = getHeader(headers, 'From');
    const parsedFrom = parseFrom(fromHeader);
    const from: EmailAddress = { name: parsedFrom.name || undefined, email: parsedFrom.email };
    
    const toRaw = getHeader(headers, 'To');
    const parsedTo = parseAddressList(toRaw);
    const to: EmailAddress[] = parsedTo.map(p => ({ name: p.name || undefined, email: p.email }));
    
    const ccRaw = getHeader(headers, 'Cc');
    const parsedCc = ccRaw ? parseAddressList(ccRaw) : [];
    const cc: EmailAddress[] | undefined = parsedCc.length > 0 
      ? parsedCc.map(p => ({ name: p.name || undefined, email: p.email })) 
      : undefined;
    
    const bccRaw = getHeader(headers, 'Bcc');
    const parsedBcc = bccRaw ? parseAddressList(bccRaw) : [];
    const bcc: EmailAddress[] | undefined = parsedBcc.length > 0
      ? parsedBcc.map(p => ({ name: p.name || undefined, email: p.email }))
      : undefined;

    // Track participants
    if (from.email) participants.set(from.email, from);
    to.forEach((t) => participants.set(t.email, t));
    cc?.forEach((c) => participants.set(c.email, c));

    // Extract attachment details
    const attachments = extractAttachments(msg.payload);
    
    // Extract additional headers for advanced features
    const replyTo = getHeader(headers, 'Reply-To') || undefined;
    const inReplyTo = getHeader(headers, 'In-Reply-To') || undefined;
    const references = getHeader(headers, 'References') || undefined;
    const listUnsubscribe = getHeader(headers, 'List-Unsubscribe') || undefined;
    const listUnsubscribePost = getHeader(headers, 'List-Unsubscribe-Post') || undefined;
    
    // Check TLS status from Received headers
    const receivedHeaders = headers
      .filter((h: { name: string; value: string }) => h.name.toLowerCase() === 'received')
      .map((h: { name: string; value: string }) => h.value);
    const tls = wasSentWithTLS(receivedHeaders);
    
    messages.push({
      id: msg.id,
      threadId: msg.threadId,
      messageId: getHeader(headers, 'Message-ID') || getHeader(headers, 'Message-Id'),
      snippet: decodeHtmlEntities(msg.snippet || ''),
      subject: getHeader(headers, 'Subject'),
      from,
      to,
      cc,
      bcc,
      replyTo,
      date: getHeader(headers, 'Date'),
      body: text || html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
      bodyHtml: html || undefined,
      isRead: !msg.labelIds?.includes('UNREAD'),
      labels: msg.labelIds || [],
      hasAttachments: attachments.length > 0,
      attachments: attachments.length > 0 ? attachments : undefined,
      inReplyTo,
      references,
      listUnsubscribe,
      listUnsubscribePost,
      tls,
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
  const draftIdToCleanup = draft.gmailDraftId;
  
  // If we have a Gmail draft ID, try to use drafts.send which automatically:
  // 1. Sends the email
  // 2. Deletes the draft from the Drafts folder
  // 3. Creates the sent message in the Sent folder
  if (draftIdToCleanup) {
    console.log('[sendEmail] Attempting to send saved draft:', draftIdToCleanup);
    const response = await fetch('/api/gmail/send-draft', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ draftId: draftIdToCleanup }),
    });

    if (response.ok) {
      console.log('[sendEmail] Draft sent successfully via drafts.send');
      return; // Draft is automatically deleted by Gmail
    }
    
    // If draft not found (404), fall back to sending as new message
    if (response.status === 404) {
      console.log('[sendEmail] Draft not found in Gmail, falling back to messages/send');
      // Continue to the regular send flow below
    } else {
      // For other errors, throw
      let errorMessage = 'Failed to send draft';
      try {
        const errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        errorMessage = `Server error (${response.status})`;
      }
      console.error('[sendEmail] Draft send failed:', errorMessage);
      throw new Error(errorMessage);
    }
  }

  // Send as a new message (either no draft ID, or draft wasn't found)
  console.log('[sendEmail] Sending via messages/send');
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
  
  console.log('[sendEmail] Message sent successfully');
  
  // If we had a draft ID and fell back to messages/send, try to clean up the draft
  // (It might have been in a weird state or the ID was stale)
  if (draftIdToCleanup) {
    console.log('[sendEmail] Cleaning up draft after fallback send:', draftIdToCleanup);
    try {
      await deleteGmailDraft(accessToken, draftIdToCleanup);
      console.log('[sendEmail] Draft cleanup successful');
    } catch (e) {
      // Draft might already be deleted, that's fine
      console.log('[sendEmail] Draft cleanup skipped (probably already deleted)');
    }
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

// ============================================================================
// GMAIL DRAFTS API
// ============================================================================

// Create Gmail draft using mimetext library for proper RFC compliance
export async function createGmailDraft(accessToken: string, draft: EmailDraft): Promise<string> {
  console.log('[createGmailDraft] Creating draft for thread:', draft.threadId);
  
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
    const errorText = await response.text();
    console.error('[createGmailDraft] Failed:', response.status, errorText);
    throw new Error('Failed to create draft');
  }

  const data = await response.json();
  console.log('[createGmailDraft] Created draft with ID:', data.id);
  return data.id;
}

// Update an existing Gmail draft
export async function updateGmailDraft(accessToken: string, draftId: string, draft: EmailDraft): Promise<string> {
  console.log('[updateGmailDraft] Updating draft:', draftId);
  
  const encodedEmail = buildEmailForGmail(draft);

  const response = await fetch(`${GMAIL_API_BASE}/drafts/${draftId}`, {
    method: 'PUT',
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
    // If draft not found, create a new one instead
    if (response.status === 404) {
      console.log('[updateGmailDraft] Draft not found, creating new draft');
      return createGmailDraft(accessToken, draft);
    }
    const errorText = await response.text();
    console.error('[updateGmailDraft] Failed:', response.status, errorText);
    throw new Error('Failed to update draft');
  }

  const data = await response.json();
  console.log('[updateGmailDraft] Updated draft, new ID:', data.id);
  return data.id;
}

// Delete a Gmail draft
export async function deleteGmailDraft(accessToken: string, draftId: string): Promise<void> {
  const response = await fetch(`${GMAIL_API_BASE}/drafts/${draftId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to delete draft');
  }
}

// Gmail draft info returned from API
export interface GmailDraftInfo {
  id: string;
  threadId?: string;
  subject: string;
  to: string[];
  snippet: string;
  date: string;
}

// Helper: fetch drafts in batches to avoid rate limits
async function fetchInBatches<T, R>(
  items: T[],
  batchSize: number,
  fetchFn: (item: T) => Promise<R | null>
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fetchFn));
    // Filter out nulls and add to results
    for (const r of batchResults) {
      if (r !== null) {
        results.push(r);
      }
    }
    
    // Small delay between batches to avoid rate limits
    if (i + batchSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return results;
}

// List all Gmail drafts
export async function listGmailDrafts(accessToken: string): Promise<GmailDraftInfo[]> {
  const response = await fetch(`${GMAIL_API_BASE}/drafts?maxResults=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to list drafts');
  }

  const data = await response.json();
  
  if (!data.drafts || data.drafts.length === 0) {
    return [];
  }

  // Fetch details in batches of 5 to avoid rate limits
  const fetchDraftDetails = async (draft: { id: string }): Promise<GmailDraftInfo | null> => {
    try {
      const detailResponse = await fetch(`${GMAIL_API_BASE}/drafts/${draft.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      if (detailResponse.ok) {
        const detail = await detailResponse.json();
        const message = detail.message;
        const headers = message?.payload?.headers || [];
        
        const getHeader = (name: string) => 
          headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        
        const toHeader = getHeader('To');
        const toAddresses = toHeader ? toHeader.split(',').map((s: string) => s.trim()) : [];
        
        return {
          id: draft.id,
          threadId: message?.threadId,
          subject: getHeader('Subject') || '(No Subject)',
          to: toAddresses,
          snippet: decodeHtmlEntities(message?.snippet || ''),
          date: getHeader('Date') || new Date().toISOString(),
        } as GmailDraftInfo;
      }
      return null;
    } catch (e) {
      console.error('Failed to fetch draft details:', draft.id, e);
      return null;
    }
  };
  
  return fetchInBatches(data.drafts, 5, fetchDraftDetails);
}


// Get threads that have drafts (for showing draft indicator)
// Uses minimal API call - just drafts.list without fetching full details
export async function getThreadsWithDrafts(accessToken: string): Promise<Set<string>> {
  try {
    // Only request the fields we need - avoids fetching full draft content
    const response = await fetch(
      `${GMAIL_API_BASE}/drafts?maxResults=100&fields=drafts(id,message(threadId))`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (!response.ok) {
      console.warn('Failed to list drafts for thread check');
      return new Set();
    }
    
    const data = await response.json();
    const threadIds = new Set<string>();
    
    // Extract threadIds directly from the list response (no extra API calls!)
    if (data.drafts) {
      for (const draft of data.drafts) {
        if (draft.message?.threadId) {
          threadIds.add(draft.message.threadId);
        }
      }
    }
    
    return threadIds;
  } catch (e) {
    console.error('Error getting threads with drafts:', e);
    return new Set();
  }
}

// Full draft info with body content for editing
export interface FullGmailDraft {
  id: string;
  threadId?: string;
  subject: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  body: string;
  type: 'reply' | 'forward' | 'new';
  inReplyTo?: string;
  references?: string;
}

// Get full draft details for a specific thread (including body for editing)
// Optimized: First find draft by threadId using minimal format, then fetch full details only for matching draft
export async function getDraftForThread(accessToken: string, threadId: string): Promise<FullGmailDraft | null> {
  // List drafts with minimal info first (includes threadId in message object)
  const response = await fetch(`${GMAIL_API_BASE}/drafts?maxResults=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to list drafts');
  }

  const data = await response.json();
  
  // Find draft that matches our threadId by checking the draft's message.threadId
  // Gmail drafts list response includes { id, message: { id, threadId } }
  let matchingDraftId: string | null = null;
  
  for (const draft of data.drafts || []) {
    if (draft.message?.threadId === threadId) {
      matchingDraftId = draft.id;
      break;
    }
  }
  
  // No matching draft found
  if (!matchingDraftId) {
    return null;
  }
  
  // Now fetch ONLY the matching draft with full details
  try {
    const detailResponse = await fetch(`${GMAIL_API_BASE}/drafts/${matchingDraftId}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    if (detailResponse.ok) {
      const detail = await detailResponse.json();
      const message = detail.message;
      
      if (message?.threadId === threadId) {
          const headers = message?.payload?.headers || [];
          const getHeader = (name: string) => 
            headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
          
          // Helper to decode HTML entities
          const decodeHtmlEntities = (text: string): string => {
            let decoded = text;
            // Named entities
            decoded = decoded.replace(/&nbsp;/gi, ' ');
            decoded = decoded.replace(/&amp;/gi, '&');
            decoded = decoded.replace(/&lt;/gi, '<');
            decoded = decoded.replace(/&gt;/gi, '>');
            decoded = decoded.replace(/&quot;/gi, '"');
            decoded = decoded.replace(/&#39;/gi, "'");
            decoded = decoded.replace(/&apos;/gi, "'");
            decoded = decoded.replace(/&ndash;/gi, '\u2013');
            decoded = decoded.replace(/&mdash;/gi, '\u2014');
            decoded = decoded.replace(/&lsquo;/gi, '\u2018');
            decoded = decoded.replace(/&rsquo;/gi, '\u2019');
            decoded = decoded.replace(/&ldquo;/gi, '\u201C');
            decoded = decoded.replace(/&rdquo;/gi, '\u201D');
            decoded = decoded.replace(/&hellip;/gi, '\u2026');
            decoded = decoded.replace(/&copy;/gi, '\u00A9');
            decoded = decoded.replace(/&reg;/gi, '\u00AE');
            decoded = decoded.replace(/&trade;/gi, '\u2122');
            // Numeric entities (decimal)
            decoded = decoded.replace(/&#(\d+);/gi, (_, num) => String.fromCharCode(parseInt(num, 10)));
            // Numeric entities (hex)
            decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
            return decoded;
          };
          
          // Helper to convert HTML to plain text
          const htmlToPlainText = (html: string): string => {
            let text = html;
            // Convert <br> and <br/> to newlines
            text = text.replace(/<br\s*\/?>/gi, '\n');
            // Convert </p> and </div> to newlines (block elements)
            text = text.replace(/<\/(p|div|li|tr)>/gi, '\n');
            // Remove all remaining HTML tags
            text = text.replace(/<[^>]*>/g, '');
            // Decode HTML entities
            text = decodeHtmlEntities(text);
            // Clean up excessive newlines
            text = text.replace(/\n{3,}/g, '\n\n');
            return text.trim();
          };
          
          // Extract body from payload
          let body = '';
          const payload = message?.payload;
          
          if (payload) {
            // Handle multipart messages
            if (payload.parts) {
              const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
              const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
              
              if (textPart?.body?.data) {
                const rawText = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                // Even plain text might have HTML entities, decode them
                body = decodeHtmlEntities(rawText);
              } else if (htmlPart?.body?.data) {
                // Convert HTML to plain text for editing
                const html = atob(htmlPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                body = htmlToPlainText(html);
              }
            } else if (payload.body?.data) {
              // Simple message body - might be HTML or plain text
              const rawBody = atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
              // Check if it looks like HTML
              if (rawBody.includes('<') && rawBody.includes('>')) {
                body = htmlToPlainText(rawBody);
              } else {
                // Decode any HTML entities in plain text
                body = decodeHtmlEntities(rawBody);
              }
            }
          }
          
          // Parse recipients
          const toHeader = getHeader('To');
          const ccHeader = getHeader('Cc');
          const bccHeader = getHeader('Bcc');
          const inReplyTo = getHeader('In-Reply-To');
          const references = getHeader('References');
          const subject = getHeader('Subject');
          
          const parseAddresses = (header: string) => 
            header ? header.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
          
          // Determine type based on subject and headers
          let type: 'reply' | 'forward' | 'new' = 'new';
          if (inReplyTo || references) {
            type = 'reply';
          } else if (subject.toLowerCase().startsWith('fwd:') || subject.toLowerCase().startsWith('fw:')) {
            type = 'forward';
          } else if (threadId && message.threadId === threadId) {
            // Has a thread but no In-Reply-To - could be a reply being composed
            type = 'reply';
          }
          
        return {
          id: matchingDraftId!,
          threadId: message.threadId,
          subject,
          to: parseAddresses(toHeader),
          cc: parseAddresses(ccHeader),
          bcc: parseAddresses(bccHeader),
          body: body.trim(),
          type,
          inReplyTo: inReplyTo || undefined,
          references: references || undefined,
        };
      }
    }
  } catch (e) {
    console.error('Failed to fetch draft details:', matchingDraftId, e);
  }
  
  return null;
}

// ============================================================================
// SNOOZE FUNCTIONALITY
// ============================================================================
// Gmail API doesn't have native snooze support, so we implement it using:
// 1. Custom labels (FloMail/Snoozed, FloMail/Unsnoozed) 
// 2. Firestore to track snooze times
// 3. A scheduled function to unsnooze at the right time

// Cache for label IDs to avoid repeated lookups
let snoozeLabelId: string | null = null;
let unsnoozedLabelId: string | null = null;

// Label names (visible in Gmail)
export const SNOOZE_LABEL_NAME = 'FloMail/Snoozed';
export const UNSNOOZED_LABEL_NAME = 'FloMail/Unsnoozed';

// Get or create a Gmail label
async function getOrCreateLabel(accessToken: string, labelName: string): Promise<string> {
  // First, try to find the existing label
  const listResponse = await fetch(`${GMAIL_API_BASE}/labels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  
  if (!listResponse.ok) {
    throw new Error('Failed to list labels');
  }
  
  const labelsData = await listResponse.json();
  const existingLabel = labelsData.labels?.find((l: any) => l.name === labelName);
  
  if (existingLabel) {
    return existingLabel.id;
  }
  
  // Label doesn't exist, try to create it
  const createResponse = await fetch(`${GMAIL_API_BASE}/labels`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    }),
  });
  
  // Handle 409 Conflict - label already exists (race condition)
  if (createResponse.status === 409) {
    // Re-fetch the label list to get the existing label ID
    const retryListResponse = await fetch(`${GMAIL_API_BASE}/labels`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    if (retryListResponse.ok) {
      const retryLabelsData = await retryListResponse.json();
      const retryLabel = retryLabelsData.labels?.find((l: any) => l.name === labelName);
      if (retryLabel) {
        return retryLabel.id;
      }
    }
    
    // If we still can't find it, throw error
    throw new Error(`Label "${labelName}" exists but could not be retrieved`);
  }
  
  if (!createResponse.ok) {
    const error = await createResponse.text();
    throw new Error(`Failed to create label: ${error}`);
  }
  
  const newLabel = await createResponse.json();
  return newLabel.id;
}

// Get the Snoozed label ID (cached)
export async function getSnoozeLabelId(accessToken: string): Promise<string> {
  if (snoozeLabelId) return snoozeLabelId;
  snoozeLabelId = await getOrCreateLabel(accessToken, SNOOZE_LABEL_NAME);
  return snoozeLabelId;
}

// Get the Unsnoozed label ID (cached)
export async function getUnsnoozedLabelId(accessToken: string): Promise<string> {
  if (unsnoozedLabelId) return unsnoozedLabelId;
  unsnoozedLabelId = await getOrCreateLabel(accessToken, UNSNOOZED_LABEL_NAME);
  return unsnoozedLabelId;
}

// Snooze a thread (remove from inbox, add Snoozed label)
export async function snoozeThread(accessToken: string, threadId: string): Promise<void> {
  const snoozeLabelId = await getSnoozeLabelId(accessToken);
  
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      addLabelIds: [snoozeLabelId],
      removeLabelIds: ['INBOX'],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to snooze thread: ${error}`);
  }
}

// Unsnooze a thread (add back to inbox, remove Snoozed label, add Unsnoozed label)
export async function unsnoozeThread(accessToken: string, threadId: string): Promise<void> {
  const [snoozeLabelId, unsnoozedLabelId] = await Promise.all([
    getSnoozeLabelId(accessToken),
    getUnsnoozedLabelId(accessToken),
  ]);
  
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      addLabelIds: ['INBOX', unsnoozedLabelId],
      removeLabelIds: [snoozeLabelId],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to unsnooze thread: ${error}`);
  }
}

// Clear the "Unsnoozed" label from a thread (after user has seen it)
export async function clearUnsnoozedLabel(accessToken: string, threadId: string): Promise<void> {
  const unsnoozedLabelId = await getUnsnoozedLabelId(accessToken);
  
  const response = await fetch(`${GMAIL_API_BASE}/threads/${threadId}/modify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      removeLabelIds: [unsnoozedLabelId],
    }),
  });

  if (!response.ok) {
    console.error('Failed to clear unsnoozed label');
  }
}

// Get all snoozed threads (threads with the Snoozed label)
export async function getSnoozedThreads(accessToken: string): Promise<EmailThread[]> {
  const snoozeLabelId = await getSnoozeLabelId(accessToken);
  
  const response = await fetch(`${GMAIL_API_BASE}/threads?labelIds=${snoozeLabelId}&maxResults=50`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  
  if (!response.ok) {
    throw new Error('Failed to get snoozed threads');
  }
  
  const data = await response.json();
  const threads: EmailThread[] = [];
  
  if (data.threads) {
    for (const t of data.threads) {
      try {
        const thread = await fetchThread(accessToken, t.id);
        threads.push(thread);
      } catch (e) {
        console.error('Failed to fetch snoozed thread:', t.id, e);
      }
    }
  }
  
  return threads;
}

// Check if a thread has the Snoozed label (currently snoozed)
export function hasSnoozedLabel(thread: EmailThread): boolean {
  return thread.labels?.some(l => 
    l === SNOOZE_LABEL_NAME || l.includes('/Snoozed')
  ) || false;
}

// Check if a thread has the Unsnoozed label (just returned from snooze)
export function hasUnsnoozedLabel(thread: EmailThread): boolean {
  return thread.labels?.some(l => 
    l === UNSNOOZED_LABEL_NAME || l.includes('Unsnoozed')
  ) || false;
}

