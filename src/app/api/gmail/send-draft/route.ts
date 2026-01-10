import { NextRequest, NextResponse } from 'next/server';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * POST /api/gmail/send-draft
 * Proxies the Gmail drafts.send endpoint to avoid CORS issues
 * 
 * Body: { draftId: string }
 * Headers: Authorization: Bearer <access_token>
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'No authorization header' }, { status: 401 });
    }

    const body = await request.json();
    const { draftId } = body;
    
    if (!draftId) {
      return NextResponse.json({ error: 'Missing draftId' }, { status: 400 });
    }

    console.log('[send-draft] Sending draft:', draftId);

    // Call Gmail API server-side (no CORS issues)
    const response = await fetch(`${GMAIL_API_BASE}/drafts/${draftId}/send`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    // Get response as text first to handle both JSON and HTML responses
    const responseText = await response.text();
    
    console.log('[send-draft] Response status:', response.status);
    console.log('[send-draft] Response text (first 500 chars):', responseText.substring(0, 500));

    if (!response.ok) {
      // Try to parse as JSON, fall back to raw text
      let errorMessage = 'Failed to send draft';
      try {
        const errorJson = JSON.parse(responseText);
        errorMessage = errorJson.error?.message || errorJson.error || errorMessage;
      } catch {
        // Not JSON - might be HTML error page
        if (responseText.includes('Not Found')) {
          errorMessage = 'Draft not found - it may have been deleted or already sent';
        } else if (responseText.includes('Invalid')) {
          errorMessage = 'Invalid draft ID';
        } else {
          errorMessage = `Gmail error (${response.status}): ${responseText.substring(0, 200)}`;
        }
      }
      
      console.error('[send-draft] Error:', errorMessage);
      return NextResponse.json({ error: errorMessage }, { status: response.status });
    }

    // Success - try to parse the response
    let data = {};
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        // Response might be empty on success
        data = { success: true };
      }
    }

    console.log('[send-draft] Success!');
    return NextResponse.json(data);
  } catch (error) {
    console.error('[send-draft] Exception:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
