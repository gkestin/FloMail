import { NextRequest, NextResponse } from 'next/server';
import { buildAgentConfig } from '@/lib/voice-agent';

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Cache the agent ID in memory (persists across requests in the same server instance)
let cachedAgentId: string | null = null;
let agentCreatedAt: number = 0;
const AGENT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * POST /api/voice/elevenlabs
 *
 * Creates or returns a cached ElevenLabs agent for FloMail voice mode.
 * Also can generate a signed URL for private agent sessions.
 *
 * Body: { action: 'get_agent' | 'get_signed_url', voiceId?, llmModel? }
 * Returns: { agentId } or { signedUrl }
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ElevenLabs API key not configured. Add ELEVENLABS_API_KEY to your environment variables.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { action = 'get_agent', voiceId, llmModel } = body;

    if (action === 'get_agent') {
      // Check for a pre-configured agent ID in env
      const envAgentId = process.env.ELEVENLABS_AGENT_ID;
      if (envAgentId) {
        return NextResponse.json({ agentId: envAgentId });
      }

      // Check cache
      if (cachedAgentId && Date.now() - agentCreatedAt < AGENT_CACHE_TTL) {
        return NextResponse.json({ agentId: cachedAgentId });
      }

      // Create a new agent
      const config = buildAgentConfig({ voiceId, llmModel });

      const response = await fetch(`${ELEVENLABS_API_URL}/convai/agents/create`, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('[Voice] ElevenLabs agent creation failed:', response.status, errorData);
        return NextResponse.json(
          { error: `Failed to create voice agent: ${response.statusText}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      cachedAgentId = data.agent_id;
      agentCreatedAt = Date.now();

      console.log('[Voice] Created ElevenLabs agent:', cachedAgentId);
      return NextResponse.json({ agentId: cachedAgentId });
    }

    if (action === 'get_signed_url') {
      // Get agent ID first
      const agentId = process.env.ELEVENLABS_AGENT_ID || cachedAgentId;
      if (!agentId) {
        return NextResponse.json(
          { error: 'No agent ID available. Create an agent first.' },
          { status: 400 }
        );
      }

      // Request a signed URL for private sessions
      const response = await fetch(
        `${ELEVENLABS_API_URL}/convai/conversation/get_signed_url?agent_id=${agentId}`,
        {
          method: 'GET',
          headers: {
            'xi-api-key': apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.text();
        console.error('[Voice] Failed to get signed URL:', response.status, errorData);
        return NextResponse.json(
          { error: 'Failed to get signed URL' },
          { status: response.status }
        );
      }

      const data = await response.json();
      return NextResponse.json({ signedUrl: data.signed_url });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('[Voice] API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
