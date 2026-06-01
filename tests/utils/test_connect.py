"""Smoke test: confirm utils.connect imports cleanly and exposes the public API.

This test does NOT make a real LLM call. It just verifies the module is
importable in a fresh ``uv sync`` environment — useful as the first signal
that the template is set up correctly.
"""

from __future__ import annotations

import pytest


def test_connect_imports():
    from utils import connect

    assert callable(connect.ask)
    assert callable(connect.ask_json)
    assert connect.DEFAULT_MODEL
    assert connect.BASE_URL.startswith("https://")
    assert "oauth-gpt" in connect.OAUTH_MODELS


def test_get_client_requires_api_key(monkeypatch):
    from utils.connect import get_client

    monkeypatch.delenv("TRITONAI_API_KEY", raising=False)
    try:
        get_client()
    except ValueError as exc:
        assert "TRITONAI_API_KEY" in str(exc)
    else:
        raise AssertionError("expected ValueError when TRITONAI_API_KEY is unset")


def test_describe_model_reports_oauth_route():
    from utils import connect

    desc = connect.describe_model("oauth-gpt")

    assert "oauth-gpt" in desc
    assert "OAuth" in desc
    assert connect.OAUTH_BACKEND_MODEL in desc


def test_ask_routes_oauth_gpt_model_through_oauth(monkeypatch):
    from utils import connect

    calls = []

    def fake_oauth(text, *, model, instructions, **kwargs):
        calls.append(
            {
                "text": text,
                "model": model,
                "instructions": instructions,
                "kwargs": kwargs,
            }
        )
        return "oauth reply"

    monkeypatch.setattr("utils.oauth_gpt.ask_gpt_with_oauth", fake_oauth)

    result = connect.ask(
        "What is 2+2?",
        model="oauth-gpt",
        temperature=0.9,
        max_tokens=123,
    )

    assert result == "oauth reply"
    assert calls == [
        {
            "text": "What is 2+2?",
            "model": connect.OAUTH_BACKEND_MODEL,
            "instructions": connect.DEFAULT_SYSTEM,
            "kwargs": {},
        }
    ]


def test_ask_oauth_flattens_messages_list(monkeypatch):
    from utils import connect

    calls = []

    def fake_oauth(text, *, model, instructions, **kwargs):
        calls.append({"text": text, "model": model, "instructions": instructions})
        return "ok"

    monkeypatch.setattr("utils.oauth_gpt.ask_gpt_with_oauth", fake_oauth)
    messages = [
        {"role": "system", "content": "You are a careful analyst."},
        {"role": "user", "content": "Summarize this."},
        {"role": "assistant", "content": "First draft."},
        {"role": "user", "content": "Make it shorter."},
    ]

    connect.ask(messages, model="oauth-gpt")

    assert calls[0]["instructions"] == "You are a careful analyst."
    assert calls[0]["text"] == ("USER: Summarize this.\n\nASSISTANT: First draft.\n\nUSER: Make it shorter.")


def test_ask_json_routes_oauth_gpt_model_through_oauth(monkeypatch):
    from utils import connect

    captured = []

    def fake_oauth(text, *, model, instructions, **kwargs):
        captured.append({"text": text, "model": model, "instructions": instructions})
        return '{"answer": "yes"}'

    monkeypatch.setattr("utils.oauth_gpt.ask_gpt_with_oauth", fake_oauth)

    result = connect.ask_json("Return JSON.", model="oauth-gpt")

    assert result == {"answer": "yes"}
    assert captured[0]["model"] == connect.OAUTH_BACKEND_MODEL
    assert "Return ONLY a valid JSON object" in captured[0]["instructions"]


def test_ask_json_oauth_appends_pydantic_schema(monkeypatch):
    from pydantic import BaseModel

    from utils import connect

    class Reply(BaseModel):
        answer: str

    captured = []

    def fake_oauth(text, **kwargs):
        captured.append(text)
        return '{"answer": "yes"}'

    monkeypatch.setattr("utils.oauth_gpt.ask_gpt_with_oauth", fake_oauth)

    result = connect.ask_json("Reply?", schema=Reply, model="oauth-gpt")

    assert isinstance(result, Reply)
    assert result.answer == "yes"
    assert "JSON object that matches" in captured[0]


def test_ask_does_not_fallback_when_oauth_errors(monkeypatch):
    from utils import connect

    def fail(*args, **kwargs):
        raise RuntimeError("HTTP 401: account cannot access model")

    monkeypatch.setattr("utils.oauth_gpt.ask_gpt_with_oauth", fail)

    with pytest.raises(RuntimeError, match="account cannot access"):
        connect.ask("hi", model="oauth-gpt")
