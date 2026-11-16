
import { pool } from "../config/postgres.js";

const contactFields = `
  id,
  label,
  '+' || country_code AS "countryCode",
  phone_number AS "phoneNumber",
  call_enabled AS "callEnabled",
  whatsapp_enabled AS "whatsappEnabled",
  whatsapp_message AS "whatsappMessage",
  is_primary AS "isPrimary",
  status,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

export class ContactNumberError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serialize changes so two requests cannot create primary numbers.
    await client.query(
      "LOCK TABLE contact_numbers IN SHARE ROW EXCLUSIVE MODE"
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

async function getContact(client, id) {
  const result = await client.query(
    `SELECT ${contactFields}
     FROM contact_numbers
     WHERE id = $1`,
    [id]
  );

  return result.rows[0];
}

async function hasPrimary(client) {
  const result = await client.query(
    "SELECT id FROM contact_numbers WHERE is_primary = 1 LIMIT 1"
  );

  return result.rows.length > 0;
}

async function activeCount(client) {
  const result = await client.query(
    "SELECT COUNT(*) AS count FROM contact_numbers WHERE status = 'active'"
  );

  return Number(result.rows[0].count);
}

async function audit(client, actorAdminId, action, contact) {
  await client.query(
    `INSERT INTO admin_audit_log
      (actor_admin_id, target_admin_id, action, details)
     VALUES ($1, NULL, $2, $3)`,
    [
      actorAdminId,
      action,
      JSON.stringify({
        contactNumberId: contact.id,
        label: contact.label,
        countryCode: contact.countryCode,
        phoneNumber: contact.phoneNumber
      })
    ]
  );
}

export async function listContactNumbers() {
  const result = await pool.query(
    `SELECT ${contactFields}
     FROM contact_numbers
     ORDER BY is_primary DESC, (status = 'active') DESC, id ASC`
  );

  return result.rows;
}

export async function listPublicContactNumbers() {
  const result = await pool.query(
    `SELECT
       id,
       label,
       '+' || country_code AS "countryCode",
       phone_number AS "phoneNumber",
       call_enabled AS "callEnabled",
       whatsapp_enabled AS "whatsappEnabled",
       whatsapp_message AS "whatsappMessage",
       is_primary AS "isPrimary"
     FROM contact_numbers
     WHERE status = 'active'
     ORDER BY is_primary DESC, id ASC`
  );

  return result.rows;
}

export async function createContactNumber(data, actorAdminId) {
  return withTransaction(async (client) => {
    const makePrimary =
      Boolean(data.isPrimary) || !(await hasPrimary(client));

    if (makePrimary && data.status !== "active") {
      throw new ContactNumberError(
        400,
        "The primary contact number must be active"
      );
    }

    if (makePrimary) {
      await client.query(
        "UPDATE contact_numbers SET is_primary = 0 WHERE is_primary = 1"
      );
    }

    const result = await client.query(
      `INSERT INTO contact_numbers (
        label,
        country_code,
        phone_number,
        call_enabled,
        whatsapp_enabled,
        whatsapp_message,
        is_primary,
        status,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      RETURNING id`,
      [
        data.label,
        data.countryCode,
        data.phoneNumber,
        data.callEnabled ? 1 : 0,
        data.whatsappEnabled ? 1 : 0,
        data.whatsappMessage,
        makePrimary ? 1 : 0,
        data.status
      ]
    );

    const contact = await getContact(client, result.rows[0].id);

    await audit(client, actorAdminId, "contact_number.created", contact);

    return contact;
  });
}

export async function updateContactNumber(id, data, actorAdminId) {
  return withTransaction(async (client) => {
    const currentResult = await client.query(
      "SELECT * FROM contact_numbers WHERE id = $1",
      [id]
    );

    const current = currentResult.rows[0];

    if (!current) {
      throw new ContactNumberError(404, "Contact number not found");
    }

    const makePrimary =
      Boolean(data.isPrimary) ||
      (current.is_primary === 1 && data.status === "active");

    if (makePrimary && data.status !== "active") {
      throw new ContactNumberError(
        400,
        "The primary contact number must be active"
      );
    }

    if (current.is_primary === 1 && !makePrimary) {
      throw new ContactNumberError(
        409,
        "Set another active number as primary before removing primary status"
      );
    }

    if (
      current.status === "active" &&
      data.status === "inactive" &&
      (await activeCount(client)) <= 1
    ) {
      throw new ContactNumberError(
        409,
        "At least one contact number must remain active"
      );
    }

    if (makePrimary && current.is_primary !== 1) {
      await client.query(
        "UPDATE contact_numbers SET is_primary = 0 WHERE is_primary = 1"
      );
    }

    await client.query(
      `UPDATE contact_numbers
       SET label = $1,
           country_code = $2,
           phone_number = $3,
           call_enabled = $4,
           whatsapp_enabled = $5,
           whatsapp_message = $6,
           is_primary = $7,
           status = $8,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9`,
      [
        data.label,
        data.countryCode,
        data.phoneNumber,
        data.callEnabled ? 1 : 0,
        data.whatsappEnabled ? 1 : 0,
        data.whatsappMessage,
        makePrimary ? 1 : 0,
        data.status,
        id
      ]
    );

    const contact = await getContact(client, id);

    await audit(client, actorAdminId, "contact_number.updated", contact);

    return contact;
  });
}

export async function setContactNumberStatus(id, status, actorAdminId) {
  return withTransaction(async (client) => {
    const currentResult = await client.query(
      "SELECT * FROM contact_numbers WHERE id = $1",
      [id]
    );

    const current = currentResult.rows[0];

    if (!current) {
      throw new ContactNumberError(404, "Contact number not found");
    }

    if (current.status === status) {
      return getContact(client, id);
    }

    if (status === "inactive") {
      if (current.is_primary === 1) {
        throw new ContactNumberError(
          409,
          "Set another active number as primary before deactivating this number"
        );
      }

      if ((await activeCount(client)) <= 1) {
        throw new ContactNumberError(
          409,
          "At least one contact number must remain active"
        );
      }
    }

    await client.query(
      `UPDATE contact_numbers
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [status, id]
    );

    const contact = await getContact(client, id);

    await audit(
      client,
      actorAdminId,
      status === "active"
        ? "contact_number.activated"
        : "contact_number.deactivated",
      contact
    );

    return contact;
  });
}

