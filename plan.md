# plan.md — Link Production Timetable Slots ↔ Teacher Portal

> **Goal:** one source of truth for "what does this teacher teach, when, where". The published (production) timetable drives **📅 My Schedule**, **🕐 Today's Schedule**, the **✅ Take Attendance auto-popup**, and **🏖 My Leaves & Substitutions**, with day-level changes (holidays, cancellations, substitutions, approved leave) applied on top.
>
> **Status (30 Sep 2026)**
> - ✅ **Phase 1 — Teacher page repair: DONE** (this change set, see §2).
> - ⏳ **Phase 0 — Timetable workspace bugs:** must land before linking (§3). Several of them corrupt or block the production data that linking depends on.
> - ⏳ **Phases 2–6 — Linking:** specified below, file-by-file.

---

## 0. Ground rules (from `CLAUDE.md`, apply to every phase)

- Vanilla HTML/CSS/JS only. No framework, no bundler.
- `const M = require('../models')` everywhere; never import model files directly.
- Every new route sits behind `authMiddleware` (the timetable router already does `router.use(authMiddleware)` at line ~837). All query params go through `sanitizeToString` / `sanitizeToObjectId`.
- Response contract: success `{ ok: true, data }`, failure `{ error }` with 400/401/403/404/500.
- Attendance stays server-enforced: the popup is a **shortcut into the existing flows**, never a bypass of `checkAttendanceMarkGuard`, `verifyTeacherAssignment`, rate limiters, QR rotation, or Rep-Share headcount.
- Additive schema changes only. No destructive migrations. Every backfill script is dry-run by default.
- `logAction` on every mutation added.
- Teacher files (`teacher.html`, `teacher.css`, `teacher.page.js`) use **CRLF** line endings — keep them CRLF.

---

## 1. Why the teacher page never showed the timetable (root causes)

```
Timetable workspace (coordinator)                    Teacher portal
───────────────────────────────                      ──────────────
save-production / publish-all                        GET /api/timetable?teacherId=<id>
  └─► SectionTimetable.slots  (production) ✗──────►    └─► legacy `Timetable` collection
  └─► SemesterTemplate(status:published)                    (no teacherId field → always [])
  └─► Assignment (auto-synced)  ───────────────────►  classes/subjects dropdowns ✓
Override (substitute/cancel) ✗─────────────────────►  never read
TeacherLeaveRequest ─► /leave/affected-slots ───────►  reads legacy Timetable with isDraft:false → always 0 slots
```

1. **Wrong collection.** The portal reads the legacy per-teacher `Timetable` model. Production lives in `SectionTimetable.slots` (Mixed object keyed `Monday_3`), written by the Timetable workspace.
2. **Missing identity.** The legacy model has no `teacherId`, `periodNumber`, `type`, `hallNo`, `isDraft` — Mongoose strict mode drops them, and filters on them (`teacherId`, `isDraft:false`) match nothing.
3. **Production slots carry only a teacher *name*** (`slot.teacher = "Priya Raman"`), no `teacherTrackId`/`teacherId`. Linking must match names until slots are backfilled (Phase 6).
4. **Two slot shapes in production.** `persistState()` sends `entriesToGrid()` output (`period: 3`, `span`, `isLab`), but save-production / verification / publish-all send raw workspace entries (`period: 'P3'`, `duration`, `type:'Lab'`). Keys become `Monday_P3` vs `Monday_3`.
5. **Two Override shapes.** Coordinator substitutions write `newSlot {teacher, teacherId, room, subject}`; HOD leave approval writes `newSlot {teacherName, teacherTrackId, hallNo, subjectName}`. Readers only understand one of them.
6. **Hard-coded, wrong period times** in the teacher page (`TEACHER_PERIODS`: P6 = 13:15–14:00) vs the seeded timing sets (SET_1: P6 = 12:30–13:15, lunch 13:15–14:00, P8 = 14:45–15:30).

---

## 2. Phase 1 — Teacher page repair (DONE)

Files: `public/teacher.html`, `public/css/teacher.css`, `public/js/pages/teacher.page.js`, `routes/timetable.routes.js` (1 line).

### 2.1 Broken HTML structure (the big one)
| Bug | Effect | Fix |
|---|---|---|
| `#cont-tl-duties` card never closed | HOD approvals card, **Grievance page and My Profile page** were nested inside the hidden "Substitution Duties" tab → both pages rendered 0×0 | Closed the card; all pages are now siblings |
| `#m-leave-review` modal backdrop never closed | **Apply-for-Leave modal, Free-Slot Finder, both toasts, Quick Pass / QR / Rep-Share modals and the forced-password modal** were children of an `opacity:0` backdrop → invisible | Closed the backdrop; every modal/toast is now a direct child of `<body>` |
| Leave-review modal had no `.mbody`/`.modal-actions` | Content flush against the modal edge (teacher.css sets `.modal{padding:0}`) | Wrapped body/actions; reject button uses `btn-form-del` |
| Insights KPI used `.t-stats-grid/.t-stat-card` (undefined) | 4 KPI cards stacked as giant unstyled blocks | Switched to existing `.t-stat-grid/.t-stat-mini` |
| `btn btn-sm btn-outline`, `btn bdan` (undefined) | Unstyled buttons | `btno bsm`, `btn-form-del` |

