import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle } from 'lucide-react';
import { api } from './api';
import './booking-admin.css';

const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const bookedSlotMessage = 'Sorry, this time slot is already booked. Please select another slot.';
const unavailableSlotMessage = 'This time slot is no longer available. Please select another slot.';

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function BookingPage() {
  const [services, setServices] = useState([]);
  const [selected, setSelected] = useState([]);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [slots, setSlots] = useState([]);
  const [shopClosed, setShopClosed] = useState(false);
  const [holiday, setHoliday] = useState('');
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [form, setForm] = useState({
    petName: '', petType: 'Dog', breed: '', age: '', size: '',
    fullName: '', phone: '', email: '', notes: '', paymentMethod: 'pay_at_shop'
  });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/services').then(setServices).catch(requestError => setError(requestError.message));
  }, []);

  const chosen = useMemo(() => services.filter(service => selected.includes(service.id)), [services, selected]);
  const duration = chosen.reduce((total, service) => total + service.duration, 0);
  const total = chosen.reduce((amount, service) => amount + service.price, 0);

  useEffect(() => {
    if (!date || !duration) {
      setSlots([]);
      setShopClosed(false);
      setHoliday('');
      setAvailabilityError('');
      setAvailabilityLoading(false);
      return undefined;
    }

    let active = true;
    let loaded = false;
    async function refreshAvailability() {
      if (!loaded) setAvailabilityLoading(true);
      try {
        const availability = await api(`/availability?date=${encodeURIComponent(date)}&duration=${duration}`);
        if (!active) return;
        const nextSlots = availability.slots || [];
        setSlots(nextSlots);
        setShopClosed(Boolean(availability.isClosed));
        setHoliday(availability.holiday || '');
        setAvailabilityError('');
        const selectedSlot = nextSlots.find(slot => slot.time === time);
        if (time && selectedSlot?.status !== 'available') {
          setTime('');
          setError(selectedSlot?.status === 'booked' ? bookedSlotMessage : unavailableSlotMessage);
        }
      } catch (requestError) {
        if (active) setAvailabilityError(requestError.message);
      } finally {
        if (active) {
          loaded = true;
          setAvailabilityLoading(false);
        }
      }
    }
    refreshAvailability();
    const timer = window.setInterval(refreshAvailability, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [date, duration, time]);

  function update(key, value) {
    setForm(current => ({ ...current, [key]: value }));
  }

  function toggleService(serviceId, checked) {
    setSelected(current => checked
      ? [...current, serviceId]
      : current.filter(id => id !== serviceId));
    setTime('');
    setError('');
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const booking = await api('/bookings', {
        method: 'POST',
        body: JSON.stringify({ ...form, serviceIds: selected, date, time })
      });
      setResult(booking);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <main className="booking-wrap">
        <div className="success-card">
          <CheckCircle size={52}/>
          <span className="eyebrow">BOOKING REQUEST RECEIVED</span>
          <h1>Thank you, {result.customerName}!</h1>
          <p>Your appointment request has been saved. Please keep this reference number.</p>
          <div className="receipt">
            <b>{result.reference}</b>
            <span>{result.petName} · {result.date} at {result.time}</span>
            <span>{result.services.map(service => service.name).join(', ')}</span>
            <strong>{money(result.totalPrice)}</strong>
            <small>Status: Pending confirmation · Payment: {result.paymentMethod === 'mock_online' ? 'Mock online payment' : 'Pay at shop'}</small>
          </div>
          <button className="btn" onClick={() => window.print()}>Print receipt</button>
          <Link className="text-link" to="/">Back to home</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="booking-wrap">
      <div className="booking-intro">
        <span className="eyebrow">LET'S MAKE THEM FEEL PAW-SOME</span>
        <h1>Book an appointment.</h1>
        <p>Share a few details and choose a time that works for you.</p>
      </div>
      <form className="booking-form" onSubmit={submit}>
        <div className="form-section">
          <h2><span>01</span> Your pet</h2>
          <div className="form-grid">
            <label>Pet name *<input required value={form.petName} onChange={event => update('petName', event.target.value)} placeholder="e.g. Bruno"/></label>
            <label>Pet type *<select value={form.petType} onChange={event => update('petType', event.target.value)}><option>Dog</option><option>Cat</option></select></label>
            <label>Breed<input value={form.breed} onChange={event => update('breed', event.target.value)} placeholder="Breed"/></label>
            <label>Age<input value={form.age} onChange={event => update('age', event.target.value)} placeholder="e.g. 2 years"/></label>
            <label>Pet size<select value={form.size} onChange={event => update('size', event.target.value)}><option value="">Select size</option><option>Small</option><option>Medium</option><option>Large</option></select></label>
          </div>
        </div>

        <div className="form-section">
          <h2><span>02</span> Choose services</h2>
          <div className="pick-grid">
            {services.map(service => (
              <label className={`pick-card ${selected.includes(service.id) ? 'picked' : ''}`} key={service.id}>
                <input type="checkbox" checked={selected.includes(service.id)} onChange={event => toggleService(service.id, event.target.checked)}/>
                <span><b>{service.name}</b><small>{service.duration} min · {money(service.price)}</small></span>
              </label>
            ))}
          </div>
          <div className="total-line"><span>{chosen.length} services · {duration} min estimated</span><b>{money(total)}</b></div>
        </div>

        <div className="form-section">
          <h2><span>03</span> Date & time</h2>
          <label>Appointment date *<input type="date" required min={localDate()} value={date} onChange={event => { setDate(event.target.value); setTime(''); setError(''); }}/></label>
          {date && duration > 0 && (
            <>
              <p className="hint">Availability refreshes automatically while you choose a time.</p>
              <div className="slot-legend" aria-label="Appointment slot availability">
                <span><i className="available"/> Available</span>
                <span><i className="booked"/> Booked</span>
                <span><i className="unavailable"/> Unavailable</span>
              </div>
              {availabilityLoading && slots.length === 0 && <p className="hint" role="status">Checking available times…</p>}
              {availabilityError && <p className="error" role="alert">{availabilityError}</p>}
              {shopClosed && <p className="hint">{holiday ? `Shop closed: ${holiday}` : 'The shop is closed on this date.'}</p>}
              <div className="slot-grid">
                {slots.map(slot => (
                  <button
                    type="button"
                    key={slot.time}
                    disabled={slot.status !== 'available'}
                    className={`slot ${slot.status} ${time === slot.time ? 'selected' : ''}`}
                    onClick={() => { setTime(slot.time); setError(''); }}
                    aria-label={`${slot.time} ${slot.status}`}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>
              {!availabilityLoading && slots.length === 0 && <p className="hint">No time slots are available for this date.</p>}
            </>
          )}
          {date && !duration && <p className="hint">Select at least one service to see available times.</p>}
        </div>

        <div className="form-section">
          <h2><span>04</span> Your contact details</h2>
          <div className="form-grid">
            <label>Full name *<input required value={form.fullName} onChange={event => update('fullName', event.target.value)} placeholder="Your name"/></label>
            <label>Phone number *<input required value={form.phone} onChange={event => update('phone', event.target.value)} placeholder="Your phone number"/></label>
            <label>Email<input type="email" value={form.email} onChange={event => update('email', event.target.value)} placeholder="you@example.com"/></label>
            <label className="wide">Special requests / pet instructions<textarea rows="3" value={form.notes} onChange={event => update('notes', event.target.value)} placeholder="Anything our groomer should know?"/></label>
          </div>
        </div>

        <div className="form-section">
          <h2><span>05</span> Payment preference</h2>
          <div className="payment-options">
            <label><input type="radio" name="payment" checked={form.paymentMethod === 'pay_at_shop'} onChange={() => update('paymentMethod', 'pay_at_shop')}/> Pay at shop</label>
            <label><input type="radio" name="payment" checked={form.paymentMethod === 'mock_online'} onChange={() => update('paymentMethod', 'mock_online')}/> Mock online payment (testing only)</label>
          </div>
          <p className="hint">Online payment is simulated during development; no real payment is collected.</p>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="submit-row">
          <div><small>Estimated total</small><b>{money(total)}</b></div>
          <button className="btn" disabled={busy || !selected.length || !date || !time || Boolean(availabilityError)}>
            {busy ? 'Submitting…' : 'Request appointment'} <ArrowRight size={17}/>
          </button>
        </div>
      </form>
    </main>
  );
}
