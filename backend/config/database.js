import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const db = new Database(process.env.DATABASE_PATH || path.join(here, "a1-paws.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 full_name TEXT NOT NULL DEFAULT '',
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 phone TEXT NOT NULL DEFAULT '',
 role TEXT NOT NULL DEFAULT 'admin',
 status TEXT NOT NULL DEFAULT 'active',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 token_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS customers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 full_name TEXT NOT NULL,
 phone TEXT NOT NULL,
 email TEXT
);
CREATE TABLE IF NOT EXISTS pets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL REFERENCES customers(id),
 name TEXT NOT NULL, type TEXT NOT NULL, breed TEXT, age TEXT, size TEXT
);
CREATE TABLE IF NOT EXISTS services (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, description TEXT DEFAULT '',
 price INTEGER NOT NULL CHECK(price >= 0),
 duration INTEGER NOT NULL CHECK(duration > 0),
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS bookings (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reference TEXT UNIQUE NOT NULL,
 customer_id INTEGER NOT NULL REFERENCES customers(id),
 pet_id INTEGER NOT NULL REFERENCES pets(id),
 appointment_date TEXT NOT NULL,
 start_time TEXT NOT NULL,
 end_time TEXT NOT NULL,
 total_price INTEGER NOT NULL,
 total_duration INTEGER NOT NULL,
 additional_charges INTEGER NOT NULL DEFAULT 0,
 discount_amount INTEGER NOT NULL DEFAULT 0,
 final_amount INTEGER NOT NULL DEFAULT 0,
 payment_method TEXT NOT NULL,
 payment_status TEXT NOT NULL DEFAULT 'pending',
 status TEXT NOT NULL DEFAULT 'pending',
 assigned_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
 notes TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS booking_services (
 booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 service_id INTEGER NOT NULL REFERENCES services(id),
 service_name TEXT NOT NULL,
 price INTEGER NOT NULL,
 duration INTEGER NOT NULL,
 PRIMARY KEY(booking_id, service_id)
);
CREATE TABLE IF NOT EXISTS business_hours (
 weekday INTEGER PRIMARY KEY,
 is_open INTEGER NOT NULL,
 open_time TEXT NOT NULL,
 close_time TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS holidays (
 date TEXT PRIMARY KEY, label TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 booking_id INTEGER NOT NULL REFERENCES bookings(id),
 provider TEXT NOT NULL, amount INTEGER NOT NULL,
 status TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_password_resets (
 admin_id INTEGER PRIMARY KEY REFERENCES admins(id) ON DELETE CASCADE,
 otp_hash TEXT,
 otp_salt TEXT,
 expires_at INTEGER,
 last_sent_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 reset_token_hash TEXT,
 reset_expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS admin_audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
 target_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
 action TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contact_numbers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 label TEXT NOT NULL,
 country_code TEXT NOT NULL,
 phone_number TEXT NOT NULL,
 call_enabled INTEGER NOT NULL DEFAULT 1 CHECK(call_enabled IN (0,1)),
 whatsapp_enabled INTEGER NOT NULL DEFAULT 1 CHECK(whatsapp_enabled IN (0,1)),
 whatsapp_message TEXT NOT NULL DEFAULT 'Hello A1 PAWS! I would like to enquire about your pet grooming services and appointment availability.',
 is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(is_primary=0 OR status='active'),
 UNIQUE(country_code,phone_number)
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(appointment_date);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON customers(phone);
`);

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(existing => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing("admins", "full_name", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("admins", "phone", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("admins", "status", "TEXT NOT NULL DEFAULT 'active'");
addColumnIfMissing("admins", "created_at", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("admins", "token_version", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("bookings", "assigned_admin_id", "INTEGER REFERENCES admins(id) ON DELETE SET NULL");
addColumnIfMissing("bookings", "additional_charges", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("bookings", "discount_amount", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("bookings", "final_amount", "INTEGER NOT NULL DEFAULT 0");
db.exec(`
 UPDATE admins SET full_name=substr(email,1,instr(email,'@')-1) WHERE full_name='';
 UPDATE admins SET created_at=CURRENT_TIMESTAMP WHERE created_at='';
 UPDATE bookings SET final_amount=total_price+additional_charges-discount_amount WHERE final_amount=0;
 UPDATE bookings SET payment_status=(
   SELECT payments.status FROM payments WHERE payments.booking_id=bookings.id ORDER BY payments.id DESC LIMIT 1
 ) WHERE EXISTS(SELECT 1 FROM payments WHERE payments.booking_id=bookings.id);
 CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_email_case_insensitive ON admins(email COLLATE NOCASE);
 CREATE INDEX IF NOT EXISTS idx_bookings_assigned_admin ON bookings(assigned_admin_id);
 CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at);
 CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_numbers_single_primary ON contact_numbers(is_primary) WHERE is_primary=1;
`);

const contactCount = db.prepare("SELECT COUNT(*) AS n FROM contact_numbers").get().n;
if (!contactCount) {
  const insertContact = db.prepare(`INSERT INTO contact_numbers(
    label,country_code,phone_number,call_enabled,whatsapp_enabled,whatsapp_message,is_primary,status
  ) VALUES(?, '91', ?, 1, 1, ?, ?, 'active')`);
  const defaultMessage = "Hello A1 PAWS! I would like to enquire about your pet grooming services and appointment availability.";
  [
    ["Main Contact","9740708576",1],
    ["Alternate Contact","9901543772",0],
    ["Additional Contact","9353639773",0]
  ].forEach(([label,number,isPrimary])=>insertContact.run(label,number,defaultMessage,isPrimary));
}

const count = db.prepare("SELECT COUNT(*) AS n FROM services").get().n;
if (!count) {
  const insert = db.prepare("INSERT INTO services(name,description,price,duration) VALUES(?,?,?,?)");
  [
    ["Bathing","Gentle bath with pet-safe shampoo",600,45],
    ["Towel Dry","Gentle removal of excess moisture",200,15],
    ["Blow Dry","Low-heat drying",300,25],
    ["Basic Trim","Paw, face, sanitary and underbelly trim",500,40],
    ["Zero Trim","Uniform short coat trim",800,50],
    ["Full Body Trim","Customized full-body grooming",1000,75]
  ].forEach(x => insert.run(...x));
}
const hours = db.prepare("SELECT COUNT(*) AS n FROM business_hours").get().n;
if (!hours) {
  const insert = db.prepare("INSERT INTO business_hours(weekday,is_open,open_time,close_time) VALUES(?,?,?,?)");
  for (let day=0; day<7; day++) insert.run(day, day===0 ? 0 : 1, "10:00", "18:00");
}
