# Free OpenStreetMap Tour Planning, Daily Route, District/City Views & Vacant Area Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-cost, interactive OpenStreetMap (Leaflet) tour planning and vacant area system where the owner can view each employee's daily routes across Indian cities/districts, inspect completed/pending/upcoming visit statuses, identify uncovered/vacant areas left unvisited, and edit or reassign beats and schedules.

**Architecture:** 
- **Free Map Engine:** OpenStreetMap (OSM) tile rendering via Leaflet.js on React Web and OpenStreetMap/Geo-intent on Mobile APK — 100% free, zero API key required, no Google billing or token expiration.
- **Geocoding & Spatial Directory:** A pre-computed local coordinate dictionary (`server/geo_coordinates.py`) covering all 52 districts and 113 cities in Haryana, Punjab, and border territories for instant zero-latency rendering, with fallback to free OpenStreetMap Nominatim API for custom coordinates.
- **Backend Persistence:** SQLite tables `tour_plans` and `tour_visits` linked to `parties` (137 dealers/shops) and `users` (13 real HR-PB sales officers), exposed via FastAPI REST endpoints.
- **Frontend Interfaces:**
  - `web/src/pages/TourPlan.tsx`: Interactive map with sequential route polylines, status filters (Daily, Upcoming, Completed, Missed), and owner beat editor.
  - `web/src/pages/VaccantArea.tsx`: District-wise and city-wise visual map highlighting covered vs. vacant/neglected areas with one-click employee reassignment.
  - Mobile APK: `mobile/lib/features/tours/tour_plan_screen.dart` and `mobile/lib/features/areas/vaccant_area_screen.dart` live sync.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Leaflet.js, OpenStreetMap (OSM), FastAPI, SQLite, Flutter / Dart.

---

## Global Constraints

- Zero paid API requirements: Never use Google Maps paid billing APIs; strictly use OpenStreetMap (OSM) and Leaflet.
- Zero credential exposure: No secrets or hardcoded passwords in client bundles or public endpoints.
- Preserve existing data: Keep all 137 dealers in `parties` and all 13 sales officers in `users` completely intact.
- High-performance offline resilience: Pre-compute coordinates so maps load instantly without external rate-limit blocks.
- Windows PowerShell & quality-check compliance: All code must pass `.\scripts\quality_check.ps1 -Check All`.

---

## Review Focus

1. **Map rendering performance**: Leaflet map container must cleanly initialize and destroy without "Map container is already initialized" errors on React route changes.
2. **Missing coordinate graceful handling**: If a shop or city lacks precise GPS, it must fall back to district center coordinates without crashing.
3. **Owner vs. Employee Role Scoping**: Owner sees all 13 sales officers' routes; employees see only their assigned daily beat.
4. **Sequential route ordering**: Route polylines must connect stops in explicit sequence order (`sequence: 1, 2, 3...`) rather than arbitrary database row order.
5. **Vacant area detection accuracy**: A district or city is classified as "Vacant" if it has zero active shops with assigned salespersons, or "Neglected" if it has had zero visits in the last 14 days.

---

## Implementation Tasks

### Task 1: Geocoding Directory & Leaflet Web Dependency

**Files:**
- Create: `server/geo_coordinates.py`
- Modify: `web/package.json`
- Test: `tests/test_geo_coordinates.py`

**Steps:**
- [ ] 1.1 Write failing test `tests/test_geo_coordinates.py` testing district and city coordinate lookups for Haryana and Punjab.
- [ ] 1.2 Implement `server/geo_coordinates.py` containing GPS coordinates (latitude, longitude) for all 52 districts and 113 cities present in `data/operations.db` `parties`.
- [ ] 1.3 Add helper `get_coordinates_for_location(city, district, state)` with fallback to district center and state center.
- [ ] 1.4 Install `leaflet` and `@types/leaflet` in `web/` (`npm --prefix web i leaflet @types/leaflet`).
- [ ] 1.5 Run tests to verify coordinate lookups succeed and web builds cleanly.

---

