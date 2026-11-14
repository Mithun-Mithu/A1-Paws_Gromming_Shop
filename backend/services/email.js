import nodemailer from "nodemailer";

export function isEmailConfigured() {
  const port = Number(process.env.SMTP_PORT);

  return Boolean(
    process.env.SMTP_HOST &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535 &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.EMAIL_FROM
  );
}

function createTransporter() {
  const port = Number(process.env.SMTP_PORT);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatInr(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR"
  }).format(amount);
}

function formatAppointmentDate(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const formattedDate = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day)));

  return `${formattedDate} at ${time}`;
}

export async function sendBookingEmail({
  to,
  customerName,
  reference,
  petName,
  services,
  date,
  time,
  totalAmount,
  paymentMethod,
  status
}) {
  if (!isEmailConfigured()) {
    throw new Error("SMTP email delivery is not configured");
  }
  if (status !== "pending" && status !== "confirmed") {
    throw new Error("Unsupported booking email status");
  }

  const transporter = createTransporter();
  const pending = status === "pending";
  const subject = pending
    ? `We received your A1 Paws booking ${reference}`
    : `Your A1 Paws booking is confirmed ${reference}`;
  const formattedDate = formatAppointmentDate(date, time);
  const formattedTotal = formatInr(totalAmount);
  const formattedServices = services.map(service =>
    `${service.name} - ${formatInr(service.price)}`
  );
  const paymentLabel = paymentMethod === "pay_at_shop"
    ? "Pay at shop"
    : paymentMethod === "mock_online" ? "Online" : paymentMethod;
  const statusMessage = pending
    ? "We received your booking request and it will be confirmed shortly."
    : "Your booking is confirmed.";
  const text = [
    `Hello ${customerName},`,
    "",
    statusMessage,
    `Reference: ${reference}`,
    `Pet: ${petName}`,
    "Services:",
    ...formattedServices.map(service => `- ${service}`),
    `Date and time: ${formattedDate}`,
    `Total: ${formattedTotal}`,
    `Payment method: ${paymentLabel}`
  ].join("\n");
  const html = `
    <h2>A1 Paws booking</h2>
    <p>Hello ${escapeHtml(customerName)},</p>
    <p>${escapeHtml(statusMessage)}</p>
    <p><strong>Reference:</strong> ${escapeHtml(reference)}</p>
    <p><strong>Pet:</strong> ${escapeHtml(petName)}</p>
    <p><strong>Services:</strong></p>
    <ul>${services.map(service =>
      `<li>${escapeHtml(service.name)} - ${escapeHtml(formatInr(service.price))}</li>`
    ).join("")}</ul>
    <p><strong>Date and time:</strong> ${escapeHtml(formattedDate)}</p>
    <p><strong>Total:</strong> ${escapeHtml(formattedTotal)}</p>
    <p><strong>Payment method:</strong> ${escapeHtml(paymentLabel)}</p>
  `;

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    text,
    html
  });
}

export async function sendAdminPasswordResetCode(email, otp) {
  if (!isEmailConfigured()) {
    throw new Error("SMTP email delivery is not configured");
  }

  const transporter = createTransporter();
  await transporter.verify();

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Your A1 Paws admin password reset code",
    text: `Your A1 Paws verification code is ${otp}. It expires in 5 minutes.`,
    html: `
      <h2>A1 Paws Verification</h2>
      <p>Your verification code is:</p>
      <h1>${otp}</h1>
      <p>This code expires in 5 minutes.</p>
    `
  });

  return info;
}