# DecoHUB core architecture audit

Date: 2026-10-07. Baseline: `f441f3f6c695bce6c465bfde222e10b329c8727d`. This document records source inspection and current-process observations; no earlier report is treated as proof.

## Account flow

`routes.ts` creates profiles through `AccountProfileManager`, stores metadata in `hub.db`, launches Antigravity with a profile directory, and stores `active_account_profile_id` in `system_settings`. `switchAccount` can also set a project override and create a conversation. Profile folders under `~/.ai-dev-hub/profiles` exist. Current DB has `acc-pro-1` (legacy default Antigravity data path) and `acc-pro-2` (isolated path). Antigravity GUI and language-server processes are running.

Problems: `createProfile` can set `READY` from a typed email. `verifyProfile` treats an email or `app_storage.json` username as authentication proof. Startup repeats that false verification. Runtime discovery matches any process containing `profiles`, allowing cross-account routing. A standalone language server is started and assumed ready after a spin timeout without authentication proof. `switchAccount` saves a previous account's conversation ID or a fabricated ID for the target if creation fails. Launch uses generated PowerShell and VBScript files and assumes a returned PID means a working graphical/login session. The legacy default profile cannot be assumed fully isolated from the user's existing Antigravity data.

## Worker flow

`WorkerRegistry` persists workers and leases in SQLite. `AutonomousRunnerService.start` creates three default workers, then calls `ensureWorkerAvailable`. Scheduler tries bootstrap when none are ready.

Problems: `createWorker` starts in `READY` without an agent. `ensureDefaultWorkers` creates synthetic workers and heartbeats. `ensureWorkerAvailable` trusts an existing `READY` worker without probing agentapi. The runner refreshes all ready-worker heartbeats every 15 seconds without checking their processes. A failed bootstrap returns null and scheduler loops forever in `waiting_for_worker`. Runtime identity and profile binding are not enforced in worker matching. `claimTask` checks then inserts a lease without a transaction, permitting a race.

## Autonomous flow

`AutonomousManager` stores runs, task graph, task states and events. `AutonomousRunnerService` polls runs, matches a ready task to a worker, claims a lease, sends work to `AntigravityProvider`, evaluates, reviews, and advances. Context can be reconstructed from project files, memory, Git and SQLite.

Problems: a fabricated `READY` worker can enter the execution path. Errors can leave runs retrying without an actionable terminal code. A three-minute watchdog may reset a genuinely running task because task progress is not necessarily persisted while agentapi works. GitHub PR/issue steps are coupled to task completion even for local projects. The current DB has no active autonomous run, so an end-to-end success has not been demonstrated.

## Model flow

`ModelRegistry` exposes `flash_lite`, `flash`, `pro` as a static catalog and checks only that `agentapi --help` responds. Provider sends `--model=` and records requested settings; it does not obtain an independently confirmed `actual_model`. Current labels imply specific Gemini versions without runtime proof. Unsupported model handling and fallback evidence need real probes.

## Process flow

Desktop `ServiceManager` starts backend as a hidden Electron child and supervises restart. `AccountProfileManager` launches Antigravity and discovers language servers through Windows process/port inspection. Electron variables are scrubbed for provider calls and GUI launch. Single-instance handling is in desktop main.

Problems: ownership of processes is inferred from broad command substrings. Backend readiness does not prove account or worker readiness. Packaged desktop behavior and crash recovery require separate tests. Existing unrelated Antigravity processes must not be killed.

## Memory, MCP, Git, and usage

The repository contains `.ai-dev-hub` memory, `mcpCore.ts`, Git/checkpoint managers, and local `hub.db`. This session registered the repository as `decohub-core` because the existing database only registered `C:\IA`; the local MCP core then returned project context and session ID `80f4fb87-0657-48e9-ac3d-85df3e0dc672`. The external `ai-dev-hub` MCP connector is unavailable in this Codex session. `UsageTracker` stores local execution events; real token and quota values are unavailable. The report must distinguish observed evidence from stored claims.

## Repair order

1. Remove false `READY` paths and cross-profile runtime discovery.
2. Require a real account-specific agentapi conversation before worker readiness.
3. Make scheduler failure explicit and leases atomic; then prove a local full run.
4. Probe model selection and actual-model evidence; record unknown where the runtime does not expose it.
5. Test process recovery and packaged desktop separately.