### Task 2: Backend SQLite Schemas & REST APIs for Tour Plans & Vacant Areas

**Files:**
- Modify: `server/db.py` (add `tour_plans` and `tour_visits` tables and CRUD helpers)
- Modify: `server/main.py` (add `/api/v1/tours` and `/api/v1/territories` endpoints)
- Modify: `server/test_server.py` (unit tests for tour plans and vacant areas)

**Steps:**
- [ ] 2.1 Write failing tests in `server/test_server.py` for:
  - `GET /api/v1/tours`
  - `POST /api/v1/tours`
  - `PUT /api/v1/tours/{id}`
  - `DELETE /api/v1/tours/{id}`
  - `POST /api/v1/tours/{id}/visits/{visit_id}/status`
  - `GET /api/v1/territories/vacant-areas`
  - `POST /api/v1/territories/assign`
- [ ] 2.2 In `server/db.py`, add schema creation:
  - `tour_plans`: `id`, `salesperson_id`, `salesperson_name`, `date`, `area_name`, `notes`, `status`, `created_at`
  - `tour_visits`: `id`, `plan_id`, `customer_id`, `customer_name`, `city`, `district`, `sequence`, `status` (`planned`, `in_progress`, `completed`, `missed`), `purpose`, `notes`, `gps_lat`, `gps_lng`, `completed_at`
- [ ] 2.3 Implement CRUD functions in `server/db.py`: `save_tour_plan`, `get_tour_plans`, `delete_tour_plan`, `update_visit_status`.
- [ ] 2.4 Seed initial realistic tour plans for sales officers (e.g. Ajay Ji in Sirsa/Dabwali, Pankaj Ji in Kurukshetra/Yamunanagar) so the map is populated immediately.
- [ ] 2.5 In `server/main.py`, implement endpoint handlers:
  - `GET /api/v1/tours`: Filter by date, salesperson, and status.
  - `POST /api/v1/tours`: Create a new tour plan with ordered shop stops.
  - `PUT /api/v1/tours/{id}`: Re-order stops, update date or salesperson.
  - `DELETE /api/v1/tours/{id}`: Remove a plan.
  - `POST /api/v1/tours/{id}/visits/{visit_id}/status`: Toggle status (completed, missed, planned).
  - `GET /api/v1/territories/vacant-areas`: Compute district and city coverage, vacant shops, and neglected areas.
  - `POST /api/v1/territories/assign`: Assign vacant city/shop to a salesperson.
- [ ] 2.6 Run `python -m unittest server/test_server.py` to confirm all API endpoints pass.

---

### Task 3: Interactive OpenStreetMap Tour Plan Web Interface

**Files:**
- Create: `web/src/components/map/LeafletTourMap.tsx`
- Modify: `web/src/pages/TourPlan.tsx`
- Modify: `web/src/lib/serverApi.ts`

**Steps:**
- [ ] 3.1 In `web/src/lib/serverApi.ts`, add types and API client functions:
  - `ServerTourPlan`, `ServerTourVisit`, `ServerVacantArea`
  - `listTourPlans`, `createTourPlan`, `updateTourPlan`, `deleteTourPlan`, `updateVisitStatus`
- [ ] 3.2 Create reusable `LeafletTourMap.tsx` component:
  - Initializes OpenStreetMap tile layer with zoom controls.
  - Draws numbered, color-coded stop markers:
    - 🟢 Green: Completed visit
    - 🟡 Amber: Pending / In Progress
    - 🔵 Blue: Upcoming planned stop
    - 🔴 Red: Missed stop
  - Draws interactive SVG polyline connecting consecutive stops (`1 -> 2 -> 3`).
  - Marker popups display: Shop Name, City, Sequence #, Purpose, Contact Phone, and quick actions ("Mark Complete", "Open in OSM/Google Maps").
