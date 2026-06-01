"""Admin — Autopilot: end-to-end daily pipeline with human-in-loop review."""

from __future__ import annotations

import datetime as dt
import io
import sys
from pathlib import Path

import polars as pl
import streamlit as st

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from app.db import (
    read_table,
    apply_repricing_batch,
    save_triage_tags,
    update_memo_decision,
    update_inventory_price,
    log_skill_run,
    last_skill_run,
)
from app.components.auth import require_admin
from app.components import schedule
from app.autopilot import run_autopilot


# ---------------------------------------------------------------------------
# Styling
# ---------------------------------------------------------------------------

_AUTOPILOT_CSS = """
<style>
.autopilot-hero {
    background: linear-gradient(135deg, #1e3a8a 0%, #5b21b6 50%, #be185d 100%);
    color: white;
    padding: 28px 32px;
    border-radius: 16px;
    margin-bottom: 18px;
    box-shadow: 0 6px 24px rgba(99, 23, 182, 0.18);
}
.autopilot-hero h1 {
    color: white;
    font-size: 2.1rem;
    margin: 0;
    font-weight: 700;
}
.autopilot-hero p {
    color: rgba(255,255,255,0.85);
    margin: 6px 0 0 0;
    font-size: 1.0rem;
}
.autopilot-pill {
    display: inline-block;
    background: rgba(255,255,255,0.15);
    color: white;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.85rem;
    margin-top: 12px;
    backdrop-filter: blur(8px);
}
.autopilot-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 16px 18px;
    margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.autopilot-card.review {
    border-left: 4px solid #f59e0b;
}
.autopilot-card.auto {
    border-left: 4px solid #10b981;
}
.tier-pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    margin-left: 6px;
}
.tier-Top    { background: #dcfce7; color: #065f46; }
.tier-High   { background: #dbeafe; color: #1e40af; }
.tier-Mid    { background: #fef3c7; color: #92400e; }
.tier-Low    { background: #fee2e2; color: #991b1b; }
.tier-Unknown{ background: #f3f4f6; color: #4b5563; }
.tag-pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    margin-left: 6px;
}
.tag-HOLD     { background: #fee2e2; color: #991b1b; }
.tag-WATCH    { background: #fef3c7; color: #92400e; }
.tag-DISCOUNT { background: #fed7aa; color: #9a3412; }
.tag-CLEAR    { background: #dcfce7; color: #065f46; }
.section-header {
    font-size: 1.05rem;
    font-weight: 600;
    color: #111827;
    margin: 16px 0 8px 0;
    display: flex;
    align-items: center;
    gap: 8px;
}
.status-ok {
    background: #ecfdf5; color: #065f46;
    padding: 8px 14px; border-radius: 8px;
    border-left: 4px solid #10b981;
    font-size: 0.92rem;
}
.status-warn {
    background: #fffbeb; color: #92400e;
    padding: 8px 14px; border-radius: 8px;
    border-left: 4px solid #f59e0b;
    font-size: 0.92rem;
}
.muted {
    color: #6b7280; font-size: 0.85rem;
}
.pipeline {
    display: flex;
    gap: 8px;
    align-items: stretch;
    margin: 4px 0 18px 0;
    flex-wrap: wrap;
}
.pipeline-step {
    flex: 1 1 0;
    min-width: 150px;
    background: white;
    border: 1px solid #e5e7eb;
    border-left: 4px solid #10b981;
    border-radius: 10px;
    padding: 10px 14px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.pipeline-step .num {
    color: #9ca3af;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
}
.pipeline-step .title {
    font-size: 0.98rem;
    font-weight: 600;
    color: #111827;
    margin-top: 2px;
}
.pipeline-step .stat {
    color: #047857;
    font-weight: 600;
    font-size: 0.86rem;
    margin-top: 4px;
}
.pipeline-step .stat .review {
    color: #b45309;
}
.pipeline-arrow {
    align-self: center;
    color: #d1d5db;
    font-size: 1.4rem;
    user-select: none;
}
</style>
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _gather_data() -> dict[str, pl.DataFrame]:
    return {
        "inventory": read_table("inventory"),
        "rap": pl.read_csv(_REPO_ROOT / "data" / "Milestone_2" / "rap_weekly_seed.csv"),
        "sales": read_table("sales_transactions"),
        "demand": read_table("demand_signals"),
        "memos": read_table("memos"),
        "quotes": read_table("quotes"),
        "payments": read_table("payment_history"),
        "customers": read_table("customers"),
        "comms": pl.read_csv(_REPO_ROOT / "data" / "Milestone_2" / "communication_logs_seed.csv"),
    }


def _run_autopilot_now():
    """Run the orchestrator against current DB state and return the report."""
    data = _gather_data()
    return run_autopilot(
        data["inventory"], data["rap"], data["sales"], data["demand"],
        data["memos"], data["quotes"], data["payments"],
        data["customers"], data["comms"],
        today=dt.date.today(),
    )


def _run_with_live_ticker():
    """Run the pipeline and stream a step-by-step ticker to the UI.

    Returns (report, applied_counts).
    """
    step_meta = [
        ("triage",    "🏷️ Triage",        "Tagging stones by age & demand…"),
        ("repricing", "📈 Repricing",      "Computing weekly price moves…"),
        ("clv",       "⭐ CLV ranking",    "Ranking customers by lifetime value…"),
        ("memos",     "📋 Memo approval",  "Reviewing pending memo requests…"),
    ]
    # session_state.live_status keys the current run; reset each invocation
    state = {key: "pending" for key, _, _ in step_meta}
    payloads: dict[str, dict] = {}

    def _line(idx: int, key: str, title: str, sub: str) -> str:
        st_now = state[key]
        if st_now == "pending":
            return f"⏸️ **Step {idx} · {title}** — waiting"
        if st_now == "running":
            return f"⏳ **Step {idx} · {title}** — {sub}"
        # done
        p = payloads.get(key, {})
        if key == "triage":
            extra = f"{p.get('total', 0):,} stones tagged"
        elif key == "repricing":
            extra = f"{p.get('auto', 0):,} auto · {p.get('review', 0):,} for review"
        elif key == "clv":
            extra = f"{p.get('ranked', 0):,} customers ranked"
        elif key == "memos":
            extra = f"{p.get('auto', 0):,} auto · {p.get('review', 0):,} for review"
        else:
            extra = ""
        return f"✅ **Step {idx} · {title}** — {extra}"

    with st.status("🚀 Running daily Autopilot…", expanded=True) as status:
        slots = [st.empty() for _ in step_meta]

        def _render():
            for i, (key, title, sub) in enumerate(step_meta):
                slots[i].markdown(_line(i + 1, key, title, sub))

        _render()

        def progress(step: str, status_val: str, payload: dict) -> None:
            state[step] = status_val
            if payload:
                payloads[step] = payload
            _render()

        data = _gather_data()
        report = run_autopilot(
            data["inventory"], data["rap"], data["sales"], data["demand"],
            data["memos"], data["quotes"], data["payments"],
            data["customers"], data["comms"],
            today=dt.date.today(),
            price_auto_threshold_pct=float(st.session_state["ap_price_thresh"]),
            opp_score_ceiling=int(st.session_state["ap_opp_ceiling"]),
            progress_cb=progress,
        )
        applied_counts = _apply_auto_actions(report)
        status.update(label=f"✅ Done — {report.headline}", state="complete",
                      expanded=False)
    return report, applied_counts


def _apply_auto_actions(report) -> dict[str, int]:
    """Write the auto-applied rows to the DB. Returns counts of what was applied."""
    counts = {"triage": 0, "prices": 0, "memos": 0}

    # Triage tags — always applied (just labels, not pricing)
    if not report.triage.is_empty():
        tag_rows = report.triage.select(["stock_id", "action_tag"]).to_dicts()
        counts["triage"] = save_triage_tags(tag_rows, approved_by="autopilot")

    # Pricing — only the auto-apply subset
    if not report.repricing_auto.is_empty():
        rows = [
            {"stock_id": r["stock_id"], "proposed_price": r["proposed_price"]}
            for r in report.repricing_auto.to_dicts()
        ]
        counts["prices"] = apply_repricing_batch(rows)

    # Memos — auto-approve subset
    if not report.memo_auto.is_empty():
        for r in report.memo_auto.to_dicts():
            update_memo_decision(
                memo_id=r["memo_id"],
                decision="Approved",
                reason=f"[Autopilot] {r.get('reason', 'High-CLV customer; safe to approve.')}",
                cond_price=None,
                cond_hold=None,
            )
            counts["memos"] += 1
    return counts


def _has_run_today() -> tuple[bool, str | None]:
    """Return (True, run_at) if Autopilot logged an 'auto_applied' run today."""
    last = last_skill_run("Autopilot", status="auto_applied")
    if not last:
        return False, None
    run_at = last.get("run_at", "")
    if run_at.startswith(dt.date.today().isoformat()):
        return True, run_at
    return False, run_at


# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------


def _tier_pill(tier: str) -> str:
    cls = tier if tier in ("Top", "High", "Mid", "Low") else "Unknown"
    return f'<span class="tier-pill tier-{cls}">{tier}</span>'


def _tag_pill(tag: str) -> str:
    cls = tag if tag in ("HOLD", "WATCH", "DISCOUNT", "CLEAR") else "WATCH"
    return f'<span class="tag-pill tag-{cls}">{tag}</span>'


def _render_hero(report, run_at: str | None) -> None:
    today_str = dt.date.today().strftime("%A, %B %d, %Y")
    when = "Just now" if run_at is None else f"Last run · {run_at[:16]}"
    st.markdown(
        f"""
        <div class="autopilot-hero">
            <h1>🚀 Autopilot</h1>
            <p>{report.headline}</p>
            <div>
                <span class="autopilot-pill">📅 {today_str}</span>
                <span class="autopilot-pill">⏱️ {when}</span>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def _render_pipeline(report) -> None:
    """Horizontal 4-step pipeline strip — visual summary of what ran."""
    triage_n = sum(report.triage_counts.values())
    n_auto_px = len(report.repricing_auto)
    n_review_px = len(report.repricing_review)
    n_clv = len(report.clv_tiers)
    n_auto_memo = len(report.memo_auto)
    n_review_memo = len(report.memo_review)

    steps = [
        ("STEP 01", "🏷️ Triage",   f"{triage_n} stones tagged", ""),
        ("STEP 02", "📈 Repricing",
         f"{n_auto_px} auto",
         f"{n_review_px} review" if n_review_px else ""),
        ("STEP 03", "⭐ CLV",       f"{n_clv} customers ranked", ""),
        ("STEP 04", "📋 Memos",
         f"{n_auto_memo} auto",
         f"{n_review_memo} review" if n_review_memo else ""),
    ]

    html = ['<div class="pipeline">']
    for i, (num, title, stat_main, stat_review) in enumerate(steps):
        review_part = (
            f'<span class="review"> · {stat_review}</span>' if stat_review else ""
        )
        html.append(
            f'<div class="pipeline-step">'
            f'<div class="num">{num} · ✓ done</div>'
            f'<div class="title">{title}</div>'
            f'<div class="stat">{stat_main}{review_part}</div>'
            f'</div>'
        )
        if i < len(steps) - 1:
            html.append('<div class="pipeline-arrow">→</div>')
    html.append("</div>")
    st.markdown("".join(html), unsafe_allow_html=True)


