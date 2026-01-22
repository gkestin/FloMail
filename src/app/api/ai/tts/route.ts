import { NextRequest, NextResponse } from 'next/server';
import { textToSpeech, TTSVoice } from '@/lib/openai';

export async function POST(request: NextRequest) {
  try {
    const { text, voice = 'nova', speed = 1.0 } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    // Limit text length to prevent abuse
    if (text.length > 5000) {
      return NextResponse.json(
        { error: 'Text too long (max 5000 characters)' },
        { status: 400 }
      );
    }

    const audioBuffer = await textToSpeech(text, voice as TTSVoice, speed);

    // Return audio as mp3
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
      },
    });
  } catch (error: any) {
    console.error('TTS Error:', error);
    
    // If OpenAI API fails, return error
    return NextResponse.json(
      { error: 'TTS generation failed', details: error.message },
      { status: 500 }
    );
  }
}
