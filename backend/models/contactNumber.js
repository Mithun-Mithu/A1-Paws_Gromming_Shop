import { db } from "../config/database.js";
import { recordAdminAudit } from "./admin.js";

const contactFields = `
 id,
 label,
 '+' || country_code AS countryCode,
 phone_number AS phoneNumber,
 call_enabled AS callEnabled,
 whatsapp_enabled AS whatsappEnabled,
 whatsapp_message AS whatsappMessage,
 is_primary AS isPrimary,
 status,
 created_at AS createdAt,
 updated_at AS updatedAt
`;

export class ContactNumberError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function getContact(id) {
  return db.prepare(`SELECT ${contactFields} FROM contact_numbers WHERE id=?`).get(id);
}

function hasPrimary() {
  return Boolean(db.prepare("SELECT id FROM contact_numbers WHERE is_primary=1").get());
}

function activeCount() {
  return db.prepare("SELECT COUNT(*) AS count FROM contact_numbers WHERE status='active'").get().count;
}

function audit(actorAdminId, action, contact) {
  recordAdminAudit(actorAdminId, action, null, {
    contactNumberId: contact.id,
    label: contact.label,
    countryCode: contact.countryCode,
    phoneNumber: contact.phoneNumber
  });
}

export function listContactNumbers() {
  return db.prepare(`SELECT ${contactFields} FROM contact_numbers
    ORDER BY is_primary DESC, status='active' DESC, id ASC`).all();
}

export function listPublicContactNumbers() {
  return db.prepare(`SELECT id,label,'+' || country_code AS countryCode,
    phone_number AS phoneNumber,call_enabled AS callEnabled,
    whatsapp_enabled AS whatsappEnabled,whatsapp_message AS whatsappMessage,
    is_primary AS isPrimary
    FROM contact_numbers WHERE status='active'
    ORDER BY is_primary DESC,id ASC`).all();
}

export function createContactNumber(data, actorAdminId) {
  return db.transaction(() => {
    const makePrimary = data.isPrimary || !hasPrimary();
    if (makePrimary && data.status !== "active") {
      throw new ContactNumberError(400, "The primary contact number must be active");
    }

    if (makePrimary) {
      db.prepare("UPDATE contact_numbers SET is_primary=0 WHERE is_primary=1").run();
    }

    const result = db.prepare(`INSERT INTO contact_numbers(
      label,country_code,phone_number,call_enabled,whatsapp_enabled,
      whatsapp_message,is_primary,status,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(
      data.label,data.countryCode,data.phoneNumber,data.callEnabled ? 1 : 0,
      data.whatsappEnabled ? 1 : 0,data.whatsappMessage,makePrimary ? 1 : 0,data.status
    );
    const contact = getContact(Number(result.lastInsertRowid));
    audit(actorAdminId, "contact_number.created", contact);
    return contact;
  }).immediate();
}

export function updateContactNumber(id, data, actorAdminId) {
  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM contact_numbers WHERE id=?").get(id);
    if (!current) throw new ContactNumberError(404, "Contact number not found");
    const makePrimary = data.isPrimary || (current.is_primary === 1 && data.status === "active");

    if (makePrimary && data.status !== "active") {
      throw new ContactNumberError(400, "The primary contact number must be active");
    }
    if (current.is_primary && !makePrimary) {
      throw new ContactNumberError(409, "Set another active number as primary before removing primary status");
    }
    if (current.status === "active" && data.status === "inactive" && activeCount() <= 1) {
      throw new ContactNumberError(409, "At least one contact number must remain active");
    }

    if (makePrimary && current.is_primary !== 1) {
      db.prepare("UPDATE contact_numbers SET is_primary=0 WHERE is_primary=1").run();
    }
    db.prepare(`UPDATE contact_numbers SET label=?,country_code=?,phone_number=?,
      call_enabled=?,whatsapp_enabled=?,whatsapp_message=?,is_primary=?,status=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
      data.label,data.countryCode,data.phoneNumber,data.callEnabled ? 1 : 0,
      data.whatsappEnabled ? 1 : 0,data.whatsappMessage,makePrimary ? 1 : 0,data.status,id
    );
    const contact = getContact(id);
    audit(actorAdminId, "contact_number.updated", contact);
    return contact;
  }).immediate();
}

export function setContactNumberStatus(id, status, actorAdminId) {
  return db.transaction(() => {
    const current = db.prepare("SELECT * FROM contact_numbers WHERE id=?").get(id);
    if (!current) throw new ContactNumberError(404, "Contact number not found");
    if (current.status === status) return getContact(id);

    if (status === "inactive") {
      if (current.is_primary) {
        throw new ContactNumberError(409, "Set another active number as primary before deactivating this number");
      }
      if (activeCount() <= 1) {
        throw new ContactNumberError(409, "At least one contact number must remain active");
      }
    }

    db.prepare("UPDATE contact_numbers SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,id);
    const contact = getContact(id);
    audit(actorAdminId, status === "active" ? "contact_number.activated" : "contact_number.deactivated", contact);
    return contact;
  }).immediate();
}

export function setPrimaryContactNumber(id, actorAdminId) {
  return db.transaction(() => {
    const contact = db.prepare("SELECT * FROM contact_numbers WHERE id=?").get(id);
    if (!contact) throw new ContactNumberError(404, "Contact number not found");
    if (contact.status !== "active") {
      throw new ContactNumberError(409, "Only an active contact number can be primary");
    }
    if (!contact.is_primary) {
      db.prepare("UPDATE contact_numbers SET is_primary=0 WHERE is_primary=1").run();
      db.prepare("UPDATE contact_numbers SET is_primary=1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      audit(actorAdminId, "contact_number.primary_changed", getContact(id));
    }
    return getContact(id);
  }).immediate();
}

export function deleteContactNumber(id, actorAdminId) {
  return db.transaction(() => {
    const contact = db.prepare("SELECT * FROM contact_numbers WHERE id=?").get(id);
    if (!contact) throw new ContactNumberError(404, "Contact number not found");
    if (contact.status === "active" && activeCount() <= 1) {
      throw new ContactNumberError(409, "The last active contact number cannot be deleted");
    }
    if (contact.is_primary) {
      throw new ContactNumberError(409, "Set another active number as primary before deleting this number");
    }
    audit(actorAdminId, "contact_number.deleted", {
      id: contact.id,
      label: contact.label,
      countryCode: `+${contact.country_code}`,
      phoneNumber: contact.phone_number
    });
    db.prepare("DELETE FROM contact_numbers WHERE id=?").run(id);
    return { id, deleted: true };
  }).immediate();
}
