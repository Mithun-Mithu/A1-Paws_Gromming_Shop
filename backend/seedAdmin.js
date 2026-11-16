
import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./config/postgres.js";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const fullName =
  process.env.ADMIN_NAME?.trim() || "A1 Paws Administrator";
const phone = process.env.ADMIN_PHONE?.trim() || "";

if (
  !email ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  !password ||
  password.length < 12 ||
  !/[a-z]/.test(password) ||
  !/[A-Z]/.test(password) ||
  !/\d/.test(password) ||
  !/[^A-Za-z0-9]/.test(password)
) {
  throw new Error(
    "Set a valid ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters with upper/lowercase letters, a number, and a symbol in backend/.env"
  );
}

async function seedAdmin() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id
       FROM admins
       WHERE LOWER(email) = LOWER($1)
       FOR UPDATE`,
      [email]
    );

    const hash = await bcrypt.hash(password, 12);

    let adminId;

    if (existing.rows.length > 0) {
      adminId = existing.rows[0].id;

      await client.query(
        `UPDATE admins
         SET full_name = $1,
             email = $2,
             password_hash = $3,
             phone = $4,
             role = 'super_admin',
             status = 'active',
             token_version = token_version + 1
         WHERE id = $5`,
        [fullName, email, hash, phone, adminId]
      );
    } else {
      const result = await client.query(
        `INSERT INTO admins
          (full_name, email, password_hash, phone, role, status)
         VALUES ($1, $2, $3, $4, 'super_admin', 'active')
         RETURNING id`,
        [fullName, email, hash, phone]
      );

      adminId = result.rows[0].id;
    }

    await client.query(
      "DELETE FROM admin_password_resets WHERE admin_id = $1",
      [adminId]
    );

    await client.query("COMMIT");

    console.log(`Admin account ready: ${email}`);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Admin seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seedAdmin();