# ---------------------------------------------------------------------------
# Per-step "click to see what it did" expanders (plain-English explanations)
# ---------------------------------------------------------------------------


def _render_step_details(report, applied_counts: dict[str, int]) -> None:
    """Four clickable expanders. Each step explains in plain English what
    Autopilot did and shows a small sample of the output."""
    st.markdown('<div class="section-header">🔍 Click each step to see what it did</div>',
                unsafe_allow_html=True)

    _step1_triage(report)
    _step2_repricing(report, applied_counts)
    _step3_clv(report)
    _step4_memos(report, applied_counts)


def _step1_triage(report) -> None:
    counts = report.triage_counts
    total = sum(counts.values())
    label = f"✅  Step 1 of 4 · 🏷️ Triage — tagged {total:,} stones"
    with st.expander(label, expanded=False):
        st.markdown(
            "**What I did:** I looked at every available stone and gave each "
            "one a label based on how long it's been sitting in stock and how "
            "much demand its category is seeing right now. These labels feed "
            "the next steps (pricing uses them to discount slow movers; memo "
            "approval blocks lending out any stone tagged HOLD)."
        )
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("🔴 CLEAR",
                  f"{counts.get('CLEAR', 0):,}",
                  help="Very stale — mark down hard.")
        c2.metric("🟠 DISCOUNT",
                  f"{counts.get('DISCOUNT', 0):,}",
                  help="Slow mover — small markdown suggested.")
        c3.metric("🟡 WATCH",
                  f"{counts.get('WATCH', 0):,}",
                  help="Borderline — keep an eye on them.")
        c4.metric("🟢 HOLD",
                  f"{counts.get('HOLD', 0):,}",
                  help="Moving fine — no action needed.")

        if not report.triage.is_empty():
            st.markdown("**Five oldest stones flagged:**")
            sample = (
                report.triage
                .filter(pl.col("action_tag").is_in(["CLEAR", "DISCOUNT"]))
                .sort("age_in_stock_days", descending=True)
                .head(5)
                .select(["stock_id", "category_simple", "age_in_stock_days",
                         "action_tag", "reason"])
            )
            st.dataframe(sample, use_container_width=True, hide_index=True)


