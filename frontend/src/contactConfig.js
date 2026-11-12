const digitsOnly = value => String(value || '').replace(/\D/g, '');

export const DEFAULT_WHATSAPP_MESSAGE = 'Hello A1 PAWS! I would like to enquire about your pet grooming services and appointment availability.';

export function getPhoneHref(contact) {
  return `tel:+${digitsOnly(contact.countryCode)}${digitsOnly(contact.phoneNumber)}`;
}

export function getWhatsAppHref(contact) {
  const phone = `${digitsOnly(contact.countryCode)}${digitsOnly(contact.phoneNumber)}`;
  const message = contact.whatsappMessage || '';
  return `https://wa.me/${phone}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}
