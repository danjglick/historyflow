export interface WikiArticle {
  title: string;
  extract: string;
  url: string;
}

export interface WikiSection {
  heading: string;
  html: string;
}

interface SearchResult {
  titles: string[];
  nextOffset: number | null;
}

// Simple session cache so repeated loads don't re-fetch the same articles
const articleCache = new Map<string, WikiArticle>();

// Each query tracks its own offset and exhaustion state independently
const queries = [
  { term: 'intitle:history',  offset: Math.floor(Math.random() * 50) * 20, hasMore: true },
  { term: 'intitle:politics', offset: Math.floor(Math.random() * 20) * 20, hasMore: true },
  { term: 'intitle:culture',  offset: Math.floor(Math.random() * 20) * 20, hasMore: true },
];

async function runSearch(term: string, offset: number): Promise<{ titles: string[]; nextOffset: number | null }> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: term,
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

  return {
    titles: data.query.search.map((r: { title: string }) => r.title),
    nextOffset: data.continue?.sroffset ?? null,
  };
}

export async function searchHistoryArticles(): Promise<SearchResult> {
  const active = queries.filter(q => q.hasMore);
  if (active.length === 0) return { titles: [], nextOffset: null };

  const results = await Promise.allSettled(
    active.map(q => runSearch(q.term, q.offset))
  );

  let allTitles: string[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      allTitles = [...allTitles, ...result.value.titles];
      active[i].offset = result.value.nextOffset ?? active[i].offset + 20;
      active[i].hasMore = result.value.nextOffset !== null;
    }
  });

  // Fisher-Yates shuffle so each batch arrives in unpredictable order
  for (let i = allTitles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allTitles[i], allTitles[j]] = [allTitles[j], allTitles[i]];
  }

  if (allTitles.length === 0) throw new Error('All searches failed');

  const anyMore = queries.some(q => q.hasMore);
  return { titles: allTitles, nextOffset: anyMore ? 1 : null };
}

async function fetchBatchChunk(titles: string[]): Promise<void> {
  const params = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
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
  if (!res.ok) return;
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
    const firstSentence = page.extract.split(/\.[\s\n]/)[0];
    if (/\b(journal|film|review|account|exhibition|magazine|museum|channel|institute|prize|professor|department|professional|departments|singer|developer|version|publisher|documentary|book|volume|organization|organisation|lecture|examination|journal|club|monographic|website|programme|committee|games|library|list|association|monograph|platform|magazine|project|band|museum|publication|initiative|author|ministry|department|channel|podcast|album)\b/i.test(firstSentence)) continue;
    articleCache.set(page.title, {
      title: page.title,
      extract: page.extract.trim(),
      url: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    });
  }
}

// Fetch all titles in batches of 50 (Wikipedia API limit)
export async function fetchArticlesBatch(titles: string[]): Promise<WikiArticle[]> {
  const uncached = titles.filter(t => !articleCache.has(t));

  if (uncached.length > 0) {
    const chunks: string[][] = [];
    for (let i = 0; i < uncached.length; i += 50) {
      chunks.push(uncached.slice(i, i + 50));
    }
    try {
      await Promise.all(chunks.map(fetchBatchChunk));
    } catch {
      // Network failure — return whatever is in cache
    }
  }

  return titles.flatMap(t => {
    const a = articleCache.get(t);
    return a ? [a] : [];
  });
}

const SKIP_SECTIONS = /^(see also|references|external links|notes|further reading|bibliography|footnotes)$/i;

const CLUTTER = [
  '.mw-editsection', 'sup.reference', '.reflist', '.navbox',
  '.metadata', '.mbox-small', '.ambox', '.infobox', '.thumb',
  'figure', '.hatnote', '.mw-empty-elt', 'style',
];

export async function fetchArticleSections(title: string): Promise<WikiSection[]> {
  try {
    const params = new URLSearchParams({
      action: 'parse',
      page: title,
      prop: 'text',
      format: 'json',
      origin: '*',
      redirects: '1',
    });
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    const html: string = data.parse?.text?.['*'];
    if (!html) return [];

    const doc = new DOMParser().parseFromString(html, 'text/html');
    CLUTTER.forEach(sel => doc.querySelectorAll(sel).forEach(el => el.remove()));

    const sections: WikiSection[] = [];

    for (const div of Array.from(doc.querySelectorAll('.mw-heading2'))) {
      const h2 = div.querySelector('h2');
      const heading = h2?.textContent?.trim() ?? '';
      if (!heading || SKIP_SECTIONS.test(heading)) continue;

      const parts: string[] = [];
      let node = div.nextElementSibling;
      while (node && !node.classList.contains('mw-heading2')) {
        node.querySelectorAll('a').forEach(a => {
          const href = a.getAttribute('href') ?? '';
          if (href.startsWith('/wiki/') && !href.includes(':')) {
            a.setAttribute('href', `https://en.wikipedia.org${href}`);
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
          } else {
            a.replaceWith(doc.createTextNode(a.textContent ?? ''));
          }
        });
        parts.push(node.outerHTML);
        node = node.nextElementSibling;
      }

      const sectionHtml = parts.join('').trim();
      if (sectionHtml) sections.push({ heading, html: sectionHtml });
    }

    return sections;
  } catch (e) {
    console.error('[HistoryFlow] fetchArticleSections failed:', e);
    return [];
  }
}
