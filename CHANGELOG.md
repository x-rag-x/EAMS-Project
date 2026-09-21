## 🔹 `v2.3.3` — 21 September 2026 *(Security Hardening & Authorization Overhaul)*

### *Encryption & Security*
- **Stronger Encryption (`utils/qrCrypto.js`)**: Upgraded encryption from AES-256-CBC to AES-256-GCM, which also verifies data hasn't been tampered with. Old encrypted data is still readable through automatic backward compatibility.
- **No More Default Keys**: Removed all hardcoded fallback encryption keys. `LOG_ENCRYPTION_KEY`, `SID_ENCRYPTION_KEY`, and `QRID_ENCRYPTION_KEY` must now be set in environment variables — the server won't start without them.
- **No Hardcoded QR Secret**: Removed the static `'eams_default_qr_secret'` fallback. All QR code generation now strictly requires an active, random session secret.
- **Secure ID Generation**: Session track IDs now use proper cryptographic random generation instead of `Math.random()`, making them unpredictable.

### *Authorization & Access Control*
- **Role Checks on Attendance APIs**: Attendance marking and updating endpoints now only allow teachers and admins — students can no longer directly call these APIs.
- **Teacher-Subject Verification**: Before marking or editing attendance, the system now checks that the teacher is actually assigned to that class and subject (admins are exempt).
- **Token Query String Blocked (`middleware/auth.js`)**: Tokens must now only be passed in `Authorization: Bearer` headers; query parameters (`?token=`) are rejected to prevent sensitive tokens from leaking into browser history or logs.
- **Location-Denied Protection (`routes/auth.routes.js`)**: The `/api/auth/location-denied` endpoint now requires a verified pre-authentication token or valid password before locking an account, closing the denial-of-service lockout vulnerability.
- **Attendance Edit Lock**: Institutions can now set a time window (e.g., 6 hours) after which attendance records automatically lock and can't be edited by teachers.
- **Period Author Verification**: Only the teacher who originally marked a period can edit it, unless the other teacher is also assigned to that class.
- **Privilege Escalation Protection (`routes/users.routes.js`)**: Teacher-admins can no longer grant themselves more admin rights or special designations — only full admins can change these fields.
- **New `requireRole` Middleware (`middleware/auth.js`)**: A reusable middleware to check user roles at the route level.
- **Timetable Edit Protection (`routes/timetable.routes.js`)**: Only coordinators and admins can create, edit, or delete timetable slots.

### *Live Session & QR Attendance Security*
- **Device ID Required**: Both passcode and QR attendance now require a device identifier — without it, the request is rejected. This prevents one student marking attendance for another.
- **Input Bounds & Coordinate Validation**: Added string length caps and latitude/longitude range limits (-90 to 90, -180 to 180) across all live attendance submission endpoints.
- **Location Radius Check (`routes/qrAttendance.routes.js`)**: QR attendance now checks if the student's GPS location is within 200 meters (configurable) of the classroom. If too far, attendance is rejected.
- **Location is Now Mandatory**: Previously, missing location data was silently allowed. Now it fails the verification.
- **Mode Mismatch Blocked**: If a session is set to passcode mode, QR submissions are rejected and vice versa.
- **Session Ownership Checks (IDOR Fixes)**:
  - Teachers can only view status, end, or see participation for their own live sessions.
  - Quick Pass end and save-draft now verify the teacher owns that session.
  - Rep Share view, submit, draft review, and cancel all check that the user is the assigned teacher or rep.
- **QR Image Generation Now Protected**: The QR code image endpoint now requires login and rate limiting — it was previously open to anyone.
- **Live Session Model Updates (`models/system.model.js`)**: Added location fields (`latitude`, `longitude`, `maxRadiusMeters`) for classroom geofencing. Each marked student now tracks `deviceId` and `source` (whether they used code, QR, or passcode).

### *XSS Prevention & Server Headers*
- **HTML Escaping (`public/js/core/session.js`)**: Added a global `escapeHtml()` function that sanitizes special characters before inserting user content into the page, preventing script injection attacks. Added to all portal pages.
- **Grievance Content Sanitized (`teacher.page.js`)**: Grievance subject, status, category, and detail text are now properly escaped before display.
- **Hardened Server Security Headers (`server.js`)**: Removed `'unsafe-eval'` from CSP script sources, restricted resource sharing to `same-origin`, and made reverse proxy trust conditional (`TRUST_PROXY` or production environment).

