export interface WikiArticle {
  title: string;
  extract: string;
  description?: string;
  url: string;
}

interface SearchResult {
  titles: string[];
  nextOffset: number | null;
}

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

  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
  if (!res.ok) throw new Error('Search failed');
  const data = await res.json();

  const titles: string[] = data.query.search.map((r: { title: string }) => r.title);
  const nextOffset: number | null = data.continue?.sroffset ?? null;

  return { titles, nextOffset };
}

export async function fetchArticleSummary(title: string): Promise<WikiArticle | null> {
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.extract || data.extract.trim() === '') return null;
    return {
      title: data.title,
      extract: data.extract,
      description: data.description,
      url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch {
    return null;
  }
}
