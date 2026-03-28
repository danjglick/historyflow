import { useState, useEffect, useCallback, useRef } from 'react';
import { searchHistoryArticles, fetchArticlesBatch, fetchFullArticle } from './utils/wikipedia';
import type { WikiArticle } from './utils/wikipedia';
import './App.css';

interface Section {
  heading: string;
  lines: string[];
}

function parseNamedSections(text: string): Section[] {
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let currentLines: string[] = [];

  for (const line of text.split('\n')) {
    const h2 = !line.startsWith('===') && line.match(/^==\s*(.+?)\s*==$/);
    if (h2) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, lines: currentLines });
      }
      currentHeading = h2[1];
      currentLines = [];
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, lines: currentLines });
  }

  return sections.filter(s => s.lines.some(l => l.trim()));
}

function renderSections(sections: Section[], count: number) {
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < count && i < sections.length; i++) {
    const s = sections[i];
    nodes.push(<h3 key={`h-${i}`} className="section-h2">{s.heading}</h3>);
    for (let j = 0; j < s.lines.length; j++) {
      const line = s.lines[j];
      const h3 = line.match(/^===\s*(.+?)\s*===$/);
      const trimmed = line.trim();
      if (h3) {
        nodes.push(<h4 key={`h3-${i}-${j}`} className="section-h3">{h3[1]}</h4>);
      } else if (trimmed) {
        nodes.push(<p key={`p-${i}-${j}`} className="article-extract">{trimmed}</p>);
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
    </div>
  );
}

export default function App() {
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setArticles(prev => [...prev, ...valid]);
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
      const text = await fetchFullArticle(title);
      const sections = text ? parseNamedSections(text) : [];
      setNamedSections(prev => new Map(prev).set(title, sections));
      setSectionsVisible(prev => new Map(prev).set(title, 1));
      setExpanding(prev => { const s = new Set(prev); s.delete(title); return s; });
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
          const sections = namedSections.get(article.title);
          const nVisible = sectionsVisible.get(article.title) ?? 0;
          const isExpanding = expanding.has(article.title);
          const allVisible = sections !== undefined && nVisible >= sections.length;

          return (
            <article key={`${article.title}-${i}`} className="article">
              <h2 className="article-title">{article.title}</h2>
              <div className="article-body">
                {article.extract.split('\n').filter(Boolean).map((p, j) =>
                  <p key={j} className="article-extract">{p.trim()}</p>
                )}
                {sections && renderSections(sections, nVisible)}
              </div>
              <button
                onClick={() => {
                  if (allVisible) {
                    setNamedSections(prev => { const m = new Map(prev); m.delete(article.title); return m; });
                    setSectionsVisible(prev => { const m = new Map(prev); m.delete(article.title); return m; });
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
