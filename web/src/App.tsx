import { useState, useEffect, useCallback, useRef } from 'react';
import { searchHistoryArticles, fetchArticlesBatch, fetchFullArticle } from './utils/wikipedia';
import type { WikiArticle } from './utils/wikipedia';
import './App.css';

const ABBREV = /^([A-Z]|Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|St|Mt|Lt|Gen|Col|Maj|Capt|Gov|Sen|Rep|Rev|Dept|Inc|Corp|Ltd|est|approx|U\.S|U\.K|D\.C|i\.e|e\.g|etc|ca|c|pp|vol|no|lit)$/i;

function getFirstSentence(text: string): string {
  const parts = text.split('. ');
  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const lastWord = result.split(/\s+/).pop() ?? '';
    if (ABBREV.test(lastWord)) {
      result += '. ' + parts[i];
    } else {
      break;
    }
  }
  if (!/[.!?]$/.test(result)) result += '.';
  return result;
}

interface Section { heading: string; lines: string[]; }

function parseNamedSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of text.split('\n')) {
    if (line.startsWith('===')) {
      // subsection — treat as content
      if (current) current.lines.push(line);
      continue;
    }
    const h2 = line.match(/^==\s*(.+?)\s*==$/);
    if (h2) {
      if (current) sections.push(current);
      current = { heading: h2[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function renderSections(sections: Section[], count: number) {
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < count && i < sections.length; i++) {
    const s = sections[i];
    nodes.push(<h3 key={`h-${i}`} className="section-h2">{s.heading}</h3>);
    for (let j = 0; j < s.lines.length; j++) {
      const line = s.lines[j].trim();
      if (!line) continue;
      const h3 = line.match(/^===\s*(.+?)\s*===$/);
      if (h3) {
        nodes.push(<h4 key={`sh-${i}-${j}`} className="section-h3">{h3[1]}</h4>);
      } else {
        nodes.push(<p key={`p-${i}-${j}`} className="article-extract">{line}</p>);
      }
    }
  }
  return nodes;
}

function FeedTitle() {
  const svgRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<SVGTextElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const text = textRef.current;
    if (!svg || !text) return;
    const bb = text.getBBox();
    svg.setAttribute('viewBox', `${bb.x} ${bb.y} ${bb.width} ${bb.height}`);
    svg.style.aspectRatio = `${bb.width} / ${bb.height}`;
  }, []);

  return (
    <div className="feed-title-wrapper">
      <svg ref={svgRef} className="feed-title" width="100%" aria-label="HISTORYFLOW">
        <text
          ref={textRef}
          x="0" y="0.85em"
          fontFamily="-apple-system, 'SF Pro Display', system-ui, sans-serif"
          fontWeight="700"
          fontSize="100"
          fill="currentColor"
        >HISTORYFLOW</text>
      </svg>
      <p className="feed-subtitle">an endless stream of history, politics and culture, courtesy of wikipedia</p>
    </div>
  );
}

export default function App() {
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leadExpanded, setLeadExpanded] = useState<Set<string>>(new Set());
  const [namedSections, setNamedSections] = useState<Map<string, Section[]>>(new Map());
  const [sectionsVisible, setSectionsVisible] = useState<Map<string, number>>(new Map());
  const [expanding, setExpanding] = useState<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const { titles, nextOffset } = await searchHistoryArticles();
      const valid = await fetchArticlesBatch(titles);
      setArticles(prev => {
        const seen = new Set(prev.map(a => a.title));
        return [...prev, ...valid.filter(a => !seen.has(a.title))];
      });
      hasMoreRef.current = nextOffset !== null;
    } catch (e) {
      console.error('[HistoryFlow] load failed:', e);
      setError('Having trouble reaching Wikipedia. Tap Retry to try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const revealNextSection = useCallback(async (title: string) => {
    if (!namedSections.has(title)) {
      setExpanding(prev => new Set(prev).add(title));
      try {
        const text = await fetchFullArticle(title);
        const sections = text ? parseNamedSections(text) : [];
        setNamedSections(prev => new Map(prev).set(title, sections));
        if (sections.length > 0) {
          setSectionsVisible(prev => new Map(prev).set(title, 1));
        }
      } finally {
        setExpanding(prev => { const s = new Set(prev); s.delete(title); return s; });
      }
    } else {
      setSectionsVisible(prev => new Map(prev).set(title, (prev.get(title) ?? 0) + 1));
    }
  }, [namedSections]);

  // Initial load
  useEffect(() => {
    loadMore();
  }, [loadMore]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: '400px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div className="app">
      <FeedTitle />
      <main className="feed">
        {articles.map((article, i) => {
          const isLeadExpanded = leadExpanded.has(article.title);
          const sectionsFetched = namedSections.has(article.title);
          const sections = namedSections.get(article.title);
          const nVisible = sectionsVisible.get(article.title) ?? 0;
          const isExpanding = expanding.has(article.title);
          const allSectionsVisible = sectionsFetched && (!sections || sections.length === 0 || nVisible >= sections.length);
          const allVisible = isLeadExpanded && allSectionsVisible;
          const firstSentence = getFirstSentence(article.extract);

          return (
            <article key={`${article.title}-${i}`} className="article">
              <h2 className="article-title">{article.title}</h2>
              <div className="article-body">
                {isLeadExpanded
                  ? article.extract.split('\n').filter(Boolean).map((p, j) =>
                      <p key={j} className="article-extract">{p.trim()}</p>
                    )
                  : <p className="article-extract">{firstSentence}</p>
                }
                {isLeadExpanded && sections && renderSections(sections, nVisible)}
              </div>
              <button
                onClick={() => {
                  if (allVisible) {
                    setLeadExpanded(prev => { const s = new Set(prev); s.delete(article.title); return s; });
                    setNamedSections(prev => { const m = new Map(prev); m.delete(article.title); return m; });
                    setSectionsVisible(prev => { const m = new Map(prev); m.delete(article.title); return m; });
                  } else if (!isLeadExpanded) {
                    setLeadExpanded(prev => new Set(prev).add(article.title));
                  } else {
                    revealNextSection(article.title);
                  }
                }}
                className="expand-btn"
                disabled={isExpanding}
              >
                {isExpanding ? 'Loading…' : allVisible ? 'Collapse' : 'Read More'}
              </button>
            </article>
          );
        })}

        {error && (
          <div className="error">
            <p>{error}</p>
            <button onClick={loadMore} className="retry-btn">Retry</button>
          </div>
        )}

        {loading && (
          <div className="loading" aria-label="Loading articles">
            <div className="loading-dots">
              <span /><span /><span />
            </div>
          </div>
        )}

        {!hasMoreRef.current && !loading && (
          <div className="end-marker">— End of feed —</div>
        )}

        <div ref={sentinelRef} className="sentinel" aria-hidden="true" />
      </main>
    </div>
  );
}
