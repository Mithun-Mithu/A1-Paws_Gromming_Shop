import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { MessageCircle, PhoneCall, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { api } from './api';
import { getPhoneHref, getWhatsAppHref } from './contactConfig.js';

const ContactNumbersContext = createContext(null);

export function ContactNumbersProvider({ children }) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshContacts = useCallback(async () => {
    try {
      const currentContacts = await api('/contacts');
      setContacts(currentContacts);
      setError('');
      return true;
    } catch (requestError) {
      setError(requestError.message || 'Contact numbers could not be loaded');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshContacts();
    const timer = window.setInterval(refreshContacts, 30000);
    return () => window.clearInterval(timer);
  }, [refreshContacts]);

  return (
    <ContactNumbersContext.Provider value={{ contacts, loading, error, refreshContacts }}>
      {children}
    </ContactNumbersContext.Provider>
  );
}

export function useContactNumbers() {
  const context = useContext(ContactNumbersContext);
  if (!context) throw new Error('useContactNumbers must be used within ContactNumbersProvider');
  return context;
}

export function ContactOptions({ variant = 'section' }) {
  const { contacts, loading, error, refreshContacts } = useContactNumbers();

  if (loading && contacts.length === 0) {
    return <p className="contact-options-message" role="status">Loading contact options…</p>;
  }
  if (contacts.length === 0) {
    return (
      <div className="contact-options-message" role="alert">
        <p>{error || 'No active contact numbers are available.'}</p>
        <button className="text-link" onClick={refreshContacts}>Retry</button>
      </div>
    );
  }

  return (
    <div className={`contact-options contact-options-${variant}`}>
      {error && <p className="contact-options-refresh-error" role="status">Contact information may be out of date. Refreshing failed.</p>}
      {contacts.map(contact => (
        <div className="contact-option" key={contact.id}>
          <div className="contact-option-identity">
            <span className="contact-label">{contact.label}{contact.isPrimary ? ' · Primary' : ''}</span>
            {contact.callEnabled
              ? <a className="contact-number" href={getPhoneHref(contact)}>{contact.countryCode} {contact.phoneNumber}</a>
              : <span className="contact-number">{contact.countryCode} {contact.phoneNumber}</span>}
          </div>
          <div className="contact-option-actions">
            {contact.callEnabled && (
              <a className="contact-action contact-call" href={getPhoneHref(contact)} aria-label={`Call ${contact.label}`}>
                <PhoneCall size={16} /> <span>Call Now</span>
              </a>
            )}
            {contact.whatsappEnabled && (
              <a className="contact-action contact-whatsapp" href={getWhatsAppHref(contact)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${contact.label}`}>
                <MessageCircle size={17} /> <span>WhatsApp</span>
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function FloatingContactWidget() {
  const { contacts } = useContactNumbers();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const whatsappContacts = contacts.filter(contact => contact.whatsappEnabled);

  useEffect(() => {
    if (whatsappContacts.length <= 1) setOpen(false);
  }, [whatsappContacts.length]);

  if (pathname.startsWith('/admin') || whatsappContacts.length === 0) return null;

  if (whatsappContacts.length === 1) {
    const contact = whatsappContacts[0];
    return (
      <a className="floating-contact-button" href={getWhatsAppHref(contact)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${contact.label}`}>
        <MessageCircle size={22} /> <span>WhatsApp</span>
      </a>
    );
  }

  return (
    <div className="floating-contact">
      {open && (
        <div className="floating-contact-menu" aria-label="Choose a WhatsApp contact">
          <div className="floating-contact-menu-heading">
            <b>Message A1 PAWS</b>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close WhatsApp contact list"><X size={17} /></button>
          </div>
          {whatsappContacts.map(contact => (
            <a key={contact.id} href={getWhatsAppHref(contact)} target="_blank" rel="noreferrer">
              <MessageCircle size={17} />
              <span>{contact.label}<small>{contact.countryCode} {contact.phoneNumber}</small></span>
            </a>
          ))}
        </div>
      )}
      <button
        className="floating-contact-button"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        <span>{open ? 'Close' : 'WhatsApp'}</span>
      </button>
    </div>
  );
}
