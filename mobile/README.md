# Dura Smart Business Platform — Flutter UI build

Android UI/frontend build of the Dura Smart business platform using the approved
**Option 3 colourful gradient** design (blue → violet → magenta with orange, teal and pink
highlights on white / light-grey surfaces). All business data is **in-memory demo data** —
there is no backend, no real login and no cloud sync in this phase.

- App label: **Dura Smart**
- Package / applicationId: **com.durasmart.business**
- Flutter SDK used to build: 3.47.7 stable (Dart 3.13.5)

---

## 1. What is implemented

### Sign-in and shell
| Screen | Route | Notes |
| --- | --- | --- |
| Login | `/login` | email / mobile / employee-ID + password, show-hide toggle, inline validation, loading state, tappable demo-account list |
| Forgot password | `/forgot` | request + support-contact flow, no real reset |
| Invitation registration | `/register` | invitation-code gate + demo approval request |
| Home dashboard | `/home` | exact menu labels: Sales, Payment, Vaccant Area, Tour Plan, New Customer Add, New Order, Task Alarm + live summary metrics, notifications sheet, profile entry |
| More / all modules | inside `/home` | every department and utility screen reachable |

### Sales department
- **Sales Dashboard** — Monthly Target Qty, Order Received, Order Pending, Pending for Dispatch,
  Pending Target, Payment Received, Payment Balance. Every figure is **computed from the demo
  records** (`MockRepository.salesMetrics`), filterable by month and salesperson, plus a
  six-month achievement chart and per-salesperson cards.
- **Salesperson Performance** — target vs achievement, orders, collections, balance, overdue.
- **Customer List / Customer Details** — search, sort, overdue derived from order due dates,
  order & payment history, WhatsApp summary share with user-selected content.
- **Debtor List** — outstanding vs overdue-only filter, totals, WhatsApp reminder share.
- **New Customer Add** — Save / Cancel / Preview; new customers land in **Pending Approval**
  and only become active after Owner approval.
- **New Order** — multiple product lines, automatic line and order totals, order date /
  expected dispatch date, payment terms, camera + gallery photos, Save Draft / Preview / Submit.
- **Order Management** — tabs All / Pending / Confirmed / Pending for Dispatch / Dispatched with
  live counts, search, Order Details with dispatch progress, payments, photos and WhatsApp share.

### Dispatch
- Per-line dispatch quantities that **cannot exceed the pending quantity** of each line.
- Vehicle, driver, transport details and loading photos, mandatory confirmation before submit.
- An order is only marked **Dispatched when every line quantity is fully covered**; a partial
  dispatch keeps it in *Pending for Dispatch* with the dispatched quantity shown.
- Dispatch history screen with tracking-number copy/share and a success screen with WhatsApp
  sharing of the delivery details.

### Payment
- **Record Payment** — rejects zero/negative amounts and rejects amounts above the outstanding
  balance unless the *advance* switch is turned on deliberately.
- Payment dashboard metrics, **Customer Ledger** (order-wise + payment-wise running balance),
  **Outstanding / Overdue** views with filters. All balances recompute from the records.

### Vaccant Area (spelling kept exactly as approved)
- Territory cards with status chips, search + state filter, add/edit area, assign salesperson
  (Owner only). Employees get a clearly labelled read-only view.

### Tour Plan
- Plan list with planned/completed/missed visit counts, create plan (date + area + salesperson),
  add visits, visit detail form with status, notes and photo.
- **GPS is optional and honest**: no live location plugin is bundled, so the app never invents
  coordinates. Manual lat/long entry is available, and a visit is only flagged *GPS verified*
  when the user explicitly ticks that box.

### Task Alarm
- Owner: create task, pick assignee/priority/due date, review completion photos.
- Employee: Upcoming / Due today / Overdue / Completed tabs, Acknowledge, Mark Complete with
  notes and completion photo (a photo-required task cannot be completed without one).
- Statuses stay consistent across list, detail and dashboard.
- **These are in-app reminders only.** No real Android alarm scheduling is implemented, so the
  app makes no claim that notifications ring when the app is closed, the phone is locked or
  battery optimisation is active.

### Organisation & settings
- Profile (role, department, employee ID, monthly target, editable phone, logout),
  Employee list & details, Settings (gradient theme preview, local notification switches with a
  demo-only notice, role permission overview, department read-out, logout).

---

## 2. Project structure

```
lib/
  main.dart                  entry point — provider + app
  app.dart                   MaterialApp, route table
  core/                      theme, shared widgets, formatters, WhatsApp/share service
  data/                      models + MockRepository (all demo data & derived metrics)
  features/
    auth/  home/  sales/  dispatch/  payments/  areas/  tours/  tasks/  org/
```

