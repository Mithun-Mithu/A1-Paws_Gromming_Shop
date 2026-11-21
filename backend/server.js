
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { z } from "zod";

import { pool } from "./config/postgres.js";
import { phoneNumberSchema } from "./utils/phone.js";
import { requireAdmin, requirePermission } from "./middleware/auth.js";
import { isEmailConfigured, sendAdminPasswordResetCode, sendBookingEmail } from "./services/email.js";
import { recordAdminAudit } from "./models/admin.js";
import { getPublicContactNumbers } from "./controllers/contactNumberController.js";
import adminRoutes from "./routes/adminRoutes.js";
import contactNumberRoutes from "./routes/contactNumberRoutes.js";

if (
  !process.env.JWT_SECRET ||
  process.env.JWT_SECRET.length < 32 ||
  process.env.JWT_SECRET === "replace-with-a-long-random-secret"
) {
  throw new Error("Set a unique JWT_SECRET of at least 32 characters in .env");
}

const app = express();

app.use(helmet());

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const allowedOrigins = [
  "https://a1-paws.vercel.app",
  "https://a1-paws-grooming-shop.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5175"
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true
}));

app.use(express.json({ limit: "100kb" }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 300 }));

app.use("/api/admins", adminRoutes);

const recoveryRequestLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password recovery requests. Please try again later." }
});

const adminLoginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many admin login attempts. Please try again later." }
});

const recoveryVerifyLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many verification attempts. Please try again later." }
});

const bookedSlotMessage =
  "Sorry, this time slot is already booked. Please select another slot.";

const unavailableSlotMessage =
  "This time slot is unavailable. Please select another slot.";

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTimeString(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const [hour, minute] = value.split(":").map(Number);

  return hour < 24 && minute < 60;
}

function localToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(part => [part.type, part.value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function logEmailFailure(error) {
  console.error("EMAIL DELIVERY FAILED:", {
    code: error?.code,
    message: error?.message
  });
}

const bookingSchema = z.object({
  petName: z.string().trim().min(1).max(80),
  petType: z.enum(["Dog", "Cat"]),
  breed: z.string().max(80).optional().default(""),
  age: z.string().max(30).optional().default(""),
  size: z.string().max(30).optional().default(""),
  serviceIds: z.array(z.number().int().positive()).min(1),
  date: z.string().refine(isValidDateString),
  time: z.string().refine(isValidTimeString),
  fullName: z.string().trim().min(2).max(100),
  phone: phoneNumberSchema,
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().max(1000).optional().default(""),
  paymentMethod: z.enum(["pay_at_shop"])
});

function minutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function timeString(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

// The optional dbClient lets booking transactions check slots
// using the same PostgreSQL connection.
async function getSlots(date, duration, excludeBookingId = null, dbClient = pool) {
  const weekday = new Date(`${date}T12:00:00`).getDay();

  const [holidayResult, hoursResult, bookingsResult] = await Promise.all([
    dbClient.query(
      "SELECT date FROM holidays WHERE date = $1",
      [date]
    ),
    dbClient.query(
      "SELECT * FROM business_hours WHERE weekday = $1",
      [weekday]
    ),
    excludeBookingId === null
      ? dbClient.query(
          `SELECT start_time, end_time
           FROM bookings
           WHERE appointment_date = $1
           AND status != 'cancelled'`,
          [date]
        )
      : dbClient.query(
          `SELECT start_time, end_time
           FROM bookings
           WHERE appointment_date = $1
           AND status != 'cancelled'
           AND id != $2`,
          [date, excludeBookingId]
        )
  ]);

  const holiday = holidayResult.rows[0];
  const hours = hoursResult.rows[0];

  const open = minutes(hours?.open_time || "10:00");
  const close = minutes(hours?.close_time || "18:00");

  const nowTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date());

  const nowDate = localToday();
  const existing = bookingsResult.rows;
  const slots = [];
  const step = 30;

  const closed = !hours || Number(hours.is_open) !== 1 || Boolean(holiday);

  for (let start = open; start < close; start += step) {
    const end = start + duration;
    const time = timeString(start);

    const conflict = existing.some(booking =>
      start < minutes(booking.end_time) &&
      end > minutes(booking.start_time)
    );

    const past =
      date < nowDate ||
      (date === nowDate && time <= nowTime);

    const status = closed || past || end > close
      ? "unavailable"
      : conflict
        ? "booked"
        : "available";

    slots.push({
      time,
      status,
      available: status === "available"
    });
  }

  return slots;
}

// --------------------------------------------------
// HEALTH
// --------------------------------------------------

app.get("/api/health", asyncHandler(async (req, res) => {
  await pool.query("SELECT 1");

  res.json({
    ok: true,
    service: "A1 Paws API",
    database: "connected"
  });
}));

// --------------------------------------------------
// PUBLIC SERVICES AND CONTACTS
// --------------------------------------------------

app.get("/api/services", asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, description, price, duration
     FROM services
     WHERE active = 1
     ORDER BY id`
  );

  res.json(result.rows);
}));

app.get("/api/contacts", getPublicContactNumbers);

app.get("/api/availability", asyncHandler(async (req, res) => {
  const { date, duration } = req.query;

  if (
    !isValidDateString(date) ||
    !Number.isInteger(Number(duration)) ||
    Number(duration) < 1
  ) {
    return res.status(400).json({
      message: "Valid date and duration are required"
    });
  }

  const weekday = new Date(`${date}T12:00:00`).getDay();

  const [hoursResult, holidayResult, slots] = await Promise.all([
    pool.query(
      "SELECT is_open FROM business_hours WHERE weekday = $1",
      [weekday]
    ),
    pool.query(
      "SELECT label FROM holidays WHERE date = $1",
      [date]
    ),
    getSlots(date, Number(duration))
  ]);

  const hours = hoursResult.rows[0];
  const holiday = holidayResult.rows[0];

  res.json({
    slots,
    isClosed: !hours || Number(hours.is_open) !== 1 || Boolean(holiday),
    holiday: holiday?.label || null
  });
}));

// --------------------------------------------------
// CREATE BOOKING
// --------------------------------------------------

app.post("/api/bookings", asyncHandler(async (req, res) => {
  const parsed = bookingSchema.safeParse(req.body);

  if (!parsed.success) {
    const phoneError = parsed.error.issues.find(
      issue => issue.path[0] === "phone"
    );

    return res.status(400).json({
      message: phoneError?.message || "Please check the booking details",
      errors: parsed.error.flatten()
    });
  }

  const v = parsed.data;

  if (v.date < localToday()) {
    return res.status(400).json({
      message: "Past dates cannot be booked"
    });
  }

  const ids = [...new Set(v.serviceIds)];

  if (ids.length !== v.serviceIds.length) {
    return res.status(400).json({
      message: "Duplicate services are not allowed"
    });
  }

  const client = await pool.connect();

  let reference;
  let selected;
  let totalPrice;
  let totalDuration;
  let id;

  const paymentStatus = "pending";

  try {
    await client.query("BEGIN");

    // Serialize booking attempts for the same date.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
      [`booking:${v.date}`]
    );

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");

    const servicesResult = await client.query(
      `SELECT id, name, price, duration
       FROM services
       WHERE active = 1
       AND id IN (${placeholders})
       ORDER BY id`,
      ids
    );

    selected = servicesResult.rows;

    if (selected.length !== ids.length) {
      const error = new Error("One or more services are unavailable");
      error.code = "A1_INVALID_SERVICES";
      throw error;
    }

    totalPrice = selected.reduce(
      (sum, service) => sum + Number(service.price),
      0
    );

    totalDuration = selected.reduce(
      (sum, service) => sum + Number(service.duration),
      0
    );

    const endTime = timeString(minutes(v.time) + totalDuration);

    const slot = (await getSlots(
      v.date,
      totalDuration,
      null,
      client
    )).find(item => item.time === v.time);

    if (!slot || !slot.available) {
      const error = new Error(
        slot?.status === "booked"
          ? bookedSlotMessage
          : unavailableSlotMessage
      );

      error.code = "A1_SLOT_CONFLICT";
      throw error;
    }

    reference = "A1P-" + randomUUID().slice(0, 8).toUpperCase();

    const customerResult = await client.query(
      "SELECT id FROM customers WHERE phone = $1",
      [v.phone]
    );

    let customerId;

    if (customerResult.rows.length > 0) {
      customerId = customerResult.rows[0].id;

      await client.query(
        `UPDATE customers
         SET full_name = $1, email = $2
         WHERE id = $3`,
        [v.fullName, v.email || null, customerId]
      );
    } else {
      const customerInsert = await client.query(
        `INSERT INTO customers(full_name, phone, email)
         VALUES($1, $2, $3)
         RETURNING id`,
        [v.fullName, v.phone, v.email || null]
      );

      customerId = customerInsert.rows[0].id;
    }

    const petResult = await client.query(
      `INSERT INTO pets(customer_id, name, type, breed, age, size)
       VALUES($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        customerId,
        v.petName,
        v.petType,
        v.breed,
        v.age,
        v.size
      ]
    );

    const petId = petResult.rows[0].id;

    const bookingResult = await client.query(
      `INSERT INTO bookings(
        reference, customer_id, pet_id, appointment_date,
        start_time, end_time, total_price, total_duration,
        additional_charges, discount_amount, final_amount,
        payment_method, payment_status, notes
      )
      VALUES(
        $1, $2, $3, $4, $5, $6, $7, $8,
        0, 0, $9, $10, $11, $12
      )
      RETURNING id`,
      [
        reference,
        customerId,
        petId,
        v.date,
        v.time,
        endTime,
        totalPrice,
        totalDuration,
        totalPrice,
        v.paymentMethod,
        paymentStatus,
        v.notes
      ]
    );

    id = bookingResult.rows[0].id;

    for (const service of selected) {
      await client.query(
        `INSERT INTO booking_services(
          booking_id, service_id, service_name, price, duration
        )
        VALUES($1, $2, $3, $4, $5)`,
        [
          id,
          service.id,
          service.name,
          service.price,
          service.duration
        ]
      );
    }

    await client.query(
      `INSERT INTO payments(booking_id, provider, amount, status)
       VALUES($1, $2, $3, $4)`,
      [id, "shop", totalPrice, paymentStatus]
    );

    await client.query("COMMIT");

  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "A1_SLOT_CONFLICT") {
      return res.status(409).json({ message: error.message });
    }

    if (error.code === "A1_INVALID_SERVICES") {
      return res.status(400).json({ message: error.message });
    }

    if (error.code === "23505") {
      return res.status(409).json({ message: bookedSlotMessage });
    }

    throw error;

  } finally {
    client.release();
  }

  if (v.email && isEmailConfigured()) {
    void sendBookingEmail({
      to: v.email,
      customerName: v.fullName,
      reference,
      petName: v.petName,
      services: selected,
      date: v.date,
      time: v.time,
      totalAmount: totalPrice,
      paymentMethod: v.paymentMethod,
      status: "pending"
    }).catch(logEmailFailure);
  }

  return res.status(201).json({
    id,
    reference,
    customerName: v.fullName,
    petName: v.petName,
    date: v.date,
    time: v.time,
    totalPrice,
    totalDuration,
    paymentMethod: v.paymentMethod,
    paymentStatus,
    status: "pending",
    services: selected
  });
}));

// --------------------------------------------------
// PUBLIC BOOKING DETAILS
// --------------------------------------------------

