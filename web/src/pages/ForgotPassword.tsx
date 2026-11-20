import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { KeyRound, ArrowLeft, CheckCircle2, Eye, EyeOff, AlertCircle, Building2, Mail, Lock } from 'lucide-react';
import { requestPasswordReset, resetPassword, ServerError } from '../lib/serverApi';
import { APP_NAME, APP_SUBTITLE } from '../lib/appConfig';
import { toast } from '../lib/toast';

export default function ForgotPassword() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [userInfo, setUserInfo] = useState<{
    name: string;
    role: string;
    maskedContact: string;
    emailSent?: boolean;
    devOtp?: string;
  } | null>(null);

  const navigate = useNavigate();

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanId = identifier.trim();
    if (!cleanId) {
      setError('Please enter your email or employee ID.');
      return;
    }

    setBusy(true);
    try {
      const res = await requestPasswordReset(cleanId);
      setUserInfo({
        name: res.user?.name || 'Team Member',
        role: res.user?.role || 'employee',
        maskedContact: res.user?.maskedContact || cleanId,
        emailSent: res.emailSent,
        devOtp: res.devOtp,
      });
      setOtp(''); // Do not prefill; wait for user to enter code from their email
      toast.success(res.message || 'Verification code sent to your email.');
      setStep(2);
    } catch (err) {
      setError(err instanceof ServerError ? err.message : 'Account lookup failed. Please check your email or ID.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanOtp = otp.trim();
    if (!cleanOtp) {
      setError('Please enter the 6-digit verification code.');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      await resetPassword({
        identifier: identifier.trim(),
        otp: cleanOtp,
        newPassword,
        confirmPassword,
      });
      toast.success('Password updated successfully!');
      setStep(3);
    } catch (err) {
      setError(err instanceof ServerError ? err.message : 'Invalid or expired verification code.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-[460px] space-y-4">
        {/* APK-Style Hero Header */}
        <div className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-[#4F46E5] via-[#6366F1] to-[#8B5CF6] p-6 text-white shadow-xl shadow-indigo-500/20">
          <div className="inline-flex items-center gap-3 rounded-2xl bg-white px-3.5 py-2 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#4F46E5] to-[#8B5CF6] text-white">
              <Building2 size={20} className="stroke-[2.5]" />
            </div>
            <div className="text-left">
              <p className="text-[12px] font-black tracking-wider text-slate-900 leading-tight uppercase">
                {APP_NAME}
              </p>
              <p className="text-[9px] font-extrabold tracking-widest text-indigo-600 uppercase">
                {APP_SUBTITLE || 'OPERATIONS PLATFORM'}
              </p>
            </div>
          </div>

          <h1 className="mt-5 text-[22px] font-black leading-tight tracking-tight text-white">
            {step === 3 ? 'Password updated' : 'Reset your passcode'}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/90">
            {step === 1 && 'Enter your registered email to receive a 6-digit verification code.'}
            {step === 2 && 'Enter the OTP code sent to your email to choose a new password.'}
            {step === 3 && 'Your account security has been verified. You can now log in.'}
          </p>

          <div className="absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-white/10 blur-xl pointer-events-none" />
        </div>

        {/* Floating Form Card */}
        <div className="rounded-[26px] bg-white p-7 shadow-xl shadow-slate-200/50 border border-slate-100">
          {step === 1 && (
            <div>
              <div className="mb-5">
                <h2 className="text-[20px] font-extrabold text-slate-900">Forgot passcode</h2>
                <p className="mt-1 text-[13px] text-slate-500">
                  We'll send an email with your one-time verification code.
                </p>
              </div>

              <form onSubmit={handleRequestOtp} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                    Registered Email or Employee ID
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-indigo-500">
                      <Mail size={18} />
                    </div>
                    <input
                      type="text"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="e.g. your.email@example.com"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                      autoComplete="username"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 rounded-2xl bg-rose-50 border border-rose-200/80 p-3 text-[12px] font-semibold text-rose-700">
                    <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-500" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="mt-2 w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#6366F1] via-[#7C3AED] to-[#8B5CF6] py-3.5 text-[14px] font-extrabold text-white shadow-lg shadow-indigo-500/25 hover:opacity-95 active:scale-[0.99] disabled:opacity-60 transition-all"
                >
                  {busy ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Sending OTP code…</span>
                    </>
                  ) : (
                    <>
                      <KeyRound size={16} />
                      <span>Send Verification Code</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="mb-5">
                <h2 className="text-[20px] font-extrabold text-slate-900">Enter Verification Code</h2>
                <div className="mt-2 rounded-xl bg-indigo-50 border border-indigo-100 p-3 text-[12px] font-medium text-indigo-900">
                  <p>
                    Code sent to <strong>{userInfo?.maskedContact}</strong>.
                  </p>
                  <p className="mt-0.5 text-indigo-600 text-[11px]">
                    ⏱ Valid for 10 minutes. Check your spam folder if not received.
                  </p>
                </div>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-3.5">
                <div>
                  <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                    6-Digit Verification Code
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-indigo-500">
                      <KeyRound size={18} />
                    </div>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                      placeholder="000000"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-center text-[18px] font-mono font-black tracking-[6px] text-indigo-900 placeholder:text-slate-300 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                      autoComplete="one-time-code"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                    New Passcode
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-blue-500">
                      <Lock size={18} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-11 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-600 transition-colors"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                    Confirm New Passcode
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-blue-500">
                      <Lock size={18} />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat new passcode"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                      autoComplete="new-password"
                    />
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 rounded-2xl bg-rose-50 border border-rose-200/80 p-3 text-[12px] font-semibold text-rose-700">
                    <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-500" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="mt-3 w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#6366F1] via-[#7C3AED] to-[#8B5CF6] py-3.5 text-[14px] font-extrabold text-white shadow-lg shadow-indigo-500/25 hover:opacity-95 active:scale-[0.99] disabled:opacity-60 transition-all"
                >
                  {busy ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Updating password…</span>
                    </>
                  ) : (
                    <span>Save New Passcode</span>
                  )}
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStep(1);
                      setError('');
                    }}
                    className="text-[12px] font-bold text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Resend code or change email
                  </button>
                </div>
              </form>
            </div>
          )}

          {step === 3 && (
            <div className="text-center py-4">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 shadow-sm">
                <CheckCircle2 size={36} />
              </div>
              <h2 className="mt-4 text-[20px] font-extrabold text-slate-900">
                Password Successfully Reset!
              </h2>
              <p className="mt-2 text-[13px] text-slate-500 leading-relaxed max-w-xs mx-auto">
                Your passcode has been updated securely. You can now log in to the workspace.
              </p>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="mt-6 w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] py-3.5 text-[14px] font-extrabold text-white shadow-lg shadow-indigo-500/25 hover:opacity-95 transition-all"
              >
                Proceed to Sign in
              </button>
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-[13px] font-extrabold text-indigo-600 hover:text-indigo-700 transition-colors"
            >
              <ArrowLeft size={14} /> Back to Sign in
            </Link>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-400">
          DuraSmart Operations Suite &bull; Account Security
        </p>
      </div>
    </div>
  );
}