### *Rate Limiting & Defensive Controls*
- **Attendance Marking**: Limited to 60 requests per 5 minutes per IP address.
- **Attendance Updates**: Limited to 60 requests per 5 minutes per IP address.
- **Login & Location Rate Limiting**: Added `loginLimiter` protection to `/location-denied` and established a reasonable 100-request development floor.
- **Database Backup Protection**: Applied critical rate limiting to system database backups.

### *Data Model & Performance*
- **Attendance Model (`models/attendance.model.js`)**: Added `overallPercentage` field and faster database indexes on class and date combinations.
- **Batch Support in Student Routes (`routes/students.routes.js`)**: Creating and editing students now supports the `batch` field alongside `batchTrackId`. If batch isn't provided, it's automatically pulled from the class. Filtering students by batch now searches across multiple related fields.
- **Student Period Notes (`routes/attendance.routes.js`)**: Students can now view period notes, but only for their own class — they can't see other classes' data.
- **Location Cache (`utils/reverseGeocode.js`)**: Added an in-memory cache (up to 500 entries) for location lookups, so the same area doesn't trigger repeated external API calls.
- **Settings Query Sanitization (`routes/settings.routes.js`)**: Bounded pagination (`page`, `limit` capped at 100) and escaped search query characters.
- **Safe Database Seeding (`config/db.js`)**: Added safety guards to prevent crashes or insecure accounts if default passwords are not configured in `.env`.

### `Total 43 Files changed and updated in v2.3.3`


## 🔹 `v2.3.2` — 16 September 2026 *(Complete Attendance Implementation)*

### *Multi-Modal Live Attendance Suite (QR, Quick Pass & Rep Share)*
- **Dynamic Rotating QR Attendance (`attendance.html`, `routes/qrAttendance.routes.js`, `utils/qrCrypto.js`)**:
  - Implemented real-time dynamic QR code generation powered by backend buffer encoding (`/api/qr-attendance/generate-qr`).
  - Cryptographically secured rotating QR tokens generated via HMAC-SHA256 with configurable rotation intervals (default 20s) and a 2-second grace period (`DEFAULT_GRACE_PERIOD_SEC`).
  - Interactive Teacher Live Session dashboard with animated rotation countdown ring, rotation indicators, and live participant roster with instant "Apply & Save" integration.
  - Multi-factor verification pipeline for student check-ins (`/api/qr-attendance/submit`): active session validation, token expiration with grace period fallback, strict physical device fingerprinting (`deviceId`) to block proxy attendance on shared phones, and geolocation verification.
- **12-Character Alphanumeric Quick Pass (`routes/quickPass.routes.js`)**:
  - Introduced Quick Pass passcode attendance mode generating 12-character uppercase alphanumeric codes (`generate12CharCode`).
  - Automatic time-based code rotation across customizable rotation windows with live countdown timers.
  - Campus Wi-Fi & IP restriction enforcement (`college_ips` setting) preventing off-campus check-ins.
  - Live student attendance counter and classroom headcount synchronization.
- **Class Representative Attendance Delegation (Rep Share) (`routes/repShare.routes.js`)**:
  - Teacher can delegate period attendance marking to designated Class Representatives (`isRep: true`).
  - Automated high-priority notification sent to the student representative with a dedicated Rep Attendance interface in `student.html`.
  - Anti-fraud verification check: requires the representative to enter a verified physical classroom headcount that must strictly match the count of marked present students before submission.
  - Complete review & finalize lifecycle: Representative submits draft → Teacher reviews draft roster, adjusts remarks, and finalizes with automatic notification dispatch.
- **Unified Live Attendance Check-in Portal (`public/attendance.html`)**:
  - Dedicated, responsive check-in page featuring a clean mode switcher between Quick Pass and QR Scanner.
  - 12-box auto-advancing OTP input with copy-paste restriction, active session verification banners, and immediate status feedback.