def _step2_repricing(report, applied_counts: dict[str, int]) -> None:
    n_auto = len(report.repricing_auto)
    n_rev = len(report.repricing_review)
    thresh = report.config["price_auto_threshold_pct"]
    label = (f"✅  Step 2 of 4 · 📈 Repricing — applied {n_auto:,} small moves, "
             f"{n_rev:,} need your review")
    with st.expander(label, expanded=False):
        st.markdown(
            f"**What I did:** I compared each stone's current price against "
            f"the new weekly RapNet benchmark, then adjusted for demand, "
            f"recent sales velocity, the triage tag from Step 1, and a margin "
            f"floor. I split the proposals into two piles using the "
            f"**{thresh:.1f}%** auto-apply threshold you set:\n\n"
            f"- ✅ **{n_auto:,} prices applied automatically** — every move "
            f"was within ±{thresh:.1f}%, so I just updated them.\n"
            f"- ⚠️ **{n_rev:,} prices sent to your review queue** — these "
            f"were bigger moves (or the stone has a `frozen`, `margin`, or "
            f"`quote` flag that makes the change worth a second look)."
        )

        if not report.repricing_auto.is_empty():
            st.markdown("**Biggest of the auto-applied moves (top 5):**")
            sample = (
                report.repricing_auto
                .with_columns(pl.col("pct_change").abs().alias("_abs"))
                .sort("_abs", descending=True)
                .head(5)
                .select(["stock_id", "category_simple", "old_price",
                         "proposed_price", "pct_change", "primary_driver"])
            )
            st.dataframe(sample, use_container_width=True, hide_index=True)

        if n_rev > 0:
            st.info("👉 See the **⚠️ Needs review** tab to approve or reject "
                    "the larger price moves.")