app.get("/api/bookings/:reference", asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT
       b.*,
       c.full_name,
       c.phone,
       c.email,
       p.name AS pet_name,
       p.type AS pet_type
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id
     JOIN pets p ON p.id = b.pet_id
     WHERE b.reference = $1`,
    [req.params.reference]
  );

  const booking = result.rows[0];

  if (!booking) {
    return res.status(404).json({ message: "Booking not found" });
  }

  const services = await pool.query(
    `SELECT service_name, price, duration
     FROM booking_services
     WHERE booking_id = $1
     ORDER BY service_id`,
    [booking.id]
  );

  booking.services = services.rows;

  res.json(booking);
}));

// --------------------------------------------------
// ADMIN LOGIN
// --------------------------------------------------

app.post("/api/admin/login", adminLoginLimit, asyncHandler(async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email(),
    password: z.string().min(1)
  });

  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Enter a valid email and password"
    });
  }

  const result = await pool.query(
    `SELECT *
     FROM admins
     WHERE LOWER(email) = LOWER($1)
     AND status = 'active'`,
    [parsed.data.email]
  );

  const admin = result.rows[0];

  if (!admin || !(await bcrypt.compare(parsed.data.password, admin.password_hash))) {
    return res.status(401).json({
      message: "Incorrect email or password"
    });
  }

  const token = jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      version: admin.token_version
    },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );

  await recordAdminAudit(
    admin.id,
    "admin.login",
    admin.id,
    { role: admin.role }
  );

  res.json({
    token,
    email: admin.email,
    fullName: admin.full_name,
    role: admin.role
  });
}));

// --------------------------------------------------
// ADMIN PASSWORD RECOVERY
// --------------------------------------------------

const genericRecoveryMessage =
  "If an administrator account matches that email, a verification code will be sent shortly.";

const recoveryEmailSchema = z.object({
  email: z.string().trim().email().max(254)
    .transform(value => value.toLowerCase())
});

const otpHash = (otp, salt) =>
  createHmac("sha256", process.env.JWT_SECRET)
    .update(`${salt}:${otp}`)
    .digest("hex");

const resetTokenHash = token =>
  createHash("sha256").update(token).digest("hex");

app.post(
  "/api/admin/forgot-password",
  recoveryRequestLimit,
  asyncHandler(async (req, res) => {
    const parsed = recoveryEmailSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Enter a valid email address"
      });
    }

        if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({
        message: "Password recovery email is temporarily unavailable. Contact the site administrator."
      });
    }

    const result = await pool.query(
      `SELECT id, email
       FROM admins
       WHERE LOWER(email) = $1
       AND status = 'active'`,
      [parsed.data.email]
    );

    const admin = result.rows[0];

    if (admin) {
      const client = await pool.connect();
      let issued = null;

      try {
        await client.query("BEGIN");

        const previous = await client.query(
          `SELECT last_sent_at
           FROM admin_password_resets
           WHERE admin_id = $1
           FOR UPDATE`,
          [admin.id]
        );

        const now = Date.now();
        const lastSent = previous.rows[0]?.last_sent_at;

        if (lastSent !== undefined && now - Number(lastSent) < 60_000) {
          await client.query("COMMIT");
        } else {
          const otp = String(randomInt(100000, 1000000));
          const salt = randomBytes(16).toString("hex");
          const hash = otpHash(otp, salt);

          await client.query(
            `INSERT INTO admin_password_resets(
              admin_id, otp_hash, otp_salt, expires_at,
              last_sent_at, attempts, reset_token_hash, reset_expires_at
            )
            VALUES($1, $2, $3, $4, $5, 0, NULL, NULL)
            ON CONFLICT(admin_id) DO UPDATE SET
              otp_hash = EXCLUDED.otp_hash,
              otp_salt = EXCLUDED.otp_salt,
              expires_at = EXCLUDED.expires_at,
              last_sent_at = EXCLUDED.last_sent_at,
              attempts = 0,
              reset_token_hash = NULL,
              reset_expires_at = NULL`,
            [admin.id, hash, salt, now + 5 * 60_000, now]
          );

          await client.query("COMMIT");
          issued = otp;
        }
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      if (issued) {
        void sendAdminPasswordResetCode(admin.email, issued)
          .then(info => {
            console.log("Admin recovery email accepted by SMTP:", info.messageId);
          })
          .catch(logEmailFailure);
      }
    }

    res.status(202).json({ message: genericRecoveryMessage });
  })
);

app.post(
  "/api/admin/verify-otp",
  recoveryVerifyLimit,
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      email: z.string().trim().email().max(254)
        .transform(value => value.toLowerCase()),
      otp: z.string().regex(/^\d{6}$/)
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: "Enter the registered email and 6-digit verification code"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const adminResult = await client.query(
        `SELECT id
         FROM admins
         WHERE LOWER(email) = $1
         AND status = 'active'`,
        [parsed.data.email]
      );

      const admin = adminResult.rows[0];

      if (!admin) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "The verification code is invalid or expired. Request a new code."
        });
      }

      const challengeResult = await client.query(
        `SELECT *
         FROM admin_password_resets
         WHERE admin_id = $1
         FOR UPDATE`,
        [admin.id]
      );

      const challenge = challengeResult.rows[0];

      if (
        !challenge ||
        !challenge.otp_hash ||
        !challenge.otp_salt ||
        challenge.attempts >= 5 ||
        Number(challenge.expires_at) <= Date.now()
      ) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "The verification code is invalid or expired. Request a new code."
        });
      }

      const expected = Buffer.from(challenge.otp_hash, "hex");
      const actual = Buffer.from(
        otpHash(parsed.data.otp, challenge.otp_salt),
        "hex"
      );

      if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
      ) {
        await client.query(
          `UPDATE admin_password_resets
           SET attempts = attempts + 1,
               otp_hash = CASE WHEN attempts + 1 >= 5 THEN NULL ELSE otp_hash END,
               otp_salt = CASE WHEN attempts + 1 >= 5 THEN NULL ELSE otp_salt END
           WHERE admin_id = $1
           AND attempts < 5`,
          [admin.id]
        );

        await client.query("COMMIT");

        return res.status(400).json({
          message: "The verification code is invalid or expired. Request a new code."
        });
      }

      const resetToken = randomBytes(32).toString("base64url");

      const consumed = await client.query(
        `UPDATE admin_password_resets
         SET otp_hash = NULL,
             otp_salt = NULL,
             expires_at = NULL,
             reset_token_hash = $1,
             reset_expires_at = $2
         WHERE admin_id = $3
         AND otp_hash = $4
         AND otp_salt = $5
         AND attempts < 5
         AND expires_at > $6`,
        [
          resetTokenHash(resetToken),
          Date.now() + 10 * 60_000,
          admin.id,
          challenge.otp_hash,
          challenge.otp_salt,
          Date.now()
        ]
      );

      if (!consumed.rowCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "The verification code is invalid or expired. Request a new code."
        });
      }

      await client.query("COMMIT");

      res.json({ resetToken });

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

app.post(
  "/api/admin/reset-password",
  recoveryVerifyLimit,
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      resetToken: z.string().min(40).max(100),
      password: z.string().min(12).max(128)
        .regex(/[a-z]/, "Password must contain a lowercase letter")
        .regex(/[A-Z]/, "Password must contain an uppercase letter")
        .regex(/\d/, "Password must contain a number")
        .regex(/[^A-Za-z0-9]/, "Password must contain a symbol")
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        message: parsed.error.issues[0]?.message || "Choose a stronger password"
      });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const tokenHash = resetTokenHash(parsed.data.resetToken);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT admin_id
         FROM admin_password_resets
         WHERE reset_token_hash = $1
         AND reset_expires_at > $2
         FOR UPDATE`,
        [tokenHash, Date.now()]
      );

      const row = result.rows[0];

      if (!row) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "This password reset link is invalid or expired. Start again."
        });
      }

      const updated = await client.query(
        `UPDATE admins
         SET password_hash = $1,
             token_version = token_version + 1
         WHERE id = $2
         AND status = 'active'`,
        [passwordHash, row.admin_id]
      );

      if (!updated.rowCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          message: "This password reset link is invalid or expired. Start again."
        });
      }

      await client.query(
        "DELETE FROM admin_password_resets WHERE admin_id = $1",
        [row.admin_id]
      );

      await client.query("COMMIT");

      await recordAdminAudit(
        row.admin_id,
        "admin.password_reset",
        row.admin_id,
        { method: "email_otp" }
      );

      res.json({
        message: "Password updated successfully. Please sign in with your new password."
      });

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

