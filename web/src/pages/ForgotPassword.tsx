import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, AlertCircle, Building2, Mail, Send, RotateCw } from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { APP_NAME, APP_SUBTITLE } from '../lib/appConfig';
import { toast } from '../lib/toast';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [isSent, setIsSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => (c > 1 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleSendResetLink = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError('');

    const cleanEmail = (email || submittedEmail).trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your registered email address.');
      return;
    }
    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setError('Please enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      // 1. Direct Google Firebase Auth Password Reset Email
      await sendPasswordResetEmail(auth, cleanEmail);
      setSubmittedEmail(cleanEmail);
      setIsSent(true);
      setCooldown(60);
      toast.success('Password reset link sent! Please check your Gmail.');
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/user-not-found') {
        setError('No account found with this email. Please check your spelling or contact your administrator.');
      } else if (code === 'auth/invalid-email') {
        setError('Invalid email address format.');
      } else if (code === 'auth/too-many-requests') {
        setError('Too many reset attempts. Google has temporarily throttled requests. Please wait a few moments.');
      } else {
        // Fallback to backend API endpoint if client direct call had network issue
        try {
          const res = await fetch('https://durasmart2154.onrender.com/api/v1/auth/firebase-password-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail }),
          });
          if (res.ok) {
            setSubmittedEmail(cleanEmail);
            setIsSent(true);
            setCooldown(60);
            toast.success('Google password reset link sent to your email.');
            return;
          }
          const data = await res.json().catch(() => null);
          setError(data?.detail || 'Failed to send reset link. Please try again.');
        } catch (_) {
          setError(err?.message || 'Could not send reset email. Please check your network connection.');
        }
      }
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
            {isSent ? 'Check your email' : 'Reset your password'}
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/90">
            {isSent
              ? 'Google Firebase has sent an official password reset link directly to your inbox.'
              : 'Enter your registered email address to receive Google\'s official password reset link.'}
          </p>

          <div className="absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-white/10 blur-xl pointer-events-none" />
        </div>

        {/* Floating Form Card */}
        <div className="rounded-[26px] bg-white p-7 shadow-xl shadow-slate-200/50 border border-slate-100">
          {!isSent ? (
            <div>
              <div className="mb-5">
                <h2 className="text-[20px] font-extrabold text-slate-900">Firebase Password Recovery</h2>
                <p className="mt-1 text-[13px] text-slate-500">
                  We'll send an official reset link powered by Google Firebase.
                </p>
              </div>

              <form onSubmit={handleSendResetLink} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                    Registered Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-indigo-500">
                      <Mail size={18} />
                    </div>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="e.g. mohairsin@gmail.com"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                      autoComplete="email"
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
                      <span>Sending reset link…</span>
                    </>
                  ) : (
                    <>
                      <Send size={16} />
                      <span>Send Password Reset Link</span>
                    </>
                  )}
                </button>
              </form>

              <div className="mt-5 pt-5 border-t border-slate-100 text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-[13px] font-bold text-slate-500 hover:text-indigo-600 transition-colors"
                >
                  <ArrowLeft size={15} />
                  <span>Back to sign in</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-5 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-50/50">
                <CheckCircle2 size={36} className="stroke-[2.5]" />
              </div>

              <div>
                <h2 className="text-[20px] font-extrabold text-slate-900">Reset link sent!</h2>
                <p className="mt-1.5 text-[13px] text-slate-600">
                  Google Firebase dispatched an official reset email to:
                </p>
                <div className="mt-2.5 inline-block rounded-xl bg-indigo-50 px-4 py-2 font-mono text-[14px] font-bold text-indigo-700 border border-indigo-100">
                  {submittedEmail}
                </div>
              </div>

              {/* Step instructions */}
              <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-left space-y-2.5 text-[12px] text-slate-700">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700 text-[11px]">
                    1
                  </span>
                  <span>Open your Gmail inbox (or check spam/updates folder).</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700 text-[11px]">
                    2
                  </span>
                  <span>Click the secure link from <strong>Google Firebase</strong> to open the password reset page.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700 text-[11px]">
                    3
                  </span>
                  <span>Type your new password, submit, then return here to sign in.</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="space-y-2.5 pt-2">
                <Link
                  to="/login"
                  className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#6366F1] via-[#7C3AED] to-[#8B5CF6] py-3.5 text-[14px] font-extrabold text-white shadow-lg shadow-indigo-500/25 hover:opacity-95 active:scale-[0.99] transition-all"
                >
                  <ArrowLeft size={16} />
                  <span>Return to Sign In</span>
                </Link>

                <button
                  type="button"
                  disabled={busy || cooldown > 0}
                  onClick={() => handleSendResetLink()}
                  className="w-full flex items-center justify-center gap-1.5 rounded-2xl border border-slate-200 bg-white py-3 text-[13px] font-bold text-slate-700 hover:bg-slate-50 active:scale-[0.99] disabled:opacity-50 transition-all"
                >
                  <RotateCw size={14} className={busy ? 'animate-spin' : ''} />
                  <span>
                    {cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend password reset link'}
                  </span>
                </button>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsSent(false);
                    setEmail(submittedEmail);
                  }}
                  className="text-[12px] font-semibold text-indigo-600 hover:underline"
                >
                  Entered wrong email? Change email
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