def _step3_clv(report) -> None:
    tiers = report.clv_tiers
    counts = {"Top": 0, "High": 0, "Mid": 0, "Low": 0}
    for t in tiers.values():
        if t in counts:
            counts[t] += 1
    label = (f"✅  Step 3 of 4 · ⭐ CLV ranking — sorted {len(tiers):,} "
             "customers into 4 tiers")
    with st.expander(label, expanded=False):
        st.markdown(
            "**What I did:** I ranked every broker and company by "
            "**Customer Lifetime Value** — how much profit we expect from "
            "them over the next 36 months, given their gross-profit history "
            "and churn risk. Then I sorted everyone into quartiles. "
            "This ranking matters for the next step: only **Top** and "
            "**High** tier customers are eligible for auto-approved memos."
        )
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("⭐ Top 25%",  f"{counts['Top']:,}")
        c2.metric("🔵 High 25%", f"{counts['High']:,}")
        c3.metric("🟡 Mid 25%",  f"{counts['Mid']:,}")
        c4.metric("🔴 Low 25%",  f"{counts['Low']:,}")
        st.caption("See the **⭐ CLV tiers** tab for the full list.")


def _step4_memos(report, applied_counts: dict[str, int]) -> None:
    n_auto = len(report.memo_auto)
    n_rev = len(report.memo_review)
    tiers = ", ".join(report.config["auto_approve_tiers"])
    label = (f"✅  Step 4 of 4 · 📋 Memo approval — auto-approved {n_auto:,}, "
             f"{n_rev:,} need your review")
    with st.expander(label, expanded=False):
        if n_auto == 0 and n_rev == 0:
            st.markdown(
                "**What I did:** I checked for pending memo requests and "
                "found **none** today. Nothing to decide."
            )
            return

        st.markdown(
            f"**What I did:** I reviewed every pending memo request "
            f"(a memo is when a broker asks to hold a stone on consignment "
            f"before deciding to buy). For each one I scored the requester's "
            f"reliability and the opportunity cost of lending the stone out, "
            f"then made a recommendation. I auto-approve only the safest "
            f"cases:\n\n"
            f"- ✅ **{n_auto:,} auto-approved** — the customer is in the "
            f"**{tiers}** tier, the stone isn't tagged HOLD, and the "
            f"recommendation was a clean APPROVE.\n"
            f"- ⚠️ **{n_rev:,} sent to your review** — anything with "
            f"conditions, a rejection recommendation, a Mid/Low customer, "
            f"or a hot stone."
        )

        if not report.memo_auto.is_empty():
            st.markdown("**Auto-approved today:**")
            cols = [c for c in
                    ["memo_id", "stock_id", "customer_id", "tier",
                     "reliability_score", "opportunity_score"]
                    if c in report.memo_auto.columns]
            st.dataframe(report.memo_auto.select(cols).head(10),
                         use_container_width=True, hide_index=True)
        if n_rev > 0:
            st.info("👉 See the **⚠️ Needs review** tab to decide on the "
                    "remaining memo requests.")