// --------------------------------------------------
// ADMIN CONTACT NUMBERS
// --------------------------------------------------

app.use("/api/admin/contact-numbers", contactNumberRoutes);

// --------------------------------------------------
// ADMIN AUTHENTICATION
// --------------------------------------------------

app.use("/api/admin", requireAdmin);

// --------------------------------------------------
// ADMIN DASHBOARD
// --------------------------------------------------

app.get(
  "/api/admin/dashboard",
  requirePermission("dashboard:read"),
  asyncHandler(async (req, res) => {
    const staffScope = req.admin.role === "staff";
    const adminId = req.admin.id;
    const today = localToday();

    async function scalar(sql, params = []) {
      const result = await pool.query(sql, params);
      return Number(result.rows[0].n);
    }

    const countStatus = status => staffScope
      ? scalar(
          `SELECT COUNT(*) AS n
           FROM bookings
           WHERE assigned_admin_id = $1 AND status = $2`,
          [adminId, status]
        )
      : scalar(
          "SELECT COUNT(*) AS n FROM bookings WHERE status = $1",
          [status]
        );

    const totalPromise = staffScope
      ? scalar(
          "SELECT COUNT(*) AS n FROM bookings WHERE assigned_admin_id = $1",
          [adminId]
        )
      : scalar("SELECT COUNT(*) AS n FROM bookings");

    const todayPromise = staffScope
      ? scalar(
          `SELECT COUNT(*) AS n FROM bookings
           WHERE assigned_admin_id = $1
           AND appointment_date = $2
           AND status != 'cancelled'`,
          [adminId, today]
        )
      : scalar(
          `SELECT COUNT(*) AS n FROM bookings
           WHERE appointment_date = $1
           AND status != 'cancelled'`,
          [today]
        );

    const upcomingPromise = staffScope
      ? scalar(
          `SELECT COUNT(*) AS n FROM bookings
           WHERE assigned_admin_id = $1
           AND appointment_date >= $2
           AND status IN ('pending', 'confirmed')`,
          [adminId, today]
        )
      : scalar(
          `SELECT COUNT(*) AS n FROM bookings
           WHERE appointment_date >= $1
           AND status IN ('pending', 'confirmed')`,
          [today]
        );

    const revenuePromise = staffScope
      ? scalar(
          `SELECT COALESCE(SUM(b.final_amount), 0) AS n
           FROM bookings b
           WHERE b.assigned_admin_id = $1
           AND b.status = 'completed'
           AND COALESCE(
             (SELECT pay.status FROM payments pay
              WHERE pay.booking_id = b.id
              ORDER BY pay.id DESC LIMIT 1),
             b.payment_status
           ) IN ('paid', 'mock_paid')`,
          [adminId]
        )
      : scalar(
          `SELECT COALESCE(SUM(b.final_amount), 0) AS n
           FROM bookings b
           WHERE b.status = 'completed'
           AND COALESCE(
             (SELECT pay.status FROM payments pay
              WHERE pay.booking_id = b.id
              ORDER BY pay.id DESC LIMIT 1),
             b.payment_status
           ) IN ('paid', 'mock_paid')`
        );

    const pendingPaymentsPromise = staffScope
      ? scalar(
          `SELECT COALESCE(SUM(b.final_amount), 0) AS n
           FROM bookings b
           WHERE b.assigned_admin_id = $1
           AND b.status != 'cancelled'
           AND COALESCE(
             (SELECT pay.status FROM payments pay
              WHERE pay.booking_id = b.id
              ORDER BY pay.id DESC LIMIT 1),
             b.payment_status
           ) = 'pending'`,
          [adminId]
        )
      : scalar(
          `SELECT COALESCE(SUM(b.final_amount), 0) AS n
           FROM bookings b
           WHERE b.status != 'cancelled'
           AND COALESCE(
             (SELECT pay.status FROM payments pay
              WHERE pay.booking_id = b.id
              ORDER BY pay.id DESC LIMIT 1),
             b.payment_status
           ) = 'pending'`
        );

    const [
      total,
      pending,
      confirmed,
      todayCount,
      upcoming,
      completed,
      cancelled,
      revenue,
      pendingPayments
    ] = await Promise.all([
      totalPromise,
      countStatus("pending"),
      countStatus("confirmed"),
      todayPromise,
      upcomingPromise,
      countStatus("completed"),
      countStatus("cancelled"),
      revenuePromise,
      pendingPaymentsPromise
    ]);

    res.json({
      total,
      pending,
      confirmed,
      today: todayCount,
      upcoming,
      completed,
      cancelled,
      revenue,
      pendingPayments,
      currentAdmin: {
        id: req.admin.id,
        fullName: req.admin.fullName,
        email: req.admin.email,
        role: req.admin.role
      }
    });
  })
);

// --------------------------------------------------
// HELPER: ATTACH BOOKING SERVICES
// --------------------------------------------------

