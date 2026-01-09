import { NextRequest, NextResponse } from 'next/server';

// Use Tavily's extract endpoint for clean content extraction
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    const tavilyApiKey = process.env.TAVILY_API_KEY;
    
    if (!tavilyApiKey) {
      // Fallback: Try basic fetch
      console.warn('[Browse] TAVILY_API_KEY not configured, using basic fetch');
      return await basicFetch(url);
    }

    console.log('[Browse] Fetching URL:', url);

    const response = await fetch(TAVILY_EXTRACT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        urls: [url],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Browse] Tavily extract error:', response.status, errorText);
      // Fallback to basic fetch
      return await basicFetch(url);
    }

    const data = await response.json();
    
    // Tavily returns results array with extracted content
    const result = data.results?.[0];
    
    if (!result || !result.raw_content) {
      console.log('[Browse] No content from Tavily, falling back to basic fetch');
      return await basicFetch(url);
    }

    console.log('[Browse] Got content, length:', result.raw_content?.length || 0);

    return NextResponse.json({
      url,
      title: extractTitle(result.raw_content) || url,
      content: cleanContent(result.raw_content),
      success: true,
    });

  } catch (error) {
    console.error('[Browse] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch URL content' },
      { status: 500 }
    );
  }
}

// Basic fetch fallback when Tavily is not available
async function basicFetch(url: string): Promise<NextResponse> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FloMail/1.0; +https://flomail.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json({
        url,
        error: `Failed to fetch: ${response.status} ${response.statusText}`,
        success: false,
      });
    }

    const contentType = response.headers.get('content-type') || '';
    
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return NextResponse.json({
        url,
        content: `This URL points to a ${contentType} file, not a webpage.`,
        success: true,
      });
    }

    const html = await response.text();
    const content = extractTextFromHtml(html);
    const title = extractTitleFromHtml(html) || url;

    return NextResponse.json({
      url,
      title,
      content: content.slice(0, 10000), // Limit content length
      success: true,
    });

  } catch (error) {
    console.error('[Browse] Basic fetch error:', error);
    return NextResponse.json({
      url,
      error: `Failed to fetch URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
      success: false,
    });
  }
}

// Extract title from HTML
function extractTitleFromHtml(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : null;
}

// Extract readable text from HTML (basic extraction)
function extractTextFromHtml(html: string): string {
  // Remove script and style elements
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  
  // Replace common block elements with newlines
  text = text
    .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ') // Remove remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // Clean up whitespace
  text = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  
  return text.trim();
}

// Extract title from content (first heading or first line)
function extractTitle(content: string): string | null {
  const lines = content.split('\n').filter(l => l.trim());
  return lines[0]?.slice(0, 100) || null;
}

// Clean and limit content
function cleanContent(content: string): string {
  if (!content) return '';
  
  // Limit to ~10k characters for context window efficiency
  const maxLength = 10000;
  if (content.length > maxLength) {
    return content.slice(0, maxLength) + '\n\n[Content truncated...]';
  }
  
  return content;
}
