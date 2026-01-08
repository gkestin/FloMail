import { NextRequest, NextResponse } from 'next/server';
import { agentChat, OPENAI_MODELS } from '@/lib/openai';
import { agentChatClaude, CLAUDE_MODELS } from '@/lib/anthropic';
import { EmailThread } from '@/types';
import { ToolCall } from '@/lib/agent-tools';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      messages, 
      thread, 
      folder = 'inbox',
      provider = 'anthropic', 
      model 
    }: {
      messages: { role: 'user' | 'assistant'; content: string }[];
      thread?: EmailThread;
      folder?: string;
      provider?: 'openai' | 'anthropic';
      model?: string;
    } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }

    console.log(`[FloMail] Chat request - Provider: ${provider}, Model: ${model || 'default'}`);
    console.log(`[FloMail] Messages count: ${messages.length}, Has thread: ${!!thread}`);

    let result: {
      content: string;
      toolCalls: ToolCall[];
    };

    if (provider === 'openai') {
      const openaiModel = model && model in OPENAI_MODELS 
        ? model as keyof typeof OPENAI_MODELS 
        : 'gpt-4.1';
      console.log(`[FloMail] Using OpenAI model: ${openaiModel}, Folder: ${folder}`);
      const response = await agentChat(messages, thread, openaiModel, folder);
      result = {
        content: response.content,
        toolCalls: response.toolCalls,
      };
    } else {
      const claudeModel = model && model in CLAUDE_MODELS 
        ? model as keyof typeof CLAUDE_MODELS 
        : 'claude-sonnet-4-20250514';
      console.log(`[FloMail] Using Claude model: ${claudeModel}, Folder: ${folder}`);
      const response = await agentChatClaude(messages, thread, claudeModel, folder);
      result = {
        content: response.content,
        toolCalls: response.toolCalls,
      };
    }

    console.log(`[FloMail] Response - Content length: ${result.content?.length || 0}, Tool calls: ${result.toolCalls?.length || 0}`);
    if (result.toolCalls?.length) {
      console.log(`[FloMail] Tool calls:`, result.toolCalls.map(tc => tc.name));
    }

    // If we got nothing at all, provide a fallback response
    if (!result.content && (!result.toolCalls || result.toolCalls.length === 0)) {
      result.content = "I'm here to help! You can ask me to summarize this email, draft a reply, archive it, or move to the next email.";
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[FloMail] AI agent error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process request' },
      { status: 500 }
    );
  }
}

// GET endpoint to list available models
export async function GET() {
  return NextResponse.json({
    openai: Object.entries(OPENAI_MODELS).map(([id, name]) => ({ id, name })),
    anthropic: Object.entries(CLAUDE_MODELS).map(([id, name]) => ({ id, name })),
  });
}
