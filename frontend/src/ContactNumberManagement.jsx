import { useEffect, useState } from 'react';
import { MessageCircle, PhoneCall, Plus, Star, Trash2 } from 'lucide-react';
import { api } from './api';
import { DEFAULT_WHATSAPP_MESSAGE } from './contactConfig.js';

const blankContact = () => ({
  label: '',
  countryCode: '+91',
  phoneNumber: '',
  callEnabled: true,
  whatsappEnabled: true,
  whatsappMessage: DEFAULT_WHATSAPP_MESSAGE,
  isPrimary: false,
  status: 'active'
});

function contactFormValues(contact) {
  return {
    label: contact.label,
    countryCode: contact.countryCode,
    phoneNumber: contact.phoneNumber,
    callEnabled: Boolean(contact.callEnabled),
    whatsappEnabled: Boolean(contact.whatsappEnabled),
    whatsappMessage: contact.whatsappMessage || '',
    isPrimary: Boolean(contact.isPrimary),
    status: contact.status
  };
}

function validateContact(values, contacts, editingId) {
  const countryCode = values.countryCode.replace(/\D/g, '');
  const phoneNumber = values.phoneNumber.replace(/\D/g, '');
  if (!/^\+?[1-9]\d{0,2}$/.test(values.countryCode.trim())) return 'Enter a valid country calling code.';
  if (phoneNumber.length < 6 || phoneNumber.length > 14 || countryCode.length + phoneNumber.length > 15) {
    return 'Enter a valid phone number, including its country code.';
  }
  if (!values.callEnabled && !values.whatsappEnabled) return 'Enable phone calls, WhatsApp, or both.';
  if (values.isPrimary && values.status !== 'active') return 'The primary contact number must be active.';
  const duplicate = contacts.some(contact => contact.id !== editingId &&
    contact.countryCode.replace(/\D/g, '') === countryCode &&
    contact.phoneNumber.replace(/\D/g, '') === phoneNumber);
  if (duplicate) return 'That phone number is already registered.';
  return '';
}

