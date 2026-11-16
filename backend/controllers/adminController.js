
import bcrypt from "bcryptjs";
import { z } from "zod";

import {
  AdminManagementError,
  createAdmin as insertAdmin,
  deleteAdmin as removeAdmin,
  getAdminById,
  listAdmins,
  listAdminAudit,
  setAdminStatus,
  updateAdmin as saveAdmin
} from "../models/admin.js";

import { phoneNumberSchema } from "../utils/phone.js";

const roleSchema = z.enum(["super_admin", "admin", "staff"]);

const adminFields = {
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform(
    value => value.toLowerCase()
  ),
  phone: phoneNumberSchema,
  role: roleSchema
};

const passwordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/\d/, "Password must contain a number")
  .regex(/[^A-Za-z0-9]/, "Password must contain a symbol");

const createSchema = z.object({
  ...adminFields,
  password: passwordSchema,
  confirmPassword: z.string()
}).superRefine((data, context) => {
  if (data.password !== data.confirmPassword) {
    context.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "Passwords do not match"
    });
  }
});

const updateSchema = z.object({
  ...adminFields,
  phone: phoneNumberSchema.or(z.literal(""))
});

const statusSchema = z.object({
  status: z.enum(["active", "inactive"])
});

function asyncRoute(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      sendAdminError(error, res, next);
    }
  };
}

function idFromRequest(req, res) {
  const parsed = z.coerce.number().int().positive().safeParse(
    req.params.id
  );

  if (!parsed.success) {
    res.status(400).json({ message: "Invalid admin ID" });
    return null;
  }

  return parsed.data;
}

function sendAdminError(error, res, next) {
  if (error instanceof AdminManagementError) {
    return res.status(error.status).json({
      message: error.message
    });
  }

  // PostgreSQL unique constraint violation
  if (error.code === "23505") {
    return res.status(409).json({
      message: "That email address is already registered"
    });
  }

  next(error);
}

export const getAdmins = asyncRoute(async (req, res) => {
  const parsed = z.object({
    search: z.string().trim().max(100).optional().default("")
  }).safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Search must be 100 characters or fewer"
    });
  }

  const result = await listAdmins(parsed.data.search);

  res.json(result);
});

export const getAdmin = asyncRoute(async (req, res) => {
  const id = idFromRequest(req, res);
  if (id === null) return;

  const admin = await getAdminById(id);

  if (!admin) {
    return res.status(404).json({
      message: "Admin account not found"
    });
  }

  res.json(admin);
});

export const createAdmin = asyncRoute(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.issues[0]?.message || "Invalid admin details"
    });
  }

  const { password, confirmPassword, ...data } = parsed.data;

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await insertAdmin(
    { ...data, passwordHash },
    req.admin.id
  );

  res.status(201).json(admin);
});

export const updateAdmin = asyncRoute(async (req, res) => {
  const id = idFromRequest(req, res);
  if (id === null) return;

  const parsed = updateSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: parsed.error.issues[0]?.message || "Invalid admin details"
    });
  }

  const admin = await saveAdmin(
    id,
    parsed.data,
    req.admin.id
  );

  res.json(admin);
});

export const updateAdminStatus = asyncRoute(async (req, res) => {
  const id = idFromRequest(req, res);
  if (id === null) return;

  const parsed = statusSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Status must be active or inactive"
    });
  }

  const admin = await setAdminStatus(
    id,
    parsed.data.status,
    req.admin.id
  );

  res.json(admin);
});

export const deleteAdmin = asyncRoute(async (req, res) => {
  const id = idFromRequest(req, res);
  if (id === null) return;

  const deleted = await removeAdmin(id, req.admin.id);

  res.json({
    ok: true,
    deleted: {
      id: deleted.id,
      fullName: deleted.full_name,
      email: deleted.email
    }
  });
});

export const getAdminAudit = asyncRoute(async (req, res) => {
  const parsed = z.coerce.number()
    .int()
    .min(1)
    .max(200)
    .default(100)
    .safeParse(req.query.limit);

  if (!parsed.success) {
    return res.status(400).json({
      message: "Audit limit must be between 1 and 200"
    });
  }

  const audit = await listAdminAudit(parsed.data);

  res.json(audit);
});
