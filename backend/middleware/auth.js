import jwt from "jsonwebtoken";
import { db } from "../config/database.js";

const rolePermissions = {
  super_admin: new Set(["*"]),
  admin: new Set([
    "dashboard:read", "bookings:read", "bookings:update", "bookings:assign", "bookings:export",
    "payments:update", "customers:read", "customers:manage", "pets:read", "pets:manage", "services:read", "services:manage", "contacts:manage"
  ]),
  staff: new Set(["dashboard:read", "bookings:read", "bookings:update", "customers:read", "pets:read"])
};

export function requireAdmin(req,res,next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i,"");
  if (!token) return res.status(401).json({message:"Admin login required"});
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch { return res.status(401).json({message:"Invalid or expired session"}); }
  const admin = db.prepare("SELECT id,email,full_name,role,status,token_version FROM admins WHERE id=?").get(payload.id);
  if (!admin || admin.status !== "active" || !rolePermissions[admin.role] ||
    payload.role !== admin.role || payload.version !== admin.token_version) {
    return res.status(401).json({message:"Invalid or expired session"});
  }
  req.admin = {id:admin.id,email:admin.email,fullName:admin.full_name,role:admin.role,version:admin.token_version};
  next();
}

export function requireRole(...roles) {
  return (req,res,next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return res.status(403).json({message:"You do not have permission to perform this action"});
    }
    next();
  };
}

export function requirePermission(permission) {
  return (req,res,next) => {
    const permissions = rolePermissions[req.admin?.role];
    if (!permissions || (!permissions.has("*") && !permissions.has(permission))) {
      return res.status(403).json({message:"You do not have permission to perform this action"});
    }
    next();
  };
}
