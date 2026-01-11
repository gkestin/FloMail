import { NextRequest, NextResponse } from 'next/server';

/**
 * Get the actual origin, handling proxies and Cloud Run
 */
function getOrigin(request: NextRequest): string {
  // Check for forwarded headers (used by Cloud Run and other proxies)
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  
  // Check the host header
  const host = request.headers.get('host');
  if (host && !host.includes('0.0.0.0')) {
    const proto = host.includes('localhost') ? 'http' : 'https';
    return `${proto}://${host}`;
  }
  
  // Fallback to nextUrl.origin
  return request.nextUrl.origin;
}

/**
 * Redirects the user to Google's OAuth consent page
 * This initiates the OAuth 2.0 authorization code flow
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  
  if (!clientId) {
    return NextResponse.json({ error: 'Google Client ID not configured' }, { status: 500 });
  }

  // Get the origin for the callback URL
  const origin = getOrigin(request);
  const redirectUri = `${origin}/api/auth/google/callback`;
  
  console.log('[OAuth] Redirect URI:', redirectUri);

  // Build the Google OAuth URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
    ].join(' '),
    access_type: 'offline', // This is key - gets us a refresh token
    prompt: 'consent', // Force consent to ensure we get refresh token
    include_granted_scopes: 'true',
  });

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return NextResponse.redirect(googleAuthUrl);
}
