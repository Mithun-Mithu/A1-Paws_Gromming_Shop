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

export async function sendAdminPasswordResetCode(email, otp) {
  if (!isEmailConfigured()) {
    throw new Error("SMTP email delivery is not configured");
  }

  const port = Number(process.env.SMTP_PORT);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

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