def _render_threshold_histogram(report, threshold_pct: float) -> None:
    """Histogram of |pct_change| with a red line at the auto-apply threshold.

    Makes the slider's effect tangible: bars to the left of the line are
    auto-applied; bars to the right go to review.
    """
    # Combine both auto and review pricing rows so the full distribution shows.
    parts = []
    if not report.repricing_auto.is_empty():
        parts.append(report.repricing_auto.select(["pct_change", "flag"]))
    if not report.repricing_review.is_empty():
        parts.append(report.repricing_review.select(["pct_change", "flag"]))
    if not parts:
        st.caption("No price changes to plot today.")
        return

    full = pl.concat(parts, how="vertical_relaxed")
    df = full.with_columns(
        pl.col("pct_change").abs().alias("abs_pct"),
    ).with_columns(
        pl.when(pl.col("abs_pct") <= threshold_pct)
        .then(pl.lit("Auto-applied"))
        .otherwise(pl.lit("Review"))
        .alias("bucket")
    )

    n_auto = int((df["bucket"] == "Auto-applied").sum())
    n_review = int((df["bucket"] == "Review").sum())

    try:
        from plotnine import (
            ggplot, aes, geom_histogram, geom_vline, scale_fill_manual,
            labs, theme_minimal, theme, element_text,
        )
    except ImportError:
        st.caption("plotnine not installed — skipping chart.")
        return

    pdf = df.to_pandas()
    fig = (
        ggplot(pdf, aes(x="abs_pct", fill="bucket"))
        + geom_histogram(bins=24, alpha=0.85, color="white", size=0.2)
        + geom_vline(xintercept=threshold_pct, color="#ef4444",
                     linetype="dashed", size=0.8)
        + scale_fill_manual(values={"Auto-applied": "#10b981", "Review": "#f59e0b"})
        + labs(
            title=f"Price moves vs. threshold ({threshold_pct:.1f}%)",
            x="|% change|", y="Stones", fill="",
        )
        + theme_minimal()
        + theme(figure_size=(8, 3.2),
                legend_position="bottom",
                plot_title=element_text(size=11, weight="bold"))
    )

    buf = io.BytesIO()
    fig.save(buf, format="png", dpi=140, verbose=False)
    buf.seek(0)
    st.image(buf, use_container_width=True)
    st.caption(
        f"At the current threshold of **{threshold_pct:.1f}%**: "
        f"🟢 **{n_auto}** stones auto-applied · 🟡 **{n_review}** routed to review. "
        f"Drag the slider in the sidebar and re-run to see the split change."
    )


def _render_activity_feed(limit: int = 8) -> None:
    """Show the most recent Autopilot run-log rows from skill_runs."""
    from app.db import get_conn
    rows: list[dict] = []
    with get_conn() as conn:
        for r in conn.execute(
            "SELECT run_at, status, result_summary FROM skill_runs "
            "WHERE skill_name='Autopilot' ORDER BY run_at DESC LIMIT ?",
            (limit,),
        ):
            rows.append(dict(r))
    if not rows:
        st.caption("No Autopilot runs logged yet.")
        return

    status_icon = {
        "auto_applied":      "🤖",
        "approved_review":   "✅",
        "rejected_review":   "❌",
    }
    for r in rows:
        icon = status_icon.get(r["status"], "•")
        ts = (r["run_at"] or "")[:16]
        st.markdown(
            f"<div style='padding:6px 0;border-bottom:1px solid #f3f4f6;'>"
            f"{icon} <span class='muted'>{ts}</span> "
            f"<b>{r['status'].replace('_',' ')}</b> — "
            f"{r['result_summary'] or ''}"
            f"</div>",
            unsafe_allow_html=True,
        )


def _render_kpi_strip(report, applied_counts: dict[str, int] | None) -> None:
    c1, c2, c3, c4, c5 = st.columns(5)
    triage_total = sum(report.triage_counts.values())
    c1.metric("🏷️ Stones triaged", f"{triage_total:,}")
    c2.metric("📈 Prices auto-applied", f"{len(report.repricing_auto):,}")
    c3.metric("📋 Memos auto-approved", f"{len(report.memo_auto):,}")
    c4.metric("⚠️ Needs review",
              f"{len(report.repricing_review) + len(report.memo_review):,}")
    high_tier = sum(1 for t in report.clv_tiers.values() if t in ("Top", "High"))
    c5.metric("⭐ High-value customers", f"{high_tier:,}")