async function includeBookingServices(rows) {
  if (!rows.length) return rows;

  const ids = rows.map(row => row.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");

  const result = await pool.query(
    `SELECT booking_id, service_name, price, duration
     FROM booking_services
     WHERE booking_id IN (${placeholders})
     ORDER BY booking_id, service_id`,
    ids
  );

  const byBooking = new Map();

  result.rows.forEach(service => {
    if (!byBooking.has(service.booking_id)) {
      byBooking.set(service.booking_id, []);
    }

    byBooking.get(service.booking_id).push({
      name: service.service_name,
      price: service.price,
      duration: service.duration
    });
  });

  return rows.map(row => ({
    ...row,
    services: byBooking.get(row.id) || []
  }));
}

// --------------------------------------------------
// ADMIN BOOKINGS
// --------------------------------------------------

app.get(
  "/api/admin/bookings",
  requirePermission("bookings:read"),
  asyncHandler(async (req, res) => {
    const staffScope = req.admin.role === "staff";

    const result = await pool.query(
      `SELECT
        b.id, b.reference, b.appointment_date, b.start_time, b.end_time,
        b.total_price, b.additional_charges, b.discount_amount,
        b.final_amount, b.total_duration, b.payment_method, b.notes,
        b.created_at, b.status,
        COALESCE(
          (SELECT pay.status FROM payments pay
           WHERE pay.booking_id = b.id
           ORDER BY pay.id DESC LIMIT 1),
          b.payment_status
        ) AS payment_status,
        (SELECT pay.provider FROM payments pay
         WHERE pay.booking_id = b.id
         ORDER BY pay.id DESC LIMIT 1) AS payment_provider,
        (SELECT pay.amount FROM payments pay
         WHERE pay.booking_id = b.id
         ORDER BY pay.id DESC LIMIT 1) AS payment_amount,
        b.assigned_admin_id,
        assigned.full_name AS assigned_name,
        c.full_name, c.phone, c.email,
        p.name AS pet_name, p.type AS pet_type,
        p.breed, p.age, p.size
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       JOIN pets p ON p.id = b.pet_id
       LEFT JOIN admins assigned ON assigned.id = b.assigned_admin_id
       ${staffScope ? "WHERE b.assigned_admin_id = $1" : ""}
       ORDER BY b.appointment_date ASC, b.start_time ASC`,
      staffScope ? [req.admin.id] : []
    );

    res.json(await includeBookingServices(result.rows));
  })
);

// --------------------------------------------------
// ADMIN CUSTOMERS
// --------------------------------------------------

app.get(
  "/api/admin/customers",
  requirePermission("customers:read"),
  asyncHandler(async (req, res) => {
    const staffScope = req.admin.role === "staff";

    const result = await pool.query(
      `SELECT
        c.id, c.full_name, c.phone, c.email,
        ${staffScope
          ? `COUNT(DISTINCT p.id) FILTER (
               WHERE EXISTS (
                 SELECT 1 FROM bookings pet_assignment
                 WHERE pet_assignment.pet_id = p.id
                 AND pet_assignment.assigned_admin_id = $1
               )
             )`
          : "COUNT(DISTINCT p.id)"
        } AS pet_count,
        ${staffScope
          ? "COUNT(DISTINCT b.id) FILTER (WHERE b.assigned_admin_id = $2)"
          : "COUNT(DISTINCT b.id)"
        } AS booking_count
       FROM customers c
       LEFT JOIN pets p ON p.customer_id = c.id
       LEFT JOIN bookings b ON b.customer_id = c.id
       WHERE ${
         staffScope
           ? `EXISTS (
                SELECT 1 FROM bookings assigned
                WHERE assigned.customer_id = c.id
                AND assigned.assigned_admin_id = $3
              )`
           : "TRUE"
       }
       GROUP BY c.id
       ORDER BY c.full_name`,
      staffScope
        ? [req.admin.id, req.admin.id, req.admin.id]
        : []
    );

    res.json(result.rows);
  })
);

// --------------------------------------------------
// ADMIN PETS
// --------------------------------------------------

app.get(
  "/api/admin/pets",
  requirePermission("pets:read"),
  asyncHandler(async (req, res) => {
    const staffScope = req.admin.role === "staff";

    const result = await pool.query(
      `SELECT
        p.id, p.name, p.type, p.breed, p.age, p.size,
        c.full_name AS customer_name,
        c.phone
       FROM pets p
       JOIN customers c ON c.id = p.customer_id
       WHERE ${
         staffScope
           ? `EXISTS (
                SELECT 1 FROM bookings assigned
                WHERE assigned.pet_id = p.id
                AND assigned.assigned_admin_id = $1
              )`
           : "TRUE"
       }
       ORDER BY p.name`,
      staffScope ? [req.admin.id] : []
    );

    res.json(result.rows);
  })
);

// --------------------------------------------------
// UPDATE CUSTOMER
// --------------------------------------------------

app.patch(
  "/api/admin/customers/:id",
  requirePermission("customers:manage"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      fullName: z.string().trim().min(2).max(100),
      phone: phoneNumberSchema,
      email: z.string().trim().email().max(254)
        .or(z.literal(""))
        .transform(value => value || null)
    }).safeParse(req.body);

    const id = z.coerce.number().int().positive().safeParse(req.params.id);

    if (!id.success || !parsed.success) {
      return res.status(400).json({
        message: "Invalid customer details"
      });
    }

    const result = await pool.query(
      `UPDATE customers
       SET full_name = $1, phone = $2, email = $3
       WHERE id = $4`,
      [
        parsed.data.fullName,
        parsed.data.phone,
        parsed.data.email,
        id.data
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: "Customer not found" });
    }

    await recordAdminAudit(
      req.admin.id,
      "customer.updated",
      null,
      { customerId: id.data }
    );

    res.json({ ok: true });
  })
);

// --------------------------------------------------
// UPDATE PET
// --------------------------------------------------