State is a single `ChangeNotifier` (`MockRepository`) exposed with `provider`; screens read it
with `context.watch<MockRepository>()`, so adding an order, payment, dispatch or task updates
every dependent screen immediately.

## 3. Dependencies (intentionally minimal)

`provider` (state) · `image_picker` (camera/gallery) · `share_plus` (system share of photos) ·
`url_launcher` (WhatsApp / tel deep links) · `cupertino_icons`.
No backend, database or location packages.

## 4. Setup & run (Windows)

Only the **Android** platform folder is scaffolded in this build (the scope is an Android APK).

```powershell
flutter --version          # expects Flutter 3.x stable
flutter doctor -v          # Android toolchain + a JDK 17 must be visible
flutter pub get
flutter devices            # note the device id of your phone / emulator
flutter run -d <device-id>
```

If you want to preview the same UI in a browser or on an iPhone, generate the extra
platform folders first (`flutter create --platforms=web .` on Windows,
`--platforms=ios` on macOS) — no Dart code changes are needed.

Build the debug APK:

```powershell
flutter build apk --debug
```

The APK is written to:

```
build/app/outputs/flutter-apk/app-debug.apk
```

Install it on a device with `adb install build/app/outputs/flutter-apk/app-debug.apk`, or copy
the file to the phone and install it (enable "install unknown apps").

This build was produced on Windows with `flutter build apk --debug`, which succeeded and wrote
`build/app/outputs/flutter-apk/app-debug.apk` (package `com.durasmart.business`, label
`Dura Smart`, minSdk 24, targetSdk 36). The **first** run is slow (about 38 minutes here) because
Gradle downloads its distribution plus the Android NDK, build-tools and platform SDKs; later runs
are much faster. If the wrapper cannot download `gradle-9.3.1-bin.zip` on your network, place the
zip in `%USERPROFILE%\.gradle\wrapper\dists\gradle-9.3.1-bin\<url-hash>\`, unzip it there and add
an empty `gradle-9.3.1-bin.zip.ok` marker file next to the `gradle-9.3.1` folder.

Quality gates:

```powershell
dart format lib test
flutter analyze
flutter test
```

`dart format .` is fine before the first build, but once an APK has been produced the generated
Gradle output under `build/` makes it scan far too deep (it can fail on very long paths), so the
commands above limit the formatter to the real sources.

`flutter test` runs the suite in `test/widget_test.dart`: the login validation and sign-in flow,
the exact home menu labels, the sales-dashboard metric cards, the repository rules that keep
figures derived from records (payment, over-payment rejection, new order, partial dispatch,
customer approval) and a phone-size (411×891) render check of every route, which fails if any
screen produces a layout overflow.

## 5. Demo accounts

`demo123` is the shared **demo passcode** (visible on the login screen; it is not a secret and
not real authentication).

| Identity | Role |
| --- | --- |
| `owner@durasmart.in` | Owner / Admin |
| `EMP-101` (Amanpreet Singh) | Sales |
| `EMP-102` (Harpreet Singh) | Sales |
| `EMP-103` (Rohit Kumar) | Sales |
| `EMP-201` (Simran Kaur) | Dispatch |

Any listed account also signs in with the mobile number or the `SAL-0x` employee ID.

## 6. Known limitations — this is a UI/frontend prototype

- **Not production-ready.** Authentication, cloud sync, notifications and data persistence are
  demo implementations. There is no server, no PostgreSQL, no multi-company separation and no
  audit trail.
- **Role filtering is cosmetic.** The locally stored role only changes what the UI shows; it is
  not secure authorization. Production access control must be enforced by the backend.
- **Data resets on restart.** Photos are kept in memory only and are never uploaded.
- **WhatsApp never sends automatically.** The app builds a reviewable message, lets the user
  choose which parts to include, and hands off to WhatsApp (or falls back to copy/system share
  when WhatsApp is unavailable). The user always presses send.
- **No real alarms** (see Task Alarm above) and **no live GPS**.
- The launcher icon shipped here is generated from the Dura Smart gradient brand; replace the
  five `android/app/src/main/res/mipmap-*/ic_launcher.png` files to use a final logo.

## 7. Next phase

1. Backend with real authentication, company/branch separation and server-side role checks.
2. Persistent storage + offline queue and sync.
3. Photo upload to object storage, Tally/ERP export, purchase/stock/invoice integration.
4. Native Android alarm + notification implementation and physical-device testing.
5. Web admin panel and iOS build (iOS signing requires macOS + Xcode).
