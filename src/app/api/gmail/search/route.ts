import { NextRequest, NextResponse } from 'next/server';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const MAX_BODY_PER_MESSAGE = 1500;
const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 150;

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch {
    try {
      return atob(base64);
    } catch {
      return str;
    }
  }
}

function extractEmailBody(payload: any): string {
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
        const nested = extractEmailBody(part);
        if (!text && nested) text = nested;
      }
    }
  }

  if (text) return text;
  if (html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

export async function POST(request: NextRequest) {
  try {
    const { query, accessToken, maxResults = 5 } = await request.json();

    if (!query || !accessToken) {
      return NextResponse.json(
        { error: 'query and accessToken are required' },
        { status: 400 }
      );
    }

    const effectiveMaxResults = Math.min(maxResults, 10);

    // Step 1: Search for matching thread IDs
    const params = new URLSearchParams({
      maxResults: String(effectiveMaxResults),
      q: query,
    });

    const threadsResponse = await fetch(
      `${GMAIL_API_BASE}/threads?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!threadsResponse.ok) {
      console.error('[GmailSearch] API error:', threadsResponse.status);
      return NextResponse.json(
        { error: `Gmail search failed: ${threadsResponse.status}` },
        { status: threadsResponse.status }
      );
    }

    const threadsData = await threadsResponse.json();

    if (!threadsData.threads || threadsData.threads.length === 0) {
      return NextResponse.json({
        query,
        totalFound: 0,
        threads: [],
        formatted: `No emails found matching: "${query}"`,
      });
    }

    const totalFound = threadsData.resultSizeEstimate || threadsData.threads.length;
    const threadsToFetch = threadsData.threads.slice(0, effectiveMaxResults);

    // Step 2: Fetch full thread content in batches
    const threadDetails: Array<{
      subject: string;
      participants: string[];
      messageCount: number;
      messages: Array<{ from: string; date: string; subject: string; body: string }>;
    }> = [];

    for (let batchStart = 0; batchStart < threadsToFetch.length; batchStart += BATCH_SIZE) {
      const batch = threadsToFetch.slice(batchStart, batchStart + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(async (thread: { id: string }) => {
          try {
            const res = await fetch(
              `${GMAIL_API_BASE}/threads/${thread.id}?format=full`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!res.ok) return null;
            return await res.json();
          } catch {
            return null;
          }
        })
      );

      for (const detail of batchResults) {
        if (!detail?.messages) continue;

        const messages: Array<{ from: string; date: string; subject: string; body: string }> = [];
        const participants = new Set<string>();
        let threadSubject = '';

        for (const message of detail.messages) {
          const headers = message.payload?.headers || [];
          const subject = headers.find((h: any) => h.name === 'Subject')?.value || '(no subject)';
          const from = headers.find((h: any) => h.name === 'From')?.value || 'Unknown';
          const date = headers.find((h: any) => h.name === 'Date')?.value || '';

          let body = extractEmailBody(message.payload);
          if (body.length > MAX_BODY_PER_MESSAGE) {
            body = body.slice(0, MAX_BODY_PER_MESSAGE) + '... [truncated]';
          }

          if (!threadSubject) threadSubject = subject;
          participants.add(from);
          messages.push({ from, date, subject, body });
        }

        threadDetails.push({
          subject: threadSubject,
          participants: Array.from(participants),
          messageCount: messages.length,
          messages,
        });
      }

      // Delay between batches
      if (batchStart + BATCH_SIZE < threadsToFetch.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    // Step 3: Format results as text for the voice agent
    let formatted = `EMAIL SEARCH RESULTS\nQuery: "${query}"\nFound: ${totalFound} total threads, showing ${threadDetails.length} with content\n\n`;

    for (let i = 0; i < threadDetails.length; i++) {
      const t = threadDetails[i];
      formatted += `--- Thread ${i + 1}: "${t.subject}" ---\n`;
      formatted += `Participants: ${t.participants.join(', ')}\n`;
      for (const msg of t.messages) {
        formatted += `\nFrom: ${msg.from}\nDate: ${msg.date}\n${msg.body}\n`;
      }
      formatted += '\n';
    }

    return NextResponse.json({
      query,
      totalFound,
      threads: threadDetails,
      formatted,
    });
  } catch (error) {
    console.error('[GmailSearch] Error:', error);
    return NextResponse.json(
      { error: 'Email search failed' },
      { status: 500 }
    );
  }
}
