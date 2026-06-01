'use client';
import { useEffect, useRef, useState } from 'react';

type Turn = { role: 'user' | 'assistant'; text: string };

const SUGGESTIONS = [
  'Who has the highest CLV?',
  'Which shape has the most stock?',
  'What memos need my sign-off?',
  'What stones are stale on memo?',
  'Top 5 customers by enquiry value',
];

const STORAGE_KEY = 'admin.ai.chat.turns';

export function AIChatWidget({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore conversation on mount
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setTurns(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Persist on change
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(turns)); } catch {}
  }, [turns]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, pending, open]);

  if (!enabled) return null;

  async function ask(q: string) {
    const text = q.trim();
    if (!text || pending) return;
    setError(null);
    setTurns(prev => [...prev, { role: 'user', text }]);
    setQuestion('');
    setPending(true);
    try {
      const r = await fetch('/api/admin/ai/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: text }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setTurns(prev => [...prev, { role: 'assistant', text: data.answer ?? '(no answer)' }]);
    } catch (e: any) {
      setError(e?.message ?? 'Request failed');
    } finally {
      setPending(false);
    }
  }

  function clearChat() {
    setTurns([]);
    setError(null);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  return (
    <>
      {/* Floating launcher button (hidden when panel open) */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open AI assistant"
          className="fixed bottom-5 right-5 z-40 w-14 h-14 rounded-full
                     bg-gradient-to-br from-brand-700 to-brand-900 text-white
                     shadow-lg hover:shadow-xl hover:scale-105 transition
                     flex items-center justify-center"
        >
          <span className="text-2xl">💬</span>
          <span className="sr-only">Ask AI</span>
        </button>
      )}

      {/* Slide-out panel */}
      <div
        className={`fixed bottom-5 right-5 z-40 w-[380px] max-w-[calc(100vw-2rem)]
                    h-[600px] max-h-[calc(100vh-2rem)]
                    bg-white rounded-xl shadow-2xl border border-brand-200
                    flex flex-col overflow-hidden
                    transition-all duration-200 origin-bottom-right
                    ${open ? 'opacity-100 scale-100' : 'opacity-0 scale-90 pointer-events-none'}`}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-r from-brand-900 to-brand-700 text-white flex items-center justify-between">
          <div>
            <div className="font-serif text-base leading-tight">Ask Mahant AI</div>
            <div className="text-[11px] text-brand-200">
              Live desk data · inventory · CLV · memos
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={clearChat}
              title="Clear conversation"
              className="text-brand-200 hover:text-white px-2 py-1 text-xs rounded hover:bg-white/10"
            >
              Clear
            </button>
            <button
              onClick={() => setOpen(false)}
              title="Close"
              className="text-brand-200 hover:text-white w-7 h-7 rounded hover:bg-white/10 flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-brand-50/30">
          {turns.length === 0 && !pending && (
            <div className="text-xs text-brand-700/70 text-center py-4">
              Ask anything about today’s desk — inventory, customers, CLV, memos.
            </div>
          )}
          {turns.map((t, i) => (
            <div
              key={i}
              className={
                t.role === 'user'
                  ? 'ml-6 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 text-sm text-brand-900 whitespace-pre-wrap'
                  : 'mr-6 bg-gradient-to-br from-brand-700 to-brand-900 text-white rounded-lg px-3 py-2 text-sm whitespace-pre-wrap shadow-sm'
              }
            >
              {t.text}
            </div>
          ))}
          {pending && (
            <div className="mr-6 text-xs text-brand-700/70 italic flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 bg-brand-700/60 rounded-full animate-pulse"></span>
              <span className="inline-block w-1.5 h-1.5 bg-brand-700/60 rounded-full animate-pulse" style={{ animationDelay: '0.15s' }}></span>
              <span className="inline-block w-1.5 h-1.5 bg-brand-700/60 rounded-full animate-pulse" style={{ animationDelay: '0.3s' }}></span>
              <span className="ml-1">Thinking…</span>
            </div>
          )}
          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
              {error}
            </div>
          )}
        </div>

        {/* Suggestions (only when empty) */}
        {turns.length === 0 && (
          <div className="px-3 pb-2 flex flex-wrap gap-1.5 bg-brand-50/30">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => ask(s)}
                disabled={pending}
                className="text-[11px] px-2 py-1 rounded-full border border-brand-200 bg-white hover:bg-brand-50 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={(e) => { e.preventDefault(); ask(question); }}
          className="flex gap-2 p-2.5 border-t border-brand-100 bg-white"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything…"
            disabled={pending}
            className="flex-1 rounded border border-brand-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-700"
          />
          <button
            type="submit"
            disabled={pending || question.trim().length === 0}
            className="px-3 py-2 rounded bg-brand-900 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </>
  );
}
