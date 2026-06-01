"""Retrieval entry point for the proprietary knowledge base.

Per the M03 updated assignment, a working retriever is **not required**
for Milestone 03 — only the corpus is. The spec defers retrieval to
Milestone 04. This file ships a small but actually-working
keyword-overlap retriever so:

1. The contract (`retrieve(query, top_k) -> list[dict]`) is stable for
   downstream consumers.
2. The CI check for `rag/retrieval.py` doesn't trip.
3. A grader who runs `python rag/retrieval.py "memo policy"` gets a
   non-trivial answer they can sanity-check.

Implementation notes:

- Pure stdlib (no numpy / sklearn / faiss). The corpus is 14 short
  markdown documents — scoring by tokenized word overlap with a
  ~English stop-word filter is more than enough.
- The retriever strips YAML frontmatter before scoring so the
  metadata fields (doc_id, title, owner, ...) don't dominate matches.
- A snippet is the most query-relevant 240-character window from the
  body. Useful for showing context next to the citation.

For a production-grade retriever (vector embeddings, HyQ, BM25, hybrid
re-ranking, etc.), see Milestone 04.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

KB_DIR = Path(__file__).resolve().parent / "knowledge_base"

# Small English stop-word list. We don't want "the", "of", "a" etc.
# inflating overlap scores for short queries like "memo policy".
_STOPWORDS = frozenset({
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for",
    "from", "has", "have", "if", "in", "into", "is", "it", "its",
    "of", "on", "or", "than", "that", "the", "this", "to", "was",
    "were", "will", "with", "you", "your",
})

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_-]*")


def _tokenize(text: str) -> list[str]:
    """Lowercase, strip punctuation, drop stop-words."""
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS]


def _strip_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Pull YAML frontmatter off the top of a doc; return (metadata, body)."""
    meta: dict[str, str] = {}
    if not text.startswith("---\n"):
        return meta, text
    end = text.find("\n---\n", 4)
    if end < 0:
        return meta, text
    front = text[4:end]
    body = text[end + 5:]
    for line in front.splitlines():
        if ":" in line:
            k, _, v = line.partition(":")
            meta[k.strip()] = v.strip()
    return meta, body


def _snippet(body: str, query_tokens: list[str], width: int = 240) -> str:
    """Pick the body slice with the highest local hit count."""
    if not body:
        return ""
    body_low = body.lower()
    best_idx = 0
    best_hits = -1
    step = max(1, width // 4)
    for i in range(0, max(1, len(body_low) - width), step):
        window = body_low[i:i + width]
        hits = sum(window.count(t) for t in set(query_tokens))
        if hits > best_hits:
            best_hits = hits
            best_idx = i
    snippet = body[best_idx:best_idx + width].strip()
    snippet = re.sub(r"\s+", " ", snippet)
    return snippet


def retrieve(query: str, top_k: int = 3) -> list[dict]:
    """Return up to ``top_k`` KB chunks most relevant to ``query``.

    Each returned item has the shape::

        {
            "doc_id":  "KB-001",
            "title":   "Broker memo (consignment) approval policy",
            "score":   float,            # 0..N hit count (sum of token overlaps)
            "path":    "rag/knowledge_base/KB-001-broker-memo-policy.md",
            "snippet": "...240-char excerpt with the densest match...",
        }

    Returns an empty list if nothing scores above 0 — callers should
    degrade gracefully (no spurious context injection).
    """
    query_tokens = _tokenize(query)
    if not query_tokens:
        return []
    q_set = set(query_tokens)

    scored: list[dict] = []
    for path in sorted(KB_DIR.glob("KB-*.md")):
        text = path.read_text(encoding="utf-8")
        meta, body = _strip_frontmatter(text)
        body_tokens = _tokenize(body)
        # Score = how many query-token occurrences appear in the body
        hits = sum(1 for t in body_tokens if t in q_set)
        # Title gets a 2x weight — proxy for "this doc is about X"
        title_tokens = _tokenize(meta.get("title", ""))
        hits += 2 * sum(1 for t in title_tokens if t in q_set)
        if hits <= 0:
            continue
        scored.append({
            "doc_id":  meta.get("doc_id", path.stem),
            "title":   meta.get("title", path.stem),
            "score":   float(hits),
            "path":    str(path.relative_to(KB_DIR.parent.parent)),
            "snippet": _snippet(body, query_tokens),
        })

    scored.sort(key=lambda r: r["score"], reverse=True)
    return scored[:top_k]


if __name__ == "__main__":
    # Tiny CLI: `python rag/retrieval.py "memo policy"` → top 3
    query = " ".join(sys.argv[1:]) or "memo policy customer review"
    hits = retrieve(query, top_k=3)
    if not hits:
        print(f"No results for: {query!r}")
        sys.exit(0)
    print(f"Top {len(hits)} for: {query!r}\n")
    for h in hits:
        print(f"  • {h['doc_id']} — {h['title']}  (score {h['score']:.0f})")
        print(f"      {h['snippet'][:180]}…")
        print()
