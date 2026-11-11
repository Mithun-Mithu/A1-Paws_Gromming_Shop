import { db } from "../config/database.js";

const publicAdminFields = `id,full_name AS fullName,email,phone,role,status,created_at AS createdAt`;

export class AdminManagementError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function audit(actorAdminId, targetAdminId, action, details) {
  db.prepare(`INSERT INTO admin_audit_log(actor_admin_id,target_admin_id,action,details)
    VALUES(?,?,?,?)`).run(actorAdminId,targetAdminId,action,JSON.stringify(details));
}

function findAdmin(id) {
  return db.prepare(`SELECT id,full_name,email,phone,role,status,created_at,token_version
    FROM admins WHERE id=?`).get(id);
}

function countActiveSuperAdmins() {
  return db.prepare("SELECT COUNT(*) AS count FROM admins WHERE role='super_admin' AND status='active'").get().count;
}

function preventLastSuperAdmin(target, nextRole, nextStatus) {
  const remainsSuperAdmin = nextRole === "super_admin" && nextStatus === "active";
  if (target.role === "super_admin" && target.status === "active" && !remainsSuperAdmin && countActiveSuperAdmins() <= 1) {
    throw new AdminManagementError(409,"The last active Super Admin cannot be demoted or deactivated");
  }
}

export function listAdmins(search = "") {
  const escaped = search.replace(/[!%_]/g,"!$&");
  const pattern = `%${escaped}%`;
  const admins = db.prepare(`SELECT ${publicAdminFields} FROM admins
    WHERE ?='' OR lower(full_name) LIKE lower(?) ESCAPE '!' OR lower(email) LIKE lower(?) ESCAPE '!'
    ORDER BY created_at DESC,id DESC`).all(search,pattern,pattern);
  const counts = db.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN status='inactive' THEN 1 ELSE 0 END) AS inactive FROM admins`).get();
  return {admins,counts:{total:counts.total,active:counts.active||0,inactive:counts.inactive||0}};
}

export function getAdminById(id) {
  return db.prepare(`SELECT ${publicAdminFields} FROM admins WHERE id=?`).get(id);
}

export function createAdmin(data, actorAdminId) {
  return db.transaction(() => {
    const result = db.prepare(`INSERT INTO admins(full_name,email,password_hash,phone,role,status,created_at)
      VALUES(?,?,?,?,?,'active',CURRENT_TIMESTAMP)`).run(
      data.fullName,data.email,data.passwordHash,data.phone,data.role
    );
    const id = Number(result.lastInsertRowid);
    audit(actorAdminId,id,"admin.created",{fullName:data.fullName,email:data.email,role:data.role});
    return getAdminById(id);
  })();
}

export function updateAdmin(id, data, actorAdminId) {
  return db.transaction(() => {
    const current = findAdmin(id);
    if (!current) throw new AdminManagementError(404,"Admin account not found");
    const duplicate = db.prepare("SELECT id FROM admins WHERE email=? COLLATE NOCASE AND id<>?").get(data.email,id);
    if (duplicate) throw new AdminManagementError(409,"That email address is already registered");
    if (actorAdminId === id && (data.role !== "super_admin" || current.status !== "active")) {
      throw new AdminManagementError(409,"You cannot remove your own Super Admin access");
    }
    preventLastSuperAdmin(current,data.role,current.status);
    const revokeSessions = actorAdminId !== id || data.role !== current.role;
    db.prepare(`UPDATE admins SET full_name=?,email=?,phone=?,role=?,
      token_version=token_version+${revokeSessions ? 1 : 0}
      WHERE id=?`).run(data.fullName,data.email,data.phone,data.role,id);
    audit(actorAdminId,id,"admin.updated",{
      before:{fullName:current.full_name,email:current.email,phone:current.phone,role:current.role},
      after:{fullName:data.fullName,email:data.email,phone:data.phone,role:data.role}
    });
    return getAdminById(id);
  })();
}

export function setAdminStatus(id, status, actorAdminId) {
  return db.transaction(() => {
    const current = findAdmin(id);
    if (!current) throw new AdminManagementError(404,"Admin account not found");
    if (actorAdminId === id && status !== "active") {
      throw new AdminManagementError(409,"You cannot deactivate your own account");
    }
    preventLastSuperAdmin(current,current.role,status);
    if (current.status !== status) {
      db.prepare("UPDATE admins SET status=?,token_version=token_version+1 WHERE id=?").run(status,id);
      audit(actorAdminId,id,status==="active"?"admin.activated":"admin.deactivated",{
        fullName:current.full_name,email:current.email
      });
    }
    return getAdminById(id);
  })();
}

export function deleteAdmin(id, actorAdminId) {
  return db.transaction(() => {
    const current = findAdmin(id);
    if (!current) throw new AdminManagementError(404,"Admin account not found");
    if (actorAdminId === id) throw new AdminManagementError(409,"You cannot delete your own account");
    preventLastSuperAdmin(current,null,null);
    audit(actorAdminId,id,"admin.deleted",{fullName:current.full_name,email:current.email,role:current.role});
    db.prepare("DELETE FROM admins WHERE id=?").run(id);
    return current;
  })();
}

export function recordAdminAudit(actorAdminId, action, targetAdminId = null, details = {}) {
  audit(actorAdminId,targetAdminId,action,details);
}

export function listAdminAudit(limit = 100) {
  return db.prepare(`SELECT l.id,l.action,l.details,l.created_at AS createdAt,
    actor.full_name AS actorName,actor.email AS actorEmail
    FROM admin_audit_log l LEFT JOIN admins actor ON actor.id=l.actor_admin_id
    ORDER BY l.id DESC LIMIT ?`).all(limit);
}
