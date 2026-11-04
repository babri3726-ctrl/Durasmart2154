import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';
import { useLiveSession } from '../lib/liveSession';
import {
  ServerError,
  serverHost,
  signUpUser,
  verifyInvitationCode,
  VerifyInvitationResult,
} from '../lib/serverApi';
import { APP_NAME, APP_SUBTITLE, APP_TAGLINE } from '../lib/appConfig';
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

    if (!inviteCode.trim()) {
      setError('Invitation code is required to sign up.');
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
        inviteCode: inviteCode.trim().toUpperCase(),
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
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar-grad p-10 lg:flex">
        <div className="flex items-center gap-3">
          <img src="/app-icon.png" alt={APP_NAME} className="h-11 w-11 rounded-2xl" />
          <div>
            <p className="text-lg font-black text-white">{APP_NAME}</p>
            <p className="text-xs font-semibold text-indigo-200/80">{APP_SUBTITLE}</p>
          </div>
        </div>
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-indigo-100">
            <ShieldCheck size={14} /> Official Team Registration
          </div>
          <h1 className="max-w-md text-4xl font-black leading-tight text-white">
            Join the team with your <span className="bg-brand-grad bg-clip-text text-transparent">invitation code</span>.
          </h1>
          <p className="mt-3 max-w-md text-sm text-indigo-200/80">
            {APP_TAGLINE}
          </p>
        </div>
        <p className="text-[11px] text-indigo-300/60">
          © {new Date().getFullYear()} {APP_NAME}. Protected by salted credentials and owner authorization.
        </p>
      </div>

      <div className="flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <img src="/app-icon.png" alt={APP_NAME} className="h-10 w-10 rounded-xl" />
            <p className="text-lg font-black">{APP_NAME} {APP_SUBTITLE}</p>
          </div>

          <div className="card p-7">
            <h2 className="text-xl font-black">Register Staff Account</h2>
            <p className="mt-1 text-sm text-muted">Use the invitation code provided by the business owner.</p>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <div>
                <label className="label">Invitation Code</label>
                <div className="flex gap-2">
                  <input
                    className="input uppercase tracking-wider font-mono font-bold"
                    value={inviteCode}
                    onChange={(e) => {
                      setInviteCode(e.target.value);
                      setVerification(null);
                    }}
                    onBlur={() => handleVerify(inviteCode)}
                    placeholder="DURA-XXXX-YYYY"
                    required
                  />
                  <button
                    type="button"
                    className="btn-outline shrink-0 text-xs py-2 px-3"
                    disabled={verifying || !inviteCode.trim()}
                    onClick={() => handleVerify(inviteCode)}
                  >
                    {verifying ? 'Checking…' : 'Verify'}
                  </button>
                </div>
              </div>

              {verification?.valid && (
                <div className="rounded-field border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                    <CheckCircle2 size={15} /> Valid Invitation Code
                  </div>
                  <p className="mt-1 text-emerald-700">
                    Role: <strong className="capitalize">{verification.role}</strong> &bull; Dept: <strong>{verification.department}</strong>
                    {verification.salesTerritory ? ` • Territory: ${verification.salesTerritory}` : ''}
                    {verification.monthlyTargetQty ? ` • Quota: ${verification.monthlyTargetQty} ${verification.targetUnit || 'MT'}` : ''}
                  </p>
                </div>
              )}

              <div>
                <label className="label">Full Name</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jaspreet Singh"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Email / Username</label>
                  <input
                    className="input"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="name@company.com"
                    autoComplete="username"
                    required
                  />
                </div>
                <div>
                  <label className="label">Mobile Number</label>
                  <input
                    className="input"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="98140XXXXX"
                    autoComplete="tel"
                  />
                </div>
              </div>

              <div>
                <label className="label">Create Password</label>
                <div className="relative">
                  <input
                    className="input pr-10"
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
                    onClick={() => setShow(!show)}
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="label">Confirm Password</label>
                <input
                  className="input"
                  type={show ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  required
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-field bg-brand-red/10 px-3 py-2 text-xs font-bold text-brand-red">
                  <AlertCircle size={15} />
                  <span>{error}</span>
                </div>
              )}

              <button className="btn-grad w-full" disabled={busy}>
                {busy ? 'Creating Account…' : 'Complete Registration'}
              </button>
            </form>

            <div className="mt-5 border-t border-line pt-4 text-center text-xs text-muted">
              Already have an account?{' '}
              <Link to="/login" className="font-bold text-brand-blue hover:underline">
                Sign in here
              </Link>
            </div>
            <p className="mt-2 text-center text-[10px] text-faint">
              Operating against backend at {serverHost()}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
