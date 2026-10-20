# Fidelity Section Map V2

| Source area | V2 action | DecoHUB destination |
|---|---|---|
| System identity / Claude product identity | REPLACE | DecoHUB agent identity + runtime-verified model |
| Harness | KEEP / ADAPT | Harness + instruction hierarchy |
| Anthropic security wording | REMOVE | Provider-native restrictions remain external |
| Fable/Mythos marketing | REMOVE | None |
| Session-specific Claude commands | REMOVE | None |
| Memory | ADAPT | `.ai-dev-hub/`, decisions, checkpoints, tasks, Git, MCP |
| Claude environment/model IDs | REPLACE | Runtime context injection |
| Context management | KEEP / ADAPT | Durable project continuity |
| Delivering work | KEEP | Delivering work |
| Writing for user | KEEP / ADAPT | Writing for user |
| Captured session context | REMOVE | Runtime-provided live context |
| Agents | ADAPT | Workers |
| Claude/Chrome/computer MCP instructions | REMOVE / ADAPT principles | Optional connector/browser/computer-use contracts |
| Anthropic skills list | REMOVE | Runtime-discovered skills/workflows only |
| Agent tool schema | ADAPT semantics | Workers + runtime schemas |
| Artifact system | REMOVE | No false equivalent assumed |
| AskUserQuestion | KEEP / ADAPT | Asking the user |
| Bash | KEEP / ADAPT | Terminal and command execution |
| Cron/Monitor | ADAPT | Scheduler/background/monitoring semantics |
| Edit | KEEP / ADAPT | File editing |
| Enter/Exit Plan Mode | ADAPT | Planning contract without fake tool requirement |
| Enter/Exit Worktree | KEEP / ADAPT conditionally | Worktrees and isolation |
| NotebookEdit | ADAPT conditionally | Notebooks |
| Read | KEEP / ADAPT | File reading |
| ReportFindings | KEEP / ADAPT | Review findings |
| SendMessage | ADAPT | Worker communication |
| TaskStop | ADAPT | Cancellation/task stopping |
| ToolSearch | KEEP / ADAPT | Runtime tool discovery |
| WebFetch/WebSearch | ADAPT conditionally | Web research |
| Write | KEEP / ADAPT | File writing |
| Calendar/Gmail/Drive schemas | REMOVE | Use connectors only if runtime exposes them |
| Claude Desktop session/window/sidebar tools | REMOVE | DecoHUB owns its UI/runtime |
| Claude Browser schemas | REMOVE | Optional browser contract only |
| computer-use schemas | REMOVE | Optional computer-use contract only |
| scheduled tasks schemas | REMOVE | Scheduler contract only |
| terminal MCP schemas | REMOVE | Runtime terminal schema injection |
| visualizer schemas | REMOVE | No assumed equivalent |
