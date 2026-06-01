"""Sidebar role selector — no real auth, demo only."""

from __future__ import annotations

import streamlit as st

from app.db import read_table

_ADMIN_ROLE = "admin"
_BROKER_ROLE = "broker"

ADMIN_USER = {"role": _ADMIN_ROLE, "name": "Pramukh Gems Admin",
              "customer_id": None, "avatar": "🏢"}


def init_auth() -> None:
    """Call once at the top of main.py to set up session state."""
    if "user" not in st.session_state:
        st.session_state.user = ADMIN_USER


def render_sidebar_auth() -> dict:
    """Render role picker in sidebar. Returns the active user dict."""
    with st.sidebar:
        st.markdown("## 👤 Login")

        customers = read_table("customers")
        if customers.is_empty():
            brokers_list = []
        else:
            brokers = customers.filter(
                (customers["is_broker"] == "true") |
                (customers["customer_type"] == "Broker")
            ).sort("customer_name")
            brokers_list = brokers.select(["customer_id", "customer_name"]).to_dicts()

        options = ["🏢 Admin (Pramukh Gems)"] + [
            f"🤝 {b['customer_name']}" for b in brokers_list
        ]
        ids     = [None] + [b["customer_id"] for b in brokers_list]

        current_idx = 0
        if "user" in st.session_state and st.session_state.user["customer_id"]:
            cid = st.session_state.user["customer_id"]
            if cid in ids:
                current_idx = ids.index(cid)

        selected = st.selectbox("Select account", options, index=current_idx,
                                key="role_selector")
        idx = options.index(selected)
        chosen_id = ids[idx]

        if chosen_id is None:
            user = ADMIN_USER
        else:
            chosen = brokers_list[idx - 1]
            user = {
                "role": _BROKER_ROLE,
                "name": chosen["customer_name"],
                "customer_id": chosen["customer_id"],
                "avatar": "🤝",
            }

        st.session_state.user = user
        st.markdown(f"**Logged in as:** {user['avatar']} {user['name']}")

        if user["role"] == _ADMIN_ROLE:
            st.success("Admin access")
        else:
            st.info("Broker access")

        st.markdown("---")

    return user


def require_admin() -> bool:
    """Returns True if current user is admin. Shows error otherwise."""
    user = st.session_state.get("user", ADMIN_USER)
    if user["role"] != _ADMIN_ROLE:
        st.error("🔒 Admin access required for this page.")
        return False
    return True


def current_user() -> dict:
    return st.session_state.get("user", ADMIN_USER)
