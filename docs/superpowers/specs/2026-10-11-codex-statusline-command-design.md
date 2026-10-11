# Design: ccstatusline in the Codex CLI footer (codexs)

- **Date:** 2026-10-11
- **Status:** Approved with review corrections authorized 2026-10-11. System setup and user-run source checkout are verified; Phase 0 baseline work is in progress.
- **Owner / sole user:** Palan, Windows 11 and Windows Terminal.
- **Source layout:** The Codex checkout is C:\Users\Palan\Documents\computer_programming\Projects\codex. The ccstatusline checkout is the sibling C:\Users\Palan\Documents\computer_programming\Projects\ccstatusline. The new codexs directory is at the **Codex repository root**, beside codex-rs, not inside codex-rs.

The user's working agreement takes precedence over this reviewed design; this design takes precedence over the handoff, which takes precedence over the task plan. The plan records progress and STOP results. Git clone, switch, branch, fetch, rebase and all other state-changing git or gh operations remain **user only** unless separately and explicitly requested. System installation, global npm replacement, the real Codex config edit and manual visual checks retain their stated STOPs. Checkpoints are concise progress ledger entries; one consolidated report comes after execution.

## 1. Goal and scope

codexs is a separately named, locally built Codex TUI with a command-backed passive footer. It gives the configured command Claude-compatible session JSON on stdin, displays the first non-empty stdout line and preserves the built-in footer as fallback. The official npm codex remains available. The current ccstatusline line should show model, thinking effort, output style, context, session usage, free memory, reset timer, session clock and custom symbol with live Codex data. Later Codex-specific widgets use a schema-versioned extras block.

The feature applies to the Codex TUI. It does not change the desktop app, IDE integration or codex exec. Output is one line. The command runs with the user's privileges outside the Codex sandbox, so only trusted non-project configuration may enable it.

## 2. Decisions

| ID | Decision |
|---|---|
| D1 | Modify Codex's TUI and install it as a separate codexs command. |
| D2 | Use tag rust-v0.162.1 with npm @openai/codex 0.162.1 and the matching Windows helper package; updates happen when the user chooses. |
| D3 | Send Claude-compatible fields plus a codex block with schema exactly 1. Marker detection is independent of extras validation. |
| D4 | Group A values come from Codex; group B needs ccstatusline mapping; group C Claude-only widgets are hidden for any Codex-marked input. |
| D5 | Resolve the command only from trusted non-project Codex config layers. A loaded project setting is ignored and warns once. |
| D6 | Build locally under the disk and memory guard; GitHub Actions is the fallback if the local build is infeasible. |
| D7 | Task 0A's minimal Codex marker, Group C filtering and Claude API/status/account/transcript guards pass **before the first actual ccstatusline invocation from codexs** in Task 9. Initial Codex-only integration uses inert echo; Group B metrics follow in Phase 2. |

## 3. Architecture and lifecycle

Codex TUI local settings resolve the command, then ChatWidget refresh captures a snapshot and asks the command runtime to run. The runtime owns a timer, a pending delay, one active command and its complete process tree. It coalesces refreshes during a run and spaces launches by at least 300 ms. Each output and tick event carries a runtime/session identity and generation. A result is accepted only if both match the currently configured ChatWidget runtime. A new session, changed command/config, or disable operation invalidates earlier events and output, cancels timers and delayed launches, and terminates and reaps the running tree. A changed refresh interval stops and replaces the timer. Shutdown performs the same owned cleanup.

The runner writes JSON to stdin while it drains stdout concurrently, avoiding pipe backpressure. It reads no more than 64 KiB of retained stdout, but continues draining to EOF or fails explicitly with an output-cap error and terminates the tree; it never stops reading and then waits indefinitely for the child. Broken stdin/stdout pipes and wait errors are explicit failures. A successful exit code is required before any stdout is rendered. Empty output, missing command, nonzero exit, pipe error, output cap and timeout follow the fallback rules. On timeout, terminate the tree and await cleanup; keep the last good line for the same runtime. Other failures show the built-in list. Warnings are deduplicated by kind per session.

Windows is the supported execution platform. Use the existing codex-utils-pty JobObject only if it provides a real kill-on-close job for this launch. If job creation or association fails, return a spawn/containment failure without running an uncontained command. Never call preserve_descendants. Terminate and reap on completion, timeout, cancellation, cap failure and shutdown. Do not ignore terminate or cleanup failures; return or record them. Non-Windows builds either implement verified process-group cleanup or return an explicit unsupported-command fallback. A child-only kill-on-drop does not satisfy this design.

