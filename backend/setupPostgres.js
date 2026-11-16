
import { pool } from "./config/postgres.js";
import { schema } from "./config/postgresSchema.js";

async function setupDatabase() {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(schema);
    await client.query("COMMIT");

    console.log("PostgreSQL tables created successfully!");

    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log("Tables found:", result.rows.length);
    console.table(result.rows);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Database setup failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

setupDatabase();