### *Next-Generation Timetable Studio*
*Current timetable version is not a complete/finished. It is filled with css brakes, broken page, bug filled. The `v2.3.3` will stage the complete version of time table. Currently this is forced commit fot time table.*

### *Institutional Export & Report Center (`public/export.html`, `routes/export.routes.js`, `models/export.model.js`)*
- **Dedicated Centralized Export Hub**:
  - Complete standalone reporting and export portal accessible across Admin, Teacher, and Controller portals.
- **Modular Report Generation**:
  - **Student Reports**: Student complete dossier, term-wise attendance history, leave & permission logs, and low-attendance defaulters warning letters.
  - **Class Reports**: Monthly & semester attendance registers, daily period attendance sheets, and consolidated class summaries.
  - **Subject & Faculty Reports**: Subject attendance registers, period-wise syllabus coverage & teaching notes logs, and faculty workload compliance reports.
  - **Department Reports**: Department overview, year-wise comparative performance, and institution-wide attendance analytics.
- **Automation, History & Saved Templates**:
  - Save custom filter configurations as reusable templates (`ExportTemplate`).
  - Pre-generation preview calculating estimated record counts and file sizes.
  - Background export tracking (`ExportHistory`) with unique `TR-EXP-XXXXXX` tracking IDs and direct download endpoints.

### *Performance Optimization & Infrastructure Hardening*
- **In-Memory Settings Caching (`utils/settingsCache.js`)**:
  - Introduced an in-memory cache with 60-second TTL for system settings (`pages`, `security`, `attendance`, `maintenance`), reducing database queries by up to 90% across authentication and middleware guards.
- **Write-Throttled Session Activity Monitoring (`middleware/auth.js`)**:
  - Throttled database writes to MongoDB `LoginHistory` (at most once every 60 seconds per session), eliminating severe database write pressure and connection lockups.
- **Transient Connection Resilience**:
  - Added robust connection error handling in authentication middleware (`MongoServerSelectionError`, `MongoNetworkError`, `ECONNRESET`), responding with clean 503 status codes instead of unhandled crashes.
- **Database Migration Clean-Up**:
  - Deprecated legacy string-date migration script in `utils/dbMigrator.js` in favor of standard BSON Date objects across all collections.
- **Security & CSP Updates (`server.js`)**:
  - Updated Content Security Policy (CSP) headers in Helmet to permit localhost/127.0.0.1 image sources for local development and offline QR rendering.

### *Portal Refinements & User Experience Enhancements*
- **Teacher Portal (`public/teacher.html`, `public/js/pages/teacher.page.js`)**:
  - Added "Attendance Insights" view, "My Leaves & Subs" management, and Export Center shortcut.
  - Interactive Weekly Timetable Card with visual badges for Theory, Lab, Combined, and Substitute assignments, plus PDF export.
  - Integrated live multi-method attendance launcher (Manual Roster, Rotating QR, Quick Pass, Rep Share).
- **Student Portal (`public/student.html`, `public/js/pages/student.page.js`)**:
  - Added "Mark Attendance" quick action linking to the live attendance portal.
  - Live Ongoing Session Banner alerting students in real-time when Quick Pass or QR Attendance is active for their class.
  - Dedicated Class Representative Attendance view for delegated period marking.
- **Admin Console & Controller Hub (`public/admin.html`, `public/controller.html`)**:
  - Added direct shortcuts to the Export Center in sidebar navigation.
  - Added Period Records & Teaching Notes search filtering by topic, syllabus notes, and faculty.
  - Refined Executive Principal and HOD role management modals.
- **Manage Page (`public/manage.html`)**:
  - Added Semester Dates Configuration within the Academic Year modal (defining semester start and end dates for timetable calculations and reporting).
- **Workspace Hub (`public/selector.html`, `public/js/pages/selector.page.js`)**:
  - Added Export & Report Center portal card with role-based access checks.
  - Dynamic institutional branding across headers, page titles, and footers.

### `Total 107 Files changed and updated in v2.3.2`

----------------------------------

## 🔹 `v2.3.1` — 24 August 2026 *(Features Implementation)*