The command receives CCSTATUSLINE_WIDTH for the current footer width. The runner retains the first non-empty line, removes all controls except safe SGR style, and truncates by grapheme cluster and terminal columns. Emoji ZWJ sequences, flags, combining marks, CJK and powerline glyphs must remain intact. After a resize, the next refresh refits the line.

## 4. Payload contract

The common Claude-compatible fields are hook_event_name = Status, session_id, cwd and workspace paths, model id/display name, effort level, Codex version, output_style.name for Codex mode, context_window usage/totals/percentages, rate_limits.five_hour and seven_day only for windows of exactly 300 and 10080 minutes, and cost.total_duration_ms as **session wall time since this codexs launch**. On resume, this clock restarts. It is not billed API time.

Codex cached_input_tokens is already part of input_tokens. Claude-compatible current_usage.input_tokens is input minus cached (clamped at zero), and cache_read_input_tokens is cached. Fresh sessions omit absent usage and percentages rather than sending zero. Never send transcript_path, dollar cost or Claude-specific limits. workspace.project_dir currently equals cwd; ccstatusline resolves Git independently. vim.mode and worktree extras are deferred because the available ChatWidget state does not supply reliable values.

The extras block is explicitly schema 1:

~~~json
{
  "codex": {
    "schema": 1,
    "approval_mode": "on-request",
    "sandbox": "workspace-write",
    "thread_name": "example",
    "compactions": 0,
    "turn_wall_duration_ms": 0,
    "speed_tokens": { "input": 400, "output": 90, "total": 490 },
    "tokens": { "input": 50400, "cached_input": 20000, "output": 2090, "reasoning_output": 900, "total": 52490 },
    "rate_limits": [{ "used_percent": 12.5, "resets_at": 1791544719, "window_minutes": 300 }]
  }
}
~~~

The schema-1 field contract is: tokens is the cumulative thread count object with nonnegative safe-integer input (including cached input), cached_input, output, reasoning_output and total; it is null or omitted until available. speed_tokens is null/omitted until a valid post-launch measurement and otherwise has nonnegative safe-integer input, output and total **deltas since the launch/resume baseline**. turn_wall_duration_ms is a nonnegative safe-integer sum of active-turn elapsed wall time for that same launch-local interval. compactions is a nonnegative safe integer; thread_name is a string or null. rate_limits is an array of zero or more windows with finite used_percent in 0–100, nullable Unix-seconds resets_at and nullable positive-integer window_minutes. Invalid optional fields are omitted rather than coerced. The existing human-readable reset display remains unchanged. The extras parser accepts only schema exactly 1 and validates fields individually: malformed or unknown extras produce no derived group B metrics. That never changes detection of the Codex marker. Codex extras take precedence over transcript values for Codex input.

turn_wall_duration_ms accumulates active-turn elapsed wall time, including tools, approval waits and model time. It is **not actual API duration**. A running turn contributes elapsed time to the current snapshot. Replay events and failed starts do not add time; a turn contributes once on a matching completion. Compactions are counted once per unique live compaction id after start succeeds; replayed/duplicate notifications do not increment. Resuming a thread starts new launch-local counters.

Speed requires numerator and denominator over the same lifetime. On launch or resume, record the then-current cumulative token counts as a baseline. speed_tokens are the nonnegative deltas since that baseline, and turn_wall_duration_ms covers the same post-launch interval. Omit speeds until both a valid baseline and a later matching measurement exist and duration is positive. A token counter reset invalidates and re-baselines speed. These are launch-local active-turn wall-time averages, never transcript windowed speed or API throughput. Context and token totals may still use the full thread totals independently.

## 5. Widget and privacy rules

| Group | Behavior |
|---|---|
| A | Built-in compatible context, model, effort, session/weekly usage, reset timers, cwd, Git/jj, free memory, clock, output style and other command-local widgets. |
| B | Codex extras provide cached/total token metrics, cache hit/read, session name, compactions and launch-local speed when valid. |
| C | Hide Claude status, account email, extra usage, Opus/Sonnet/Fable weekly, remote control, voice, skills, cache timer and dollar cost/rate for every Codex-marked input. |

The ccstatusline render path filters group C widgets **before any prefetch or transcript analysis**. The usage prefetch function independently refuses to call Anthropic for Codex input, even when a requested rate-limit field is absent. The Claude status prefetch and account-email credential reader are also never reached. No Codex-marked input is interpreted as a Claude transcript; any unexpected transcript_path is ignored. A malformed or future-schema codex block still triggers all those protections and suppression. Input without a codex marker retains the existing Claude behavior and output.

## 6. Config, installation and trust

The setting lives under [tui.status_line_command] with a non-empty command, refresh_interval_secs default 10 (0 disables timer), and timeout_ms default 2000. It is loaded into TUI local settings from non-project layers; project layers cannot override or enable it. The official codex compatibility with that unknown section must be checked without modifying the user's config first.

