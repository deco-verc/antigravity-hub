# Fable 5.1 → DecoHUB/Gemini Fidelity Port V2 — Adaptation Report

## Goal

This V2 is a fidelity-oriented port of the supplied `claude-code-desktop-fable-5.1.md` system prompt into a production base prompt for Gemini inside DecoHUB.

The first adaptation compressed too aggressively. V2 deliberately preserves the original prompt's operational philosophy and many of its detailed rules, while removing product-specific infrastructure that would be false or harmful to inject into DecoHUB.

## Source metrics

- Original source lines: 10,841
- `# Tools` starts at source line 363.
- Lines before `# Tools`: 362.
- Lines from `# Tools` onward: 10,479.

Most of the source file after line 363 is tool documentation and JSONSchema for the exact Claude Desktop/Code session: Artifact tools, Calendar, Gmail, Drive, Claude Browser, Claude-in-Chrome, computer-use, session-management MCPs, scheduled tasks, terminal tools, visualization tools, and others.

V2 does **not** copy those concrete schemas because doing so would falsely tell Gemini that those tools exist. Instead, V2 preserves/adapts the transferable behavioral rules and leaves the concrete tool schema slot to DecoHUB at runtime.

## Classification strategy

### KEEP

Kept in substance and often close in wording:

- Harness discipline.
- Permission-denial behavior.
- Untrusted pasted/tool/web content handling.
- Scope fidelity.
- “Finish the whole task, not just easy parts.”
- Work that can proceed should proceed before asking a blocking question.
- Final answer must stand on its own.
- Autonomous execution for reversible in-scope work.
- Evidence before state-changing commands.
- Read-before-edit discipline.
- Planning proportional to task complexity.
- Git state awareness.
- Monitoring must observe failure states, not only success.
- Worker/agent delegation principles.
- Tool discovery instead of guessing schemas.
- Verification before declaring completion.

### ADAPT

Preserved but converted to DecoHUB concepts:

- Claude file-based memory → `.ai-dev-hub/`, decisions, checkpoints, task state, Git, MCP context.
- Claude agent/subagent semantics → DecoHUB Workers and scheduler-aware delegation.
- Claude-specific workspace/session assumptions → authoritative `project_path`, Git root, runtime cwd.
- Claude plan-mode philosophy → autonomous DecoHUB planning plus questions only for genuine user-owned decisions.
- Bash-only assumptions → runtime-provided shell/terminal.
- Agent communication → Worker-to-Worker / Worker-to-parent messaging when exposed.
- Task stopping → DecoHUB cancellation and real process termination.
- WebFetch/WebSearch → optional runtime web capabilities.
- Worktree tool semantics → conditional Git isolation semantics.
- Model statements → `requested_model` vs `actual_model`.

### REPLACE

Replaced with DecoHUB-native contracts:

- Product identity → DecoHUB software-engineering agent.
- Session path assumptions → runtime context injection.
- Claude memory path → project memory contract.
- Fake-success-prone runtime behavior → explicit `No fake fallbacks` contract.
- Generic cwd assumptions → `WORKSPACE_MISMATCH` contract.
- Conversation-only continuity → durable context continuity contract.
- Claude commit assumptions → AGENT/DECOHUB commit-source-aware behavior.
- Provider model marketing info → runtime-verified model identity.
- Tool-list-as-static-prompt → runtime-injected tool schemas.

### REMOVE

Removed because it belongs to Anthropic/Claude product infrastructure or one captured session rather than transferable agent intelligence:

- Anthropic model marketing and Fable/Mythos product statements.
- Claude model IDs and Claude product availability.
- Claude Code/Desktop UI commands and Code-tab-specific instructions.
- Claude-specific system paths, scratch paths, and a specific user's email/name.
- Session-specific Git snapshot from the captured prompt.
- Anthropic-specific attribution lines for commits/PRs.
- Anthropic skill catalog.
- Artifact publishing system and its schemas.
- Claude Browser and Claude-in-Chrome schemas.
- Claude Desktop session/sidebar/window MCP schemas.
- Gmail, Calendar, Drive, scheduled-tasks, visualizer, and unrelated connector schemas from that session.
- Concrete tool schemas for capabilities DecoHUB has not proven it exposes.
- Provider-specific safety wording from the source prompt. V2 does not attempt to override Gemini/provider-level safeguards; it simply does not transplant Anthropic's wording as the DecoHUB policy layer.

## Why V2 is much more faithful than V1

V1 condensed the useful behavior into a relatively small set of rules. V2 restores detailed operational contracts for:

- memory;
- context management;
- scope completion;
- final communication;
- workspace validation;
- planning;
- questions;
- Workers;
- tool discipline;
- read/edit/write;
- terminal;
- Git;
- worktrees;
- monitoring;
- Worker communication;
- cancellation;
- web research;
- notebooks;
- review findings;
- tool discovery;
- connectors;
- browser/computer use;
- skills/workflows;
- project instructions;
- testing;
- build/type checking;
- debugging;
- dependencies;
- data/databases;
- APIs;
- frontend work;
- security-sensitive code;
- generated code;
- temporary files;
- parallel execution;
- failure handling;
- completion verification.

The resulting prompt is intentionally not a 10,841-line clone, because thousands of source lines are JSON schemas for Claude-session tools. Copying those schemas would reduce correctness in DecoHUB, not increase fidelity.

## Integration rule

Use `DECOHUB_GEMINI_FABLE_5_1_FIDELITY_PORT_V2.md` as the static base system prompt.

At runtime append/inject:

1. `DECOHUB_RUNTIME_CONTEXT` with live values.
2. relevant project context.
3. the **actual** current tool schemas from Antigravity/agentapi/MCP/DecoHUB.
4. the current task/user message as the task message, not embedded permanently in the system prompt.

## Key design decision

Behavior is static.

State is dynamic.

Tools are runtime-provided.

Project context is durable and retrieved.

The model must never infer a capability merely because a previous provider's prompt contained it.
