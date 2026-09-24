# EAMS — Educational Activity & Attendance Management System
### Enterprise Academic Management Platform

> A full-stack web application for managing student attendance, teacher assignments, departments, classes, and academic records. Built with Node.js, Express, MongoDB Atlas, and vanilla HTML/CSS/JS.

---

## Prerequisites

Before setting up, make sure you have:

- **Node.js** v18 or higher — [Download](https://nodejs.org)
- **npm** v9 or higher (comes with Node.js)
- **MongoDB Atlas account** (free) — [Sign up](https://www.mongodb.com/cloud/atlas)
- **Git** (optional, for version control)

---

## Setup — Step by Step

### Step 1 — Get the Project

**Option A: Clone from GitHub**
```bash
git clone https://github.com/your-username/EAMS-Project.git
cd EAMS-Project
```

**Option B: Extract from ZIP**
```bash
# Extract the zip, then open the folder in VS Code
# Press Ctrl+` to open terminal
```

---

### Step 2 — Install Dependencies

Open a terminal in the project folder and run:

```bash
npm install
```

This installs: `express`, `mongoose`, `bcryptjs`, `jsonwebtoken`, `cors`, `dotenv`, `multer`, `xlsx`

---

### Step 3 — Set Up MongoDB Atlas

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) and sign in
2. Create a new **Free Cluster (M0)**
3. Under **Database Access** → Add a database user with username + password
4. Under **Network Access** → Add IP Address → type `0.0.0.0/0` (allow all)
5. Click **Connect** → **Drivers** → copy your connection string

It will look like:
```
mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?appName=Cluster0
```

---

### Step 4 — Configure Environment Variables

Create a `.env` file in the project root:

```bash
# Windows
copy .env.example .env

# Mac/Linux
cp .env.example .env
```

Edit `.env` with your actual values:

```env
MONGO_URI=mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/?appName=Cluster0
DB_NAME=eams_db
JWT_SECRET=replace_this_with_a_long_random_string_min_32_chars
PORT=3000
```

> ⚠️ **Never commit `.env` to GitHub.** It's already in `.gitignore`.

---


---

### Step 6 — Start the Server

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
# or
node server.js
```

On first run, the terminal will show:

```
✅ MongoDB connected → eams_db

┌──────────────────────────────────────────┐
│          EAMS DEFAULT CREDENTIALS         │
├──────────────────────────────────────────┤
│  ADMIN                                   │
│  Username : admin                        │
│  Password : admin123                     │
├──────────────────────────────────────────┤
│  TEACHER                                 │
│  Username : teacher                      │
│  Password : teacher123                   │
└──────────────────────────────────────────┘

🚀 EAMS API running → http://localhost:3000
```

> The displayed password is always the **current real password** fetched from MongoDB — if it has been changed, the new password appears here.

---

### Step 7 — Open the Application

Open your browser and go to:

```
http://localhost:3000
```

You will see the EAMS login page. Sign in with the credentials shown in the terminal.

---

## First Time Setup Workflow

After logging in as Admin for the first time:

1. **Change password** — a popup will appear forcing a password change
2. **Go to Bulk Upload** → click **🚀 Setup Wizard** — guides you through in order:
   - Upload Departments (name, code, icon)
   - Upload Teachers (name, empId, dept, username, password)
   - Upload Classes (dept, hallNo, year, semester, section — name is auto-generated)
   - Upload Subjects (name, code, dept, credits, type)
   - Upload Students (fullname, regNo, dept, class, section, email, username)
3. **Assign Roles** — in Teachers page, click **🎓 Assign Roles** to set HOD and Class Advisors
4. **Go to Control Panel** → Basic Settings → fill in institution details

---

## Bulk Upload File Formats

All uploads accept `.xlsx`, `.xls`, or `.csv`.

### Departments
| Column | Required | Example |
|--------|----------|---------|
| DeptName | ✅ | Computer Science Engineering |
| Code | ✅ | CSE |
| Icon | — | 💻 |

### Teachers
| Column | Required | Example |
|--------|----------|---------|
| Name | ✅ | John Doe |
| EmployeeID | — | EMP001 |
| Department | — | CSE |
| Designation | — | Assistant Professor |
| Username | ✅ | johndoe |
| Password | — | teacher123 |

### Classes
| Column | Required | Example |
|--------|----------|---------|
| Department | ✅ | CSE |
| HallNo | — | LH01 |
| Year | — | I Year |
| Semester | ✅ | I |
| Section | ✅ | A |

> ClassName is auto-generated as `DEPTCODE-SEM-SECTION` (e.g. `CSE-I-A`)

### Subjects
| Column | Required | Example |
|--------|----------|---------|
| Name | ✅ | Data Structures |
| Code | ✅ | CS201 |
| Department | ✅ | CSE |
| Credits | — | 4 |
| Type | — | Theory / Lab / Elective |
| Teacher | — | John Doe |

### Students
| Column | Required | Example |
|--------|----------|---------|
| FullName | ✅ | Arun Kumar |
| RegisterNo | ✅ | CSE25001 |
| AcademicYear | — | 2025-26 |
| CourseType | — | UG |
| Branch | — | B.E |
| Department | ✅ | CSE |
| Year | — | I Year |
| Class | — | CSE-I-A |
| Section | — | A |
| Email | — | arun@eams.edu |
| Username | — | arun25 |
| Password | — | Student@123 |

---

## Security Features

| Feature | Details |
|---------|---------|
| Password hashing | bcrypt with 10 rounds |
| JWT tokens | Expire in 8 hours |
| Session DB tracking | Every login creates a DB session; logout invalidates it |
| Account lockout | Locked for 15 minutes after 5 failed login attempts |
| Auto maintenance mode | Enabled automatically if brute-force attack detected |
| Right-click disabled | Context menu blocked on all pages |
| DevTools blocked | F12, Ctrl+Shift+I/J/C/K, Ctrl+U blocked |
| DevTools detection | Window size check — shows lock screen if devtools opened |
| Special delete password | Data Management in Control Panel requires extra password (`987543210`) |
| Force password change | Admin and teacher must change default password on first login |
| No text selection | `user-select:none` on all pages |

---


## Deployment — Railway.app

1. Push your project to a GitHub repository (without `.env`)
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repository
4. Add environment variables in Railway dashboard:
   ```
   MONGO_URI=mongodb+srv://...
   DB_NAME=eams_db
   JWT_SECRET=your_secret_here
   PORT=3000
   NODE_ENV=production
   ```
5. Railway uses `railway.json` automatically — start command is `node server.js`
6. Your app will be live at a `*.up.railway.app` URL

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URI` | ✅ | `mongodb://localhost:27017/eams_db` | MongoDB connection string |
| `DB_NAME` | — | `eams_db` | Database name |
| `JWT_SECRET` | ✅ | `eams_jwt_secret_change_in_production` | JWT signing secret (change this!) |
| `JWT_EXPIRES_IN` | — | `8h` | Token expiry duration |
| `BCRYPT_ROUNDS` | — | `10` | bcrypt hashing rounds |
| `PORT` | — | `3000` | HTTP server port |
| `NODE_ENV` | — | `development` | Environment mode |
| `CORS_ORIGIN` | — | `http://localhost:5500` | Allowed CORS origin |

---

*Built for Educational Institutions & Universities.*