### *General Changes & Updates*
- Implementation of **Selector HTML** file for teacher login. Sub-Admin features and whole admin feature access updated and linked with teacher portal. Teacher with `adminRights` can have access to admin featured pages via `selector.html`.
- Added personal `defaultAttendanceStatus` (`Present`/`Absent`/`Unmarked`) in teacher profile to pre-fill roster sheets during attendance marking.
- Each class menu now contains Add Class Advisor option.
- Logout animations, when logout button is clicked it disable all other buttons clicks and opens a Green layer to prevent further clicks.
- Added teacher notes/topic for each class.

### *Security Improvement*
- Centralized rate limiters for sensitive endpoints.
- Created validatePassword checking minimum 8 characters, uppercase, lowercase, digit, and special character.
- Added `passwordHistory` field to AdminSchema, TeacherSchema, and StudentSchema. Users are prevented from reusing their last 5 passwords. 
- Optimised Session monitor. Inactivity session timeout and automatic concurrent session termination.
- **New Settings Hub (`settings.html`)**: Centralized 9-tab configuration center covering Institution branding, Pages & Portals, Attendance policies, Feature models, Academic config, Security/Auth rules, Broadcast defaults, Change History, and System Utilities with factory reset.
- **Tri-State Portal Access**: Universal 3-state control (`Enabled`, `Disabled`, `Hidden`) for all portals. Disabled portals display a `🔒 Disabled` badge and reject access with `403 Forbidden`; hidden portals are completely removed from UI and navigation.
- **Change History & Audit Trail**: Real-time immutable logging tracking every setting modification with before/after diffs, author identity, IP, and timestamps.
- **Mandatory Location on Sign-In**: Sign is only allowed when geolocation is accepted, id denied immediate blocking. By enabling this users location is identified for security reasons and attendance marking.

### *Leave & Permission Management*

- Implemented the full end-to-end Student Leave & Permission Management workflow across the Admin, Student, and Teacher portals. Students can choose between Full Day Leave and Half Day Permission (FN - Forenoon / Morning, AN - Afternoon, or custom period range). Period attendance auto-marking will smartly flag students.

### *User Grid Management*
- **Full CRUD & Role-Specific Modal Editing**: Refactored edit modal to align with Admin design standards (`.form-grid`, `.fc2`, `.fl`, `.fg`, `.auto-txt`, `.auto-block`). Full field support across Students (Register No, Department auto-dropdown, Class auto-dropdown, Section, Course Level, Branch, Admission Year, Batch Track ID, Representative flag), Faculty (Employee ID, Department, Designation, Default Attendance Status, Sub-Admin toggle, granular 9-point privilege matrix), and Admins with automatic first/last name splitting.
- **Enhanced Actions Bar with Labeled Buttons**: Expanded action column to 330px with clear, styled text buttons (`✏️ Edit`, `🔑 Password`, `⚡ Deactivate` / `🟢 Activate`, `🔓 Unlock`, `🗑️ Delete`) styled to match Admin action layouts.
- **Status Toggling & Safe Soft-Delete**: Instant inline active/inactive status toggle and custom EAMS small confirmation dialog for deletion capturing pre-deletion snapshots in `M.UndoLog` (Recycle Bin) for 10-day recovery.
- **Attendance Record Audit & Edit**: Complete attendance grid enabling filtering by date range, department, class, and status; in-place attendance status modification (`Present`, `Absent`, `OD`, `Leave`) and period remarks with automatic student attendance counter re-synchronization.

### *Improved Activity Logs Management*
- **Logs Page**: Removed activity logs navigation and implemeneted a new `logs.html` file.
- All logs contains a unique `trackId` for tracking and built with AES-256-GCM Encryption.
- Each log audit is now clickable to open a Detail log information with multiple features.
- `LoginHistorySchema` updated with `location` and `logoutMethod`. 
- Extend LogSchema with logTrackId, encryptedPayload, sessionData, changes, attendanceSummary, actingWithAdminRights, module, subType.
- Login and logout are recorded as one single log entry. When a user logs in, the entry is created. When the user logs out (manual, timeout, or forced), the same log entry is updated with `logoutTime`, `logoutMethod: 'manual'`. 
- One log per student per day. As subsequent periods are marked throughout the day, the existing daily log is updated (updatedAt: new Date()) with the new period statuses.