def _render_review_pricing(report) -> None:
    if report.repricing_review.is_empty():
        st.markdown(
            '<div class="status-ok">✓ No price changes need your attention today.</div>',
            unsafe_allow_html=True,
        )
        return

    st.markdown(
        f'<div class="status-warn">⚠️ {len(report.repricing_review)} '
        f'price change(s) outside the auto-apply threshold '
        f'({report.config["price_auto_threshold_pct"]:.0f}%) — please review.</div>',
        unsafe_allow_html=True,
    )

    rows = report.repricing_review.head(50).to_dicts()
    for r in rows:
        stock_id = r["stock_id"]
        key = f"px_{stock_id}"
        decided = st.session_state.get(f"{key}_decided", False)
        if decided:
            continue

        direction = "🔼" if r["pct_change"] > 0 else "🔽"
        flag = r.get("flag", "")
        flag_badge = f' · 🚩 {flag}' if flag else ""

        with st.container(border=True):
            top, btn = st.columns([5, 2])
            with top:
                st.markdown(
                    f"**{stock_id}** · {r.get('category_simple','')}{flag_badge}  \n"
                    f"{direction} **${r['old_price']:,.0f} → ${r['proposed_price']:,.0f}** "
                    f"({r['pct_change']:+.1f}%)  \n"
                    f"<span class='muted'>Driver: {r.get('primary_driver','')}</span>",
                    unsafe_allow_html=True,
                )
            with btn:
                bc1, bc2 = st.columns(2)
                if bc1.button("✅ Apply", key=f"{key}_apply"):
                    update_inventory_price(stock_id, float(r["proposed_price"]),
                                           updated_by="admin (autopilot review)")
                    log_skill_run("Autopilot", "admin", "approved_review",
                                  f"Approved price change for {stock_id}: "
                                  f"{r['pct_change']:+.1f}%")
                    st.session_state[f"{key}_decided"] = True
                    st.toast(f"Applied {stock_id}", icon="✅")
                    st.rerun()
                if bc2.button("✖ Skip", key=f"{key}_skip"):
                    log_skill_run("Autopilot", "admin", "rejected_review",
                                  f"Rejected price change for {stock_id}")
                    st.session_state[f"{key}_decided"] = True
                    st.rerun()


def _render_review_memos(report) -> None:
    if report.memo_review.is_empty():
        st.markdown(
            '<div class="status-ok">✓ No memo requests need your attention today.</div>',
            unsafe_allow_html=True,
        )
        return

    st.markdown(
        f'<div class="status-warn">⚠️ {len(report.memo_review)} '
        f'memo request(s) need a decision.</div>',
        unsafe_allow_html=True,
    )

    rows = report.memo_review.head(50).to_dicts()
    for r in rows:
        memo_id = r["memo_id"]
        key = f"memo_{memo_id}"
        if st.session_state.get(f"{key}_decided"):
            continue

        decision = r.get("decision", "")
        tier = r.get("tier", "Unknown")
        tag = r.get("triage_tag", "") or "—"
        reason = r.get("reason", "")

        # Visual mapping of recommended decision
        rec_icon = {"APPROVE": "🟢", "APPROVE_WITH_CONDITIONS": "🟡", "REJECT": "🔴"}.get(decision, "⚪")

        with st.container(border=True):
            top, btn = st.columns([5, 2])
            with top:
                st.markdown(
                    f"**{memo_id}** · 💎 {r.get('stock_id','')} · 👤 {r.get('customer_id','')}"
                    f"{_tier_pill(tier)}{_tag_pill(tag) if tag != '—' else ''}  \n"
                    f"{rec_icon} **Recommendation: {decision}**  \n"
                    f"<span class='muted'>{reason}</span>  \n"
                    f"<span class='muted'>Reliability {r.get('reliability_score','?')}/100 · "
                    f"Opportunity cost {r.get('opportunity_score','?')}/100</span>",
                    unsafe_allow_html=True,
                )
            with btn:
                bc1, bc2 = st.columns(2)
                if bc1.button("✅ Approve", key=f"{key}_approve"):
                    update_memo_decision(
                        memo_id=memo_id,
                        decision="Approved",
                        reason=f"[Reviewed] {reason}",
                    )
                    log_skill_run("Autopilot", "admin", "approved_review",
                                  f"Approved memo {memo_id}")
                    st.session_state[f"{key}_decided"] = True
                    st.toast(f"Approved {memo_id}", icon="✅")
                    st.rerun()
                if bc2.button("❌ Reject", key=f"{key}_reject"):
                    update_memo_decision(
                        memo_id=memo_id,
                        decision="Rejected",
                        reason=f"[Reviewed] {reason}",
                    )
                    log_skill_run("Autopilot", "admin", "rejected_review",
                                  f"Rejected memo {memo_id}")
                    st.session_state[f"{key}_decided"] = True
                    st.toast(f"Rejected {memo_id}", icon="❌")
                    st.rerun()