app.patch(
  "/api/admin/pets/:id",
  requirePermission("pets:manage"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      name: z.string().trim().min(1).max(80),
      type: z.string().trim().min(1).max(40),
      breed: z.string().trim().max(80),
      age: z.string().trim().max(30),
      size: z.string().trim().max(30)
    }).safeParse(req.body);

    const id = z.coerce.number().int().positive().safeParse(req.params.id);

    if (!id.success || !parsed.success) {
      return res.status(400).json({ message: "Invalid pet details" });
    }

    const result = await pool.query(
      `UPDATE pets
       SET name = $1, type = $2, breed = $3, age = $4, size = $5
       WHERE id = $6`,
      [
        parsed.data.name,
        parsed.data.type,
        parsed.data.breed,
        parsed.data.age,
        parsed.data.size,
        id.data
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: "Pet not found" });
    }

    await recordAdminAudit(
      req.admin.id,
      "pet.updated",
      null,
      { petId: id.data }
    );

    res.json({ ok: true });
  })
);

// --------------------------------------------------
// UPDATE BOOKING STATUS
// --------------------------------------------------

app.patch(
  "/api/admin/bookings/:id/status",
  requirePermission("bookings:update"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      status: z.enum(["pending", "confirmed", "completed", "cancelled"])
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const id = z.coerce.number().int().positive().safeParse(req.params.id);

    if (!id.success) {
      return res.status(400).json({ message: "Invalid booking ID" });
    }

    const bookingResult = await pool.query(
      `SELECT
        b.id, b.reference, b.assigned_admin_id, b.status,
        b.appointment_date, b.start_time, b.final_amount,
        b.payment_method, c.full_name AS customer_name,
        c.email, p.name AS pet_name
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       JOIN pets p ON p.id = b.pet_id
       WHERE b.id = $1`,
      [id.data]
    );

    const booking = bookingResult.rows[0];

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (
      req.admin.role === "staff" &&
      Number(booking.assigned_admin_id) !== Number(req.admin.id)
    ) {
      return res.status(403).json({
        message: "You can only update appointments assigned to you"
      });
    }

    await pool.query(
      "UPDATE bookings SET status = $1 WHERE id = $2",
      [parsed.data.status, id.data]
    );

    await recordAdminAudit(
      req.admin.id,
      "booking.status_updated",
      null,
      {
        reference: booking.reference,
        status: parsed.data.status
      }
    );

    if (
      parsed.data.status === "confirmed" &&
      booking.status !== "confirmed" &&
      booking.email &&
      isEmailConfigured()
    ) {
      void (async () => {
        const servicesResult = await pool.query(
          `SELECT service_name AS name, price
           FROM booking_services
           WHERE booking_id = $1
           ORDER BY service_id`,
          [booking.id]
        );

        return sendBookingEmail({
          to: booking.email,
          customerName: booking.customer_name,
          reference: booking.reference,
          petName: booking.pet_name,
          services: servicesResult.rows,
          date: booking.appointment_date,
          time: booking.start_time,
          totalAmount: booking.final_amount,
          paymentMethod: booking.payment_method,
          status: "confirmed"
        });
      })().catch(logEmailFailure);
    }

    res.json({ ok: true });
  })
);

// --------------------------------------------------
// RESCHEDULE BOOKING
// --------------------------------------------------

app.patch(
  "/api/admin/bookings/:id/reschedule",
  requirePermission("bookings:update"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      date: z.string().refine(isValidDateString),
      time: z.string().refine(isValidTimeString)
    }).safeParse(req.body);

    const id = z.coerce.number().int().positive().safeParse(req.params.id);

    if (!id.success || !parsed.success) {
      return res.status(400).json({
        message: "Enter a valid appointment date and time"
      });
    }

    if (parsed.data.date < localToday()) {
      return res.status(400).json({
        message: "Past dates cannot be booked"
      });
    }

    const bookingResult = await pool.query(
      `SELECT id, reference, assigned_admin_id, total_duration,
              status, appointment_date, start_time
       FROM bookings
       WHERE id = $1`,
      [id.data]
    );

    const booking = bookingResult.rows[0];

    if (!booking) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (
      req.admin.role === "staff" &&
      Number(booking.assigned_admin_id) !== Number(req.admin.id)
    ) {
      return res.status(403).json({
        message: "You can only reschedule appointments assigned to you"
      });
    }

    if (["cancelled", "completed"].includes(booking.status)) {
      return res.status(400).json({
        message: "Cancelled or completed appointments cannot be rescheduled"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        [`booking:${parsed.data.date}`]
      );

      const slot = (await getSlots(
        parsed.data.date,
        Number(booking.total_duration),
        booking.id,
        client
      )).find(item => item.time === parsed.data.time);

      if (!slot || !slot.available) {
        const error = new Error(
          slot?.status === "booked"
            ? bookedSlotMessage
            : unavailableSlotMessage
        );

        error.code = "A1_SLOT_CONFLICT";
        throw error;
      }

      const endTime = timeString(
        minutes(parsed.data.time) + Number(booking.total_duration)
      );

      await client.query(
        `UPDATE bookings
         SET appointment_date = $1, start_time = $2, end_time = $3
         WHERE id = $4`,
        [parsed.data.date, parsed.data.time, endTime, booking.id]
      );

      await client.query("COMMIT");

    } catch (error) {
      await client.query("ROLLBACK");

      if (error.code === "A1_SLOT_CONFLICT") {
        return res.status(409).json({ message: error.message });
      }

      throw error;
    } finally {
      client.release();
    }

    await recordAdminAudit(
      req.admin.id,
      "booking.rescheduled",
      null,
      {
        reference: booking.reference,
        fromDate: booking.appointment_date,
        fromTime: booking.start_time,
        toDate: parsed.data.date,
        toTime: parsed.data.time
      }
    );

    res.json({ ok: true });
  })
);

// --------------------------------------------------
// UPDATE PAYMENT
// --------------------------------------------------

