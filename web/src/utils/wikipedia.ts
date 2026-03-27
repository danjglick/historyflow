export interface WikiArticle {
  title: string;
  extract: string;
  url: string;
}

interface SearchResult {
  titles: string[];
  nextOffset: number | null;
}

// Simple session cache so repeated loads don't re-fetch the same articles
const articleCache = new Map<string, WikiArticle>();

export async function searchHistoryArticles(offset = 0): Promise<SearchResult> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: 'intitle:history',
    format: 'json',
    origin: '*',
    srnamespace: '0',
    srlimit: '20',
    sroffset: String(offset),
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
      if (res.ok) break;
      if (res.status === 429) {
        const wait = parseInt(res.headers.get('Retry-After') ?? '10') * 1000;
        console.warn(`[HistoryFlow] rate limited, waiting ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw new Error(`Search failed: HTTP ${res.status}`);
      }
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  if (!res || !res.ok) throw new Error(`Search failed: HTTP ${res?.status}`);
  const data = await res.json();
  if (!data.query?.search) throw new Error(`Unexpected search response: ${JSON.stringify(data).slice(0, 200)}`);

  const titles: string[] = data.query.search.map((r: { title: string }) => r.title);
  // Fisher-Yates shuffle so each batch arrives in unpredictable order
  for (let i = titles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [titles[i], titles[j]] = [titles[j], titles[i]];
  }
  const nextOffset: number | null = data.continue?.sroffset ?? null;

  return { titles, nextOffset };
}

// Fetch all titles in a single batch request instead of 20 parallel calls
export async function fetchArticlesBatch(titles: string[]): Promise<WikiArticle[]> {
  // Return cached articles immediately; only fetch uncached ones
  const uncached = titles.filter(t => !articleCache.has(t));

  if (uncached.length > 0) {
    try {
      const params = new URLSearchParams({
        action: 'query',
        titles: uncached.join('|'),
        prop: 'extracts|pageprops|info',
        exintro: 'true',
        explaintext: 'true',
        ppprop: 'disambiguation',
        inprop: 'url',
        redirects: '1',
        format: 'json',
        origin: '*',
      });
      const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
      if (res.ok) {
        const data = await res.json();
        const pages = data.query?.pages as Record<string, {
          title: string;
          extract?: string;
          fullurl?: string;
          pageprops?: { disambiguation?: string };
          missing?: string;
        }> ?? {};

        for (const page of Object.values(pages)) {
          if ('missing' in page) continue;
          if (page.pageprops?.disambiguation !== undefined) continue;
          if (/^(list of|timeline of|index of|outline of|lists of)/i.test(page.title)) continue;
          if (!page.extract?.trim()) continue;
          articleCache.set(page.title, {
            title: page.title,
            extract: page.extract.trim(),
            url: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
          });
        }
      }
    } catch {
      // Network failure — return whatever is in cache for this batch
    }
  }

  return titles.flatMap(t => {
    const a = articleCache.get(t);
    return a ? [a] : [];
  });
}

export async function fetchFullArticle(title: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'extracts',
      explaintext: 'true',
      format: 'json',
      origin: '*',
    });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data.query.pages as Record<string, { extract?: string }>;
    const page = Object.values(pages)[0];
    const raw = page?.extract?.trim() ?? null;
    if (!raw) return null;
    const cutoff = /^==\s*(see also|notes|references|external links|further reading)\s*==/im;
    const match = raw.search(cutoff);
    return match === -1 ? raw : raw.slice(0, match).trimEnd();
  } catch {
    return null;
  }
}