- [ ] 3.3 Replace placeholder in `web/src/pages/TourPlan.tsx`:
  - Header with Employee Dropdown (All 13 sales officers or individual officer), Date Selector (Today, Tomorrow, Pick Date), and Status Tabs (**Daily Beat**, **Upcoming**, **Completed**, **Missed**).
  - Split view: Interactive Map on the left (60%) and Itinerary Stop List on the right (40%).
  - Action button: **"+ New Tour Plan"** opening a modal to create a plan for any employee.
  - Action button on itinerary: **"Edit Route"** allowing the owner to drag or change visit order (1, 2, 3), add new shops from the dealer directory, or delete stops.
- [ ] 3.4 Build web frontend (`npm --prefix web run build`) and verify zero errors.

---

### Task 4: Interactive OpenStreetMap Vacant Area Web Interface

**Files:**
- Create: `web/src/components/map/LeafletVacantAreaMap.tsx`
- Modify: `web/src/pages/VaccantArea.tsx`
- Modify: `web/src/lib/serverApi.ts` (add `listVacantAreas`, `assignTerritory`)

**Steps:**
- [ ] 4.1 In `web/src/lib/serverApi.ts`, add `listVacantAreas()` and `assignTerritory(areaId, salespersonId)`.
- [ ] 4.2 Create `LeafletVacantAreaMap.tsx`:
  - Renders pins and circles across all 52 districts in Haryana and Punjab.
  - **Color-coded coverage indicators**:
    - 🟢 Green: Fully Covered (active employee + visited recently)
    - 🟡 Amber: Partially Covered (assigned but infrequent visits)
    - 🔴 Red / Hollow: Vacant / Uncovered (zero assigned employee or neglected)
  - Toggle between **District View** and **City View**.
  - Clicking any district pin displays: District Name, State, Total Shops, Assigned Sales Officer, Last Visit Date, and a button: **"Assign Salesperson"**.
- [ ] 4.3 Replace placeholder in `web/src/pages/VaccantArea.tsx`:
  - Metric summary cards: Total Districts (52), Covered Districts, Vacant Districts, Unassigned Shops.
  - Interactive OpenStreetMap view with filters for State (Haryana, Punjab, Border) and Coverage Status (All, Vacant, Assigned, Neglected).
  - **"Assign Area" Modal**: Allows the owner to assign any vacant district or city to an employee in one click, instantly syncing party and territory records.
- [ ] 4.4 Build web frontend and verify zero errors.

---

### Task 5: Mobile APK Sync & Navigation

**Files:**
- Modify: `mobile/lib/core/api_sync_service.dart`
- Modify: `mobile/lib/features/tours/tour_plan_screen.dart`
- Modify: `mobile/lib/features/areas/vaccant_area_screen.dart`

**Steps:**
- [ ] 5.1 In `api_sync_service.dart`, add endpoints for fetching tour plans and vacant areas from the backend server.
- [ ] 5.2 In `tour_plan_screen.dart`:
  - Wire live data for Daily, Upcoming, Completed, and Missed visit tabs.
  - Add "Open Route on Map" button triggering external map intent (`geo:` / OpenStreetMap / Google Maps) with coordinates.
  - Add quick "Mark Visited" button with optional visit notes.
  - Owner mode: Employee filter dropdown to inspect any sales officer's tour plan.
- [ ] 5.3 In `vaccant_area_screen.dart`:
  - Display live district-wise and city-wise vacant territory list.
  - Owner action to assign sales officers to unassigned territories.
- [ ] 5.4 Run `flutter analyze` and `flutter test` to ensure zero regressions.

---

### Task 6: Verification, End-to-End Testing & Automated Quality Check

**Files:**
- Run: `.\scripts\quality_check.ps1 -Check All`

**Steps:**
- [ ] 6.1 Run full Python test suite (`python -m unittest server/test_server.py`).
- [ ] 6.2 Run full Web test suite (`npm --prefix web run test`).
- [ ] 6.3 Run full Mobile test suite (`flutter test` in `mobile/`).
- [ ] 6.4 Run `.\scripts\quality_check.ps1 -Check All` ensuring all 13 gates pass.
- [ ] 6.5 Commit and push clean implementation to GitHub repository.