app.patch(
  "/api/admin/bookings/:id/payment",
  requirePermission("payments:update"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      status: z.enum(["pending", "paid", "failed", "refunded", "mock_paid"])
    }).safeParse(req.body);

    const id = z.coerce.number().int().positive().safeParse(req.params.id);

    if (!id.success || !parsed.success) {
      return res.status(400).json({
        message: "Invalid payment status"
      });
    }

    const bookingResult = await pool.query(
      `SELECT id, reference, assigned_admin_id,
              payment_method, final_amount
       FROM bookings
       WHERE id = $1`,
      [id.data]
    );

    const booking = bookingResult.rows[0];

    if (!booking) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (req.admin.role === "staff") {
      return res.status(403).json({
        message: "You do not have permission to update payment status"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        "UPDATE bookings SET payment_status = $1 WHERE id = $2",
        [parsed.data.status, booking.id]
      );

      const paymentResult = await client.query(
        `SELECT id
         FROM payments
         WHERE booking_id = $1
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [booking.id]
      );

      if (paymentResult.rows[0]) {
        await client.query(
          "UPDATE payments SET status = $1 WHERE id = $2",
          [parsed.data.status, paymentResult.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO payments(booking_id, provider, amount, status)
           VALUES($1, $2, $3, $4)`,
          [
            booking.id,
            booking.payment_method === "mock_online" ? "mock" : "shop",
            booking.final_amount,
            parsed.data.status
          ]
        );
      }

      await client.query("COMMIT");

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await recordAdminAudit(
      req.admin.id,
      "booking.payment_status_updated",
      null,
      {
        reference: booking.reference,
        paymentStatus: parsed.data.status
      }
    );

    res.json({
      ok: true,
      paymentStatus: parsed.data.status
    });
  })
);

// --------------------------------------------------
// UPDATE BOOKING AMOUNTS
// --------------------------------------------------

app.patch(
  "/api/admin/bookings/:id/amounts",
  requirePermission("bookings:update"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      additionalCharges: z.number().int().min(0).max(1000000000),
      discountAmount: z.number().int().min(0).max(1000000000)
    }).safeParse(req.body);

    const id = z.coerce.number().int().positive().safeParse(req.params.id);

    if (!id.success || !parsed.success) {
      return res.status(400).json({
        message: "Enter valid charge and discount amounts"
      });
    }

    if (req.admin.role === "staff") {
      return res.status(403).json({
        message: "You do not have permission to change appointment amounts"
      });
    }

    const bookingResult = await pool.query(
      "SELECT id, reference, total_price FROM bookings WHERE id = $1",
      [id.data]
    );

    const booking = bookingResult.rows[0];

    if (!booking) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    const finalAmount =
      Number(booking.total_price) +
      parsed.data.additionalCharges -
      parsed.data.discountAmount;

    if (finalAmount < 0) {
      return res.status(400).json({
        message: "Discount cannot exceed the service total plus additional charges"
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE bookings
         SET additional_charges = $1,
             discount_amount = $2,
             final_amount = $3
         WHERE id = $4`,
        [
          parsed.data.additionalCharges,
          parsed.data.discountAmount,
          finalAmount,
          booking.id
        ]
      );

      const paymentResult = await client.query(
        `SELECT id, status
         FROM payments
         WHERE booking_id = $1
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [booking.id]
      );

      const payment = paymentResult.rows[0];

      if (payment?.status === "pending") {
        await client.query(
          "UPDATE payments SET amount = $1 WHERE id = $2",
          [finalAmount, payment.id]
        );
      }

      await client.query("COMMIT");

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await recordAdminAudit(
      req.admin.id,
      "booking.amounts_updated",
      null,
      {
        reference: booking.reference,
        additionalCharges: parsed.data.additionalCharges,
        discountAmount: parsed.data.discountAmount,
        finalAmount
      }
    );

    res.json({ ok: true, finalAmount });
  })
);

// --------------------------------------------------
// ADMIN ASSIGNEES
// --------------------------------------------------

app.get(
  "/api/admin/assignees",
  requirePermission("bookings:assign"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `SELECT id, full_name AS "fullName", email
       FROM admins
       WHERE role = 'staff'
       AND status = 'active'
       ORDER BY full_name`
    );

    res.json(result.rows);
  })
);

// --------------------------------------------------
// ASSIGN BOOKING
// --------------------------------------------------

app.patch(
  "/api/admin/bookings/:id/assignee",
  requirePermission("bookings:assign"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      adminId: z.number().int().positive().nullable()
    }).safeParse(req.body);

    const id = z.coerce.number().int().positive().safeParse(req.params.id);

    if (!id.success || !parsed.success) {
      return res.status(400).json({
        message: "Invalid booking assignment"
      });
    }

    const bookingResult = await pool.query(
      "SELECT id, reference FROM bookings WHERE id = $1",
      [id.data]
    );

    const booking = bookingResult.rows[0];

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    let assignee = null;

    if (parsed.data.adminId !== null) {
      const result = await pool.query(
        `SELECT id, full_name
         FROM admins
         WHERE id = $1
         AND role = 'staff'
         AND status = 'active'`,
        [parsed.data.adminId]
      );

      assignee = result.rows[0];

      if (!assignee) {
        return res.status(400).json({
          message: "Select an active staff account"
        });
      }
    }

    await pool.query(
      "UPDATE bookings SET assigned_admin_id = $1 WHERE id = $2",
      [parsed.data.adminId, id.data]
    );

    await recordAdminAudit(
      req.admin.id,
      "booking.assigned",
      null,
      {
        reference: booking.reference,
        assignedAdmin: assignee?.full_name || null
      }
    );

    res.json({
      ok: true,
      assignedAdminId: parsed.data.adminId
    });
  })
);

// --------------------------------------------------
// ADMIN SERVICES
// --------------------------------------------------

app.get(
  "/api/admin/services",
  requirePermission("services:read"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM services ORDER BY id"
    );

    res.json(result.rows);
  })
);