The installer resolves and validates the **installed npm @openai/codex package version and platform helper package architecture/version against the declared optional-dependency alias** (0.162.1-win32-x64 for main release 0.162.1), not just PATH codex --version. The source workspace version and built binary version must agree. The script checks raw DriveInfo available bytes before build and rejects unavailable readings or less than 8 GiB; it does not round before comparing. Build and full codex-tui tests use the release profile, CARGO_BUILD_JOBS=6 and no release debug info. PowerShell checks LASTEXITCODE immediately for every native command; no filtered error pipeline stands in for an exit-code check. Explicit npm.cmd and codex.cmd avoid PowerShell's blocked .ps1 shims without changing execution policy.

Installation stages a complete copy beside the destination, replaces the staged codex.exe and validates staged binary and required helper paths. Paths are resolved and checked to be beneath the intended installation root before recursive operations. Preflight checks for a running destination binary or helper and handles locked files without force-killing user processes. The script uses a checked sequence of renames, not an atomic multi-directory swap; rename success alone does not prove that a running/locked installation is safe. A preflight/copy failure leaves the old install usable. After a failed rename sequence it attempts to restore the prior directory and reports any rollback failure. Retain a previous backup until a later safe rotation; never delete a backup as the first step. The shim uses setlocal, clears inherited CODEX_MANAGED_BY_NPM and CODEX_MANAGED_PACKAGE_ROOT, prepends codex-path, invokes the staged binary and returns its exit code. Updating runs the full TUI suite before swap.

## 7. Verification and STOPs

Before modifications, record nonzero test counts and results for the **full** codex-tui suite and the full ccstatusline Vitest suite plus lint. Capture a deterministic Claude fixture through the actual formatter with fixed config, width and environment, preserving UTF-8 bytes and comparing fixed expected output after ccstatusline changes. Do not treat a placeholder captured line as evidence.

Rust tests cover payload omissions/accounting, config layers, runner containment and PID-based descendant cleanup, cap and pipe failures, exit/timeout, Unicode rendering, scheduler and config changes. ChatWidget integration tests begin failing before glue implementation and cover success and colors, fallback, last-good timeout, warning throttling, timers, stale cross-session events and shutdown. A project-config test proves that the project layer actually loaded and that an execution marker was never produced. A Task Manager aggregate Node count is insufficient; record child/descendant PIDs and check those exact PIDs are gone after each launch and an idle soak.

TypeScript tests cover malformed/unknown markers, missing limits, group C suppression including account email, no Anthropic usage/status/account fetch, no transcript reads, Codex precedence, matched speed lifetime, compaction/replay and Claude fixture parity. The first real ccstatusline invocation from codexs is the Group A smoke in Task 9, only after **Task 0A's minimal marker, Group C, API/status/account/transcript safety tests** pass in a local patched ccstatusline build. Task 11 later checks Group B metrics and repeats the complete regression suite. Global ccstatusline replacement has its own later STOP. Payload capture wraps the actual formatter, copies stdin bytes to a controlled UTF-8 file, forwards the same bytes to ccstatusline and leaves stdout untouched; the replay result is compared with the real rendered line using the same width and config.

STOPs remain for MSVC/rustup/npm global setup, the measured-baseline review before Task 0A/Phase 1, user-only clone/branch work, editing ~/.codex/config.toml, the Group A end-to-end review after Task 9 and before Phase 2, replacing the global ccstatusline, and user-observed TUI checks. The execution plan records each STOP result. Initial setup checks on 2026-10-11 found 26.6 GiB free, npm codex 0.162.0, no cargo/rustc on the restricted PATH and no Codex checkout. Approved setup then verified MSVC/SDK, pinned Rust 1.95.0, npm Codex 0.162.1 and its declared 0.162.1-win32-x64 helper alias; 18.7 GiB was free after setup. The user completed the pinned checkout and statusline-command branch. The upstream lockfile's 161 local workspace versions required a separately approved correction from 0.0.0 to 0.162.1, verified to leave external dependencies unchanged; the initial thin-LTO build was stopped for memory safety before completion. The user approved a baseline build/test retry with process-local CARGO_PROFILE_RELEASE_LTO=off, while retaining --release, six jobs and debug=0. The LTO-disabled retry also needed a memory-safety stop near final linking. No Rust baseline suite ran. The definitive CI-style TypeScript suite completed with 3,094 passes, 19 skips and one existing Windows symlink EPERM failure; lint and the new fixed Claude byte-parity test passed. The plan ledger retains all command results and the pending build-strategy decision. Bun 1.4.2 is available via its explicit npm package executable path.
