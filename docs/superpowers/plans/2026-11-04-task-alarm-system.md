# Task Alarm System Implementation Plan (Web Panel Creator & Mobile Phone Alarm Trigger)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a unified Task Alarm system where tasks created on the Web Operations Panel are dispatched to sales officers' phones, organized into Today, Pending, Completed, and Overdue buckets, and trigger audible/vibrating phone alarms when due time is up in the mobile APK.

**Architecture:**
- **Backend Persistence:** SQLite table `tasks` with due dates, due times, priority, status (`open`, `acknowledged`, `completed`), and alarm trigger tracking. Exposed via FastAPI REST endpoints (`/api/v1/tasks`).
- **Web Operations Panel:** [`web/src/pages/TaskAlarm.tsx`](file:///C:/NewProject_Frontend/web/src/pages/TaskAlarm.tsx) provides Owner Ishu Jindal with a dashboard to create and assign tasks to any of the 13 sales officers, track task KPIs (Today, Pending, Overdue, Completed), and filter by employee.
- **Mobile APK:** [`mobile/lib/features/tasks/task_dashboard_screen.dart`](file:///C:/NewProject_Frontend/mobile/lib/features/tasks/task_dashboard_screen.dart) displays employee-scoped tasks in 4 distinct tabs (Due Today, Pending, Overdue, Completed), connects to backend sync, and triggers device alerts (`HapticFeedback.heavyImpact()` + `SystemSound.play(SystemSoundType.alert)` + Audible Alert Dialog) when a task due time arrives.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, FastAPI, SQLite, Flutter / Dart (`SystemSound`, `HapticFeedback`, `Provider`).

---

## Global Constraints

- Panel is for task creation & monitoring: The owner creates and monitors tasks on the web panel; employees acknowledge and complete them on their mobile phones.
- Real Sales Officers: Tasks must assign to real HR-PB sales officers (`AJAY JI`, `Mozi Ram`, `GAURAV JI`, `Jagdeep Singh`, etc.).
- Alarm reliability: Mobile APK must trigger visual and audible/haptic alarms when a task due time is reached.
- Zero regression: All 210 web tests, 27 python tests, and 42 mobile tests must pass.
- Windows PowerShell & quality-check compliance: Code must pass `.\scripts\quality_check.ps1 -Check All`.

---

## Implementation Tasks

### Task 1: Backend SQLite Schemas & REST APIs for Tasks & Alarms

**Files:**
- Modify: `server/db.py` (add `tasks` table and CRUD helpers)
- Modify: `server/main.py` (add `/api/v1/tasks` endpoints)
- Modify: `server/test_server.py` (add unit tests for tasks and alarms)

**Steps:**
- [ ] 1.1 In `server/test_server.py`, write failing tests for:
  - `GET /api/v1/tasks` (with filters: `employeeId`, `status`: all, today, pending, completed, overdue)
  - `POST /api/v1/tasks` (create task with due date and due time)
  - `PUT /api/v1/tasks/{id}` (update task)
  - `DELETE /api/v1/tasks/{id}` (delete task)
  - `POST /api/v1/tasks/{id}/status` (acknowledge and complete task)
  - `GET /api/v1/tasks/due-alarms` (detect overdue/due-now tasks)
- [ ] 1.2 In `server/db.py`, create `tasks` table in `init_db()`:
  - Columns: `id`, `title`, `description`, `assigned_employee_id`, `assigned_employee_name`, `due_date`, `due_time`, `due_at`, `priority`, `requires_photo`, `status`, `created_by`, `created_at`, `completed_at`, `completion_notes`, `alarm_triggered`.
- [ ] 1.3 In `server/db.py`, implement CRUD helpers:
  - `save_task(task_dict)`, `get_tasks(...)`, `get_task_by_id(id)`, `delete_task(id)`, `update_task_status(...)`, `get_due_alarm_tasks()`, `seed_default_tasks()`.
- [ ] 1.4 In `server/main.py`, wire FastAPI endpoints:
  - `GET /api/v1/tasks`, `POST /api/v1/tasks`, `PUT /api/v1/tasks/{id}`, `DELETE /api/v1/tasks/{id}`, `POST /api/v1/tasks/{id}/status`, `GET /api/v1/tasks/due-alarms`.
- [ ] 1.5 Run `python -m unittest server/test_server.py` to confirm all server tests pass (GREEN).

---

### Task 2: Web API Client (`web/src/lib/serverApi.ts`)

**Files:**
- Modify: `web/src/lib/serverApi.ts`

**Steps:**
- [ ] 2.1 Add TypeScript interfaces: `ServerTask`, `TaskCreateInput`, `TaskSummary`.
- [ ] 2.2 Add API functions: `listTasks`, `createTask`, `updateTask`, `deleteTask`, `updateTaskStatus`, `getDueAlarms`.
- [ ] 2.3 Verify type definitions compile without errors.

---

### Task 3: Web Operations Panel Task Alarm Screen (`web/src/pages/TaskAlarm.tsx`)

**Files:**
- Modify: `web/src/pages/TaskAlarm.tsx`

**Steps:**
- [ ] 3.1 Replace the `NotConnected` placeholder with the complete Task Alarm Operations Dashboard.
- [ ] 3.2 Add KPI Metric Cards:
  - 🔵 **Today's Tasks**
  - 🟡 **Pending / Open Tasks**
  - 🔴 **Overdue Tasks**
  - 🟢 **Completed Tasks**
- [ ] 3.3 Add Filter Bar:
  - Status tabs: **Today**, **Pending**, **Completed**, **Overdue**, **All**.
  - Employee dropdown: Filter by any of the 13 sales officers or view All.
  - Priority dropdown: All, High, Normal, Low.
  - Search input: Filter by task title or description.
- [ ] 3.4 Implement **Create Task Modal**:
  - Title input (required)
  - Assigned Sales Officer dropdown (13 real HR-PB sales officers)
  - Due Date & Due Time pickers
  - Priority selector (Low, Normal, High)
  - Requires Photo Proof toggle
  - Instructions / description textarea
- [ ] 3.5 Implement Task List Table:
  - Task title, assigned employee badge, due date/time with countdown, priority tag, status pill, and action buttons (Delete, View details).
- [ ] 3.6 Run `npm --prefix web run build` to verify zero TypeScript errors.

---

### Task 4: Mobile APK Sync & Phone Alarm Trigger (`mobile/`)

**Files:**
- Modify: `mobile/lib/core/api_sync_service.dart`
- Modify: `mobile/lib/features/tasks/task_dashboard_screen.dart`
- Modify: `mobile/lib/features/home/home_shell.dart`

**Steps:**
- [ ] 4.1 In `api_sync_service.dart`, add methods:
  - `fetchTasks()`, `createTask()`, `updateTaskStatus()`, `fetchDueAlarms()`.
- [ ] 4.2 In `task_dashboard_screen.dart`:
  - Sync tasks with the backend server so tasks created on the panel appear in the APK.
  - Ensure the 4 tabs are active: **Due today**, **Pending / Upcoming**, **Overdue**, **Completed**.
  - Display employee actions: "Acknowledge" and "Mark Completed".
- [ ] 4.3 In `home_shell.dart` (or `task_dashboard_screen.dart`):
  - Add an Alarm Monitor that checks for active tasks where `dueAt <= DateTime.now()` and `status != completed`.
  - When time is up, trigger:
    - `HapticFeedback.heavyImpact()`
    - `SystemSound.play(SystemSoundType.alert)`
    - Pop up an audible/visual **Alarm Alert Dialog**:
      `🚨 TASK ALARM: Time Up!`
      `"[Task Title]" is due now for [Employee Name]!`
      `Actions: [Acknowledge]  [Mark Complete]  [Dismiss]`
- [ ] 4.4 Run `flutter test` in `mobile/` to verify all mobile tests pass.

---

### Task 5: Verification, Quality Check & Git Commit

**Files:**
- Run: `.\scripts\quality_check.ps1 -Check All`

**Steps:**
- [ ] 5.1 Run Python unit tests.
- [ ] 5.2 Run Web Node unit tests and Vite build.
- [ ] 5.3 Run Mobile Flutter tests.
- [ ] 5.4 Run `.\scripts\quality_check.ps1 -Check All` ensuring all 13 gates pass.
- [ ] 5.5 Commit and push clean code to GitHub repository.
