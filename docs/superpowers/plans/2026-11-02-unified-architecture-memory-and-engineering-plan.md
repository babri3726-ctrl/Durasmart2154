# Unified Architecture Blueprint: MCP Memory, Multi-Tier Engineering & Mobile APK Plan

> **Tracking & Guidance:** Implement this plan following the Unified Engineering Lifecycle with Superpowers and Agent Skills. All tasks adhere to the strict RED-GREEN-REFACTOR cycle and automated quality gate verification (`.\scripts\quality_check.ps1 -Check All`).

**Goal:** Establish a permanent, structured, and production-hardened engineering blueprint for DuraSmart Operations across MCP Memory Intelligence, React Web Frontend, FastAPI Backend, Flutter Mobile APK, and GitHub/Render Cloud CI/CD.

---

## 1. System Architecture & Component Mapping

```
+---------------------------------------------------------------------------------------------------------+
|                                    ANTIGRAVITY AGENTIC WORKSPACE                                        |
|  - Persistent Memory MCP (@modelcontextprotocol/server-memory)                                          |
|  - Codebase AST Graph MCP (codebase-memory-mcp / Tree-sitter)                                           |
|  - Browser Inspection & Automation (chrome-devtools / playwright)                                       |
+---------------------------------------------------------------------------------------------------------+
                                                     |
       +---------------------------------------------+---------------------------------------------+
       |                                             |                                             |
       v                                             v                                             v
+-------------------------------+             +-------------------------------+             +-------------------------------+
|      FASTAPI BACKEND          |             |      REACT WEB COCKPIT        |             |      FLUTTER MOBILE APK       |
|  - server/main.py             |  HTTP/JSON  |  - web/src/ (Vite/TS/Tailwind)|  REST API   |  - mobile/lib/ (Dart/Flutter) |
|  - server/db.py (SQLite)      |<===========>|  - Dashboard, Stock, Debtors, |<===========>|  - Yard Dispatch, Orders,     |
|  - server/stock_parser.py     |             |    Payments, Sales Targets    |             |    Debtors & Stock Preview    |
|  - server/hr_pb_parser.py     |             |  - 1-Click Browser Upload     |             |  - Offline SQLite Cache       |
+-------------------------------+             +-------------------------------+             +-------------------------------+
       |                                             ^
       v                                             |
+-----------------------------------------------------------------------------+
|                               DATA PIPELINE                                 |
|  - 1-8-26.xlsx (Stock: TOTAL STOCK, UPVC TOTAL STOCK, UPVC ITEM)            |
|  - HR-PB.xlsx (Targets & Dealers: Punjab & Haryana 137 Dealers)             |
|  - Shadow-Copy Lock Bypass (Bypasses active Excel desktop locks)            |
|  - Multi-path Sync: Direct Web Upload + Desktop Batch (.bat)                |
+-----------------------------------------------------------------------------+
```

---

## 2. Model Context Protocol (MCP) Memory Configuration

To ensure Antigravity never loses context or re-reads hundreds of lines unnecessarily, the following MCP servers manage persistent knowledge and code structure:

### Configuration File: `C:\Users\Dharampal Jindal\.gemini\config\mcp_config.json`

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "cmd.exe",
      "args": ["/c", "npx", "-y", "chrome-devtools-mcp"],
      "disabled": false
    },
    "playwright": {
      "command": "cmd.exe",
      "args": ["/c", "npx", "-y", "@playwright/mcp"],
      "disabled": false
    },
    "persistent-memory": {
      "command": "cmd.exe",
      "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-memory"],
      "disabled": false
    },
    "codebase-memory": {
      "command": "cmd.exe",
      "args": ["/c", "npx", "-y", "codebase-memory-mcp"],
      "disabled": false
    }
  }
}
```

### Roles of Each MCP Server
1. **`persistent-memory` (`@modelcontextprotocol/server-memory`):**
   - Stores domain knowledge: *"Debtor balances in paise"*, *"3 approved stock sheets"*, *"Render runs Linux containers"*, *"SLA delay threshold is 3 days"*.
   - Retained in persistent local storage (`memory.json`) across sessions and reboots.
2. **`codebase-memory` (`codebase-memory-mcp`):**
   - Automatically indexes the repository into an AST symbol graph using **Tree-sitter**.
   - Answers call-hierarchy queries (e.g. which endpoints call `extract_3sheet_stock`).
   - Performs blast-radius analysis before code edits to prevent regressions.
3. **`chrome-devtools` & `playwright`:**
   - Real browser visual verification, DOM inspections, runtime console error capture, and network performance auditing.

---

## 3. Skills Routing by Lifecycle Phase

Every engineering task must activate its designated skill per the workspace rules:

| Lifecycle Phase | Focus Area | Activated Skills |
| :--- | :--- | :--- |
| **Phase 1: Planning & Specs** | Feature conceptualization, PRD, requirements breakdown | `brainstorming`, `writing-plans`, `spec-driven-development`, `planning-and-task-breakdown` |
| **Phase 2: Architecture & Contracts** | API schema design, SQLite models, module isolation | `api-and-interface-design`, `documentation-and-adrs`, `constraint-driven-development` |
| **Phase 3: Frontend & UI/UX** | Responsive layouts, design tokens, charts, components | `ui-ux-pro-max`, `design-system`, `ui-styling`, `frontend-ui-engineering` |
| **Phase 4: Backend & TDD** | Python FastAPI routes, Excel parsers, business logic | `test-driven-development` (Strict RED-GREEN-REFACTOR), `systematic-debugging` |
| **Phase 5: Mobile Flutter APK** | Responsive Android UI, widget testing, offline sync | `flutter-build-responsive-layout`, `dart-add-unit-test`, `flutter-add-widget-test` |
| **Phase 6: Quality Gates** | Pre-merge verification, automated test suites, build checks | `verification-before-completion`, `.\scripts\quality_check.ps1 -Check All` |
| **Phase 7: Code Review** | Pre-merge auditing, security hardening, refactoring | `code-review-and-quality`, `security-and-hardening`, `code-simplification` |

---

## 4. Repository & Directory Structure Blueprint

```text
C:\NewProject_Frontend/
├── server/                              # BACKEND (Python FastAPI)
│   ├── main.py                          # Unified API, middleware, and route dispatchers
│   ├── db.py                            # SQLite operations, connection pooling, schema
│   ├── stock_parser.py                  # 3-Sheet stock extractor with lock bypass
│   ├── hr_pb_parser.py                  # HR-PB Punjab & Haryana dealer/target parser
│   └── test_server.py                   # Automated regression suite (13+ unit tests)
│
├── web/                                 # FRONTEND (React 19 / Vite / TypeScript)
│   ├── src/
│   │   ├── pages/                       # Screen routes: Dashboard, Stock, Debtors, Orders...
│   │   ├── components/                  # UI components, LiveSync, modals, tables
│   │   │   └── stock/                   # StockDashboard, WatchedWorkbook, StockKpiStrip
│   │   └── lib/                         # Wire contracts (serverApi.ts, syncStore.ts)
│   ├── dist/                            # Production bundle served by FastAPI & Render
│   └── package.json                     # Dependencies, scripts (typecheck, lint, test)
│
├── mobile/                              # MOBILE APK (Flutter 3.x / Dart 3.x)
│   ├── lib/
│   │   ├── features/                    # Yard Dispatch, Orders, Debtors, Performance
│   │   ├── data/                        # API clients, local SQLite cache, models
│   │   └── main.dart                    # Mobile app entrypoint & navigation
│   ├── test/                            # 36+ automated Flutter widget & unit tests
│   └── pubspec.yaml                     # Dependencies & build configuration
│
├── data/                                # SHARED PERSISTENCE
│   ├── operations.db                    # SQLite database (orders, dispatches, payments)
│   ├── 1-8-26.xlsx                      # Seed stock workbook
│   └── HR-PB.xlsx                       # Seed dealer targets workbook
│
├── scripts/                             # AUTOMATION & QUALITY GATES
│   ├── quality_check.ps1                # Master multi-gate test runner
│   └── Sync DuraSmart Excel.bat         # 1-Click Desktop OneDrive cloud sync
│
├── docs/                                # DOCUMENTATION & PLANS
│   ├── superpowers/plans/               # Superpowers implementation plans
│   └── ADR/                             # Architecture Decision Records
│
├── Dockerfile                           # Production container bundling API + web/dist
├── render.yaml                          # Render cloud deployment blueprint
└── requirements.txt                     # Python backend dependencies
```

---

## 5. Execution & Verification Roadmap

### Task 1: MCP Memory Server Installation & Wiring
- [ ] Configure `persistent-memory` and `codebase-memory` in `C:\Users\Dharampal Jindal\.gemini\config\mcp_config.json`.
- [ ] Verify both servers start cleanly via `npx` over stdio.
- [ ] Populate domain architecture facts into `persistent-memory` knowledge graph.

### Task 2: Backend API Contract Hardening
- [ ] Ensure all API responses enforce `Cache-Control: no-cache, no-store, must-revalidate`.
- [ ] Validate `build_stock_preview_out` against `readStockPreviewPayload` (210 contract tests).
- [ ] Maintain 100% test coverage in `server/test_server.py`.

### Task 3: Web Cockpit Direct File Sync Enhancements
- [ ] Verify `WatchedWorkbook.tsx` allows direct file uploads via `uploadExcelWorkbook`.
- [ ] Verify `HrPbTargetsCard.tsx` allows direct `HR-PB.xlsx` uploads.
- [ ] Confirm `npm run typecheck` and `npm run test` pass with 0 errors.

### Task 4: Mobile APK Build & Remote Integration
- [ ] Point Flutter `ApiConfig.baseUrl` to `https://durasmart2154.onrender.com`.
- [ ] Execute `flutter test` across all 36 mobile tests.
- [ ] Compile release APK: `flutter build apk --release`.

### Task 5: Master Quality Gate Execution
- [ ] Run `.\scripts\quality_check.ps1 -Check All`.
- [ ] Verify Git branch status and push changes to `origin/main`.
- [ ] Verify live container deployment on Render.
