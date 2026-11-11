import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { api } from './api';

const EMAIL_KEY = 'a1RecoveryEmail';
const OTP_EXPIRY_KEY = 'a1RecoveryOtpExpiry';
const RESEND_AFTER_KEY = 'a1RecoveryResendAfter';
const RESET_TOKEN_KEY = 'a1RecoveryResetToken';
const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function RecoveryLayout({ icon, eyebrow, title, description, children }) {
  return (
    <main className="admin-login">
      <section className="recovery-card">
        <div className="brand-icon">{icon}</div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="recovery-description">{description}</p>
        {children}
        <Link to="/admin" className="text-link recovery-back"><ArrowLeft size={15}/> Back to admin login</Link>
      </section>
    </main>
  );
}

export function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(sessionStorage.getItem(EMAIL_KEY) || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/admin/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      sessionStorage.setItem(EMAIL_KEY, email.trim().toLowerCase());
      sessionStorage.setItem(OTP_EXPIRY_KEY, String(Date.now() + 5 * 60_000));
      sessionStorage.setItem(RESEND_AFTER_KEY, String(Date.now() + 60_000));
      navigate('/admin/verify-otp');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <RecoveryLayout icon={<Mail/>} eyebrow="ACCOUNT RECOVERY" title="Forgot password?" description="Enter the email address associated with your administrator account.">
      <form className="recovery-form" onSubmit={submit}>
        <label>Email address<input type="email" autoComplete="email" required maxLength="254" value={email} onChange={event => setEmail(event.target.value)} placeholder="admin@example.com"/></label>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="recovery-note">If the address belongs to an admin account, we’ll send a verification code.</p>
        <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send verification code'}</button>
      </form>
    </RecoveryLayout>
  );
}

export function VerifyAdminOtp() {
  const navigate = useNavigate();
  const [email] = useState(sessionStorage.getItem(EMAIL_KEY) || '');
  const [otp, setOtp] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!email) {
      navigate('/admin/forgot-password', { replace: true });
      return undefined;
    }
    const updateTimer = () => {
      setSecondsLeft(Math.max(0, Math.ceil((Number(sessionStorage.getItem(OTP_EXPIRY_KEY)) - Date.now()) / 1000)));
      setResendSeconds(Math.max(0, Math.ceil((Number(sessionStorage.getItem(RESEND_AFTER_KEY)) - Date.now()) / 1000)));
    };
    updateTimer();
    const interval = window.setInterval(updateTimer, 1000);
    return () => window.clearInterval(interval);
  }, [email, navigate]);

  async function verify(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api('/admin/verify-otp', { method: 'POST', body: JSON.stringify({ email, otp }) });
      sessionStorage.setItem(RESET_TOKEN_KEY, result.resetToken);
      navigate('/admin/reset-password');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    setError('');
    setNotice('');
    try {
      await api('/admin/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      sessionStorage.setItem(OTP_EXPIRY_KEY, String(Date.now() + 5 * 60_000));
      sessionStorage.setItem(RESEND_AFTER_KEY, String(Date.now() + 60_000));
      setOtp('');
      setNotice('If the address belongs to an admin account, a new code will be sent.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setResending(false);
    }
  }

  return (
    <RecoveryLayout icon={<ShieldCheck/>} eyebrow="EMAIL VERIFICATION" title="Check your email" description={<>Enter the 6-digit code sent to <strong>{email || 'your email address'}</strong>. The code can be used once.</>}>
      <form className="recovery-form" onSubmit={verify}>
        <label>6-digit verification code<input className="otp-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" required value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"/></label>
        <p className={`recovery-timer ${secondsLeft === 0 ? 'expired' : ''}`} role="timer">{secondsLeft ? `Code expires in ${formatTime(secondsLeft)}` : 'This code has expired. Request a new one.'}</p>
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="recovery-notice" role="status">{notice}</p>}
        <button className="btn" disabled={busy || otp.length !== 6 || secondsLeft === 0}>{busy ? 'Verifying…' : 'Verify code'}</button>
        <button type="button" className="text-link resend-button" onClick={resend} disabled={resending || resendSeconds > 0}>{resending ? 'Requesting…' : resendSeconds ? `Resend code in ${formatTime(resendSeconds)}` : 'Resend code'}</button>
      </form>
    </RecoveryLayout>
  );
}

export function ResetAdminPassword() {
  const navigate = useNavigate();
  const [resetToken] = useState(sessionStorage.getItem(RESET_TOKEN_KEY) || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!resetToken) navigate('/admin/forgot-password', { replace: true });
  }, [resetToken, navigate]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('/admin/reset-password', { method: 'POST', body: JSON.stringify({ resetToken, password }) });
      sessionStorage.removeItem(RESET_TOKEN_KEY);
      sessionStorage.removeItem(OTP_EXPIRY_KEY);
      sessionStorage.removeItem(RESEND_AFTER_KEY);
      sessionStorage.removeItem(EMAIL_KEY);
      navigate('/admin/password-reset-success', { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <RecoveryLayout icon={<LockKeyhole/>} eyebrow="SECURE YOUR ACCOUNT" title="Set a new password" description="Use at least 12 characters with uppercase and lowercase letters, a number, and a symbol.">
      <form className="recovery-form" onSubmit={submit}>
        <label>New password<span className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength="12" maxLength="128" required value={password} onChange={event => setPassword(event.target.value)}/><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>
        <label>Confirm password<span className="password-field"><input type={showConfirm ? 'text' : 'password'} autoComplete="new-password" minLength="12" maxLength="128" required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}/><button type="button" aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'} onClick={() => setShowConfirm(!showConfirm)}>{showConfirm ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Updating password…' : 'Update password'}</button>
      </form>
    </RecoveryLayout>
  );
}

export function PasswordResetSuccess() {
  return (
    <RecoveryLayout icon={<CheckCircle/>} eyebrow="PASSWORD UPDATED" title="You’re all set" description="Your password has been changed and previous admin sessions have been signed out.">
      <Link to="/admin" className="btn recovery-success-button">Sign in with new password</Link>
    </RecoveryLayout>
  );
}
