import { useState, useEffect, useCallback, useRef } from 'react';
import { searchHistoryArticles, fetchArticleSummary } from './utils/wikipedia';
import type { WikiArticle } from './utils/wikipedia';
import './App.css';

export default function App() {
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const offsetRef = useRef(0);
  const hasMoreRef = useRef(true);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const { titles, nextOffset } = await searchHistoryArticles(offsetRef.current);
      const summaries = await Promise.all(titles.map(fetchArticleSummary));
      const valid = summaries.filter((a): a is WikiArticle => a !== null);
      setArticles(prev => [...prev, ...valid]);
      offsetRef.current = nextOffset ?? offsetRef.current + 20;
      hasMoreRef.current = nextOffset !== null;
    } catch {
      setError('Could not load articles. Check your connection and try again.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

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
      <header className="header">
        <span className="header-wordmark">HistoryFlow</span>
        <span className="header-tagline">Wikipedia · History</span>
      </header>

      <main className="feed">
        {articles.map((article, i) => (
          <article key={`${article.title}-${i}`} className="article">
            {article.description && (
              <p className="article-description">{article.description}</p>
            )}
            <h2 className="article-title">{article.title}</h2>
            <p className="article-extract">{article.extract}</p>
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="article-link"
            >
              Read on Wikipedia
            </a>
          </article>
        ))}

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