### *HOD and Principal Logins v1* 
- Implemented HoD and Principal login methods to EAMS. Special features with respective to their role have been added. 

- **HOD**: Teacher role based user with isHod field true. Department-scoped oversight & approvals. Department wise stats and operation are controlled and managed. Access to `controller.html` page and `teacher.html`

- **Principal**: Admin role user with adminFlag: 'principal' → College-wide oversight & institutional governance. Access to `controller.html` page. Overall collage level management. 

- `controller.html` - Dashboard, Attendance Overview, Leave Approvals,  Faculty Overview, Student Directory, Period Records & Teaching Notes, Defaulters Report, Attendance Reports & Analytics, Broadcast Hub, Academic Calendar, Timetable View.

### `Total 90 Files changed and updated in v2.3.1`

----------------------------------

## 🔹 `v2.3` — 14 August 2026 *(Frontend Restructure)*

### *Changes of Frontend Restructure*
A complete rotation of code and file restructure. This adds an additional important security.

- All HTML files moved to `public/` folder, and each file's css and js are separated from main html file.
- Updated backend for frontend changes.
- Moved `CHANGELOG.MD` again to main directory.
- Modified entire `/models` dir, a complete restructure.
- Moved `start.js` to `scripts/` and its now available publicly.

### *General Changes & Fixes*
- Improved Session Monitor and Logins
- Improved Loading time and restructured API Calls in admin page.
- Replaced the 11 parallel full-collection fetches at startup in admin.page.js with fetching only counts
- `JWT_SECRET` default fallback removed (security)
- New auth endpoints: `/report-unknown`, `/verify-password`, full `/login-history`
- Admin page loading toasts + dashboard `/counts`

### `Total 63 Files changed and updated in v2.3`

----------------------------------

## 🔹 `v2.2.9` — 18 July 2026 *(Performance Improvement Update)*

### *V1 Changes of Performance Improvement*

- **Frontend (`admin.html`, `teacher.html`)**
    - Dashboard: split init into fast path + deferred widgets (attendance-overview, defaulters, unmarked-teachers) with `AbortController` 8s timeout & per-widget retry.
    - Students: cascade filter (year → batch → dept → class → section), Show List always enabled, default sort by `regNo`, limit=65, client-side live search, column sort triggers server re-fetch.
    - Teachers: dept dropdown uses `_id`, GET filtered by `?deptId=` param.
    - Reports/Analytics: date range gate on all three report generators.
    - Activity Logs: cursor-based pagination (initial 50, Load More via `?before=`), switched to `_logData` array instead of `DB.get('logs')`.
    - Classes/Subjects: `openCD` uses roster mode (`?classId=X&roster=1`), `studentCount` shown from server-side aggregation.
    - ETA: dropped localStorage history persistence; now computed live from current-session task durations.

- **Backend (`routes/*.js`)**
    - `students.routes.js`: response shape changed to `{data, total, page, hasMore}`, academic year format auto-conversion (`2025-2026` → `2025-26`).
    - `logs.routes.js`: sort/filter/cursor uses `createdAt` instead of `time`.
    - `teachers.routes.js`: GET supports `?deptId` (ObjectId) and `?dept` (code).
    - `attendance.routes.js`: filter-required guard + selective student query (only referenced `studentTrackId`s).
    - `dashboard.routes.js`: `/summary` wrapped in try/catch.

- **Database Models (`models/*.js`)**
    - Added 14 indexes across Student, Teacher, Class, Subject, Assignment, Log schemas.
    - TeacherSchema: added `deptId` and `deptCode` fields.
    - LogSchema: added `{createdAt: -1}` index.

- **Migration (`scripts/backfillTeacherDeptId.js`)**
    - One-shot migration that matches `Teacher.department` (case-insensitive) against `Department.name/code/threeLetterCode` and sets `deptId`+`deptCode`.

- **Utilities (`utils/logAction.js`, `start.js`)**
    - `logAction` fixes for new field names.
    - `start.js`: `addTeacher`/`addAdmin`/`addStudent` now create `User` entries; `_demoTeachers` sets `deptId`/`deptCode`; removed `password` from User.create params.

