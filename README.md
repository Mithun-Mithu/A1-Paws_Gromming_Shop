# A1 Paws – Pet Grooming Booking Platform

## Project structure

```text
a1-paws/
├── frontend/
│   ├── public/
│   │   ├── images/
│   │   └── favicon.svg
│   └── src/
│       ├── assets/
│       ├── components/
│       ├── pages/
│       ├── layouts/
│       ├── services/
│       ├── hooks/
│       ├── styles/
│       ├── utils/
│       ├── App.jsx
│       └── main.jsx
├── backend/
│   ├── config/
│   │   └── database.js
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── middleware/
│   ├── services/
│   ├── utils/
│   ├── validators/
│   ├── .env.example
│   ├── .gitignore
│   ├── package.json
│   └── server.js
├── docs/
├── screenshots/
├── .gitignore
└── README.md
```

## Run locally

Requires Node.js 20+ and npm.

Run the following commands from the `a1-paws` folder in PowerShell.

### Backend — Terminal 1

```powershell
Set-Location .\backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm install
```

Copy `.env.example` to `.env` and set unique values for `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` (at least 12 characters with uppercase and lowercase letters, a number, and a symbol). `ADMIN_NAME` and `ADMIN_PHONE` are optional profile fields for the bootstrap Super Admin. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` with credentials from your real SMTP provider; password recovery is unavailable until these are configured. Keep `.env` private and never put these values in frontend environment variables.

```bash
npm run seed-admin
npm run dev
```

### Frontend — Terminal 2

```powershell
Set-Location .\frontend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm install
```

Then run:

```powershell
npm run dev
```

Open the Vite URL, normally http://localhost:5173.

### Admin password recovery

- The admin panel is available at `/admin`; use the administrator account created by `npm run seed-admin`.
- Select **Forgot password?** and follow the emailed 6-digit code. Codes expire in 5 minutes, can be resent after 60 seconds, and are limited to 5 verification attempts.
- The new password must be at least 12 characters and include an uppercase letter, lowercase letter, number, and symbol. Password reset invalidates existing admin sessions.
- The API accepts a comma-separated `CLIENT_ORIGIN` allow-list for local and deployed frontend origins. Set the exact deployed origin(s) and use HTTPS in production.
- Check backend/database readiness at `http://localhost:5000/api/health`; recovery delivery requires a reachable SMTP server.

### Admin and booking features

- Admin dashboard metrics include total, pending, confirmed, and completed appointments.
- Protected customer, pet, booking, and grooming-service management is available after admin login; booking status changes and CSV export are supported.
- The bootstrap account is a **Super Admin**. Super Admins can add, edit, search, activate/deactivate, and delete admin accounts; admin passwords are bcrypt-hashed and never returned by the API.
- Backend authorization enforces the `super_admin`, `admin`, and `staff` roles. Admins can manage bookings, customers, pets, and grooming services; Staff see only appointments assigned to them and can update their status.
- Admin actions are recorded in an audit log. Admin-management APIs are available under `/api/admins` and require Super Admin authorization.
- Existing admin accounts are extended in place by additive SQLite migrations. The backend database path can be overridden with `DATABASE_PATH` for isolated test databases.

## Included MVP functionality

- Responsive customer website and service cards.
- Pet and customer details with multi-service booking.
- Dynamic availability from the backend and SQLite.
- Booking references and persistent records.
- Pay-at-shop and mock online payment choices.
- Admin login, dashboard, booking status management, editable service prices/durations and CSV export.

## Configuration and production notes

- Service prices are sample values; edit them in the admin dashboard.
- Business hours are development defaults (10:00–18:00, Monday–Saturday). Update the `business_hours` table to match the shop before accepting bookings.
- Mock online payment does not collect money. Real Razorpay integration requires merchant credentials, server-side order creation and signature verification.
- Before production, configure HTTPS, backups, monitoring, notifications and deployment secrets.
- Current API handlers remain in `backend/server.js` for a straightforward runnable starter. The requested controller, model and route folders are ready for later modular extraction.
