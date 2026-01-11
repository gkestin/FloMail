import { NextRequest, NextResponse } from 'next/server';

/**
 * Handles the OAuth callback from Google
 * Exchanges the authorization code for access and refresh tokens
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    console.error('[OAuth Callback] Error from Google:', error);
    return NextResponse.redirect(new URL('/?auth_error=' + error, request.nextUrl.origin));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?auth_error=no_code', request.nextUrl.origin));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error('[OAuth Callback] Missing client credentials');
    return NextResponse.redirect(new URL('/?auth_error=config_error', request.nextUrl.origin));
  }

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/google/callback`;

  try {
    // Exchange the authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('[OAuth Callback] Token exchange failed:', errorData);
      return NextResponse.redirect(new URL('/?auth_error=token_exchange_failed', request.nextUrl.origin));
    }

    const tokens = await tokenResponse.json();
    
    console.log('[OAuth Callback] Token exchange successful');
    console.log('[OAuth Callback] Has refresh_token:', !!tokens.refresh_token);

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      console.error('[OAuth Callback] Failed to get user info');
      return NextResponse.redirect(new URL('/?auth_error=userinfo_failed', request.nextUrl.origin));
    }

    const userInfo = await userInfoResponse.json();

    // Create a response that redirects to the app with tokens in a secure cookie
    const response = NextResponse.redirect(new URL('/', request.nextUrl.origin));
    
    // Store auth data in a secure HTTP-only cookie
    // The client will read this on load and store in Firestore
    const authData = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token, // Include id_token for Firebase Auth
      expiresAt: Date.now() + (tokens.expires_in * 1000),
      user: {
        email: userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
        id: userInfo.id,
      },
    };

    // Set as a temporary cookie that the client will consume
    response.cookies.set('flomail_auth', JSON.stringify(authData), {
      httpOnly: false, // Client needs to read this
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60, // Short-lived - client should consume immediately
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('[OAuth Callback] Error:', error);
    return NextResponse.redirect(new URL('/?auth_error=server_error', request.nextUrl.origin));
  }
}
