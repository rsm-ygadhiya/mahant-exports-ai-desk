"""Load skills from hyphenated directory names via importlib."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SKILLS_DIR = _REPO_ROOT / "skills"

_cache: dict[str, object] = {}


def load_skill(skill_dir: str, script_name: str) -> object:
    """Load a skill module. Results are cached per script name."""
    if script_name in _cache:
        return _cache[script_name]
    path = _SKILLS_DIR / skill_dir / "scripts" / f"{script_name}.py"
    spec = importlib.util.spec_from_file_location(script_name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _cache[script_name] = mod
    return mod


def repricing():
    return load_skill("weekly-repricing", "repricing_skill")

def triage():
    return load_skill("inventory-aging-triage", "inventory_aging_skill")

def memo_approval():
    return load_skill("memo-approval", "memo_approval")

def quote_negotiation():
    return load_skill("quote-negotiation", "quote_negotiation")

def collection_reminder():
    return load_skill("collection-reminder", "collection_reminder")

def clv_broker():
    return load_skill("clv-broker-company", "clv_broker_company")
