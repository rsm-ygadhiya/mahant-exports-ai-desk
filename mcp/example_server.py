"""Example MCP server — minimal stub to confirm the wiring works.

Replace this with your real servers (recommended: ``data_server.py`` for
read-only resources + ``tools_server.py`` for callable tools).

Run locally with the MCP inspector::

    uv run mcp dev mcp_servers/example_server.py

Or have Claude Code start it via .mcp.json::

    uv run python -m mcp_servers.example_server
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP


def build_server() -> FastMCP:
    server = FastMCP("milestone03-example")

    @server.resource("hello://world")
    def hello_resource() -> str:
        """A trivial read-only resource. Replace with a real one.

        Example real resources (mirror the reference repo):
          - cases://raw                            (all rows in your raw table)
          - cases://{case_id}                      (one case + its history)
          - dictionaries://{name}                  (reference enumerations)
          - rag://kb                               (the proprietary KB index)
        """
        return "Hello from milestone03/mcp_servers/example_server.py — replace me."

    @server.tool()
    def echo(text: str) -> dict:
        """Return the same text back so you can confirm tool calls work.

        Replace this with a tool that wraps one of your skills or
        automations (see ``customer-ticket-process/mcp_servers/skills_server.py``
        for the subprocess-wrap pattern).
        """
        return {"status": "ok", "echoed": text}

    return server


def main() -> None:
    build_server().run()


if __name__ == "__main__":
    main()