app.post(
  "/api/admin/services",
  requirePermission("services:manage"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      name: z.string().trim().min(2),
      description: z.string().max(300).default(""),
      price: z.number().int().min(0),
      duration: z.number().int().min(5),
      active: z.boolean().default(true)
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid service details" });
    }

    const result = await pool.query(
      `INSERT INTO services(name, description, price, duration, active)
       VALUES($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        parsed.data.name,
        parsed.data.description,
        parsed.data.price,
        parsed.data.duration,
        parsed.data.active ? 1 : 0
      ]
    );

    const id = result.rows[0].id;

    await recordAdminAudit(
      req.admin.id,
      "service.created",
      null,
      { serviceId: id, name: parsed.data.name }
    );

    res.status(201).json({ id });
  })
);

app.patch(
  "/api/admin/services/:id",
  requirePermission("services:manage"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      name: z.string().trim().min(2),
      description: z.string().max(300),
      price: z.number().int().min(0),
      duration: z.number().int().min(5),
      active: z.boolean()
    }).safeParse(req.body);

    const id = z.coerce.number().int().positive().safeParse(req.params.id);

    if (!parsed.success || !id.success) {
      return res.status(400).json({ message: "Invalid service details" });
    }

    const result = await pool.query(
      `UPDATE services
       SET name = $1, description = $2, price = $3,
           duration = $4, active = $5
       WHERE id = $6`,
      [
        parsed.data.name,
        parsed.data.description,
        parsed.data.price,
        parsed.data.duration,
        parsed.data.active ? 1 : 0,
        id.data
      ]
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: "Service not found" });
    }

    await recordAdminAudit(
      req.admin.id,
      "service.updated",
      null,
      {
        serviceId: id.data,
        name: parsed.data.name
      }
    );

    res.json({ ok: true });
  })
);

// --------------------------------------------------
// CSV EXPORT HELPERS
// --------------------------------------------------

function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(
    Date.UTC(year, month - 1, day + days)
  ).toISOString().slice(0, 10);
}

function csvCell(value) {
  const text = String(value ?? "");

  const safe = /^[\t\r=+\-@]/.test(text.trimStart())
    ? `'${text}`
    : text;

  return `"${safe.replaceAll('"', '""')}"`;
}

// --------------------------------------------------
// ADMIN BOOKING CSV EXPORT
// --------------------------------------------------

app.get(
  "/api/admin/bookings.csv",
  requirePermission("bookings:export"),
  asyncHandler(async (req, res) => {
    const parsed = z.object({
      scope: z.enum(["all", "today", "week", "month", "range"]).default("all"),
      from: z.string().optional(),
      to: z.string().optional()
    }).safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid export filter" });
    }

    const { scope } = parsed.data;
    const today = localToday();

    let from = null;
    let to = null;

    if (scope === "today") {
      from = today;
      to = today;
    }

    if (scope === "week") {
      const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();

      from = addDays(today, -((weekday + 6) % 7));
      to = addDays(from, 6);
    }

    if (scope === "month") {
      from = `${today.slice(0, 7)}-01`;

      const [year, month] = today.split("-").map(Number);

      to = new Date(Date.UTC(year, month, 0))
        .toISOString().slice(0, 10);
    }

    if (scope === "range") {
      if (
        !isValidDateString(parsed.data.from) ||
        !isValidDateString(parsed.data.to) ||
        parsed.data.from > parsed.data.to
      ) {
        return res.status(400).json({
          message: "Select a valid start and end date"
        });
      }

      from = parsed.data.from;
      to = parsed.data.to;
    }

    const conditions = [];
    const params = [];

    if (from) {
      params.push(from);
      conditions.push(`b.appointment_date >= $${params.length}`);
    }

    if (to) {
      params.push(to);
      conditions.push(`b.appointment_date <= $${params.length}`);
    }

    const result = await pool.query(
      `SELECT
        b.id, b.reference, b.appointment_date, b.start_time,
        b.status, b.total_price, b.additional_charges,
        b.discount_amount, b.final_amount, b.payment_method,
        b.created_at, b.notes,
        COALESCE(
          (SELECT pay.status FROM payments pay
           WHERE pay.booking_id = b.id
           ORDER BY pay.id DESC LIMIT 1),
          b.payment_status
        ) AS payment_status,
        (SELECT pay.provider FROM payments pay
         WHERE pay.booking_id = b.id
         ORDER BY pay.id DESC LIMIT 1) AS payment_provider,
        (SELECT pay.amount FROM payments pay
         WHERE pay.booking_id = b.id
         ORDER BY pay.id DESC LIMIT 1) AS payment_amount,
        c.full_name AS customer_name,
        c.phone AS customer_phone,
        c.email AS customer_email,
        p.name AS pet_name,
        p.type AS pet_type,
        p.breed AS pet_breed,
        p.age AS pet_age,
        p.size AS pet_size
       FROM bookings b
       JOIN customers c ON c.id = b.customer_id
       JOIN pets p ON p.id = b.pet_id
       ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY b.appointment_date, b.start_time`,
      params
    );

    const bookings = await includeBookingServices(result.rows);

    const columns = [
      "Appointment ID",
      "Booking Reference",
      "Customer Name",
      "Customer Phone",
      "Customer Email",
      "Pet Name",
      "Pet Type",
      "Pet Breed",
      "Pet Age",
      "Pet Size",
      "Selected Services",
      "Individual Service Costs (INR)",
      "Appointment Date",
      "Appointment Time",
      "Booking Created Date",
      "Booking Created Time",
      "Service Total (INR)",
      "Additional Charges (INR)",
      "Discount Amount (INR)",
      "Final Amount (INR)",
      "Payment Method",
      "Payment Provider",
      "Payment Amount (INR)",
      "Payment Status",
      "Appointment Status",
      "Notes"
    ];

    const records = bookings.map(booking => {
      const createdAt = String(booking.created_at || "");
      const services = booking.services
        .map(service => service.name)
        .join("; ");

      const serviceCosts = booking.services
        .map(service =>
          `${service.name}: ${service.price} INR (${service.duration} min)`
        )
        .join("; ");

      return [
        booking.id,
        booking.reference,
        booking.customer_name,
        booking.customer_phone,
        booking.customer_email,
        booking.pet_name,
        booking.pet_type,
        booking.pet_breed,
        booking.pet_age,
        booking.pet_size,
        services,
        serviceCosts,
        booking.appointment_date,
        booking.start_time,
        createdAt.slice(0, 10),
        createdAt.slice(11, 19),
        booking.total_price,
        booking.additional_charges,
        booking.discount_amount,
        booking.final_amount,
        booking.payment_method,
        booking.payment_provider,
        booking.payment_amount,
        booking.payment_status,
        booking.status,
        booking.notes
      ];
    });

    const csv = "\uFEFF" +
      [columns, ...records]
        .map(row => row.map(csvCell).join(","))
        .join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="A1_Paws_Appointments_${today}.csv"`
    );

    res.send(csv);
  })
);

// --------------------------------------------------
// GLOBAL ERROR HANDLER
// --------------------------------------------------

app.use((err, req, res, next) => {
  console.error("API ERROR:", err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    message: "Internal server error"
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log(`A1 Paws API running at http://localhost:${port}`);
});
