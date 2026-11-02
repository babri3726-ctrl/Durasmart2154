# Phase-Gated AI Coding Workflow Repository Installation & Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sequentially clone, install, test, and pin four core repositories (`google-antigravity/antigravity-cli`, `alexherrero/agentm`, `alexherrero/crickets`, `MiniMax-AI/skills`) on Windows 11 + PowerShell, verifying each layer before proceeding, and recording exact commit hashes in `repo-manifest.json`.

**Architecture:** A 4-stage sequential phase gate executing strictly on Windows 11 PowerShell. Each stage clones a repo, installs it using its official installer script/subcommand, runs explicit behavioral test assertions, records the commit pin, and writes/updates `repo-manifest.json`.

**Tech Stack:** PowerShell 7 / Windows PowerShell, Git 2.56, AGY CLI (v1.4.12), Python 3.12, Node.js / npx.

**Spec:** User prompt specifying REPOS TO INSTALL AND TEST (AGY -> AgentM -> Crickets -> MiniMax-AI/skills) with exact pass/fail gates and `repo-manifest.json` pin requirement.

## Global Constraints
- Windows 11 + PowerShell environment.
- Strict sequential order: REPO 1 -> REPO 2 -> REPO 3 -> REPO 4.
- No moving to next repo until current passes all tests.
- Record commit hash for all four in `repo-manifest.json` in project root (`C:\NewProject_Frontend`).
- Zero destructive commands (`rm -rf` or force-push prohibited).
- No ToolNet, Codebase AI, memory-mcp, or Vex in this V1 run.
- Single sentence status declaration in final report: which repos are READY and which are NOT READY.

## Review Focus
1. AGY execution in non-interactive print mode: verify `--output-format json` yields valid JSON with status `SUCCESS` and `--output-format stream-json` yields NDJSON.
2. AgentM command files verification: verify all 6 files (`bugfix.md`, `plan.md`, `release.md`, `review.md`, `setup.md`, `work.md`) exist in `.claude/commands/`, plus `.harness/.version` and `AGENTS.md`.
3. Crickets plugin dependency order: ensure `development-lifecycle` is installed first so companion plugins (`developer-safety`, `code-review`, etc.) resolve their prerequisites without unsatisfied `requires:`.
4. MiniMax-AI skills subset curation: enable strictly `frontend-dev`, `fullstack-dev`, `flutter-dev`, and `android-native-dev` and verify `SKILL.md` exists in each.
5. Windows PowerShell execution context: ensure persistent user/machine PATH is injected into script sessions so `agy` and `git` are consistently discoverable.

---

### Task 1: REPO 1 — AGY Execution Driver (`google-antigravity/antigravity-cli`)

**Files:**
- Clone: `$HOME/antigravity-cli`
- Target: `.harness/agy.version`
- Manifest: `repo-manifest.json`

**Interfaces:**
- Produces: Verified `agy` binary, `.harness/agy.version` pin, initial `repo-manifest.json` entry for AGY.

- [x] **Step 1: Clone repo and record commit hash**
  Cloned to `C:\Users\Dharampal Jindal\antigravity-cli`.
  Commit hash: `841f45db2226ce15f5d1f52c580e35181e74ff68`.

- [x] **Step 2: Verify installer and ensure binary availability**
  Binary verified at `C:\Users\Dharampal Jindal\AppData\Local\agy\bin\agy.exe`.

- [x] **Step 3: Run Test Suite A, B, C for AGY**
  - Test a: `agy --version` -> `1.4.12` [PASS]
  - Test b: `agy -p "reply ok" --output-format json` -> valid JSON with `status: "SUCCESS"` [PASS]
  - Test c: `agy -p "reply ok" --output-format stream-json` -> NDJSON emitted [PASS]

- [x] **Step 4: Record AGY pin and initialize manifest**
  Recorded in `.harness/agy.version` and `repo-manifest.json`.

---

### Task 2: REPO 2 — AgentM State & Memory (`alexherrero/agentm`)

**Files:**
- Clone: `$HOME/agentm`
- Target: `.claude/commands/`, `.harness/.version`, `AGENTS.md`
- Manifest: `repo-manifest.json`

