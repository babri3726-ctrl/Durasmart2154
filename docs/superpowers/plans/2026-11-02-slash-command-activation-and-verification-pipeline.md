# Unified Single-Command Activation, Verification & Multi-Stack Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide **ONE single unified slash-command activation entrypoint** (`workflow` / `/workflow`, with alias `wf`) to activate and drive the entire phase-gated workflow across all phases (`/setup`, `/plan`, `/work`, `/review`, `/release`, `/bugfix`).

**Architecture:** A comprehensive routing and testing architecture built natively in PowerShell:
- `.harness/scripts/workflow.ps1` (and `dispatch.ps1`) implementing the single entrypoint and 13-step policy matrix.
- `.harness/scripts/verify.ps1` enforcing stack-specific quality gates with early-stop.
- `.harness/scripts/integration.ps1` running live service orchestration and cleanup.
- Schema validator inside `invoke_agy_safe.ps1`.
- Shell function forwards registered in PowerShell profile.

**Tech Stack:** PowerShell 5.1/7, AGY 1.4.12, AgentM v4.15.0, Crickets v5.1.0, Flutter 3.47, Node 24 / npm 11, Python 3.12 (FastAPI, pytest, ruff, mypy, pip-audit).

**Spec:** User prompt specifying ONE single slash command activation to activate this workflow, plus Parts 2-5.

## Global Constraints
- Windows 11 + PowerShell environment.
- Do NOT touch already-verified core layers (AGY, AgentM, Crickets, safety scripts).
- Stop on first verification failure — do NOT auto-fix silently; hand to `/bugfix`.
- If any test fails twice, STOP and report raw evidence.
- Zero destructive commands without explicit "APPROVE".

---

### Task 1: Part 4 — AGY JSON Schema Validation

**Files:**
- Modify: `.harness/scripts/invoke_agy_safe.ps1`
- Test: Unit test with truncated JSON payload

- [ ] **Step 1: Add Test-AgyJsonSchema validation function**
  Enforce required keys (`status`, `response` or `structured_output`, `usage`) and status enum (`SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`).
- [ ] **Step 2: Test schema validation against valid and malformed payloads**
  Confirm truncated payload is rejected with exit code 1.

---

### Task 2: Part 2 — Multi-Stack Verification Pipeline

**Files:**
- Create: `.harness/scripts/verify.ps1`
- Test: Introduce deliberate typecheck error in `web/`, confirm rejection, revert, confirm green.

- [ ] **Step 1: Implement .harness/scripts/verify.ps1**
  Support target stacks `mobile`, `web`, `server`, and `all`.
  Stop on first failure, capture failing gate name and raw error.
- [ ] **Step 2: Test verification with deliberate error in web/ and revert**
  Inject typecheck error, observe gate failure, revert, observe pass.

---

### Task 3: Part 3 — Multi-Stack Integration Test

**Files:**
- Create: `.harness/scripts/integration.ps1`
- Target: FastAPI server subprocess + React build check + cleanup

- [ ] **Step 1: Implement .harness/scripts/integration.ps1**
  Start FastAPI server in subprocess, poll `/health`, test React endpoint resolution, guarantee teardown in finally block.
- [ ] **Step 2: Test integration.ps1 execution**
  Confirm server starts, health responds, and zero orphan processes remain.

---

### Task 4: Part 1 — Single Unified Slash-Command Activation (`workflow.ps1`)

**Files:**
- Create: `.harness/scripts/workflow.ps1` (and `.harness/scripts/dispatch.ps1`)
- Create: `.harness/scripts/setup_shell_aliases.ps1`
- Test: Suite testing all 6 conditions (a to f).

- [ ] **Step 1: Implement .harness/scripts/workflow.ps1**
  Single entrypoint executing the 13-step flow applying policy matrix across all 6 commands.
- [ ] **Step 2: Implement shell forwarding functions**
  Forward `workflow`, `wf`, `/plan`, `/work`, `/review`, `/release`, `/setup`, `/bugfix` to `workflow.ps1`.
- [ ] **Step 3: Run comprehensive automated test suite for workflow.ps1**
  Verify conditions a through f.

---

### Task 5: Part 5 — End-to-End 3-Stage Test & Final Report

**Files:**
- Test 1: `workflow /plan "list entry points"`
- Test 2: `workflow /work "add a health endpoint to server/"`
- Test 3: `workflow /release -ApprovalToken APPROVE`

- [ ] **Step 1: Execute Test 1 (/plan)**
  Verify no writes, no checkpoint, `.harness/PLAN.md` generated.
- [ ] **Step 2: Execute Test 2 (/work)**
  Verify checkpoint created before write, health endpoint added, verification passed, state recorded.
- [ ] **Step 3: Execute Test 3 (/release)**
  Verify refusal without APPROVE, execution with APPROVE (full pipeline + security + integration).
- [ ] **Step 4: Emit Final Report**
  Emit table with file paths, log lines, and conclusive completion statement.
