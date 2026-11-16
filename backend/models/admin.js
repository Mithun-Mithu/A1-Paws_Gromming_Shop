
import { pool } from "../config/postgres.js";

const publicAdminFields = `
  id,
  full_name AS "fullName",
  email,
  phone,
  role,
  status,
  created_at AS "createdAt"
`;

export class AdminManagementError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function audit(client, actorAdminId, targetAdminId, action, details) {
  await client.query(
    `INSERT INTO admin_audit_log
      (actor_admin_id, target_admin_id, action, details)
     VALUES ($1, $2, $3, $4)`,
    [actorAdminId, targetAdminId, action, JSON.stringify(details)]
  );
}

async function findAdmin(client, id) {
  const result = await client.query(
    `SELECT id, full_name, email, phone, role, status, created_at, token_version
     FROM admins
     WHERE id = $1
     FOR UPDATE`,
    [id]
  );

  return result.rows[0];
}

async function getAdminByIdUsing(client, id) {
  const result = await client.query(
    `SELECT ${publicAdminFields}
     FROM admins
     WHERE id = $1`,
    [id]
  );

  return result.rows[0];
}

async function preventLastSuperAdmin(client, target, nextRole, nextStatus) {
  const remainsSuperAdmin =
    nextRole === "super_admin" && nextStatus === "active";

  if (
    target.role === "super_admin" &&
    target.status === "active" &&
    !remainsSuperAdmin
  ) {
    const result = await client.query(
      `SELECT COUNT(*) AS count
       FROM admins
       WHERE role = 'super_admin' AND status = 'active'`
    );

    if (Number(result.rows[0].count) <= 1) {
      throw new AdminManagementError(
        409,
        "The last active Super Admin cannot be demoted or deactivated"
      );
    }
  }
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize admin-management changes to protect the last Super Admin.
    await client.query(
      "LOCK TABLE admins IN SHARE ROW EXCLUSIVE MODE"
    );

    const result = await callback(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listAdmins(search = "") {
  const escaped = search.replace(/[!%_]/g, "!$&");
  const pattern = `%${escaped}%`;

  const [adminResult, countResult] = await Promise.all([
    pool.query(
      `SELECT ${publicAdminFields}
       FROM admins
       WHERE $1 = ''
          OR LOWER(full_name) LIKE LOWER($2) ESCAPE '!'
          OR LOWER(email) LIKE LOWER($2) ESCAPE '!'
       ORDER BY created_at DESC, id DESC`,
      [search, pattern]
    ),

    pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'active') AS active,
         COUNT(*) FILTER (WHERE status = 'inactive') AS inactive
       FROM admins`
    )
  ]);

  const counts = countResult.rows[0];

  return {
    admins: adminResult.rows,
    counts: {
      total: Number(counts.total),
      active: Number(counts.active),
      inactive: Number(counts.inactive)
    }
  };
}

export async function getAdminById(id) {
  return getAdminByIdUsing(pool, id);
}

export async function createAdmin(data, actorAdminId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO admins
        (full_name, email, password_hash, phone, role, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'active', CURRENT_TIMESTAMP)
       RETURNING id`,
      [
        data.fullName,
        data.email,
        data.passwordHash,
        data.phone,
        data.role
      ]
    );

    const id = result.rows[0].id;

    await audit(
      client,
      actorAdminId,
      id,
      "admin.created",
      {
        fullName: data.fullName,
        email: data.email,
        role: data.role
      }
    );

    return getAdminByIdUsing(client, id);
  });
}

export async function updateAdmin(id, data, actorAdminId) {
  return withTransaction(async (client) => {
    const current = await findAdmin(client, id);

    if (!current) {
      throw new AdminManagementError(404, "Admin account not found");
    }

    const duplicate = await client.query(
      `SELECT id
       FROM admins
       WHERE LOWER(email) = LOWER($1)
         AND id <> $2`,
      [data.email, id]
    );

    if (duplicate.rows.length > 0) {
      throw new AdminManagementError(
        409,
        "That email address is already registered"
      );
    }

    if (
      actorAdminId === id &&
      (data.role !== "super_admin" || current.status !== "active")
    ) {
      throw new AdminManagementError(
        409,
        "You cannot remove your own Super Admin access"
      );
    }

    await preventLastSuperAdmin(
      client,
      current,
      data.role,
      current.status
    );

    const revokeSessions =
      actorAdminId !== id || data.role !== current.role;

    await client.query(
      `UPDATE admins
       SET full_name = $1,
           email = $2,
           phone = $3,
           role = $4,
           token_version = token_version + $5
       WHERE id = $6`,
      [
        data.fullName,
        data.email,
        data.phone,
        data.role,
        revokeSessions ? 1 : 0,
        id
      ]
    );

    await audit(
      client,
      actorAdminId,
      id,
      "admin.updated",
      {
        before: {
          fullName: current.full_name,
          email: current.email,
          phone: current.phone,
          role: current.role
        },
        after: {
          fullName: data.fullName,
          email: data.email,
          phone: data.phone,
          role: data.role
        }
      }
    );

    return getAdminByIdUsing(client, id);
  });
}

export async function setAdminStatus(id, status, actorAdminId) {
  return withTransaction(async (client) => {
    const current = await findAdmin(client, id);

    if (!current) {
      throw new AdminManagementError(404, "Admin account not found");
    }

    if (actorAdminId === id && status !== "active") {
      throw new AdminManagementError(
        409,
        "You cannot deactivate your own account"
      );
    }

    await preventLastSuperAdmin(
      client,
      current,
      current.role,
      status
    );

    if (current.status !== status) {
      await client.query(
        `UPDATE admins
         SET status = $1,
             token_version = token_version + 1
         WHERE id = $2`,
        [status, id]
      );

      await audit(
        client,
        actorAdminId,
        id,
        status === "active" ? "admin.activated" : "admin.deactivated",
        {
          fullName: current.full_name,
          email: current.email
        }
      );
    }

    return getAdminByIdUsing(client, id);
  });
}

export async function deleteAdmin(id, actorAdminId) {
  return withTransaction(async (client) => {
    const current = await findAdmin(client, id);

    if (!current) {
      throw new AdminManagementError(404, "Admin account not found");
    }

    if (actorAdminId === id) {
      throw new AdminManagementError(
        409,
        "You cannot delete your own account"
      );
    }

    await preventLastSuperAdmin(client, current, null, null);

    await audit(
      client,
      actorAdminId,
      id,
      "admin.deleted",
      {
        fullName: current.full_name,
        email: current.email,
        role: current.role
      }
    );

    await client.query(
      "DELETE FROM admins WHERE id = $1",
      [id]
    );

    return current;
  });
}

export async function recordAdminAudit(
  actorAdminId,
  action,
  targetAdminId = null,
  details = {}
) {
  const client = await pool.connect();

  try {
    await audit(
      client,
      actorAdminId,
      targetAdminId,
      action,
      details
    );
  } finally {
    client.release();
  }
}

export async function listAdminAudit(limit = 100) {
  const result = await pool.query(
    `SELECT
       l.id,
       l.action,
       l.details,
       l.created_at AS "createdAt",
       actor.full_name AS "actorName",
       actor.email AS "actorEmail"
     FROM admin_audit_log l
     LEFT JOIN admins actor ON actor.id = l.actor_admin_id
     ORDER BY l.id DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}