def _render_auto_applied(report, applied_counts: dict[str, int]) -> None:
    st.markdown(
        f'<div class="status-ok">✓ Applied today without asking: '
        f'{applied_counts.get("triage",0)} triage tags · '
        f'{applied_counts.get("prices",0)} price updates · '
        f'{applied_counts.get("memos",0)} memo approvals.</div>',
        unsafe_allow_html=True,
    )
    sub_t1, sub_t2, sub_t3 = st.tabs(["💲 Price moves", "📋 Memos", "🏷️ Triage"])
    with sub_t1:
        if report.repricing_auto.is_empty():
            st.caption("No automatic price moves today.")
        else:
            display = report.repricing_auto.select([
                "stock_id", "category_simple", "old_price",
                "proposed_price", "pct_change", "primary_driver",
            ]).head(100)
            st.dataframe(display, use_container_width=True, hide_index=True)
    with sub_t2:
        if report.memo_auto.is_empty():
            st.caption("No automatic memo approvals today.")
        else:
            cols = [c for c in
                    ["memo_id","stock_id","customer_id","tier",
                     "reliability_score","opportunity_score","reason"]
                    if c in report.memo_auto.columns]
            st.dataframe(report.memo_auto.select(cols).head(100),
                         use_container_width=True, hide_index=True)
    with sub_t3:
        if report.triage.is_empty():
            st.caption("No triage output.")
        else:
            cols = [c for c in
                    ["stock_id","category_simple","age_in_stock_days",
                     "action_tag","suggested_price_move_pct","reason"]
                    if c in report.triage.columns]
            st.dataframe(report.triage.select(cols).head(200),
                         use_container_width=True, hide_index=True)


# ---------------------------------------------------------------------------
# Schedule panel (macOS launchd)
# ---------------------------------------------------------------------------


def _render_schedule_panel() -> None:
    """Sidebar UI: enable/disable a daily launchd job and pick a time."""
    with st.expander("📅 Daily auto-run", expanded=False):
        if not schedule.is_supported():
            st.caption("Daily scheduling is only available on macOS.")
            return

        installed = schedule.is_installed()
        current = schedule.current_schedule()

        if installed and current:
            hh, mm = current
            st.markdown(
                f'<div class="status-ok">✓ Scheduled daily at '
                f'<b>{hh:02d}:{mm:02d}</b></div>',
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                '<div class="status-warn">⏸ Daily schedule is <b>disabled</b>.</div>',
                unsafe_allow_html=True,
            )

        default_time = dt.time(hour=current[0] if current else 8,
                               minute=current[1] if current else 0)
        new_time = st.time_input(
            "Run at",
            value=default_time,
            step=300,           # 5-minute increments
            help="Time of day (24h) for the headless run.",
            key="ap_sched_time",
        )

        c1, c2 = st.columns(2)
        with c1:
            label = "💾 Update" if installed else "🟢 Enable"
            if st.button(label, key="ap_sched_enable", use_container_width=True):
                try:
                    path = schedule.enable(new_time.hour, new_time.minute)
                    st.success(
                        f"Daily run set for {new_time.strftime('%H:%M')}.\n\n"
                        f"Plist: `{path}`"
                    )
                    st.rerun()
                except Exception as e:
                    st.error(f"Could not enable schedule: {e}")
        with c2:
            if st.button("🔴 Disable", key="ap_sched_disable",
                         disabled=not installed, use_container_width=True):
                try:
                    schedule.disable()
                    st.success("Daily run disabled.")
                    st.rerun()
                except Exception as e:
                    st.error(f"Could not disable schedule: {e}")

        st.caption(
            "Schedule uses macOS launchd. The job runs even when the app "
            "isn't open, but your Mac must be awake at the chosen time."
        )


# ---------------------------------------------------------------------------
# Page entry
# ---------------------------------------------------------------------------