export default function ContactNumberManagement({ onContactsChanged }) {
  const [contacts, setContacts] = useState([]);
  const [form, setForm] = useState(blankContact);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadContacts() {
    setLoading(true);
    setError('');
    try {
      setContacts(await api('/admin/contact-numbers'));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadContacts();
  }, []);

  function openCreateForm() {
    setEditingId(null);
    setForm(blankContact());
    setFormOpen(true);
    setError('');
    setNotice('');
  }

  function editContact(contact) {
    setEditingId(contact.id);
    setForm(contactFormValues(contact));
    setFormOpen(true);
    setError('');
    setNotice('');
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(blankContact());
  }

  async function refreshAfterSave(message) {
    await loadContacts();
    const refreshed = await onContactsChanged();
    setNotice(refreshed ? message : `${message} The public contact display will retry automatically.`);
  }

  async function saveContact(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    const validationError = validateContact(form, contacts, editingId);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      await api(editingId === null ? '/admin/contact-numbers' : `/admin/contact-numbers/${editingId}`, {
        method: editingId === null ? 'POST' : 'PUT',
        body: JSON.stringify(form)
      });
      closeForm();
      await refreshAfterSave(editingId === null ? 'Contact number added.' : 'Contact number updated.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(contact) {
    setBusyId(contact.id);
    setError('');
    setNotice('');
    try {
      await api(`/admin/contact-numbers/${contact.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: contact.status === 'active' ? 'inactive' : 'active' })
      });
      await refreshAfterSave(`${contact.label} is now ${contact.status === 'active' ? 'inactive' : 'active'}.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setPrimary(contact) {
    setBusyId(contact.id);
    setError('');
    setNotice('');
    try {
      await api(`/admin/contact-numbers/${contact.id}/primary`, { method: 'PATCH' });
      await refreshAfterSave(`${contact.label} is now the primary contact.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteContact(contact) {
    if (!window.confirm(`Delete ${contact.label} (${contact.countryCode} ${contact.phoneNumber})?`)) return;
    setBusyId(contact.id);
    setError('');
    setNotice('');
    try {
      await api(`/admin/contact-numbers/${contact.id}`, { method: 'DELETE' });
      await refreshAfterSave(`${contact.label} was deleted.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="admin-panel contact-management">
      <div className="panel-title">
        <div>
          <span className="eyebrow">BUSINESS CONTACT DETAILS</span>
          <h2>Contact Number Management</h2>
          <p className="hint">Changes are published to the website automatically.</p>
        </div>
        <button className="btn small" onClick={openCreateForm}><Plus size={16} /> Add Phone Number</button>
      </div>

      {notice && <p className="admin-notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {formOpen && (
        <form className="contact-number-form" onSubmit={saveContact}>
          <div className="panel-title">
            <h3>{editingId === null ? 'Add Phone Number' : 'Edit Phone Number'}</h3>
            <span className="hint">Use the country code and local number in separate fields.</span>
          </div>
          <div className="admin-form-grid">
            <label>Contact Person / Label
              <input required maxLength="80" value={form.label} onChange={event => setForm({ ...form, label: event.target.value })} placeholder="Main Contact" />
            </label>
            <label>Country Code
              <input required value={form.countryCode} onChange={event => setForm({ ...form, countryCode: event.target.value })} placeholder="+91" />
            </label>
            <label>Phone Number
              <input required type="tel" inputMode="tel" value={form.phoneNumber} onChange={event => setForm({ ...form, phoneNumber: event.target.value })} placeholder="Enter phone number" />
            </label>
            <label>Status
              <select value={form.status} onChange={event => setForm({ ...form, status: event.target.value, isPrimary: event.target.value === 'inactive' ? false : form.isPrimary })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="contact-number-check">
              <input type="checkbox" checked={form.callEnabled} onChange={event => setForm({ ...form, callEnabled: event.target.checked })} />
              Enable phone calls
            </label>
            <label className="contact-number-check">
              <input type="checkbox" checked={form.whatsappEnabled} onChange={event => setForm({ ...form, whatsappEnabled: event.target.checked })} />
              Enable WhatsApp
            </label>
            <label className="contact-number-check">
              <input type="checkbox" checked={form.isPrimary} disabled={form.status !== 'active'} onChange={event => setForm({ ...form, isPrimary: event.target.checked })} />
              Set as primary number
            </label>
            {form.whatsappEnabled && (
              <label className="contact-message-field">Pre-filled WhatsApp Message
                <textarea rows="3" maxLength="500" value={form.whatsappMessage} onChange={event => setForm({ ...form, whatsappMessage: event.target.value })} />
              </label>
            )}
          </div>
          <div className="admin-form-actions">
            <button type="button" className="btn outline" onClick={closeForm} disabled={saving}>Cancel</button>
            <button className="btn" disabled={saving}>{saving ? 'Saving…' : editingId === null ? 'Add Phone Number' : 'Save Changes'}</button>
          </div>
        </form>
      )}

      {loading ? <p className="admin-loading" role="status">Loading contact numbers…</p> : contacts.length ? (
        <div className="table-scroll">
          <table className="contact-number-table">
            <thead>
              <tr><th>Contact Label</th><th>Country Code</th><th>Phone Number</th><th>Call Status</th><th>WhatsApp Status</th><th>Primary Contact</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>{contacts.map(contact => (
              <tr key={contact.id}>
                <td>{contact.label}</td>
                <td>{contact.countryCode}</td>
                <td>{contact.phoneNumber}</td>
                <td><span className={`contact-setting-status ${contact.callEnabled ? 'enabled' : 'disabled'}`}>{contact.callEnabled ? <><PhoneCall size={14} /> Enabled</> : 'Disabled'}</span></td>
                <td><span className={`contact-setting-status ${contact.whatsappEnabled ? 'enabled' : 'disabled'}`}>{contact.whatsappEnabled ? <><MessageCircle size={14} /> Enabled</> : 'Disabled'}</span></td>
                <td>{contact.isPrimary ? <span className="primary-contact"><Star size={14} fill="currentColor" /> Primary</span> : <button className="text-link" disabled={busyId === contact.id || contact.status !== 'active'} onClick={() => setPrimary(contact)}>Set primary</button>}</td>
                <td><span className={`admin-status ${contact.status}`}>{contact.status}</span></td>
                <td><div className="admin-row-actions">
                  <button className="text-link" disabled={busyId === contact.id} onClick={() => editContact(contact)}>Edit</button>
                  <button className="text-link" disabled={busyId === contact.id} onClick={() => setStatus(contact)}>{contact.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                  <button className="admin-delete-button" disabled={busyId === contact.id} onClick={() => deleteContact(contact)} title="Delete contact number"><Trash2 size={14} /> Delete</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="admin-empty">No contact numbers have been added.</p>}
    </section>
  );
}
