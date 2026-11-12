import { z } from "zod";
import {
  ContactNumberError,
  createContactNumber as insertContactNumber,
  deleteContactNumber as removeContactNumber,
  listContactNumbers,
  listPublicContactNumbers,
  setContactNumberStatus,
  setPrimaryContactNumber,
  updateContactNumber as saveContactNumber
} from "../models/contactNumber.js";

const contactSchema = z.object({
  label: z.string().trim().min(1).max(80),
  countryCode: z.string().trim().regex(/^\+?[1-9]\d{0,2}$/, "Enter a valid country calling code").transform(value => value.replace(/^\+/, "")),
  phoneNumber: z.string().trim().regex(/^[0-9()\-\s]{6,24}$/, "Enter a valid phone number").transform(value => value.replace(/\D/g, "")),
  callEnabled: z.boolean(),
  whatsappEnabled: z.boolean(),
  whatsappMessage: z.string().max(500),
  isPrimary: z.boolean(),
  status: z.enum(["active", "inactive"])
}).strict().superRefine((data, context) => {
  if (data.phoneNumber.length < 6 || data.phoneNumber.length > 14 ||
      data.countryCode.length + data.phoneNumber.length > 15) {
    context.addIssue({ code: "custom", path: ["phoneNumber"], message: "Phone number length is invalid" });
  }
  if (!data.callEnabled && !data.whatsappEnabled) {
    context.addIssue({ code: "custom", path: ["callEnabled"], message: "Enable calls, WhatsApp, or both" });
  }
  if (data.isPrimary && data.status !== "active") {
    context.addIssue({ code: "custom", path: ["isPrimary"], message: "The primary contact number must be active" });
  }
});

const statusSchema = z.object({ status: z.enum(["active", "inactive"]) }).strict();
const idSchema = z.coerce.number().int().positive();

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parseId(req, res) {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid contact number ID" });
    return null;
  }
  return parsed.data;
}

function sendContactError(error, res, next) {
  if (error instanceof ContactNumberError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
    res.status(409).json({ message: "That phone number is already registered" });
    return;
  }
  next(error);
}

function validateContact(req, res) {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid contact number details" });
    return null;
  }
  return parsed.data;
}

export const getPublicContactNumbers = asyncRoute((req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(listPublicContactNumbers());
});

export const getContactNumbers = asyncRoute((req, res) => {
  res.json(listContactNumbers());
});

export const createContactNumber = asyncRoute((req, res, next) => {
  const data = validateContact(req, res);
  if (!data) return;
  try {
    res.status(201).json(insertContactNumber(data, req.admin.id));
  } catch (error) {
    sendContactError(error, res, next);
  }
});

export const updateContactNumber = asyncRoute((req, res, next) => {
  const id = parseId(req, res);
  if (id === null) return;
  const data = validateContact(req, res);
  if (!data) return;
  try {
    res.json(saveContactNumber(id, data, req.admin.id));
  } catch (error) {
    sendContactError(error, res, next);
  }
});

export const updateContactNumberStatus = asyncRoute((req, res, next) => {
  const id = parseId(req, res);
  if (id === null) return;
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Status must be active or inactive" });
  try {
    res.json(setContactNumberStatus(id, parsed.data.status, req.admin.id));
  } catch (error) {
    sendContactError(error, res, next);
  }
});

export const updatePrimaryContactNumber = asyncRoute((req, res, next) => {
  const id = parseId(req, res);
  if (id === null) return;
  try {
    res.json(setPrimaryContactNumber(id, req.admin.id));
  } catch (error) {
    sendContactError(error, res, next);
  }
});

export const deleteContactNumber = asyncRoute((req, res, next) => {
  const id = parseId(req, res);
  if (id === null) return;
  try {
    res.json(removeContactNumber(id, req.admin.id));
  } catch (error) {
    sendContactError(error, res, next);
  }
});
