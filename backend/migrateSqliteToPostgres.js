
import Database from "better-sqlite3";
import { pool } from "./config/postgres.js";

const sqlite = new Database("config/a1-paws-backup.sqlite", {
  readonly: true
});

const tables = [
  {
    name: "admins",
    columns: [
      "id", "email", "password_hash", "role", "token_version",
      "full_name", "phone", "status", "created_at"
    ]
  },
  {
    name: "customers",
    columns: ["id", "full_name", "phone", "email"]
  },
  {
    name: "services",
    columns: [
      "id", "name", "description", "price",
      "duration", "active", "image_url"
    ]
  },
  {
    name: "business_hours",
    columns: ["weekday", "is_open", "open_time", "close_time"]
  },
  {
    name: "holidays",
    columns: ["date", "label"]
  },
  {
    name: "pets",
    columns: ["id", "customer_id", "name", "type", "breed", "age", "size"]
  },
  {
    name: "bookings",
    columns: [
      "id", "reference", "customer_id", "pet_id",
      "appointment_date", "start_time", "end_time",
      "total_price", "total_duration", "payment_method",
      "payment_status", "status", "notes", "created_at",
      "assigned_admin_id", "additional_charges",
      "discount_amount", "final_amount"
    ]
  },
  {
    name: "booking_services",
    columns: [
      "booking_id", "service_id", "service_name", "price", "duration"
    ]
  },
  {
    name: "payments",
    columns: [
      "id", "booking_id", "provider", "amount", "status", "created_at"
    ]
  },
  {
    name: "admin_password_resets",
    columns: [
      "admin_id", "otp_hash", "otp_salt", "expires_at",
      "last_sent_at", "attempts", "reset_token_hash", "reset_expires_at"
    ]
  },
  {
    name: "admin_audit_log",
    columns: [
      "id", "actor_admin_id", "target_admin_id",
      "action", "details", "created_at"
    ]
  },
  {
    name: "contact_numbers",
    columns: [
      "id", "label", "country_code", "phone_number",
      "call_enabled", "whatsapp_enabled", "whatsapp_message",
      "is_primary", "status", "created_at", "updated_at"
    ]
  }
];

const identityTables = [
  "admins",
  "customers",
  "services",
  "pets",
  "bookings",
  "payments",
  "admin_audit_log",
  "contact_numbers"
];

async function migrate() {
  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();

    // Read all SQLite records before starting the PostgreSQL transaction.
    const sourceData = {};

    for (const table of tables) {
      sourceData[table.name] = sqlite
        .prepare(`SELECT * FROM "${table.name}"`)
        .all();

      console.log(
        `${table.name}: ${sourceData[table.name].length} source records`
      );
    }

    await client.query("BEGIN");
    transactionStarted = true;

    // Prevent accidental duplicate imports or overwriting existing records.
    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM "${table.name}"`
      );

      if (result.rows[0].count !== 0) {
        throw new Error(
          `Destination table ${table.name} is not empty. Migration stopped.`
        );
      }
    }

    // Import records in foreign-key-safe order.
    for (const table of tables) {
      const rows = sourceData[table.name];

      if (rows.length === 0) {
        continue;
      }

      const columns = table.columns
        .map(column => `"${column}"`)
        .join(", ");

      const placeholders = table.columns
        .map((_, index) => `$${index + 1}`)
        .join(", ");

      const insertSql = `
        INSERT INTO "${table.name}" (${columns})
        VALUES (${placeholders})
      `;

      for (const row of rows) {
        const values = table.columns.map(column => row[column]);

        await client.query(insertSql, values);
      }

      console.log(
        `Imported ${rows.length} records into ${table.name}`
      );
    }

    // Reset identity sequences to prevent future ID conflicts.
    for (const table of identityTables) {
      await client.query(
        `
          SELECT setval(
            pg_get_serial_sequence('"public"."${table}"', 'id'),
            COALESCE(MAX(id), 1),
            MAX(id) IS NOT NULL
          )
          FROM "${table}"
        `
      );
    }

    // Verify all destination record counts before committing.
    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM "${table.name}"`
      );

      const expected = sourceData[table.name].length;
      const actual = result.rows[0].count;

      if (actual !== expected) {
        throw new Error(
          `Count mismatch in ${table.name}: expected ${expected}, found ${actual}`
        );
      }

      console.log(
        `Verified ${table.name}: ${actual} records`
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    console.log("\nMIGRATION COMPLETED SUCCESSFULLY!");
  } catch (error) {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError.message);
      }
    }

    console.error("\nMIGRATION FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    if (client) {
      client.release();
    }

    sqlite.close();
    await pool.end();
  }
}

migrate();
