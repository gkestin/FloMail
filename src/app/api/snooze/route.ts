import { NextRequest, NextResponse } from 'next/server';
import { snoozeThread, unsnoozeThread } from '@/lib/gmail';
import { calculateSnoozeUntil, SnoozeOption } from '@/lib/snooze-server';

// ============================================================================
// SNOOZE API ROUTE
// ============================================================================
// Handles Gmail label operations for snoozing/unsnoozing.
// Firestore operations are handled client-side where auth context is available.

/**
 * POST /api/snooze - Apply Gmail label changes for snoozing
 * 
 * Body:
 * - action: 'snooze' | 'unsnooze'
 * - threadId: string
 * - accessToken: string
 * - snoozeOption?: SnoozeOption (for snooze action, to calculate snoozeUntil)
 * - customDate?: string (ISO date for custom snooze)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, threadId, accessToken, snoozeOption, customDate } = body;

    if (!action || !threadId || !accessToken) {
      return NextResponse.json(
        { error: 'Missing required fields: action, threadId, accessToken' },
        { status: 400 }
      );
    }

    switch (action) {
      case 'snooze': {
        if (!snoozeOption) {
          return NextResponse.json(
            { error: 'Missing snoozeOption for snooze action' },
            { status: 400 }
          );
        }

        // Calculate when to unsnooze (so client knows when to save)
        const snoozeUntil = calculateSnoozeUntil(
          snoozeOption as SnoozeOption,
          customDate ? new Date(customDate) : undefined
        );

        // Apply Gmail label changes
        await snoozeThread(accessToken, threadId);

        return NextResponse.json({
          success: true,
          snoozeUntil: snoozeUntil.toISOString(),
        });
      }

      case 'unsnooze': {
        // Manually unsnooze (before time is up) or auto-unsnooze
        await unsnoozeThread(accessToken, threadId);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error('[Snooze API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process snooze action' },
      { status: 500 }
    );
  }
}