**Interfaces:**
- Consumes: AGY CLI from Task 1.
- Produces: 6 phase command templates in `.claude/commands/`, version pin in `.harness/.version`, updated `repo-manifest.json`.

- [x] **Step 1: Clone repo and checkout pinned tag**
  Cloned to `C:\Users\Dharampal Jindal\agentm`. Pinned tag: `v4.15.0`.
  Commit hash: `8f42083d3cc98b2c0559dfc0ea0ee643863eb1d3`.

- [x] **Step 2: Run PowerShell installer with project scope**
  Executed `install.ps1 -Hooks C:\NewProject_Frontend` successfully (exit code 0).

- [x] **Step 3: Run Test Suite A, B, C for AgentM**
  - Test a: `.claude/commands/` contains `bugfix.md`, `plan.md`, `release.md`, `review.md`, `setup.md`, `work.md` [PASS]
  - Test b: `.harness/.version` exists and contains `v4.15.0` [PASS]
  - Test c: `AGENTS.md` exists in project root [PASS]

- [x] **Step 4: Update repo manifest**
  Recorded in `repo-manifest.json`.

---

### Task 3: REPO 3 — Crickets Phase Lifecycle Plugins (`alexherrero/crickets`)

**Files:**
- Clone: `$HOME/crickets`
- Plugin Targets: Antigravity plugin repository (`dist/antigravity/plugins/*`)
- Manifest: `repo-manifest.json`

**Interfaces:**
- Consumes: AGY CLI and AgentM command structures from Tasks 1 & 2.
- Produces: Base plugin `development-lifecycle` and companion plugins installed and verified.

- [x] **Step 1: Clone repo and checkout pinned tag**
  Cloned to `C:\Users\Dharampal Jindal\crickets`. Pinned tag: `v5.1.0`.
  Commit hash: `090e7063505da246ad5b376439aa8351c8f286d3`.

- [x] **Step 2: Install plugins in dependency order**
  Installed `development-lifecycle` first, followed by `developer-safety`, `code-review`, `maintenance`, `privacy`, `wiki`.

- [x] **Step 3: Run Test Suite A, B, C for Crickets**
  - Test a: `agy plugin list` shows `development-lifecycle` and companions active [PASS]
  - Test b: No plugin reports unsatisfied "requires:" [PASS]
  - Test c: Phase commands (`/setup`, `/plan`, `/work`, `/review`, `/release`, `/bugfix`) resolvable [PASS]

- [x] **Step 4: Update repo manifest**
  Recorded in `repo-manifest.json`.

---

### Task 4: REPO 4 — MiniMax-AI Curated Skills (`MiniMax-AI/skills`)

**Files:**
- Clone: `"$env:USERPROFILE\.minimax-skills"`
- Targets: Enabled skill folders (`frontend-dev`, `fullstack-dev`, `flutter-dev`, `android-native-dev`)
- Manifest: `repo-manifest.json`

**Interfaces:**
- Consumes: Skills framework in Antigravity.
- Produces: Curated subset of validated skills active in project context.

- [x] **Step 1: Clone repo and record commit hash**
  Cloned to `C:\Users\Dharampal Jindal\.minimax-skills`.
  Commit hash: `60aaae52bb2af8162732751a4332f62a5fef518b`.

- [x] **Step 2: Enable curated subset only**
  Curated strictly: `frontend-dev`, `fullstack-dev`, `flutter-dev`, `android-native-dev` in `minimax-skills` plugin.

- [x] **Step 3: Run Test Suite A, B for MiniMax Skills**
  - Test a: Each enabled skill directory contains `SKILL.md` [PASS]
  - Test b: Enabled skills match curated selection exactly (0 unrequested skills enabled) [PASS]

- [x] **Step 4: Finalize repo manifest**
  Recorded in `repo-manifest.json`.

---

### Task 5: Consolidation & Final Report Gate

**Files:**
- Inspect: `repo-manifest.json`

- [x] **Step 1: Validate full `repo-manifest.json` integrity**
  All 4 repositories validated and marked `READY`.

- [x] **Step 2: Emit Final Report**
  Final table and readiness sentence produced.