### 2.2 CSS
- `.sb-itemnfo` was a botched rename of `.sinfo` → Today's-Schedule rows didn't flex; restored.
- Brand read "Sri Shakthi InstituteTeacher Portal" — styled `.sb-brand small` as a sub-line; added `.sb-item .ic`.
- Dashboard rows (`1.3fr 1fr`, `1.7fr 1fr`) never collapsed on phones (the existing `[style*=…]` selectors didn't match) → new `.dash-row` classes, 1-column ≤1024px; calendar card no longer forced to `aspect-ratio:1`.
- Attendance-overview bars always collapsed to 6px (percent heights resolved against an auto height) → columns stretch to the chart height.
- New `.week-grid` (6 → 3 → 1 columns), stacked week slot cards, `.badge/.badge-theory/.modal-md`, unmarked-row style, tablet (≤1280/≤1024) and phone (≤768/≤480) rules. Verified in headless Chromium with mocked APIs: 0 px horizontal overflow and 0 page errors on all 11 tabs at 1440/1280/1024/768/480/390 px.

### 2.3 JavaScript
| # | Bug | Fix |
|---|---|---|
| J1 | `renderSchedulePage()` referenced 4× but never defined → **Week View (default tab) crashed**; Prev/Next/Today/save/delete threw | Implemented Mon–Sat week view with dates, TODAY column, P#, "Take Att." for today, "Marked" state |
| J2 | All 11 **My Leaves & Substitutions** calls used `credentials:'same-origin'` — the API authenticates by `Authorization` header only → every call returned **401** | `authHeaders()` helper on every fetch |
| J3 | Attendance rows carry the teacher **trackId** but the page compared `a.teacherId === currentUser._id` → **dashboard chart, defaulters widget and defaulters report always empty** | Removed the redundant client filter (API already scopes by teacher) |
| J4 | `/api/attendance` defaults to 50 rows → 90-day sync and reports silently truncated | `&limit=0` |
| J5 | Schedule views filtered `t.teacherId === currentUser._id` (field doesn't exist) → always empty | `getMyTimetable()` / `normalizeScheduleSlot()` — **single accessor all views read, so Phase 3 only swaps the loader** |
| J6 | `showToast('…','info')` mapped to `saving` (spinner never closes); `'danger'/'warning'` showed green success | Correct mapping |
| J7 | HOD tab visibility read `DB.get('user')` (never set) → HOD approvals tab never shown | Uses `currentUser.isHOD/isAdmin` |
| J8 | Grievances only lived in memory: never sent, admin never notified, gone on reload | `GET/POST /api/grievances` |
| J9 | Profile → Change Password compared against `currentUser.password` (never present) → always "incorrect"; never hit the server | `POST /api/auth/change-password` |
| J10 | Add/Edit/Delete slot ignored HTTP status: a 403/400 still toasted "Slot added!" and wrote a phantom slot locally | Real error handling; local cache changes only after server success. Server `POST /api/timetable` now stamps `trackId` from `req.user` (was required but never sent → every create failed) |
| J11 | `/api/timetable/resolve` returns `{ok,data}`; page read the wrapper → holiday/cancelled warnings never fired | Unwraps `data`, span-aware period match |
| J12 | "Unmarked" default preference rendered as Absent and was saved as AB | Neutral rows, "n unmarked" counter, save blocked until all marked |
| J13 | `syncMyProfile` dropped `preferences` → default-status preference ignored after reload | Kept `preferences` + `specials` |
| J14 | `todayISO()` used UTC → wrong day 00:00–05:30 IST; many `toISOString().split('T')[0]` | `localISO()` everywhere |
| J15 | Lab spanning a break: `colspan=3` **plus** a break cell → every later cell shifted right | Column-walk that absorbs break columns into the colspan |
| J16 | "Cancel class for today" toasted "Students will be notified" without calling anything | Honest message (needs coordinator/HOD) |
| J17 | "Request substitute" opened the *student* leave page | Opens My Leaves → Apply for Leave, pre-dated to the slot's next day |
| J18 | `dbToast(msg,'warn',5000)` printed "5000" in the toast | Removed stray args |
| J19 | Combined-class dropdown never filled (`!options.length` on a select with a placeholder) | Fixed |
| J20 | Stored-XSS: student/teacher leave reasons, names and notification text went into `innerHTML` unescaped | `escapeHtml` on user-supplied fields |
| J21 | Deep link `?tab=sched` stayed empty until re-navigating; sidebar didn't highlight My Profile; mobile toggle showed ✖ while closed | Re-render after sync; nav map; initial ☰ |

**Still true after Phase 1 (by design, fixed in Phases 2–5):** in production the schedule views remain empty because the server endpoint they call cannot see production slots; "My Substitution Duties" shows an explanatory message because `/api/timetable/teacher-day-schedule` does not exist.

---

## 3. Phase 0 — Timetable workspace bugs (fix BEFORE linking)

Ordered by severity. Line numbers are from the uploaded `emas_30_9_mrg`.

| ID | Where | Bug | Impact | Fix |
|---|---|---|---|---|
| **T1** | `timetable.page.js` 7266, 7294, 7330 → `routes/timetable.routes.js` save-development (3962), verification-requests (4111), save-production (4022), publish-all (4237) | Raw `state.entries` sent (`period:'P3'`, `duration`, `type`). `SemesterTemplate.grid.period` is `Number` → **`Cast to Number failed for value "P3"`** (reproduced with Mongoose 9). | **Save to Development DB and Publish to Production return 500.** On publish, `SectionTimetable` is already overwritten and the old published template already archived before the failing `create` → no published template; `syncClassAssignmentsFromSlots` never runs. Labs lose `span`/`isLab`. | Client: send `entriesToGrid(state.entries)` in all 3 payloads. Server: add `normalizeGridSlots(slots)` (period→int, `span = span‖duration‖1`, `isLab = isLab‖type==='Lab'`) at the top of all four handlers **and** key production slots `${day}_${period}` with the numeric period. Do the `SemesterTemplate.create` *before* archiving/overwriting (or wrap in a transaction). |
| **T2** | production data | Existing `SectionTimetable.slots` already contain `Monday_P3` keys and `duration/type` fields | Readers disagree about periods and labs | One-off `scripts/normalizeProductionSlots.js` (dry-run default, `--apply`) that re-keys and normalizes every section; the resolver in Phase 2 must *also* accept both shapes |
| **T3** | `timetable.page.js` 6467 | Substitute finder calls `free-teachers?period=N`; server reads `periodNumber` | `targetPeriod` is null → anyone free in *any* period is listed as "Free in Period N" → **double-booking** | Send `periodNumber`; server also accepts `period` as alias |
| **T4** | `routes/timetable.routes.js` 4903 vs `routes/leave.routes.js` 961 | Two Override `newSlot/originalSlot` shapes | Coordinator substitutions show the **original** teacher in `/resolve`, don't mark the substitute busy, don't free the original teacher | Shared `buildOverrideSlot({teacherName, teacherTrackId, teacherId, subjectName, hallNo})` that writes **both** spellings; readers use `readOverrideSlot()` (Phase 2) |
| **T5** | `routes/timetable.routes.js` 4605 `free-teachers` | Teaching load read from published `SemesterTemplate` + legacy `Timetable` (`isDraft`, `staffName` don't exist); never from `SectionTimetable` | With T1 there is often no published template → **everyone looks free** | Build load from the Phase-2 resolver (production slots + overrides + leave) |
| **T6** | `timetable.page.js` 7134 | `clearDraft()` calls undefined `pushHistory()` | "Clear Draft" throws; nothing clears | `recordHistory('Clear Draft')` |
| **T7** | `timetable.page.js` 5612, 5671 | Dashboard "Slot Inspector" and "Emergency Room Reassign" modals use class `is-open`; CSS only shows `.modal-bg.open` | Both modals are **invisible and unclickable** (opacity 0, pointer-events none) | Use `open`; their `.modal-head` should be `.modal-hd` |
| **T8** | `timetable.page.js` 6648/6766 vs `timetable.css` 3790 | Subject search uses `.tt-searchable-dropdown/.tt-searchable-item`; CSS defines `.tt-dropdown-panel/.tt-dropdown-item` | Add-Entry subject list renders as an unpositioned, unstyled block | Rename to the CSS classes (and toggle `.open`) |
| **T9** | `routes/timetable.routes.js` 3730 `GET /overrides` | `req.query.date` copied straight into the Mongo filter | **NoSQL operator injection** (`?date[$ne]=x`) — violates invariant #9 | `sanitizeToString` + UTC day range |
| **T10** | `routes/timetable.routes.js` 4903 assign-substitute | Day bounds built with server-local `new Date(y,m,d)`; everything else uses UTC ranges | On a non-UTC server, duplicate overrides / wrong-day lookups | UTC `YYYY-MM-DDT00:00:00.000Z … T23:59:59.999Z` |
| **T11** | `routes/leave.routes.js` ~820 | HOD lookup uses `'specials.option': 'isHOD'`; enum value is `isHod` | **HOD is never notified** of faculty leave | `'isHod'` |
| **T12** | `routes/leave.routes.js` ~720 | `overrideItem` is undefined inside affected-slots | Throws (500) as soon as any slot matches — currently masked because the legacy query returns nothing | Rewritten in Phase 5 |
| **T13** | `routes/timetable.routes.js` 5113 `/resolve` | Reads only the published `SemesterTemplate`; ignores `CalendarDay.details[].year`; treats any holiday detail as global | Wrong holidays per year; empty when T1 bit | Rebuild on the Phase-2 resolver |
| **T14** | `timetable.css` | `.tt-banner*`, `.field-error`, `.modal-head`, `.modal-md` undefined | Unstyled validation errors / modal headers | Add minimal rules using tokens from `base.css` |

**Acceptance for Phase 0:** publish a class with a 3-period lab → `SectionTimetable.slots` keys are `Day_N`, lab has `span:3,isLab:true`; `SemesterTemplate(status:'published')` exists; `Assignment` rows synced; Clear Draft works; both dashboard modals open; substitute finder only lists teachers free in the chosen period.

---

## 4. Target design

### 4.1 Sources and precedence (per teacher, per date)

```
1. Weekly template      SectionTimetable.slots (production only; drafts never reach teachers)
2. Calendar             CalendarDay.details[] (holiday | leave | vacation | exam | event → no classes;
                        half-day → periods after timing.end cancelled). Match details[].year to the
                        class year (I–IV); a detail without year applies to all.
3. Teacher leave        TeacherLeaveRequest status:'Approved' covering the date (FN/AN/Full Day)
4. Overrides            Override for classId+date+period: cancelled | substitute | room_change | holiday
5. Attendance status    ClassAttendance for classId+date with periodNumbers ∋ period
```
Later layers win. Sunday is always non-working.

### 4.2 Canonical resolved slot (what every teacher-page view consumes)

```json
{
  "key": "Monday_3",
  "date": "2026-10-05",            // absent in the weekly template
  "day": "Mon", "dayFull": "Monday",
  "classId": "66f…", "className": "II CSE A", "deptName": "CSE",
  "periodNumber": 3, "span": 1, "periods": [3],
  "start": "10:15", "end": "11:00", "timingSetCode": "SET_1",
  "subject": "DSA", "subjectName": "Data Structures", "subjectId": "66a…",
  "room": "LH 204",
  "type": "Theory",                // Theory | Lab | Activity
  "isLab": false, "combinedWith": ["II CSE B"], "combinedClassIds": ["66f…"],
  "role": "owner",                 // owner | substitute
  "status": "scheduled",           // scheduled | cancelled | substituted | holiday | leave
  "originalTeacher": null,         // set when role = substitute
  "substituteTeacher": null,       // set when status = substituted
  "overrideId": null, "leaveRequestId": null, "note": "",
  "attendance": { "marked": false, "finalized": false }
}
```
Normalization rules (accept both shapes from T1/T2/T4):
- `period`: number or `"P3"` → `3`; if missing, parse from the key suffix.
- `span = span ‖ duration ‖ 1`; `isLab = isLab === true ‖ type === 'Lab'`; `Activity` when `activityId/activityLabel` set.
- `teacher ‖ teacherName`, `room ‖ hallNo`, `subject ‖ subjectName`, `day` may be `Monday` or `Mon`.

### 4.3 Teacher identity matching
`getTeacherIdentity(user)` loads the `Teacher` doc (`trackId`, `_id`, `fullName`, `firstName`, `lastName`, `username`). A slot belongs to the teacher when **any** of:
1. `slot.teacherTrackId === trackId` (after Phase 6 backfill — preferred),
2. `String(slot.teacherId) === String(_id)`,
3. `normName(slot.teacher) ∈ names` where `normName` lower-cases, strips `Dr./Mr./Mrs./Ms./Prof.`, removes punctuation and collapses spaces.

Never use substring (`includes`) matching — "Raman" must not match "Priya Raman".

### 4.4 Period timings
Resolve the class's timing set from `TimingSet.applicableYears` using `Class.year` (accept `2`/`II`); fall back to `isDefault`. Period `start/end` come from there; a spanning slot takes the first period's start and the last period's end. The teacher page stops using `TEACHER_PERIODS` for times (keeps it only as an offline fallback).

### 4.5 FN / AN definition (⚠ decision to confirm)
Today the code disagrees: student leave uses FN = P1–P4, affected-slots FN = [1–4], free-teachers FN = p ≤ 4, but both timing sets put lunch after **P6**. Proposal: one helper `sessionOfPeriod(timingSet, p)` → `'FN'` when the period ends at or before the lunch break start, else `'AN'`, used everywhere. **Confirm whether FN should mean "before lunch" (P1–P6) or stay P1–P4.**

---

## 5. Phase 2 — Server: resolver service + teacher endpoints

### 5.1 New file `utils/teacherSchedule.js`

```js
const M = require('../models');

const DAY_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const TO_ROMAN = { '1':'I','2':'II','3':'III','4':'IV' };
const WORKING_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// ── 60s in-memory cache of production sections (invalidate on every production write)
let _prodCache = { at: 0, docs: null };
async function getProductionSections() {
  if (_prodCache.docs && Date.now() - _prodCache.at < 60000) return _prodCache.docs;
  const docs = await M.SectionTimetable.find({}).lean();
  _prodCache = { at: Date.now(), docs };
  return docs;
}
function invalidateProductionCache() { _prodCache = { at: 0, docs: null }; }

function normName(s) { /* lower, strip honorifics, punctuation, collapse spaces */ }
function parsePeriod(v, keySuffix) { /* 3 | 'P3' | key 'Monday_P3' → 3 */ }
function dayFull(d) { /* 'Mon' | 'Monday' → 'Monday' */ }

function normalizeProdSlot(key, raw, section) { /* → canonical fields of §4.2 minus date overlay */ }
function readOverrideSlot(s = {}) {        // accepts both Override shapes (T4)
  return {
    teacherName:    s.teacherName || s.teacher || '',
    teacherTrackId: s.teacherTrackId || '',
    teacherId:      s.teacherId ? String(s.teacherId) : '',
    subjectName:    s.subjectName || s.subject || '',
    room:           s.hallNo || s.room || ''
  };
}
async function getTeacherIdentity(user, trackIdOverride) { /* §4.3 */ }
function refMatches(ref, idn) { /* trackId | id | normName */ }

async function getTimingSets() { /* TimingSet.find().lean(), 60s cache */ }
function timingForClass(cls, sets) { /* §4.4 */ }
function sessionOfPeriod(set, p) { /* §4.5 */ }

/** Weekly template: every production slot owned by the teacher. */
async function buildWeeklyTemplate(idn) { /* → { timingSets, slots[] } */ }

/** Resolved days between from..to (inclusive, max 14 days). */
async function resolveTeacherRange(idn, fromISO, toISO) {
  // 1. template = buildWeeklyTemplate(idn)
  // 2. dates = every YYYY-MM-DD in range
  // 3. calendar = CalendarDay.find({ date: { $gte: utc(from), $lte: utcEnd(to) } })
  // 4. leaves = TeacherLeaveRequest.find({ status:'Approved', $or:[{teacherTrackId: idn.trackId},{teacherId: idn._id}],
  //             $or:[{ dates: { $in: dates } }, { fromDate: { $lte: to }, toDate: { $gte: from } }] })
  // 5. overrides = Override.find({ date: range, $or: [
  //             { classId: { $in: templateClassIds } },
  //             { 'newSlot.teacherTrackId': idn.trackId }, { 'newSlot.teacherId': idn._id },
  //             { 'newSlot.teacher': nameRegex }, { 'newSlot.teacherName': nameRegex } ] })
  //    nameRegex = exact, case-insensitive, escaped (^…$) for each of idn.rawNames
  // 6. substitute-in slots in classes the teacher doesn't own → fill subject/room/timing from that
  //    class's production slot (getProductionSections())
  // 7. attendance = ClassAttendance.find({ classId: { $in: classIds ∪ classTrackIds }, date: range })
  //    marked = periods[].periodNumbers ∋ period (and teacherTrackId === idn.trackId for owner slots)
  // 8. subjectId via Assignment (same class, normName(subjectName) match; prefer teacherId === idn._id),
  //    fallback Subject by code/shortName in the class's dept
  // 9. return [{ date, day, isHoliday, holidayReason, onLeave, leaveSlot, slots:[canonical…] }]
}

module.exports = {
  normalizeProdSlot, readOverrideSlot, getTeacherIdentity, refMatches,
  getTimingSets, timingForClass, sessionOfPeriod,
  buildWeeklyTemplate, resolveTeacherRange,
  getProductionSections, invalidateProductionCache,
};
```
Call `invalidateProductionCache()` from every production writer: `save-production`, `verification-requests/:id/publish-all`, `PUT /section/:classId`, `PUT /section/:classId/slot`, `versions/:id/restore` (production), and the backfill scripts.

Date handling: all ranges are UTC-day bounds built from `YYYY-MM-DD` strings; bucket overrides/attendance by `toISOString().slice(0,10)`.

### 5.2 New endpoints (`routes/timetable.routes.js`, next to `/faculty-schedule`)

| Method & path | Who | Query | Returns |
|---|---|---|---|
| `GET /api/timetable/my-timetable` | teacher (self); admin may pass `teacherTrackId` | – | `{ ok, data: { teacher:{name,trackId}, timingSets:[…], slots:[canonical, no date] } }` |
| `GET /api/timetable/my-schedule` | same | `from`, `to` (YYYY-MM-DD, ≤14 days, default today) | `{ ok, data: { days:[{ date, day, isHoliday, holidayReason, onLeave, leaveSlot, slots:[…] }] } }` |

Handler rules:
- `if (!['teacher','admin'].includes(req.user.role)) return 403`.
- Validate dates with `/^\d{4}-\d{2}-\d{2}$/`, reject ranges > 14 days (400).
- Production only; never read development templates.
- Read-only → no `logAction`.

### 5.3 Rebuild existing readers on the resolver
- `GET /api/timetable/resolve/:classId/:date` (T13) and `GET /api/timetable/free-teachers` (T5): build from `getProductionSections()` + overrides + leave via the shared helpers. Keep their response shapes.
- `GET /api/leave/affected-slots` → Phase 5.

**Acceptance:** for a teacher with 3 production slots on Monday, `my-timetable` returns 3 slots with correct timing-set times; `my-schedule` for a holiday date returns `isHoliday:true`; a substitute Override naming the teacher returns an extra `role:'substitute'` slot; the original teacher's slot shows `status:'substituted'`.

---

## 6. Phase 3 — 📅 My Schedule linked to production

`public/js/pages/teacher.page.js`
1. Replace `syncMyTimetable()` with:
   ```js
   function syncMySchedule(weekOffsetDays) {
     // 1) GET /api/timetable/my-timetable  → DB.set('timetable', data.slots.map(normalizeScheduleSlot))
     //                                       DB.set('timing-sets', data.timingSets)
     // 2) GET /api/timetable/my-schedule?from=<Mon>&to=<Sat of next week>
     //                                     → DB.set('schedule-days', { [date]: day })
   }
   function getMyDay(dateISO) { /* cached day, or fetch my-schedule?from=date&to=date then re-render */ }
   ```
   `getMyTimetable()` / `normalizeScheduleSlot()` already exist (Phase 1) — only the loader changes.
2. **Week View** (`renderSchedulePage`): iterate the 6 dates, read `getMyDay(date).slots`. Status chips: `Cancelled` (grey, struck), `Substituted → <name>` (amber), `Substitute for <name>` (purple border), `Holiday`/`On leave` column banner (`.wk-holiday`). Prev/Next fetches the new week on demand.
3. **Day View**: same data for one date; show the `note` from overrides.
4. **My Timetable grid**: from the weekly template; column headers from the teacher's primary timing set (the one most of their slots use). Cells show `start–end` when a slot's own timing set differs.
5. **Read-only for teachers.** Remove "＋ Add Slot", empty-cell "+", Edit and Delete for everyone. Coordinators (`isTimeTableCoordinator`/HOD/admin) get "✏ Edit in Timetable workspace" → `timetable.html`. Slot popover actions become: *Take attendance* (today only), *Request substitute* (→ Apply for Leave pre-dated), *View class timetable* (coordinators).
6. **Calendar dots** from the template; a red dot for dates with `status:'substituted'`/leave, purple for substitute duties (from cached days).
7. Delete `TEACHER_PERIODS`-based labels from the Take-Attendance period select and the old slot modal; build options from `DB.get('timing-sets')` (keep `TEACHER_PERIODS` only as offline fallback).
8. Legacy `Timetable` collection: stop reading it from the teacher page. Leave the API in place for one release; mark deprecated in `CHANGELOG.md`.

**Acceptance:** a teacher with production slots sees them in Week/Day/Grid with correct times; a coordinator publishing a change is reflected after refresh (≤60 s cache); no Add/Edit/Delete controls for plain teachers.

---

## 7. Phase 4 — 🕐 Today's Schedule + ✅ Take Attendance auto-popup

### 7.1 Today's Schedule card (`renderTodaySchedule`)
Data: `getMyDay(todayISO())`. Per slot state, recomputed every 30 s:
| State | Condition | UI |
|---|---|---|
| `upcoming` | now < start − lead | time + "in 25 min" |
| `live` | start − lead ≤ now < end | green pulse "NOW", primary **Take Attendance** |
| `pending` | now ≥ end, not marked | amber "Attendance pending" + button (until `maxAttendanceBackdateDays` / `autoLockAttendanceHours` from settings) |
| `done` | `attendance.marked` | ✅ Done (faded) |
| `cancelled` / `substituted` / `holiday` / `leave` | from resolver | struck/greyed with reason; no button |
| `substitute` | `role:'substitute'` | purple "Substitute for <name>" + button |

Header shows "Next: P4 · III CSE B in 12 min" when nothing is live.

### 7.2 LiveSlotWatcher (auto-popup)
New block at the end of `teacher.page.js`:
```js
var LiveSlotWatcher = (function () {
  var TICK_MS = 30000, timer = null;
  function key(date, slot) { return 'eams_slotprompt_' + date + '_' + slot.classId + '_' + slot.periodNumber; }
  function isBusy() {           // never interrupt an attendance flow
    return document.getElementById('attsheet').style.display === 'block'
      || ['modal-quick-pass','modal-qr-session','modal-rep-share','modal-qr-review']
           .some(function (id) { var m = document.getElementById(id); return m && m.style.display === 'flex'; })
      || !!document.querySelector('.modal-bg.open');
  }
  function candidates() { /* today's slots: role owner|substitute, status scheduled, !attendance.marked,
                              start - lead ≤ now < end, not dismissed, snoozeUntil < now */ }
  function tick() {
    if (document.visibilityState !== 'visible' || isBusy()) return;
    if (!prefs().autoAttendancePrompt) return;
    var due = candidates(); if (due.length) openPrompt(due);
  }
  function start() { if (!timer) { tick(); timer = setInterval(tick, TICK_MS); } }
  document.addEventListener('visibilitychange', tick);
  return { start: start, tick: tick };
})();
```
- Start after the first successful `syncMySchedule()` in `bootApp()`.
- Dismiss / snooze state lives in **sessionStorage** (project convention) — `{dismissed:true}` or `{snoozeUntil:<ms>}`.
- Combined classes / multi-period labs → one prompt listing every class.

### 7.3 Prompt markup (`public/teacher.html`, before `<div class="toast">`)
```html
<div class="modal-bg" id="m-live-slot" role="dialog" aria-modal="true" aria-labelledby="mls-title">
  <div class="modal msm">
    <div class="modal-hd">
      <div><div class="modal-title" id="mls-title">✅ Class starting now</div>
           <div class="modal-sub" id="mls-sub">P3 · 10:15–11:00 · LH 204</div></div>
      <button class="modal-close" onclick="LiveSlotPrompt.close('dismiss')" aria-label="Close">✖</button>
    </div>
    <div class="mbody" id="mls-body"><!-- class · subject · role badge · student count --></div>
    <div class="modal-actions" style="flex-wrap:wrap;">
      <button class="btn-form-ghost" onclick="LiveSlotPrompt.close('snooze')">⏰ Remind in 5 min</button>
      <button class="btn-form-ghost" onclick="LiveSlotPrompt.method('rep')"  id="mls-rep">👥 Rep Share</button>
      <button class="btn-form-ghost" onclick="LiveSlotPrompt.method('qr')"   id="mls-qr">📷 Scan Live</button>
      <button class="btn-form-ghost" onclick="LiveSlotPrompt.method('code')" id="mls-code">🔢 Quick Pass</button>
      <button class="btn-form-pri"   onclick="LiveSlotPrompt.method('manual')">📋 Take Attendance</button>
    </div>
  </div>
</div>
```
`LiveSlotPrompt.method(m)`:
1. `navigateToAttendance(classId, subjectId, periodNumber, today)` (already accepts period/date since Phase 1).
2. After the prefill settles, `m === 'manual' ? loadAttendanceSheet() : triggerAttendanceMethod(m)` — the **existing** flows, so every server guard still applies.
3. Hide method buttons disabled by public settings (`quickPass`, `liveSessions`, `forwardToRep`) using the same checks as the method cards.
4. Esc closes (= dismiss); focus the primary button on open; `aria-live` not needed (modal).

### 7.4 Substitute teachers can actually mark (server, security-sensitive)
Today `verifyTeacherAssignment` (utils/assignmentAuth.js) rejects a substitute because they aren't assigned to that class/subject — Quick Pass, Scan Live, Rep Share and manual save would all return 403.
- Add an optional 4th argument `{ date, periodNumber }`. When the assignment check fails, allow **only** if an `Override` exists with `type:'substitute'`, the class (any of `_id`/`classTrackId`), that UTC date, that period, and `readOverrideSlot(newSlot)` matching the user (`refMatches`). Return `{ allowed:true, via:'substitution', overrideId }`.
- Pass `{date, periodNumber}` from the four call sites: `attendance.routes.js` 692 (+535/589 updates), `quickPass.routes.js` 52, `liveSession.routes.js` 49, `repShare.routes.js` 68.
- `logAction(..., { module:'attendance', subType:'substitute-mark', overrideId })` when `via === 'substitution'`.
- Verify both cases: substitute allowed for that exact period; same teacher denied for the next period / another date.

Client: when prefilling a substitute slot, if the class/subject isn't in the teacher's dropdowns, insert a temporary `<option data-sub="1">` labelled "(Substitution)"; remove it on `resetAttendanceView()`.

### 7.5 Preferences
- `models/user.model.js` (Teacher `preferences`): add `autoAttendancePrompt: { type:Boolean, default:true }`, `promptLeadMinutes: { type:Number, enum:[0,5,10], default:5 }` (additive).
- `routes/profile.routes.js` PUT `/me`: whitelist exactly these two keys (the current `{...updates.preferences}` spread is dropped by strict mode for unknown keys — keep it explicit).
- Profile page "Preferences & Defaults": a checkbox + lead-time select, saved by `saveTeacherPreferences()`.

### 7.6 Take Attendance page
- "Today's classes" chip strip above the selectors (from `getMyDay(today)`); clicking a chip pre-fills class/subject/period/date.
- If the chosen class/period isn't in today's schedule, show a soft warning banner ("Not in your timetable today — continue?"). Optional server echo: a new setting `attendance.timetableMatch: 'off' | 'warn' | 'block'` (default `'warn'`) — add to `config/defaultSettings.js`, read via `getSettings`, call `invalidateSettingsCache('attendance')` on change; `'block'` returns 403 from the mark endpoints. Ship as `'warn'`.

**Acceptance:** at P3 start (± lead) the prompt appears once; snooze re-prompts after 5 min; dismiss never re-prompts that period; no prompt while a sheet/session modal is open, for cancelled/substituted/holiday/leave slots, or once attendance is marked; substitute can complete Quick Pass for their period and is refused for any other.

---

## 8. Phase 5 — 🏖 My Leaves & Substitutions linked

1. **Affected slots** (`routes/leave.routes.js` `GET /affected-slots`): replace the legacy `Timetable` query with `resolveTeacherRange(idn, from, to)`; keep only `role:'owner'` and `status:'scheduled'`; filter FN/AN with `sessionOfPeriod` (§4.5); include `classId`, `subjectName`, `start/end` from the timing set, `slotKey`. Fixes T12.
2. **Apply** (`POST /teacher/apply`): server re-validates each submitted substitution against the resolver (the slot must exist and belong to the applicant on that date/period); reject unknown slots with 400. Fix HOD lookup (T11).
3. **HOD approve** (`PUT /teacher/:id/hod-approve`): write overrides through `buildOverrideSlot()` (both field spellings, T4), UTC date, `period = sub.periodNumber`, `requestId`. Overrides are never cached — the resolver reads them fresh on every call, so no invalidation is needed here.
4. **My Substitution Duties tab** (`renderTeacherSubstituteDuties`): `GET /api/timetable/my-schedule?from=today&to=today+13` → slots with `role:'substitute'`; "Take Att." only for today and wired to `navigateToAttendance(classId, subjectId, periodNumber, date)` (the current code passes an empty subjectId).
5. **Applicant's own schedule**: approved leave → slots show `status:'leave'` (or `substituted` with the substitute's name) in Week/Day/Today; no popup for them.
6. **Popups for this module** (reuse LiveSlotWatcher's prompt with a different header): "You're substituting for <name> in P5 · III CSE B today" on first load of a day with duties; leave approved/rejected already arrive via notifications — make the notification click open My Leaves.
7. Remove the stop-gap message added in Phase 1 once the tab reads `my-schedule`.

**Acceptance:** applying for a date with 2 production periods lists exactly those 2; HOD approval makes them show as substituted for the applicant and as substitute duties (with working attendance) for the substitute; free-slot finder never offers a teacher who is teaching or on leave that period.

---

## 9. Phase 6 — Make links ID-based (data backfill)

1. Timetable workspace: when a teacher is picked in the entry modal, store `teacherTrackId` and `teacherId` alongside `teacher` (name). `entriesToGrid()` and `flattenSlots()` carry them; `GridSlotSchema` gains `teacherId`, `teacherTrackId`, `subjectId` (additive, optional).
2. `scripts/backfillSlotTeacherIds.js` — for every `SectionTimetable` (and published `SemesterTemplate`), resolve `slot.teacher` names → Teacher via exact `normName` match; **dry-run by default** printing matched / ambiguous / unmatched; `--apply` writes `teacherTrackId`/`teacherId`, then calls the cache invalidation. Ambiguous or unmatched names are reported, never guessed.
3. Once coverage is 100 %, the resolver prefers IDs; name matching remains as fallback.

---

## 10. Security & invariants checklist (review every phase)

- [ ] New routes behind `authMiddleware`; role check teacher/admin; admins only may pass `teacherTrackId`.
- [ ] All query params sanitized; date regex validated; 14-day cap.
- [ ] No development/draft data returned to teachers.
- [ ] Substitute authorization is exact (class + date + period + identity) and logged.
- [ ] Popup never calls attendance endpoints directly; it only pre-fills and invokes existing flows.
- [ ] No weakening of rate limiters, QR rotation, Rep-Share headcount, `isFinalized` flow.
- [ ] User-supplied text escaped before `innerHTML` (names, reasons, notes, room labels).
- [ ] New settings key added to `config/defaultSettings.js`; `invalidateSettingsCache` on mutation.
- [ ] Schema changes additive; backfill scripts dry-run by default.

---

## 11. Verification plan

**Static:** `node --check` on every changed JS file; `node -e "require('./utils/teacherSchedule')"`.

**API (per endpoint):** success, 400 (bad date / >14 days), 401 (no token), 403 (student / non-admin passing `teacherTrackId`).

**Fixture scenario (seed a dev DB):** 1 teacher, 2 classes (years II and III → SET_2 and SET_1), a 3-period lab crossing the tea break, a combined class, a CalendarDay holiday for year II only, one cancelled override, one coordinator substitute, one HOD-approved leave with a substitute.

| Scenario | Expected |
|---|---|
| Week view, normal week | Slots at timing-set times; lab spans 3 periods across the break |
| Holiday for year II only | Only year-II class slots show Holiday |
| Coordinator substitute (T4 shape) | Original: "Substituted → X"; X: "Substitute for …" with working attendance |
| Approved leave (FN) | FN slots "On leave", AN slots normal (per §4.5 decision) |
| Auto-popup | Appears at start − lead; snooze/dismiss honoured; not while a session is open |
| Marked attendance | Card shows Done; popup suppressed |
| Deep links | `?tab=sched`, `?tab=my-leaves` render populated |

**Browser matrix:** 1440, 1280, 1024, 768, 480, 390 px — no horizontal overflow, no console errors. Note: `CLAUDE.md` says Playwright is not installed, but `package.json` lists `@playwright/test` and `scratch/` has Playwright scripts — reconcile this.

---

## 12. Rollout order & effort

| Order | Phase | Main files | Size |
|---|---|---|---|
| 1 | Phase 0 (T1–T14) | timetable.page.js, timetable.css, timetable.routes.js, leave.routes.js, `scripts/normalizeProductionSlots.js` | M |
| 2 | Phase 2 resolver + endpoints | `utils/teacherSchedule.js`, timetable.routes.js | M–L |
| 3 | Phase 3 My Schedule | teacher.page.js, teacher.html, teacher.css | M |
| 4 | Phase 4 Today + popup + substitute auth | teacher.page.js/html/css, utils/assignmentAuth.js, 4 attendance routes, user.model.js, profile.routes.js, defaultSettings.js | L |
| 5 | Phase 5 Leaves & Subs | leave.routes.js, teacher.page.js | M |
| 6 | Phase 6 backfill | timetable.page.js, timetable.model.js, `scripts/backfillSlotTeacherIds.js` | S–M |

## 13. Open decisions (need your answer before Phase 2)

1. **FN/AN boundary** — before lunch (P1–P6 in both seeded timing sets) or keep P1–P4?
2. **Popup window** — default lead time 5 min, and should an unmarked period keep a "pending" reminder after it ends (until the backdate limit), or only prompt during the class?
3. **Teacher self-editing** — confirm My Schedule becomes read-only for teachers (edits only through the Timetable workspace + HOD approval).
4. **Timetable-match enforcement** — ship `attendance.timetableMatch` as `'warn'` (recommended) or `'off'`?
