# Idea One-Pager: Agentic Awesome Skills (AAS) Hybrid Hub Architecture

**Author:** Antigravity AI Partner  
**Date:** 2026-10-31  
**Status:** Converged Proposal (Phase 3: Sharpen & Ship)  
**Target Reference:** [sickn33/agentic-awesome-skills](https://github.com/sickn33/agentic-awesome-skills)

---

## Problem Statement

How might we transition our AI development environment from a rigid trio of disparate plugin repositories to a unified, on-demand skill hub powered by `sickn33/agentic-awesome-skills` without overwhelming agent context windows, losing the strict Superpowers TDD cycle, or breaking our specialized subagent review gates?

---

## Recommended Direction

Adopt a **Hybrid Hub Architecture** that couples a lightweight, strict execution kernel with an expansive, on-demand searchable skill catalog:

1. **AAS as an On-Demand MCP Control Plane:** Rather than copying thousands of flat markdown files into prompt instructions (which would exhaust context tokens and cause severe instruction conflicts), register the AAS Core MCP Server in Antigravity via `agy mcp add aas cmd.exe /c npx -y agentic-awesome-skills --mcp`. The agent can search, inspect, and pull specific domain skills (e.g. Flutter optimizations, specialized PostgreSQL patterns) dynamically into `aas-stack.json`.
2. **Preserve the Execution Core:** Retain the Superpowers RED-GREEN-REFACTOR execution cycle, systematic root-cause debugging, and the 4 specialized subagent personas (`code-reviewer`, `security-auditor`, `test-engineer`, `web-performance-auditor`).
3. **Consolidate External Repositories:** Retire redundant external plugin folders while keeping their operational contracts preserved under the unified `AGENTS.md` 7-phase routing.

---

## Key Assumptions to Validate

- [ ] **AAS MCP Responsiveness:** Verify that `npx -y agentic-awesome-skills` initializes cleanly over stdio on Windows without administrative elevation.
- [ ] **Zero Context Bloat:** Confirm that dynamic skill selection keeps token overhead minimal during standard conversational turns.
- [ ] **TDD Precedence Continuity:** Ensure skills discovered via AAS do not attempt to bypass or weaken the Iron Law: *No production code without a failing test first*.
- [ ] **Subagent Role Compatibility:** Verify that subagents (`code-reviewer`, `test-engineer`) can query AAS recommendations during pre-merge quality gates.

---

## MVP Scope

- **In Scope:**
  - Register `agentic-awesome-skills` as a read-only local MCP server in `~/.gemini/config/mcp_config.json`.
  - Provide CLI discovery helpers (`npx agentic-awesome-skills --search <term>`).
  - Update `AGENTS.md` to reference AAS as the primary discovery catalog for novel domain problems.
  - Retain `.\scripts\quality_check.ps1` as the non-negotiable verification gate before task completion.
- **Out of Scope (For Now):**
  - Manually cloning the entire multi-thousand-file repository directly into the project root.
  - Rewriting existing, passing unit test suites to conform to alternate third-party templates.

---

## Not Doing (and Why)

- **Not dumping all thousands of AAS markdown files directly into the active prompt:** Injecting hundreds of raw `SKILL.md` prompts into the system prompt would exceed token budgets, slow model inference, and cause hallucinations across overlapping rules.
- **Not dropping our 4 verified Subagent personas:** `code-reviewer`, `security-auditor`, `test-engineer`, and `web-performance-auditor` provide automated multi-axis checks that are already proven on this workspace.
- **Not abandoning the Superpowers TDD Iron Law:** Raw skill libraries often lack enforcement mechanisms. Superpowers guarantees reproducible code quality through red-green-refactor proof.

---

## Open Questions

1. Which specific skill domains from AAS do you anticipate querying most frequently (e.g. Flutter mobile architecture, backend performance tuning, or database indexing)?
2. Would you like us to run the live MCP registration for `agentic-awesome-skills` right now to test its connection alongside `chrome-devtools` and `playwright`?