*Still multiple bugs and fixes to be made. Cureently version 1 of improvement is done*

### `Total 19 Files changed and updated in v2.2.9`

----------------------------------

## 🔹 `v2.2.8` — 12 July 2026 *(Security & Enhancement Update)*

### *General Changes & Fixes*

- `routes/auth.routes.js` & `middleware/auth.js`
    - Added express-rate-limit middleware to `/login` endpoint (10 attempts per IP per 15 minutes).
    - Implemented automatic account lockout after 3 failed attempts (15-minute timeout).
    - Fixed `authMiddleware` to use freshly-queried user document instead of stale JWT payload for real-time permission checks.
    - Improved Bearer token validation with proper scheme checking.
    - Added current-password verification to password change endpoint.
    - Enhanced error handling with generic "Invalid credentials" message (prevents username enumeration).
    - Added `mustChangePassword` field to login response for forced password change flow.

- `models/users.models.js` & `models/features.models.js`
    - Added `select: false` to password fields on Admin/Teacher/Student schemas.
    - Enhanced LoginHistory schema for lockout attempt tracking and timestamps.
    - Token hashes (SHA-256) stored instead of plain JWT strings.

- `config/index.js`
    - Removed hardcoded default password fallbacks. Now requires explicit environment variable configuration.

- `routes/students.routes.js`, `routes/users.routes.js`, `routes/profile.routes.js`
    - Fixed password hash exposure in `GET /api/students` endpoint.
    - Added NoSQL injection prevention with query parameter sanitization.
    - Fixed `new RegExp()` crashes with input escaping and try/catch protection (6 locations).
    - Corrected broken `'Manage User'` authorization checks (3 locations).
    - Fixed `isTimeTableCoordinator` permission detection.

- `server.js`
    - Hardened CORS configuration: changed from `origin: true` to explicit allow-list in production.
    - Improved error handling across all async route handlers.

- Session & Security Enhancements
    - Implemented single-session enforcement (all previous sessions killed on new login).
    - Added security headers support (helmet-compatible structure).
    - Improved logout endpoint with proper HTTP status codes.
    - Fixed raw JWT token exposure in API responses.

### *Dependencies*
- Added `express-rate-limit` package for login protection.
- Added `nodemon` to devDependencies (fixes `npm run dev` on fresh clones).
- Reviewed `xlsx` package: HIGH-severity CVEs noted (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9).

### Started
- Tried to improve real time page loading in admin.html. Next update includes final look of Page Loading.

### `Total 24 Files changed and updated in v2.2.8`

----------------------------------

## 🔹 `v2.2.7` — 06 July 2026 *(Minor & Forced Update)*

### *General Changes & Fixes*
- `admin.html`
    - Improved Add Teacher modal. Added Page option( UI only ) [PENDING!]
    - Added Acadamic Year & Semester selection automatically from manage page and API.
    - Fixed some assignments backend bugs.

- `manage.html` (Major Changes!)
    - Added Page loaders.
    - Introduction to new `Years` Menu. acadamic & semester years are managed from here.
    - Reworked manage UI completely. A fresh rework for better user experience.
    - Saving dates in DB with draft and finalize logic. [PENDING!]

- `doLogout()` function updated in all files.

Added & Improved to above changes and bugs in backed routes, middlewares and models.

### `Total 21 Files changed and updated in v2.2.7`

----------------------------------

## 🔹 `v2.2.5` — 27 June 2026 *(Minor & Forced Update)*

### *General Changes & Fixes*
- `admin.html`
    - Fixed Teacher page API bug. Teacher details display fixed.

- `teacher.html`
    - My Profile fields + Assigned Classes empty.
    - Updated UI for new Attendance Method. Added PeriodNumber column **(bug exist)**
    - Tried to removed localStorage method completely. **(paritially)**

- `control.html`
    - Added new Collections in Db, reflecting it in control panel

- `attendance.routes.js` & other routes
    - Updated backend for new Attendance Method. `ClassAttendance`, `StudentAttendance` method. 

### *File Structure v2.0*
Each file has huge lines of code. Introduction of file structures will make it easy to understand the code and easy for file accessing. Version v2.0 brings `model.js` file separation.