export async function setPrimaryContactNumber(id, actorAdminId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM contact_numbers WHERE id = $1",
      [id]
    );

    const contact = result.rows[0];

    if (!contact) {
      throw new ContactNumberError(404, "Contact number not found");
    }

    if (contact.status !== "active") {
      throw new ContactNumberError(
        409,
        "Only an active contact number can be primary"
      );
    }

    if (contact.is_primary !== 1) {
      await client.query(
        "UPDATE contact_numbers SET is_primary = 0 WHERE is_primary = 1"
      );

      await client.query(
        `UPDATE contact_numbers
         SET is_primary = 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id]
      );

      const updatedContact = await getContact(client, id);

      await audit(
        client,
        actorAdminId,
        "contact_number.primary_changed",
        updatedContact
      );
    }

    return getContact(client, id);
  });
}

export async function deleteContactNumber(id, actorAdminId) {
  return withTransaction(async (client) => {
    const result = await client.query(
      "SELECT * FROM contact_numbers WHERE id = $1",
      [id]
    );

    const contact = result.rows[0];

    if (!contact) {
      throw new ContactNumberError(404, "Contact number not found");
    }

    if (
      contact.status === "active" &&
      (await activeCount(client)) <= 1
    ) {
      throw new ContactNumberError(
        409,
        "The last active contact number cannot be deleted"
      );
    }

    if (contact.is_primary === 1) {
      throw new ContactNumberError(
        409,
        "Set another active number as primary before deleting this number"
      );
    }

    await audit(client, actorAdminId, "contact_number.deleted", {
      id: contact.id,
      label: contact.label,
      countryCode: `+${contact.country_code}`,
      phoneNumber: contact.phone_number
    });

    await client.query(
      "DELETE FROM contact_numbers WHERE id = $1",
      [id]
    );

    return { id: contact.id, deleted: true };
  });
}