def render() -> None:
    st.markdown(_AUTOPILOT_CSS, unsafe_allow_html=True)

    if not require_admin():
        return

    # ── Decide whether to run autopilot now ──────────────────────────────
    ran_today, last_run_at = _has_run_today()

    # Sidebar controls (compact)
    with st.sidebar:
        st.markdown("### 🚀 Autopilot")
        force = st.button("🔁 Re-run now", help="Re-run the full pipeline against current DB state.")
        with st.expander("⚙️ Thresholds", expanded=False):
            st.session_state.setdefault("ap_price_thresh", 7.0)
            st.session_state.setdefault("ap_opp_ceiling", 70)
            st.slider(
                "Price auto-apply threshold (%)",
                min_value=1.0, max_value=20.0, step=0.5,
                key="ap_price_thresh",
                help=(
                    "Largest price change Autopilot will apply on its own. "
                    "If a stone's proposed price moves by **more** than this "
                    "% — up or down — it goes to the review queue instead. "
                    "Lower = more cautious."
                ),
            )
            st.caption(
                f"Auto-apply when |Δprice| ≤ "
                f"**{st.session_state['ap_price_thresh']:.1f}%**. "
                f"Bigger moves → review queue."
            )
            st.slider(
                "Memo opportunity-score ceiling",
                min_value=20, max_value=100, step=5,
                key="ap_opp_ceiling",
                help=(
                    "Memo requests are auto-approved only when the stone's "
                    "opportunity-cost score (0=cheap to lend, 100=very hot) "
                    "is at or below this. Hot stones always go to review."
                ),
            )
        _render_schedule_panel()

    cache_key = "autopilot_report"
    counts_key = "autopilot_applied_counts"

    need_run = force or not ran_today or cache_key not in st.session_state

    if need_run:
        report, counts = _run_with_live_ticker()
        log_skill_run("Autopilot", "system", "auto_applied",
                      f"{report.headline} | applied: {counts}")
        st.session_state[cache_key] = report
        st.session_state[counts_key] = counts
        # Reset per-item decision flags
        for k in list(st.session_state.keys()):
            if k.endswith("_decided"):
                del st.session_state[k]

    report = st.session_state[cache_key]
    applied_counts = st.session_state.get(counts_key, {})

    _render_hero(report, last_run_at if not need_run else None)
    _render_pipeline(report)
    _render_kpi_strip(report, applied_counts)

    st.markdown("---")
    _render_step_details(report, applied_counts)

    st.markdown("")
    tab_review, tab_applied, tab_clv, tab_log = st.tabs([
        f"⚠️ Needs review ({len(report.repricing_review) + len(report.memo_review)})",
        "✅ Auto-applied today",
        "⭐ CLV tiers",
        "📜 Activity log",
    ])

    with tab_review:
        st.markdown('<div class="section-header">📊 How the threshold splits today\'s price moves</div>',
                    unsafe_allow_html=True)
        _render_threshold_histogram(report, float(st.session_state.get("ap_price_thresh", 7.0)))
        st.markdown("---")
        col_a, col_b = st.columns(2)
        with col_a:
            st.markdown('<div class="section-header">💲 Pricing review queue</div>',
                        unsafe_allow_html=True)
            _render_review_pricing(report)
        with col_b:
            st.markdown('<div class="section-header">📋 Memo review queue</div>',
                        unsafe_allow_html=True)
            _render_review_memos(report)

    with tab_applied:
        _render_auto_applied(report, applied_counts)

    with tab_clv:
        if not report.clv_tiers:
            st.caption("No CLV data available.")
        else:
            tier_counts = {"Top": 0, "High": 0, "Mid": 0, "Low": 0}
            for t in report.clv_tiers.values():
                if t in tier_counts:
                    tier_counts[t] += 1
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("⭐ Top", tier_counts["Top"])
            c2.metric("🔵 High", tier_counts["High"])
            c3.metric("🟡 Mid", tier_counts["Mid"])
            c4.metric("🔴 Low", tier_counts["Low"])
            tier_rows = sorted(report.clv_tiers.items(),
                               key=lambda x: ["Top","High","Mid","Low","Unknown"].index(x[1]))
            tier_df = pl.DataFrame(
                {"entity_id": [k for k,_ in tier_rows],
                 "tier":      [v for _,v in tier_rows]}
            )
            st.dataframe(tier_df, use_container_width=True, hide_index=True)

    with tab_log:
        st.markdown('<div class="section-header">📜 Recent Autopilot runs</div>',
                    unsafe_allow_html=True)
        st.caption("Most recent entries from the `skill_runs` table for Autopilot.")
        _render_activity_feed(limit=10)
