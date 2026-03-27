import { useState, useEffect, useCallback, useRef } from 'react';
import { searchHistoryArticles, fetchArticlesBatch, fetchFullArticle } from './utils/wikipedia';
import type { WikiArticle } from './utils/wikipedia';
import './App.css';

function renderWikiText(text: string) {
  const nodes: React.ReactNode[] = [];
  for (const line of text.split('\n')) {
    const h3 = line.match(/^===\s*(.+?)\s*===$/);
    const h2 = line.match(/^==\s*(.+?)\s*==$/);
    const trimmed = line.trim();
    if (h3) {
      nodes.push(<h4 key={nodes.length} className="section-h3">{h3[1]}</h4>);
    } else if (h2) {
      nodes.push(<h3 key={nodes.length} className="section-h2">{h2[1]}</h3>);
    } else if (trimmed) {
      nodes.push(<p key={nodes.length} className="article-extract">{trimmed}</p>);
    }
  }
  return nodes;
}

export default function App() {
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fullTexts, setFullTexts] = useState<Map<string, string>>(new Map());
  const [expanding, setExpanding] = useState<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  // Start at a random page of results so every session feels different
  const offsetRef = useRef(Math.floor(Math.random() * 50) * 20);
  const hasMoreRef = useRef(true);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const { titles, nextOffset } = await searchHistoryArticles(offsetRef.current);
      const valid = await fetchArticlesBatch(titles);
      setArticles(prev => [...prev, ...valid]);
      offsetRef.current = nextOffset ?? offsetRef.current + 20;
      hasMoreRef.current = nextOffset !== null;
    } catch (e) {
      console.error('[HistoryFlow] load failed:', e);
      setError('Having trouble reaching Wikipedia. Tap Retry to try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const toggleExpand = useCallback(async (title: string) => {
    if (expanded.has(title)) {
      setExpanded(prev => { const s = new Set(prev); s.delete(title); return s; });
      return;
    }
    if (!fullTexts.has(title)) {
      setExpanding(prev => new Set(prev).add(title));
      const text = await fetchFullArticle(title);
      setFullTexts(prev => new Map(prev).set(title, text ?? ''));
      setExpanding(prev => { const s = new Set(prev); s.delete(title); return s; });
    }
    setExpanded(prev => new Set(prev).add(title));
  }, [expanded, fullTexts]);

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
      <div className="feed-title">HISTORYFLOW</div>
      <main className="feed">
        {articles.map((article, i) => {
          const isExpanded = expanded.has(article.title);
          const isExpanding = expanding.has(article.title);
          const fullText = fullTexts.get(article.title);
          return (
            <article key={`${article.title}-${i}`} className="article">
              <h2 className="article-title">{article.title}</h2>
              {isExpanded && fullText
                ? <div className="article-body">{renderWikiText(fullText)}</div>
                : <div className="article-body">{article.extract.split('\n').filter(Boolean).map((p, j) => <p key={j} className="article-extract">{p.trim()}</p>)}</div>
              }
              {!isExpanded && (
                <button
                  onClick={() => toggleExpand(article.title)}
                  className="expand-btn"
                  disabled={isExpanding}
                >
                  {isExpanding ? 'Loading…' : 'Read More'}
                </button>
              )}
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
