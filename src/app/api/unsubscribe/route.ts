import { NextRequest, NextResponse } from 'next/server';

/**
 * RFC 8058 One-Click Unsubscribe API
 * 
 * This endpoint proxies the one-click unsubscribe POST request
 * to avoid CORS issues when unsubscribing from mailing lists.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, body: postBody } = body;

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate URL is HTTPS for security
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'https:') {
      return NextResponse.json(
        { error: 'Only HTTPS URLs are allowed' },
        { status: 400 }
      );
    }

    // Make the unsubscribe request
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'FloMail/1.0 (One-Click Unsubscribe)',
      },
      body: postBody || 'List-Unsubscribe=One-Click',
    });

    if (!response.ok) {
      console.error('Unsubscribe failed:', response.status, await response.text());
      return NextResponse.json(
        { error: `Unsubscribe failed: ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    return NextResponse.json(
      { error: 'Failed to process unsubscribe request' },
      { status: 500 }
    );
  }
}
