# `mcp_servers/`

The **Model Context Protocol** (MCP) is an open standard for letting a
GenAI model invoke tools, read resources, and call functions through a
consistent interface. You write a server that publishes a list of tools the
model can call; the model decides when and how to invoke them.

Your job in this folder: expose **2–3 tools** that connect directly to
steps in your Milestone 01 workflow. Each tool should wrap a Python
function you wrote for a skill or automation.

---

## Recommended pattern: two servers, by concern

The reference repo splits MCP into two FastMCP servers — copy that split:

| Server | What it exposes | Reference |
| --- | --- | --- |
| **Data server** | Read-only **resources** (URIs): your raw tables, FAQ KB, dictionaries, the working CSVs from a run | `customer-ticket-process/mcp_servers/data_server.py` |
| **Skills/tools server** | Callable **tools**: thin subprocess wrappers around your skills and automations, returning the JSON envelope verbatim | `customer-ticket-process/mcp_servers/skills_server.py` |

The split makes it obvious which server serves *work* and which serves
*data*. Models that browse resources don't accidentally run tools, and
tool calls don't have to plumb data through arguments.

---

## Files in this folder (after you build it)

```
mcp_servers/
├── README.md            # this file
├── __init__.py          # empty, marks the folder as a package
├── data_server.py       # your data resource server  (recommended)
├── tools_server.py      # your tools/skills server   (recommended)
└── example_server.py    # the template stub shipped here — delete when you have real servers
```

Register your servers in [`../.mcp.json`](../.mcp.json) so Claude Code
launches them. The reference repo's [`.mcp.json`](../../customer-ticket-process/.mcp.json)
is one literal block to copy and rename.

---

## Run + test

```bash
# Inspect the example server with the MCP inspector UI:
uv run mcp dev mcp_servers/example_server.py

# Run a server directly (Claude Code does this for you via .mcp.json):
uv run python -m mcp_servers.example_server
```

Once registered in `.mcp.json` and Claude Code is restarted, you can ask
Claude things like:

> "List the resources from the data server, then call the
> `<your_tool_name>` tool with `case_id="CASE-00042"`."

---

## Tool design checklist

For each tool you expose, document in this folder's `README.md`:

- **Name** (snake_case Python identifier)
- **Purpose** (one sentence)
- **Inputs** (typed arguments)
- **Returns** (the JSON envelope shape)
- **Underlying script** (which `skills/<name>/scripts/<name>.py` or
  `automations/<name>/scripts/<name>.py` it wraps)
- **Workflow step** (which step from your Milestone 01 diagram this serves)

---

## Reference (read these in order)

1. `customer-ticket-process/mcp_servers/README.md` — the conceptual map.
2. `customer-ticket-process/mcp_servers/data_server.py` (~5 KB) — shows the
   resource pattern (`@server.resource("tickets://{ticket_id}")`).
3. `customer-ticket-process/mcp_servers/skills_server.py` (~4 KB) — shows
   the tool-wraps-script pattern (`subprocess.run` returning the envelope).
4. `customer-ticket-process/.mcp.json` — three lines per server.
