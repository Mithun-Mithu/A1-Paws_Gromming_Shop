
import { pool } from "./config/postgres.js";

const checks = [
  ["Pets without customers", `
    SELECT COUNT(*) FROM pets p
    LEFT JOIN customers c ON p.customer_id = c.id
    WHERE c.id IS NULL
  `],
  ["Bookings without customers", `
    SELECT COUNT(*) FROM bookings b
    LEFT JOIN customers c ON b.customer_id = c.id
    WHERE c.id IS NULL
  `],
  ["Bookings without pets", `
    SELECT COUNT(*) FROM bookings b
    LEFT JOIN pets p ON b.pet_id = p.id
    WHERE p.id IS NULL
  `],
  ["Booking services without bookings", `
    SELECT COUNT(*) FROM booking_services bs
    LEFT JOIN bookings b ON bs.booking_id = b.id
    WHERE b.id IS NULL
  `],
  ["Booking services without services", `
    SELECT COUNT(*) FROM booking_services bs
    LEFT JOIN services s ON bs.service_id = s.id
    WHERE s.id IS NULL
  `],
  ["Payments without bookings", `
    SELECT COUNT(*) FROM payments p
    LEFT JOIN bookings b ON p.booking_id = b.id
    WHERE b.id IS NULL
  `]
];

try {
  let failed = false;

  for (const [label, sql] of checks) {
    const result = await pool.query(sql);
    const count = Number(result.rows[0].count);

    console.log(`${label}: ${count}`);

    if (count !== 0) failed = true;
  }

  console.log(
    failed
      ? "RELATIONSHIP VERIFICATION FAILED"
      : "ALL RELATIONSHIPS VERIFIED SUCCESSFULLY"
  );

  if (failed) process.exitCode = 1;
} catch (error) {
  console.error("Verification error:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
