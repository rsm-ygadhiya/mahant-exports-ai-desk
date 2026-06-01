"""Reusable human-in-the-loop skill runner widget.

Usage
-----
    from app.components.skill_runner import run_skill_card

    run_skill_card(
        skill_name  = "Weekly Repricing",
        icon        = "📈",
        description = "Re-prices all available stones based on Rap movement.",
        run_fn      = lambda: compute_repricing(...),   # returns (result_df, summary_str)
        approve_fn  = lambda df: apply_repricing_batch(df.to_dicts()),
        result_cols = ["stock_id", "old_price", "proposed_price", "flag"],
    )
"""

from __future__ import annotations

from typing import Callable

import polars as pl
import streamlit as st

from app.db import log_skill_run


def run_skill_card(
    skill_name: str,
    icon: str,
    description: str,
    run_fn: Callable[[], tuple[pl.DataFrame, str]],
    approve_fn: Callable[[pl.DataFrame], None] | None = None,
    result_cols: list[str] | None = None,
    approve_label: str = "✅ Approve & Apply",
    reject_label: str = "❌ Reject",
    show_table: bool = True,
) -> None:
    """Render a skill card with Run → spinner → results → Approve/Reject."""

    key_prefix = skill_name.replace(" ", "_").lower()

    with st.expander(f"{icon} **{skill_name}**", expanded=False):
        st.caption(description)

        col_run, col_status = st.columns([2, 3])
        with col_run:
            run_clicked = st.button(f"▶ Run {skill_name}", key=f"{key_prefix}_run")

        # Retrieve cached result from session state
        result_key = f"{key_prefix}_result"
        summary_key = f"{key_prefix}_summary"
        state_key = f"{key_prefix}_state"   # "idle" | "ran" | "approved" | "rejected"

        if key_prefix + "_state" not in st.session_state:
            st.session_state[state_key] = "idle"

        if run_clicked:
            with st.spinner(f"Running {skill_name}…"):
                try:
                    result_df, summary = run_fn()
                    st.session_state[result_key] = result_df
                    st.session_state[summary_key] = summary
                    st.session_state[state_key] = "ran"
                    log_skill_run(skill_name, "admin", "ran", summary)
                except Exception as exc:
                    st.error(f"Skill error: {exc}")
                    st.session_state[state_key] = "idle"
                    return

        state = st.session_state.get(state_key, "idle")

        if state in ("ran", "approved", "rejected"):
            summary = st.session_state.get(summary_key, "")
            result_df: pl.DataFrame = st.session_state.get(result_key, pl.DataFrame())

            with col_status:
                if state == "approved":
                    st.success("Applied ✓")
                elif state == "rejected":
                    st.warning("Rejected")
                else:
                    st.info(summary[:120] if summary else "Done")

            if show_table and not result_df.is_empty():
                display_df = result_df
                if result_cols:
                    valid = [c for c in result_cols if c in result_df.columns]
                    if valid:
                        display_df = result_df.select(valid)
                st.dataframe(display_df.head(50), use_container_width=True)

            if state == "ran" and approve_fn is not None:
                c1, c2, _ = st.columns([2, 2, 4])
                with c1:
                    if st.button(approve_label, key=f"{key_prefix}_approve"):
                        try:
                            approve_fn(result_df)
                            st.session_state[state_key] = "approved"
                            log_skill_run(skill_name, "admin", "approved", summary)
                            st.success("Changes applied!")
                            st.rerun()
                        except Exception as exc:
                            st.error(f"Apply failed: {exc}")
                with c2:
                    if st.button(reject_label, key=f"{key_prefix}_reject"):
                        st.session_state[state_key] = "rejected"
                        log_skill_run(skill_name, "admin", "rejected", summary)
                        st.rerun()