#### Backend:
- `models/`
    - `attendance.models.js` - Reworked Attendance model, `AttendanceSchema` is now splited into `ClassAttendanceSchema` `StudentAttendanceSchema`.
    - `adders.models.js`, `admin.models.js`, `attendance.models.js`, `departments.models.js`, `exams.models.js`, `manage.models.js`, `timetable.models.js`, `users.models.js`

### `Total 19 Files changed and updated in v2.2.5`

----------------------------------

## 🔹 `v2.2.4` — 26 June 2026 (Complete Update)

### General Changes & Fixes
- `admin.html`
    - Tried to removed localStorage method completely. (paritially)
    - Reworked Add Teacher model.
    - Reworked trackId generation & last name spilter modal.
    - Edit Teacher modal in the Admin panel updated. (Still a bug exist)

- `student.html`
    - Updated Force Password Change menu.

- `model.js`
    - - Merged `SessionSchema` fields into `LoginHistorySchema`
    - Added `lastActivity` tracking field to session history in `LoginHistorySchema`.
    - Updated `TeacherSchema` specials options.
    - `UserSchema` updated and related apis.

- Added `/ping` POST endpoint in auth routes to report user activity and extend active sessions.
- Created `utils/sessionMonitor.js` to monitor active user sessions and handle auto-logout/extensions in the background.
- Updated authentication routes, middleware, and user/student/teacher routes to transition from the deprecated `active` boolean field to the new `status` enum field on `User`.
- Rewrote the client-side session checker in `services/logout.services.js` to perform backend-driven active session checks and pinging.
- Removed `start.js` from public directory.

### Introduction to File Structure v1.0 (new)
Each file has huge lines of code. Introduction of file structures will make it easy to understand the code and easy for file accessing. Version v1.0 brings `server.js` file separation.

#### Backend:
- Changes made:
    - `/config` - new dir contains - `index.js`, `db.js`.
    - `/middleware` - new dir contains - `auth.js`, `maintenance.js`.
    - `/routes` - new dir contains - `assignments.routes.js`, `attendance.routes.js`, `auth.routes.js`, `calendar.routes.js`, `classes.routes.js`, `dashboard.routes.js`, `departments.routes.js`, `examAttendance.routes.js`, `exams.routes.js`, `grievances.routes.js`, `index.js`, `liveSession.routes.js`, `logs.routes.js`, `manageAdmins.routes.js`, `notifications.routes.js`, `profile.routes.js`, `settings.routes.js`, `studentPortal.routes.js`, `students.routes.js`, `subjects.routes.js`, `system.routes.js`, `teachers.routes.js`, `timetable.routes.js`, `undo.routes.js`, `users.routes.js`.
    - `/utils` - new dir contains - `dateUtils.js`, `examUtils.js`, `logAction.js`, `serverState.js`.

    - `files/` - collections of files for readability. Project program files are now much easier to access and understand. Moved `CHANGELOG.MD` to `files/` directory.

### Security Improvements v1.0 
Made first step to improve logins and logouts. Introduction of `checkSessionExpiry()` function in all html files brings auto logout of user login after *45* minutes. This improvements needs more changes currently its at version 1, futher changes will include more improvements.

#### Login
- `checkSessionExpiry()` - auto logout of user login after *45* minutes.
- Improved backend api.

#### Logout
- `doLogut()` - completely reworked.
- Improved backend api.

### `Total 54 Files changed and updated in v2.2.4`

----------------------------------

## 🔹 `v2.2.0` — 14 June 2026 (Major Update)

### General Changes & Fixes
- `admin.html`
    - Deleted `pg-maintenance` an unused page.
    - `Add Subject` model bug fixed and improved user experience.
    - Fixed `No Student Found` and `No Teacher Found` messages bug  in Students and Teachers page - `initDB()` function fixed.
    - `Activity Log` page and `Analytics/Reports` No Data Found message bug fixed.
    - Add Class & Add Subject modal auto-select dept bug
    - `initAdminReports`, `tab('dept')`, `genDeptRpt()`, `genOverallRpt()`, `genStuRpt()`, `expAdminRpt('current','xlsx')`functions fixed.

