# Unified Engineering Workflow & Skills Routing Guide

This workspace integrates four verified agentic engineering libraries:
1. **Superpowers** (`superpowers`): Core engineering rigor, TDD, planning, systematic debugging, and subagent orchestration.
2. **Agent Skills** (`agent-skills`): Full lifecycle software engineering practices, architecture contracts, quality gates, and specialized agent personas.
3. **UI/UX Pro Max** (`ui-ux-pro-max`): Design intelligence, responsive styles, color palettes, typography pairings, and framework design systems.
4. **Dart & Flutter Skills** (`dart-flutter`): Official Google Flutter team skills for widget testing, responsive layouts, state handling, and Dart best practices.

---

## 1. Engineering Lifecycle & Workflow Mapping

Always follow the phased lifecycle below. Match your current task intent to the corresponding phase and trigger the designated skill.

```
+-----------------------------------------------------------------------------------+
|  1. EXPLORE & PLAN   -->  2. ARCHITECTURE   -->  3. FRONTEND DESIGN & UI/UX       |
|  (Superpowers/Addy)       (API Contracts)        (UI-UX Pro Max)                  |
+-----------------------------------------------------------------------------------+
                                      |
                                      v
+-----------------------------------------------------------------------------------+
|  4. TDD & BUILD      -->  5. DEBUGGING      -->  6. VERIFY & REVIEW               |
|  (Red-Green-Refactor)     (Systematic Debug)     (Verification & Code Review)     |
+-----------------------------------------------------------------------------------+
```

### Phase 1: Planning & Specifications
* **When starting creative exploration or new features:** Activate `brainstorming` (Superpowers) or `idea-refine` (Agent Skills).
* **When writing requirements or functional specs:** Activate `spec-driven-development` (Agent Skills).
* **When authoring implementation plans:** Activate `writing-plans` (Superpowers).
  - Always store implementation plans in `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md` to maintain consistency with existing project documentation.
* **When breaking down tasks:** Activate `planning-and-task-breakdown` (Agent Skills).

### Phase 2: Software Architecture & Contracts
* **When defining API contracts, data models, or module boundaries:** Activate `api-and-interface-design` (Agent Skills). Establish clear contracts between Flutter mobile, React web, and Python server.
* **When making architectural decisions:** Activate `documentation-and-adrs` to record Architecture Decision Records.
* **When defining project boundaries:** Activate `constraint-driven-development` to ensure quality gates remain intact.

### Phase 3: Frontend Design & UI/UX Intelligence
* **When designing or refining web/mobile interfaces:** Activate `ui-ux-pro-max` (UI-UX Pro Max).
  - Consult the local design system database for palettes, typography pairings, charts, and layout patterns.
  - Target the active tech stack: React, Tailwind CSS, TypeScript, and Flutter.
* **When creating component design systems or tokens:** Activate `design-system` and `ui-styling`.
* **When building UI component structure & state decoupling:** Activate `frontend-ui-engineering` (Agent Skills).
* **When building Flutter UI or responsive mobile screens:** Activate `flutter-build-responsive-layout`, `flutter-fix-layout-issues`, or `flutter-add-widget-preview` (dart-flutter).

### Phase 4: Test-Driven Development (TDD)
* **When implementing any feature, bugfix, or behavioral modification:** Activate `test-driven-development` (Superpowers).
  - **The Iron Rule:** Write the failing test first. Run the test to observe it fail. Write the minimal implementation code necessary to pass. Refactor cleanly.
  - Never write implementation code before a failing test is written and confirmed failing.
* **When writing Flutter mobile tests:** Activate `flutter-add-widget-test` or `dart-add-unit-test` (dart-flutter) adhering to Superpowers TDD precedence.
* **When pacing implementation in complex modules:** Activate `incremental-implementation` (Agent Skills).

### Phase 5: Debugging & Root Cause Analysis
* **When encountering any bug, failure, or unexpected behavior:** Activate `systematic-debugging` (Superpowers).
  - Avoid speculative editing or guessing fixes.
  - **The Prove-It Pattern:** Formulate a hypothesis, write an automated test that reproduces the bug, and trace the root cause before editing production code (`debugging-and-error-recovery`).

### Phase 6: Verification & Testing
* **When claiming work is complete, fixed, or passing:** Activate `verification-before-completion` (Superpowers).
  - Evidence before assertions: Always run tests and inspect actual output before declaring completion.
  - **Automated Quality-Check Gate:** Execute `.\scripts\quality_check.ps1 -Check All` (or targeted gates: `-Check TypeCheck|Lint|Test|Browser|Security|Build`) to generate verification evidence before completion claims.
* **When testing browser and web interactions:** Activate `browser-testing-with-devtools` (Agent Skills) with configured `chrome-devtools` or `playwright` MCP servers to inspect DOM, network requests, console errors, and performance.
* **When hunting for subtle edge cases:** Activate `doubt-driven-development` (Agent Skills).

### Phase 7: Code Review & Quality Gates
* **When preparing changes for integration or merging:**
  - Enforce automated quality pass: verify `.\scripts\quality_check.ps1` output before signoff.
  - Activate `code-review-and-quality` (Agent Skills) for multi-axis review (correctness, safety, performance, maintainability).
  - Activate `requesting-code-review` / `receiving-code-review` (Superpowers) when orchestrating subagent reviews.
* **When refactoring complex or nested code:** Activate `code-simplification` (Agent Skills) without altering external behavior.
* **Specialized Agent Roles:** Delegate specialized reviews to `code-reviewer`, `security-auditor`, `test-engineer`, or `web-performance-auditor`.

---

## 2. Conflict Prevention & Skill Disambiguation

To prevent overlapping instructions and ambiguous behavior:
* **TDD Precedence:** The strict RED-GREEN-REFACTOR execution cycle from Superpowers (`test-driven-development`) governs all code-writing actions. Polyglot stack patterns from Agent Skills serve as reference guidance.
* **Planning Precedence:** Conceptual planning uses `writing-plans` targeting `docs/superpowers/plans/`. Task itemization uses `planning-and-task-breakdown`.
* **UI Design Precedence:** Visual styles, themes, palettes, and design tokens use `ui-ux-pro-max`. Component architecture and data flow use `frontend-ui-engineering`.

---

## 3. Security, Configuration & Credential Integrity

* **Zero Credential Exposure:** Never commit, log, or hardcode API keys, passwords, or authentication secrets. Store configuration in environment variables or `.env` files.
* **Preserve Configurations:** Do not overwrite or tamper with existing project configurations, build files (`mobile/pubspec.yaml`, `web/package.json`, `server/main.py`), or established documentation trees.
* **Verify Environments:** Ensure tests and scripts run safely within the Windows PowerShell environment.
