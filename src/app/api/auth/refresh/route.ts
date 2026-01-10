import { NextRequest, NextResponse } from 'next/server';

/**
 * API route to refresh Google OAuth access tokens
 * Uses the refresh token to get a new access token from Google
 */
export async function POST(request: NextRequest) {
  try {
    const { refreshToken } = await request.json();

    if (!refreshToken) {
      return NextResponse.json(
        { error: 'Refresh token is required' },
        { status: 400 }
      );
    }

    // Call Google's token endpoint to refresh the access token
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Token refresh failed:', errorData);
      
      // If refresh token is invalid/revoked, user needs to re-authenticate
      if (errorData.error === 'invalid_grant') {
        return NextResponse.json(
          { error: 'Session expired. Please sign in again.' },
          { status: 401 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to refresh token' },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      accessToken: data.access_token,
      expiresIn: data.expires_in, // Usually 3600 seconds (1 hour)
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
