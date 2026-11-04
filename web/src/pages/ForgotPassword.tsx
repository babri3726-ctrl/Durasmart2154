import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { KeyRound, ShieldCheck, ArrowLeft, CheckCircle2, Eye, EyeOff, AlertCircle } from 'lucide-react';
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
    devOtp?: string;
  } | null>(null);

  const navigate = useNavigate();

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanId = identifier.trim();
    if (!cleanId) {
      setError('Please enter your email, employee ID, or username');
      return;
    }

    setBusy(true);
    try {
      const res = await requestPasswordReset(cleanId);
      setUserInfo({
        name: res.user?.name || 'Staff Member',
        role: res.user?.role || 'employee',
        maskedContact: res.user?.maskedContact || cleanId,
        devOtp: res.devOtp,
      });
      if (res.devOtp) {
        setOtp(res.devOtp); // prefill in dev for swift testing
      }
      toast.success('Verification code generated');
      setStep(2);
    } catch (err) {
      setError(err instanceof ServerError ? err.message : 'Account lookup failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!otp.trim()) {
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
        otp: otp.trim(),
        newPassword,
        confirmPassword,
      });
      toast.success('Password updated successfully!');
      setStep(3);
    } catch (err) {
      setError(err instanceof ServerError ? err.message : 'Failed to reset password. Please verify the code.');
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
            <KeyRound size={14} /> Security & Account Recovery
          </div>
          <h1 className="max-w-md text-4xl font-black leading-tight text-white">
            Reset your password with <span className="bg-brand-grad bg-clip-text text-transparent">instant verification</span>.
          </h1>
          <p className="mt-3 max-w-md text-sm text-indigo-200/80">
            Self-service recovery for Owner Ishu Jindal and HR-PB Sales Officers. Receive a secure 6-digit OTP code to safely update your credentials.
          </p>
        </div>
        <p className="text-[11px] text-indigo-300/60">
          © {new Date().getFullYear()} {APP_NAME}. All passwords are encrypted with individual salts using SHA-256.
        </p>
      </div>

      <div className="flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <img src="/app-icon.png" alt={APP_NAME} className="h-10 w-10 rounded-xl" />
            <p className="text-lg font-black">{APP_NAME} {APP_SUBTITLE}</p>
          </div>

          <div className="card p-7">
            {step === 1 && (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-blue/10 text-brand-blue">
                    <KeyRound size={20} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black">Forgot Password</h2>
                    <p className="text-xs text-muted">Owner & Employee Account Recovery</p>
                  </div>
                </div>

                <p className="mt-4 text-xs text-muted leading-relaxed">
                  Enter your registered <strong className="text-ink">Email</strong>, <strong className="text-ink">Employee ID</strong> (e.g. <span className="font-mono text-ink">EMP-SP-01</span>), or <strong className="text-ink">Username</strong> (<span className="font-mono text-ink">ishujindal</span>).
                </p>

                <form onSubmit={handleRequestOtp} className="mt-5 space-y-4">
                  <div>
                    <label className="label">Registered Email / Employee ID / Username</label>
                    <input
                      className="input"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="e.g. ishujindal or EMP-SP-01"
                      autoFocus
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 rounded-field bg-brand-red/10 p-3 text-xs font-bold text-brand-red">
                      <AlertCircle size={15} />
                      <span>{error}</span>
                    </div>
                  )}

                  <button className="btn-grad w-full" disabled={busy}>
                    {busy ? 'Verifying Account…' : 'Generate Verification OTP'}
                  </button>
                </form>

                <div className="mt-5 border-t border-line pt-4 text-center">
                  <Link to="/login" className="inline-flex items-center gap-1.5 text-xs font-bold text-muted hover:text-ink">
                    <ArrowLeft size={14} /> Back to Sign in
                  </Link>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-teal/10 text-brand-teal">
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <h2 className="text-xl font-black">Enter Verification Code</h2>
                    <p className="text-xs text-muted">Set a new secure password</p>
                  </div>
                </div>

                {userInfo && (
                  <div className="mt-4 rounded-xl border border-line bg-canvas p-3.5 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink">{userInfo.name}</span>
                      <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[10px] font-black uppercase text-brand-blue">
                        {userInfo.role}
                      </span>
                    </div>
                    <p className="text-muted text-[11px]">Recovery Contact: {userInfo.maskedContact}</p>
                    {userInfo.devOtp && (
                      <div className="mt-2 rounded-lg bg-brand-teal/10 p-2 font-mono text-[11px] font-bold text-brand-teal">
                        Dev OTP Code: {userInfo.devOtp}
                      </div>
                    )}
                  </div>
                )}

                <form onSubmit={handleResetPassword} className="mt-5 space-y-4">
                  <div>
                    <label className="label">6-Digit Verification Code (OTP)</label>
                    <input
                      className="input font-mono text-center text-lg tracking-widest font-black"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      placeholder="••••••"
                      maxLength={6}
                    />
                  </div>

                  <div>
                    <label className="label">New Password</label>
                    <div className="relative">
                      <input
                        className="input pr-10"
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 6 characters"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="label">Confirm New Password</label>
                    <input
                      className="input"
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                    />
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 rounded-field bg-brand-red/10 p-3 text-xs font-bold text-brand-red">
                      <AlertCircle size={15} />
                      <span>{error}</span>
                    </div>
                  )}

                  <button className="btn-grad w-full" disabled={busy}>
                    {busy ? 'Updating Password…' : 'Update Password & Return to Login'}
                  </button>
                </form>

                <div className="mt-5 border-t border-line pt-4 flex items-center justify-between text-xs">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="inline-flex items-center gap-1 font-bold text-muted hover:text-ink"
                  >
                    <ArrowLeft size={13} /> Change Account
                  </button>
                  <Link to="/login" className="font-bold text-brand-blue hover:underline">
                    Back to Sign in
                  </Link>
                </div>
              </>
            )}

            {step === 3 && (
              <div className="text-center py-4">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-teal/15 text-brand-teal">
                  <CheckCircle2 size={32} />
                </div>
                <h2 className="mt-4 text-2xl font-black text-ink">Password Updated!</h2>
                <p className="mt-2 text-xs text-muted max-w-xs mx-auto leading-relaxed">
                  Your new password has been securely salted and saved. You can now log in to the operations panel.
                </p>

                <button
                  onClick={() => navigate('/login')}
                  className="btn-grad mt-6 w-full"
                >
                  Proceed to Sign In
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