- `models.js`
    - Removed `PasswordSchema`, `ManageSchema`, `StudentUserSchema` 
    - Added `LoginHistorySchema` for tracking login history.
    - Updated UserSchema, AdminSchema, TeacherSchema, StudentSchema, SettingsSchema and small changes made in models.
    - Default passwords are now refered from `.env` -> `config.js` file for more security.

- `server.js`
    - Seed Defaults(admin) to both UserSchema and AdminSchema, Moved M.Manage into settings menu. Changed all `M.User` to `M.user`. Fixed `StudentUser` and `Student`.
    - Delete password is redefined. 
    - Fixed Login (`api/auth/login`, `api/auth/change-password`) shifted `User` to respective user Schema.
    - `GET /api/students` and `GET /api/users` endpoints fixed and UserSchema changes.

- `control.html`
    - Updated with many settings in `control.html`. Each page, model and function has settings.
    - Added key label for more information.

### Manage Page (new)
A new Manage page is added to admin.html. This page defines College working days and exam dates. To Mark working days, leaves, holidays, and daily working timings and scheduling exams and track hall-wise attendance.

- Changes made:
    - `server.js` - `api/manage` endpoints for manage page.
    - `models.js` - `ManageSchema` added in models
    - `admin.html` - Reference added for `manage.html`.

----------------------------------

## 🔹 v2.1.1 — 06 June 2026 (Forced Update)

- `server.js`
    - Waste update, forgetten log of update :(.
    - Fixed Data management apis

- `control.html`
    - Fixed Data Management Page, Improved security in Data Management Page.
    - When logout, auto clears all browser caches.

- `index.html`
    - Removed default seeders (Teacher, Student) from db.

- `admin.html`
    - Reworked pages navigators
    - Fixing Empty data message(No data found.)

### ⚠️ Yet to Finish
- Add subject model bug.
- No student found, teacher found messages not display correctly.
- Activity log page bug.

----------------------------------

## 🔹 v2.1.0 — 05 May 2026 (Complete Update)

- `admin.html`
    - CSS converted to compact format.
    - Updated toast functions (`showToast`, `dbToast`)
    - Removed Old bulk Menu . 
- `bulk.html`
    - Remove 'Add Admin' Menu, Because No special admin id for any one.
    
### ✨ Added
- Add Clear button in Add Department Menu, Add Student Menu, Add Teacher Menu.

### 🔧 Updated
- Restructure with 2-digit code field in Add Department Menu
- Teacher trackId definition
- Changed showToast to dbToast for database actions.
- First step towards Setup wizard update.

### 🐛 Fixed
- Track Id generation bugs.

### ⚠️ Yet to Finish
- Bug in class & section page, clicking on department is not functioning

----------------------------------
## 🔹 v2.0.0 — 27 Apr 2026 (Complete Update)

### ✨ Added
- Introduction of Track ID generation
- Track ID column in teachers & students table
- In department menu, Hod trackId, CourseType, branch values added.
- Added Page loaders in `control.html` and `admin.html` files.
- Added Auto values updating in Add Student menu and Add department menu.

### 🔧 Updated
- Admin Track ID generation logic to allow department numbers
- Add department Menu updated.
- Shifted Bulk Menu to `bulk.html`.
- Complete changes in Add Student menu.

### 🐛 Fixed
- Fixed User Grid Page.
- Track ID generation error when department number used
- Missing trackId field in add teacher form
- Display issue with trackId values

### ⚠️ Yet to Finish
- Track Id generation bugs
- Add Clear button in Add Department Menu, Add Student Menu, Add Teacher Menu.
- Restructure with 2-digit code field in Add Department Menu


### 📁 Files Changed
- `admin.html` ------- `Complete changes`
- `server.js` -------- `Minor changes`
- `models.js` -------- `Minor changes`
- `bulk.html` -------- `Minor fixes`
- `control.html` ---- `Major fixes`  
<br><br>
----------------------
## 🔹 v1.1.0 — 27 Apr 2026 (Complete Update)

### ✨ Added
- Introduced ChangeLog.md file
- All updates, changes, new features, bug fixes and other information will be logged in this file

### 📁 Files Changed
- `CHANGELOG.md` - New File Added

---------------------