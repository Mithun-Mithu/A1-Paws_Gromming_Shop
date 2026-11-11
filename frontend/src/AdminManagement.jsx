import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { api } from './api';

const blankAdmin = () => ({
  fullName: '',
  email: '',
  phone: '',
  role: 'admin',
  password: '',
  confirmPassword: ''
});

const roleLabels = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  staff: 'Staff'
};

function createdDate(value) {
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function AdminManagement({ currentAdmin }) {
  const [accounts, setAccounts] = useState([]);
  const [counts, setCounts] = useState({ total: 0, active: 0, inactive: 0 });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(blankAdmin);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAdminId, setBusyAdminId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api('/admins');
      setAccounts(result.admins);
      setCounts(result.counts);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? accounts.filter(admin =>
      admin.fullName.toLowerCase().includes(query) || admin.email.toLowerCase().includes(query)
    ) : accounts;
  }, [accounts, search]);

  function openCreateForm() {
    setEditingId(null);
    setForm(blankAdmin());
    setFormOpen(true);
    setError('');
    setNotice('');
  }

  function editAdmin(admin) {
    setEditingId(admin.id);
    setForm({
      fullName: admin.fullName,
      email: admin.email,
      phone: admin.phone,
      role: admin.role,
      password: '',
      confirmPassword: ''
    });
    setFormOpen(true);
    setError('');
    setNotice('');
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(blankAdmin());
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (editingId === null && form.password !== form.confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      const body = editingId === null
        ? form
        : { fullName: form.fullName, email: form.email, phone: form.phone, role: form.role };
      await api(editingId === null ? '/admins' : `/admins/${editingId}`, {
        method: editingId === null ? 'POST' : 'PUT',
        body: JSON.stringify(body)
      });
      setNotice(editingId === null ? 'Admin account added successfully.' : 'Admin details updated successfully.');
      closeForm();
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(admin) {
    const status = admin.status === 'active' ? 'inactive' : 'active';
    setBusyAdminId(admin.id);
    setError('');
    setNotice('');
    try {
      await api(`/admins/${admin.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setNotice(`${admin.fullName} is now ${status}.`);
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyAdminId(null);
    }
  }

  async function deleteAdmin(admin) {
    const confirmed = window.confirm(`Delete admin account?\n\n${admin.fullName}\n${admin.email}\n\nThis action cannot be undone.`);
    if (!confirmed) return;
    setBusyAdminId(admin.id);
    setError('');
    setNotice('');
    try {
      await api(`/admins/${admin.id}`, { method: 'DELETE' });
      setNotice(`${admin.fullName} was deleted.`);
      await loadAdmins();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusyAdminId(null);
    }
  }

  return (
    <section className="admin-management">
      <div className="admin-management-heading">
        <div>
          <span className="eyebrow">ACCESS & PERMISSIONS</span>
          <h2>Admin Management</h2>
          <p>Manage administrator accounts and access to the A1 Paws dashboard.</p>
        </div>
        <button className="btn" onClick={openCreateForm}><UserPlus size={17}/> Add New Admin</button>
      </div>

      <div className="admin-count-grid">
        <article className="metric"><span>Total admins</span><b>{counts.total}</b></article>
        <article className="metric"><span>Active</span><b>{counts.active}</b></article>
        <article className="metric"><span>Inactive</span><b>{counts.inactive}</b></article>
      </div>

      {notice && <p className="admin-notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {formOpen && (
        <form className="admin-account-form" onSubmit={submit}>
          <div className="panel-title">
            <h3>{editingId === null ? 'Add New Admin' : 'Edit Admin Details'}</h3>
            <span className="hint">{editingId === null ? 'A password is required for a new account.' : 'Passwords are never shown or edited here.'}</span>
          </div>
          <div className="admin-form-grid">
            <label>Full Name<input required minLength="2" maxLength="100" value={form.fullName} onChange={event => setForm({ ...form, fullName: event.target.value })}/></label>
            <label>Email Address<input type="email" required maxLength="254" autoComplete="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })}/></label>
            <label>Phone Number<input type="tel" required={editingId === null} minLength="7" maxLength="20" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })}/></label>
            <label>Admin Role<select value={form.role} disabled={editingId === currentAdmin.id} onChange={event => setForm({ ...form, role: event.target.value })}>
              <option value="super_admin">Super Admin</option><option value="admin">Admin</option><option value="staff">Staff</option>
            </select></label>
            {editingId === null && <>
              <label>Password<input type="password" autoComplete="new-password" minLength="12" maxLength="128" required value={form.password} onChange={event => setForm({ ...form, password: event.target.value })}/><small>12+ characters with uppercase, lowercase, a number, and a symbol.</small></label>
              <label>Confirm Password<input type="password" autoComplete="new-password" minLength="12" maxLength="128" required value={form.confirmPassword} onChange={event => setForm({ ...form, confirmPassword: event.target.value })}/></label>
            </>}
          </div>
          <div className="admin-form-actions">
            <button type="button" className="btn outline" onClick={closeForm}>Cancel</button>
            <button className="btn" disabled={saving}>{saving ? 'Saving…' : editingId === null ? 'Add Admin' : 'Save Changes'}</button>
          </div>
        </form>
      )}

      <div className="admin-list-heading">
        <h3>Registered Admins</h3>
        <label className="admin-search"><Search size={17}/><input aria-label="Search admins by name or email" placeholder="Search name or email" value={search} onChange={event => setSearch(event.target.value)}/></label>
      </div>

      {loading ? <p className="admin-loading" role="status">Loading admin accounts…</p> : filteredAccounts.length ? (
        <div className="table-scroll">
          <table className="admin-account-table">
            <thead><tr><th>Admin Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Created Date</th><th>Actions</th></tr></thead>
            <tbody>{filteredAccounts.map(admin => {
              const isSelf = admin.id === currentAdmin.id;
              const busy = busyAdminId === admin.id;
              return <tr key={admin.id}>
                <td>{admin.fullName}{isSelf && <small>You</small>}</td>
                <td>{admin.email}</td>
                <td>{admin.phone || '—'}</td>
                <td>{roleLabels[admin.role]}</td>
                <td><span className={`admin-status ${admin.status}`}>{admin.status}</span></td>
                <td>{createdDate(admin.createdAt)}</td>
                <td><div className="admin-row-actions">
                  <button className="text-link" onClick={() => editAdmin(admin)}>Edit</button>
                  <button className="text-link" disabled={busy || isSelf} onClick={() => toggleStatus(admin)}>{admin.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                  <button className="admin-delete-button" disabled={busy || isSelf} onClick={() => deleteAdmin(admin)} title={isSelf ? 'You cannot delete your own account' : 'Delete admin'}>Delete</button>
                </div></td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      ) : <p className="admin-empty">{search ? 'No admins match your search.' : 'No admin accounts are registered.'}</p>}
    </section>
  );
}
