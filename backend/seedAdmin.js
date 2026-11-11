import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./config/database.js";
const email=process.env.ADMIN_EMAIL?.toLowerCase();
const password=process.env.ADMIN_PASSWORD;
const fullName=process.env.ADMIN_NAME?.trim()||"A1 Paws Administrator";
const phone=process.env.ADMIN_PHONE?.trim()||"";
if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length<12 ||
  !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password))
  throw new Error("Set a valid ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters with upper/lowercase letters, a number, and a symbol in backend/.env");
const hash=await bcrypt.hash(password,12);
db.transaction(()=>{
  const existing=db.prepare("SELECT id FROM admins WHERE email=? COLLATE NOCASE").get(email);
  if(existing) {
    db.prepare(`UPDATE admins SET full_name=?,email=?,password_hash=?,phone=?,role='super_admin',
      status='active',token_version=token_version+1 WHERE id=?`).run(fullName,email,hash,phone,existing.id);
  } else {
    db.prepare(`INSERT INTO admins(full_name,email,password_hash,phone,role,status)
      VALUES(?,?,?,?,'super_admin','active')`).run(fullName,email,hash,phone);
  }
  db.prepare("DELETE FROM admin_password_resets WHERE admin_id=(SELECT id FROM admins WHERE email=?)").run(email);
})();
console.log(`Admin account ready: ${email}`);
