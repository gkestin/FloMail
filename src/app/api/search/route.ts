import { NextRequest, NextResponse } from 'next/server';

// Tavily API for AI-optimized web search
const TAVILY_API_URL = 'https://api.tavily.com/search';

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  query: string;
  results: TavilyResult[];
  answer?: string; // AI-generated answer summary
}

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    const tavilyApiKey = process.env.TAVILY_API_KEY;
    
    if (!tavilyApiKey) {
      // Fallback: Return a message that web search is not configured
      console.warn('[WebSearch] TAVILY_API_KEY not configured');
      return NextResponse.json({
        query,
        answer: 'Web search is not configured. Please add TAVILY_API_KEY to environment variables.',
        results: [],
      });
    }

    console.log('[WebSearch] Searching for:', query);

    const response = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query,
        search_depth: 'basic', // 'basic' or 'advanced'
        include_answer: true, // Get AI-generated answer summary
        include_raw_content: false,
        max_results: 5,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[WebSearch] Tavily API error:', response.status, errorText);
      return NextResponse.json(
        { error: `Search failed: ${response.status}` },
        { status: response.status }
      );
    }

    const data: TavilyResponse = await response.json();
    
    console.log('[WebSearch] Got', data.results?.length || 0, 'results');

    // Format results for the AI
    const formattedResults = data.results?.map((r, i) => ({
      rank: i + 1,
      title: r.title,
      url: r.url,
      snippet: r.content?.slice(0, 500) || '',
    })) || [];

    return NextResponse.json({
      query: data.query,
      answer: data.answer || null,
      results: formattedResults,
    });

  } catch (error) {
    console.error('[WebSearch] Error:', error);
    return NextResponse.json(
      { error: 'Failed to perform web search' },
      { status: 500 }
    );
  }
}
