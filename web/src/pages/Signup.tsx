import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Eye, EyeOff, Lock, User, Mail, Phone, KeyRound, ShieldCheck, CheckCircle2, AlertCircle, Building2 } from 'lucide-react';
import { useLiveSession } from '../lib/liveSession';
import { ServerError, signUpUser, verifyInvitationCode, VerifyInvitationResult } from '../lib/serverApi';
import { APP_NAME, APP_SUBTITLE } from '../lib/appConfig';
import { toast } from '../lib/toast';

export default function Signup() {
  const [searchParams] = useSearchParams();
  const initialCode = searchParams.get('code') || '';

  const [inviteCode, setInviteCode] = useState(initialCode);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);

  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<VerifyInvitationResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const handleVerify = async (codeToVerify: string) => {
    const clean = codeToVerify.trim().toUpperCase();
    if (!clean) {
      setVerification(null);
      return;
    }
    setVerifying(true);
    setError('');
    try {
      const res = await verifyInvitationCode(clean);
      setVerification(res);
      if (!res.valid) {
        setError(res.reason || 'Invalid or expired invitation code.');
      }
    } catch {
      setError('Could not verify invitation code with the server.');
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    if (initialCode) {
      void handleVerify(initialCode);
    }
  }, [initialCode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanCode = inviteCode.trim().toUpperCase();
    if (!cleanCode) {
      setError('An invitation code given by the owner is required to register.');
      return;
    }
    if (!name.trim()) {
      setError('Full name is required.');
      return;
    }
    if (!identifier.trim()) {
      setError('Email or username is required.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const serverUser = await signUpUser({
        name: name.trim(),
        identifier: identifier.trim(),
        phone: phone.trim() || undefined,
        password,
        inviteCode: cleanCode,
      });
      useLiveSession.getState().setUser(serverUser);
      toast.success(`Account created! Welcome, ${serverUser.name}.`);
      navigate('/');
    } catch (cause) {
      setError(cause instanceof ServerError ? cause.message : 'Registration failed. Check network or server.');
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
            Create an account
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/90">
            Join the workspace using your owner-issued invitation code.
          </p>

          <div className="absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-white/10 blur-xl pointer-events-none" />
        </div>

        {/* Floating Form Card */}
        <div className="rounded-[26px] bg-white p-7 shadow-xl shadow-slate-200/50 border border-slate-100">
          <div className="mb-5">
            <h2 className="text-[20px] font-extrabold text-slate-900">New Registration</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Authorized team members only. Enter your invite code below.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-3.5">
            {/* Invite Code Field */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-bold text-slate-700">
                  Owner Invitation Code <span className="text-indigo-600">*</span>
                </label>
                {inviteCode && (
                  <button
                    type="button"
                    onClick={() => handleVerify(inviteCode)}
                    disabled={verifying}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                  >
                    {verifying ? 'Verifying…' : 'Check code'}
                  </button>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-indigo-500">
                  <KeyRound size={18} />
                </div>
                <input
                  type="text"
                  required
                  value={inviteCode}
                  onChange={(e) => {
                    setInviteCode(e.target.value.toUpperCase());
                    setVerification(null);
                  }}
                  onBlur={() => {
                    if (inviteCode.trim() && !verification) {
                      void handleVerify(inviteCode);
                    }
                  }}
                  placeholder="e.g. DURA-XXXX"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-[14px] font-mono font-bold tracking-wider uppercase text-slate-900 placeholder:text-slate-400 placeholder:normal-case placeholder:font-sans placeholder:font-normal focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                />
              </div>

              {/* Live Verification Badge */}
              {verification?.valid && (
                <div className="mt-2 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200/80 px-3 py-2 text-[12px] font-semibold text-emerald-800">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  <span>
                    Valid code: <strong>{verification.role}</strong> &bull; {verification.department}
                    {verification.salesTerritory ? ` (${verification.salesTerritory})` : ''}
                  </span>
                </div>
              )}
            </div>

            {/* Name */}
            <div>
              <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                Full Name <span className="text-indigo-600">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-indigo-500">
                  <User size={18} />
                </div>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  autoComplete="name"
                />
              </div>
            </div>

            {/* Email / Username */}
            <div>
              <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                Work Email or ID <span className="text-indigo-600">*</span>
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
                  placeholder="your.name@company.com"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                Mobile Number <span className="text-slate-400 text-[11px] font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-indigo-500">
                  <Phone size={18} />
                </div>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98140 00000"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  autoComplete="tel"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                Create Password <span className="text-indigo-600">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-blue-500">
                  <Lock size={18} />
                </div>
                <input
                  type={show ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-11 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-slate-400 hover:text-slate-600 transition-colors"
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                Confirm Password <span className="text-indigo-600">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-blue-500">
                  <Lock size={18} />
                </div>
                <input
                  type={show ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
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
                  <span>Creating account…</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={16} />
                  <span>Verify Invite & Create Account</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 text-center">
            <p className="text-[13px] text-slate-600">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-extrabold text-indigo-600 hover:text-indigo-700 transition-colors"
              >
                Sign in here
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-400">
          DuraSmart Operations Suite &bull; Secure Invite Gateway
        </p>
      </div>
    </div>
  );
}
