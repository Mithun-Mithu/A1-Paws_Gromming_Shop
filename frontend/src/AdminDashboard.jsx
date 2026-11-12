import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Lock, LogOut, PawPrint, RefreshCw } from 'lucide-react';
import { API, api } from './api';
import AdminManagement from './AdminManagement.jsx';
import ContactNumberManagement from './ContactNumberManagement.jsx';
import { useContactNumbers } from './contactOptions.jsx';
import './booking-admin.css';

const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const metricLabels = [
  ['Total appointments', 'total'],
  ["Today's appointments", 'today'],
  ['Upcoming appointments', 'upcoming'],
  ['Completed appointments', 'completed'],
  ['Cancelled appointments', 'cancelled'],
  ['Total revenue', 'revenue'],
  ['Pending payments', 'pendingPayments']
];

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addCalendarDays(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function weekStart(value) {
  const weekday = new Date(`${value}T12:00:00`).getDay();
  return addCalendarDays(value, -((weekday + 6) % 7));
}

export default function AdminDashboard() {
  const { refreshContacts } = useContactNumbers();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [pets, setPets] = useState([]);
  const [services, setServices] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [adminAudit, setAdminAudit] = useState([]);
  const [section, setSection] = useState('bookings');
  const [updatingBooking, setUpdatingBooking] = useState(null);
  const [assigningBooking, setAssigningBooking] = useState(null);
  const [updatingCustomer, setUpdatingCustomer] = useState(null);
  const [updatingPet, setUpdatingPet] = useState(null);
  const [savingService, setSavingService] = useState(null);
  const [reschedulingBooking, setReschedulingBooking] = useState(null);
  const [updatingPayment, setUpdatingPayment] = useState(null);
  const [updatingAmounts, setUpdatingAmounts] = useState(null);
  const [expandedBooking, setExpandedBooking] = useState(null);
  const [bookingFilter, setBookingFilter] = useState('all');
  const [bookingDate, setBookingDate] = useState(localDate());
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingSort, setBookingSort] = useState('upcoming');
  const [exportScope, setExportScope] = useState('all');
  const [exportFrom, setExportFrom] = useState(localDate());
  const [exportTo, setExportTo] = useState(localDate());
  const [newService, setNewService] = useState({ name: '', description: '', price: '', duration: '' });

  const filteredBookings = useMemo(() => {
    const today = localDate();
    const tomorrow = addCalendarDays(today, 1);
    const monday = weekStart(today);
    const nextMonday = addCalendarDays(monday, 7);
    const search = bookingSearch.trim().toLocaleLowerCase();
    return bookings.filter(booking => {
      const date = booking.appointment_date;
      const dateMatches = bookingFilter === 'today' ? date === today
        : bookingFilter === 'tomorrow' ? date === tomorrow
          : bookingFilter === 'week' ? date >= monday && date < nextMonday
            : bookingFilter === 'month' ? date.startsWith(today.slice(0, 7))
              : bookingFilter === 'custom' ? date === bookingDate
                : true;
      const searchMatches = !search || [
        booking.full_name, booking.phone, booking.email
      ].some(value => String(value || '').toLocaleLowerCase().includes(search));
      return dateMatches && searchMatches;
    }).sort((left, right) => {
      const comparison = `${left.appointment_date} ${left.start_time}`.localeCompare(`${right.appointment_date} ${right.start_time}`);
      return bookingSort === 'latest' ? -comparison : comparison;
    });
  }, [bookings, bookingDate, bookingFilter, bookingSearch, bookingSort]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const summary = await api('/admin/dashboard');
      const role = summary.currentAdmin.role;
      const [bookingRows, customerRows, petRows, serviceRows, staffRows, auditRows] = await Promise.all([
        api('/admin/bookings'),
        api('/admin/customers'),
        api('/admin/pets'),
        role === 'staff' ? Promise.resolve([]) : api('/admin/services'),
        role === 'staff' ? Promise.resolve([]) : api('/admin/assignees'),
        role === 'super_admin' ? api('/admins/audit') : Promise.resolve([])
      ]);
      setDashboard(summary);
      setBookings(bookingRows);
      setCustomers(customerRows);
      setPets(petRows);
      setServices(serviceRows);
      setAssignees(staffRows);
      setAdminAudit(auditRows);
      return true;
    } catch (requestError) {
      if (requestError.status === 401) {
        localStorage.removeItem('a1token');
        setSignedIn(false);
      }
      setError(requestError.message);
      return false;
    } finally {
      setLoading(false);
      setCheckingSession(false);
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('a1token')) {
      setCheckingSession(false);
      return;
    }
    loadDashboard().then(valid => {
      if (valid) setSignedIn(true);
    });
  }, [loadDashboard]);

  async function login(event) {
    event.preventDefault();
    setLoginBusy(true);
    setError('');
    try {
      const result = await api('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      localStorage.setItem('a1token', result.token);
      setPassword('');
      const valid = await loadDashboard();
      if (valid) {
        setSection('bookings');
        setSignedIn(true);
      }
      else localStorage.removeItem('a1token');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoginBusy(false);
    }
  }

  function signOut() {
    localStorage.removeItem('a1token');
    setSignedIn(false);
    setDashboard(null);
    setBookings([]);
    setCustomers([]);
    setPets([]);
    setServices([]);
    setAssignees([]);
    setAdminAudit([]);
    setSection('bookings');
    setError('');
  }

  async function updateBookingStatus(id, status) {
    setUpdatingBooking(id);
    setError('');
    try {
      await api(`/admin/bookings/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUpdatingBooking(null);
    }
  }

  async function rescheduleBooking(id, values) {
    setReschedulingBooking(id);
    setError('');
    try {
      await api(`/admin/bookings/${id}/reschedule`, {
        method: 'PATCH',
        body: JSON.stringify(values)
      });
      await loadDashboard();
      setExpandedBooking(id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReschedulingBooking(null);
    }
  }

  async function updatePaymentStatus(id, status) {
    setUpdatingPayment(id);
    setError('');
    try {
      await api(`/admin/bookings/${id}/payment`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUpdatingPayment(null);
    }
  }

  async function updateBookingAmounts(id, values) {
    setUpdatingAmounts(id);
    setError('');
    try {
      await api(`/admin/bookings/${id}/amounts`, {
        method: 'PATCH',
        body: JSON.stringify({
          additionalCharges: Number(values.additionalCharges),
          discountAmount: Number(values.discountAmount)
        })
      });
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setUpdatingAmounts(null);
    }
  }

  async function assignBooking(id, adminId) {
    setAssigningBooking(id);
    setError('');
    try {
      await api(`/admin/bookings/${id}/assignee`, {
        method: 'PATCH',
        body: JSON.stringify({ adminId: adminId ? Number(adminId) : null })
      });
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setAssigningBooking(null);
    }
  }

  async function updateCustomer(id, values) {
    setUpdatingCustomer(id);
    setError('');
    try {
      await api(`/admin/customers/${id}`, { method: 'PATCH', body: JSON.stringify(values) });
      await loadDashboard();
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setUpdatingCustomer(null);
    }
  }

  async function updatePet(id, values) {
    setUpdatingPet(id);
    setError('');
    try {
      await api(`/admin/pets/${id}`, { method: 'PATCH', body: JSON.stringify(values) });
      await loadDashboard();
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setUpdatingPet(null);
    }
  }

  async function saveService(service) {
    setSavingService(service.id);
    setError('');
    try {
      await api(`/admin/services/${service.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...service,
          price: Number(service.price),
          duration: Number(service.duration),
          active: Boolean(service.active)
        })
      });
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingService(null);
    }
  }

  async function addService(event) {
    event.preventDefault();
    setError('');
    try {
      await api('/admin/services', {
        method: 'POST',
        body: JSON.stringify({
          ...newService,
          price: Number(newService.price),
          duration: Number(newService.duration),
          active: true
        })
      });
      setNewService({ name: '', description: '', price: '', duration: '' });
      await loadDashboard();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function exportBookings() {
    setError('');
    try {
      if (exportScope === 'range' && (!exportFrom || !exportTo || exportFrom > exportTo)) {
        throw new Error('Select a valid start and end date for the export.');
      }
      const query = new URLSearchParams({ scope: exportScope });
      if (exportScope === 'range') {
        query.set('from', exportFrom);
        query.set('to', exportTo);
      }
      const response = await fetch(`${API}/admin/bookings.csv?${query}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('a1token')}` }
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || 'Could not export bookings');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `A1_Paws_Appointments_${localDate()}.csv`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  if (checkingSession) {
    return <main className="admin-login"><p role="status">Checking admin session…</p></main>;
  }

  if (!signedIn) {
    return (
      <main className="admin-login">
        <form className="login-card" onSubmit={login}>
          <div className="brand-icon"><Lock/></div>
          <span className="eyebrow">A1 PAWS MANAGEMENT</span>
          <h1>Admin login</h1>
          <p className="hint">Sign in with the administrator account configured on the server.</p>
          <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)}/></label>
          <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn" disabled={loginBusy}>{loginBusy ? 'Signing in…' : 'Sign in'}</button>
          <Link to="/admin/forgot-password" className="text-link recovery-forgot">Forgot password?</Link>
          <Link to="/" className="text-link">Back to website</Link>
        </form>
      </main>
    );
  }

  const role = dashboard?.currentAdmin.role;
  const canManageAdmins = role === 'super_admin';
  const canManagePeople = role === 'super_admin' || role === 'admin';
  const sections = [
    ['bookings', 'Bookings'],
    ['customers', 'Customers'],
    ['pets', 'Pets'],
    ...(role === 'staff' ? [] : [['services', 'Grooming services'], ['contacts', 'Contact Number Management']]),
    ...(canManageAdmins ? [['admins', 'Admin management'], ['audit', 'Audit log']] : [])
  ];

  return (
    <main className="admin-wrap">
      <div className="admin-top">
        <div>
          <span className="eyebrow"><PawPrint size={14}/> A1 PAWS / MANAGEMENT</span>
          <h1>Dashboard</h1>
          <p className="admin-identity">{dashboard?.currentAdmin.fullName} · {role === 'super_admin' ? 'Super Admin' : role === 'staff' ? 'Staff' : 'Admin'}</p>
        </div>
        <button className="btn outline" onClick={signOut}><LogOut size={16}/> Sign out</button>
      </div>

      {error && <div className="error admin-alert" role="alert">{error}</div>}
      {dashboard && (
        <div className="metric-grid">
          {metricLabels.map(([label, key]) => (
            <div className="metric" key={key}>
              <span>{label}</span>
              <b>{['revenue', 'pendingPayments'].includes(key) ? money(dashboard[key]) : dashboard[key]}</b>
            </div>
          ))}
        </div>
      )}

      <nav className="admin-tabs" aria-label="Admin sections">
        {sections.map(([key, label]) => (
          <button className={section === key ? 'active' : ''} key={key} onClick={() => setSection(key)}>{label}</button>
        ))}
      </nav>

      {loading ? (
        <div className="admin-loading" role="status"><RefreshCw size={18} className="spin"/> Loading admin data…</div>
      ) : (
        <>
          {section === 'bookings' && (
            <section className="admin-panel">
              <div className="panel-title admin-appointments-heading">
                <h2>Appointments</h2>
                {role !== 'staff' && (
                  <div className="appointment-export-controls">
                    <label>Export
                      <select value={exportScope} onChange={event => setExportScope(event.target.value)}>
                        <option value="all">All appointments</option>
                        <option value="today">Today</option>
                        <option value="week">This week</option>
                        <option value="month">This month</option>
                        <option value="range">Date range</option>
                      </select>
                    </label>
                    {exportScope === 'range' && <>
                      <label>From<input type="date" value={exportFrom} onChange={event => setExportFrom(event.target.value)}/></label>
                      <label>To<input type="date" value={exportTo} onChange={event => setExportTo(event.target.value)}/></label>
                    </>}
                    <button className="btn small" onClick={exportBookings}><Download size={16}/> Export CSV</button>
                  </div>
                )}
              </div>
              <div className="admin-booking-filters">
                <label>Date
                  <select value={bookingFilter} onChange={event => setBookingFilter(event.target.value)}>
                    <option value="all">All dates</option>
                    <option value="today">Today</option>
                    <option value="tomorrow">Tomorrow</option>
                    <option value="week">This week</option>
                    <option value="month">This month</option>
                    <option value="custom">Custom date</option>
                  </select>
                </label>
                {bookingFilter === 'custom' && <label>Choose date<input type="date" value={bookingDate} onChange={event => setBookingDate(event.target.value)}/></label>}
                <label className="admin-booking-search">Search name, phone or email
                  <input type="search" value={bookingSearch} onChange={event => setBookingSearch(event.target.value)} placeholder="Search appointments"/>
                </label>
                <label>Sort by
                  <select value={bookingSort} onChange={event => setBookingSort(event.target.value)}>
                    <option value="upcoming">Upcoming first</option>
                    <option value="latest">Latest first</option>
                  </select>
                </label>
              </div>
              {filteredBookings.length ? (
                <div className="table-scroll"><table className="appointment-table">
                  <thead><tr><th>Appointment</th><th>Customer contact</th><th>Pet & services</th><th>Date & time</th><th>Final amount</th><th>Payment</th><th>Status</th>{role !== 'staff' && <th>Assigned staff</th>}<th>Actions</th></tr></thead>
                  <tbody>{filteredBookings.map(booking => (
                    <Fragment key={booking.id}>
                      <tr>
                        <td>{booking.reference}<small>Booked {booking.created_at}</small></td>
                        <td>{booking.full_name}<small>{booking.phone}</small><small>{booking.email || 'No email'}</small></td>
                        <td>{booking.pet_name}<small>{booking.pet_type}{booking.breed ? ` · ${booking.breed}` : ''}</small><small>{booking.services?.map(service => service.name).join(', ')}</small></td>
                        <td>{booking.appointment_date}<small>{booking.start_time}</small></td>
                        <td>{money(booking.final_amount)}<small>Services {money(booking.total_price)}</small></td>
                        <td><span className={`payment-status ${booking.payment_status}`}>{String(booking.payment_status || 'pending').replaceAll('_', ' ')}</span><small>{booking.payment_method === 'mock_online' ? 'Mock online' : 'Pay at shop'}</small></td>
                        <td><span className={`status ${booking.status}`}>{booking.status}</span></td>
                        {role !== 'staff' && <td><select aria-label={`Assign ${booking.reference} to staff`} disabled={assigningBooking === booking.id} value={booking.assigned_admin_id || ''} onChange={event => assignBooking(booking.id, event.target.value)}>
                          <option value="">Unassigned</option>{assignees.map(admin => <option key={admin.id} value={admin.id}>{admin.fullName}</option>)}
                        </select></td>}
                        <td>
                          <button className="text-link" onClick={() => setExpandedBooking(expandedBooking === booking.id ? null : booking.id)}>
                            {expandedBooking === booking.id ? 'Hide details' : 'Details'}
                          </button>
                          <select aria-label={`Update ${booking.reference} status`} disabled={updatingBooking === booking.id} value={booking.status} onChange={event => updateBookingStatus(booking.id, event.target.value)}>
                            <option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
                          </select>
                        </td>
                      </tr>
                      {expandedBooking === booking.id && (
                        <tr className="appointment-details-row">
                          <td className="appointment-details-cell" colSpan={role !== 'staff' ? 9 : 8}>
                            <BookingDetails
                              booking={booking}
                              canUpdatePayment={role !== 'staff'}
                              rescheduling={reschedulingBooking === booking.id}
                              updatingPayment={updatingPayment === booking.id}
                              updatingAmounts={updatingAmounts === booking.id}
                              onReschedule={values => rescheduleBooking(booking.id, values)}
                              onUpdateAmounts={values => updateBookingAmounts(booking.id, values)}
                              onCancel={() => {
                                if (window.confirm(`Cancel appointment ${booking.reference}?`)) updateBookingStatus(booking.id, 'cancelled');
                              }}
                              onPaymentStatusChange={status => updatePaymentStatus(booking.id, status)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}</tbody>
                </table></div>
              ) : <p className="admin-empty">{bookings.length ? 'No appointments match the selected filters.' : 'No appointments yet. New customer bookings will appear here.'}</p>}
            </section>
          )}

          {section === 'customers' && (
            <section className="admin-panel">
              <h2>Customers</h2>
              {customers.length ? <div className="table-scroll"><table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Pets</th><th>Appointments</th>{canManagePeople && <th>Actions</th>}</tr></thead>
                <tbody>{customers.map(customer => <CustomerRow key={customer.id} customer={customer} canEdit={canManagePeople} saving={updatingCustomer === customer.id} onSave={values => updateCustomer(customer.id, values)}/>)}</tbody>
              </table></div> : <p className="admin-empty">No customers have booked yet.</p>}
            </section>
          )}

          {section === 'pets' && (
            <section className="admin-panel">
              <h2>Pets</h2>
              {pets.length ? <div className="table-scroll"><table><thead><tr><th>Pet</th><th>Type</th><th>Breed</th><th>Age</th><th>Size</th><th>Owner</th><th>Phone</th>{canManagePeople && <th>Actions</th>}</tr></thead>
                <tbody>{pets.map(pet => <PetRow key={pet.id} pet={pet} canEdit={canManagePeople} saving={updatingPet === pet.id} onSave={values => updatePet(pet.id, values)}/>)}</tbody>
              </table></div> : <p className="admin-empty">No pets have been registered yet.</p>}
            </section>
          )}

          {section === 'services' && (
            <section className="admin-panel">
              <h2>Grooming services</h2>
              {services.length ? services.map(service => <ServiceEditor key={service.id} service={service} saving={savingService === service.id} onSave={saveService}/>) : <p className="admin-empty">No grooming services are configured.</p>}
              <form className="new-service" onSubmit={addService}>
                <h3>Add a grooming service</h3>
                <div className="new-service-grid">
                  <label>Name<input required minLength="2" value={newService.name} onChange={event => setNewService({ ...newService, name: event.target.value })}/></label>
                  <label>Description<input value={newService.description} onChange={event => setNewService({ ...newService, description: event.target.value })}/></label>
                  <label>Price (₹)<input type="number" min="0" required value={newService.price} onChange={event => setNewService({ ...newService, price: event.target.value })}/></label>
                  <label>Duration (min)<input type="number" min="5" required value={newService.duration} onChange={event => setNewService({ ...newService, duration: event.target.value })}/></label>
                </div>
                <button className="btn small">Add service</button>
              </form>
            </section>
          )}
          {section === 'contacts' && role !== 'staff' && <ContactNumberManagement onContactsChanged={refreshContacts}/>}
          {section === 'admins' && canManageAdmins && <AdminManagement currentAdmin={dashboard.currentAdmin}/>}
          {section === 'audit' && canManageAdmins && (
            <section className="admin-panel">
              <h2>Admin activity</h2>
              {adminAudit.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Administrator</th><th>Activity</th></tr></thead><tbody>
                {adminAudit.map(entry => <tr key={entry.id}><td>{entry.createdAt}</td><td>{entry.actorName || entry.actorEmail || 'Deleted admin'}</td><td>{entry.action.replaceAll('.', ' ')}</td></tr>)}
              </tbody></table></div> : <p className="admin-empty">No admin activity has been recorded.</p>}
            </section>
          )}
        </>
      )}
      {!loading && !error && !dashboard && <p className="admin-empty">Admin data is unavailable.</p>}
      {error && signedIn && <button className="btn small" onClick={loadDashboard}>Retry loading dashboard</button>}
    </main>
  );
}

function BookingDetails({
  booking,
  canUpdatePayment,
  rescheduling,
  updatingPayment,
  updatingAmounts,
  onReschedule,
  onUpdateAmounts,
  onCancel,
  onPaymentStatusChange
}) {
  const [date, setDate] = useState(booking.appointment_date);
  const [time, setTime] = useState(booking.start_time);
  const [additionalCharges, setAdditionalCharges] = useState(String(booking.additional_charges || 0));
  const [discountAmount, setDiscountAmount] = useState(String(booking.discount_amount || 0));
  const services = booking.services || [];

  useEffect(() => {
    setDate(booking.appointment_date);
    setTime(booking.start_time);
    setAdditionalCharges(String(booking.additional_charges || 0));
    setDiscountAmount(String(booking.discount_amount || 0));
  }, [booking.appointment_date, booking.start_time, booking.additional_charges, booking.discount_amount]);

  return (
    <div className="booking-details">
      <div className="booking-detail-grid">
        <section>
          <h3>Customer</h3>
          <p><b>{booking.full_name}</b></p>
          <p>{booking.phone}</p>
          <p>{booking.email || 'No email provided'}</p>
        </section>
        <section>
          <h3>Pet</h3>
          <p><b>{booking.pet_name}</b> · {booking.pet_type}</p>
          <p>{booking.breed || 'Breed not provided'} · {booking.age || 'Age not provided'}</p>
          <p>{booking.size || 'Size not provided'}</p>
          <p>Notes: {booking.notes || 'None'}</p>
        </section>
        <section>
          <h3>Services & amounts</h3>
          {services.map(service => (
            <p key={`${service.name}-${service.price}`}>{service.name} · {service.duration} min · {money(service.price)}</p>
          ))}
          <p>Service total: {money(booking.total_price)}</p>
          <p>Additional charges: {money(booking.additional_charges)}</p>
          <p>Discount: {money(booking.discount_amount)}</p>
          <p><b>Final amount: {money(booking.final_amount)}</b></p>
          {canUpdatePayment && <form className="booking-amount-form" onSubmit={event => {
            event.preventDefault();
            onUpdateAmounts({ additionalCharges, discountAmount });
          }}>
            <label>Additional charges (₹)<input type="number" min="0" step="1" value={additionalCharges} onChange={event => setAdditionalCharges(event.target.value)}/></label>
            <label>Discount (₹)<input type="number" min="0" step="1" value={discountAmount} onChange={event => setDiscountAmount(event.target.value)}/></label>
            <button className="btn small" disabled={updatingAmounts}>{updatingAmounts ? 'Saving…' : 'Save amounts'}</button>
          </form>}
        </section>
        <section>
          <h3>Payment</h3>
          <p>Method: {booking.payment_method === 'mock_online' ? 'Mock online' : 'Pay at shop'}</p>
          <p>Provider: {booking.payment_provider || '—'}</p>
          <p>Payment amount: {money(booking.payment_amount)}</p>
          <label>Payment status
            <select
              value={booking.payment_status || 'pending'}
              disabled={!canUpdatePayment || updatingPayment}
              onChange={event => onPaymentStatusChange(event.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="mock_paid">Mock paid</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
            </select>
          </label>
        </section>
        <section>
          <h3>Appointment</h3>
          <p>ID: {booking.id} · {booking.reference}</p>
          <p>Created: {booking.created_at}</p>
          <p>Status: {booking.status}</p>
        </section>
      </div>
      <div className="booking-detail-actions">
        <form className="booking-reschedule-form" onSubmit={event => { event.preventDefault(); onReschedule({ date, time }); }}>
          <label>Reschedule date<input type="date" min={localDate()} required value={date} onChange={event => setDate(event.target.value)}/></label>
          <label>New time<input type="time" required value={time} onChange={event => setTime(event.target.value)}/></label>
          <button className="btn small" disabled={rescheduling || ['cancelled', 'completed'].includes(booking.status)}>
            {rescheduling ? 'Saving…' : 'Save reschedule'}
          </button>
        </form>
        <button
          className="btn small danger-button"
          disabled={['cancelled', 'completed'].includes(booking.status)}
          onClick={onCancel}
        >
          Cancel appointment
        </button>
      </div>
    </div>
  );
}

function ServiceEditor({ service, saving, onSave }) {
  const [values, setValues] = useState({ ...service, active: Boolean(service.active) });
  return (
    <form className="service-editor" onSubmit={event => { event.preventDefault(); onSave(values); }}>
      <b>{values.name}</b>
      <label>Price ₹<input type="number" min="0" value={values.price} onChange={event => setValues({ ...values, price: event.target.value })}/></label>
      <label>Duration min<input type="number" min="5" value={values.duration} onChange={event => setValues({ ...values, duration: event.target.value })}/></label>
      <label className="active-check"><input type="checkbox" checked={values.active} onChange={event => setValues({ ...values, active: event.target.checked })}/> Active</label>
      <button className="btn small" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </form>
  );
}

function CustomerRow({ customer, canEdit, saving, onSave }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({
    fullName: customer.full_name,
    phone: customer.phone,
    email: customer.email || ''
  });
  function cancel() {
    setValues({ fullName: customer.full_name, phone: customer.phone, email: customer.email || '' });
    setEditing(false);
  }
  async function save() {
    if (await onSave(values)) setEditing(false);
  }
  return <tr>
    <td>{editing ? <input aria-label="Customer name" value={values.fullName} onChange={event => setValues({ ...values, fullName: event.target.value })}/> : customer.full_name}</td>
    <td>{editing ? <input aria-label="Customer phone" type="tel" value={values.phone} onChange={event => setValues({ ...values, phone: event.target.value })}/> : customer.phone}</td>
    <td>{editing ? <input aria-label="Customer email" type="email" value={values.email} onChange={event => setValues({ ...values, email: event.target.value })}/> : customer.email || '—'}</td>
    <td>{customer.pet_count}</td><td>{customer.booking_count}</td>
    {canEdit && <td><div className="admin-row-actions">{editing ? <>
      <button className="text-link" disabled={saving} onClick={save}>Save</button>
      <button className="text-link" disabled={saving} onClick={cancel}>Cancel</button>
    </> : <button className="text-link" onClick={() => setEditing(true)}>Edit</button>}</div></td>}
  </tr>;
}

function PetRow({ pet, canEdit, saving, onSave }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState({
    name: pet.name,
    type: pet.type,
    breed: pet.breed || '',
    age: String(pet.age ?? ''),
    size: pet.size || ''
  });
  function cancel() {
    setValues({ name: pet.name, type: pet.type, breed: pet.breed || '', age: String(pet.age ?? ''), size: pet.size || '' });
    setEditing(false);
  }
  async function save() {
    if (await onSave(values)) setEditing(false);
  }
  return <tr>
    <td>{editing ? <input aria-label="Pet name" value={values.name} onChange={event => setValues({ ...values, name: event.target.value })}/> : pet.name}</td>
    <td>{editing ? <input aria-label="Pet type" value={values.type} onChange={event => setValues({ ...values, type: event.target.value })}/> : pet.type}</td>
    <td>{editing ? <input aria-label="Pet breed" value={values.breed} onChange={event => setValues({ ...values, breed: event.target.value })}/> : pet.breed || '—'}</td>
    <td>{editing ? <input aria-label="Pet age" value={values.age} onChange={event => setValues({ ...values, age: event.target.value })}/> : pet.age || '—'}</td>
    <td>{editing ? <input aria-label="Pet size" value={values.size} onChange={event => setValues({ ...values, size: event.target.value })}/> : pet.size || '—'}</td>
    <td>{pet.customer_name}</td><td>{pet.phone}</td>
    {canEdit && <td><div className="admin-row-actions">{editing ? <>
      <button className="text-link" disabled={saving} onClick={save}>Save</button>
      <button className="text-link" disabled={saving} onClick={cancel}>Cancel</button>
    </> : <button className="text-link" onClick={() => setEditing(true)}>Edit</button>}</div></td>}
  </tr>;
}
