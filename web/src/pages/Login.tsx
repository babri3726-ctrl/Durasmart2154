import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Lock, User, Sparkles, Building2, AlertCircle } from 'lucide-react';
import { useLiveSession } from '../lib/liveSession';
import { ServerError, signIn, signInWithFirebaseToken } from '../lib/serverApi';
import { auth } from '../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { APP_NAME, APP_SUBTITLE } from '../lib/appConfig';
import { toast } from '../lib/toast';

export default function Login() {
  const [idOrEmail, setIdOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanInput = idOrEmail.trim();
    if (!cleanInput) {
      setError('Please enter your email or employee ID.');
      return;
    }
    if (!password) {
      setError('Please enter your passcode.');
      return;
    }

    setBusy(true);
    try {
      const email = cleanInput.includes('@') ? cleanInput : `${cleanInput.toLowerCase()}@durasmart.com`;
      let idToken: string | null = null;
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        idToken = await cred.user.getIdToken();
      } catch (fbErr: any) {
        if (fbErr?.code === 'auth/user-not-found' || fbErr?.code === 'auth/invalid-credential') {
          try {
            const newCred = await createUserWithEmailAndPassword(auth, email, password);
            idToken = await newCred.user.getIdToken();
          } catch {
            const legacyUser = await signIn(cleanInput, password);
            useLiveSession.getState().setUser(legacyUser);
            toast.success(`Signed in as ${legacyUser.name}`);
            navigate('/');
            return;
          }
        } else {
          // If Firebase has network or other issue, fallback to backend check
          const legacyUser = await signIn(cleanInput, password);
          useLiveSession.getState().setUser(legacyUser);
          toast.success(`Signed in as ${legacyUser.name}`);
          navigate('/');
          return;
        }
      }

      if (idToken) {
        const serverUser = await signInWithFirebaseToken(idToken);
        useLiveSession.getState().setUser(serverUser);
        toast.success(`Welcome back, ${serverUser.name}!`);
        navigate('/');
      }
    } catch (cause: any) {
      const msg = cause?.message || (cause instanceof ServerError ? cause.message : 'Incorrect ID / email or passcode.');
      setError(msg.replace('Firebase: ', ''));
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
            Sign in to your workspace
          </h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-white/90">
            Sales, dispatch, payments and teams — in one colourful app.
          </p>

          <div className="absolute -right-10 -bottom-10 h-32 w-32 rounded-full bg-white/10 blur-xl pointer-events-none" />
        </div>

        {/* Floating Form Card */}
        <div className="rounded-[26px] bg-white p-7 shadow-xl shadow-slate-200/50 border border-slate-100">
          <div className="mb-5">
            <h2 className="text-[20px] font-extrabold text-slate-900">Welcome back</h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Enter your email or employee ID to continue.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[12px] font-bold text-slate-700">
                Email or Employee ID
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-indigo-500">
                  <User size={18} />
                </div>
                <input
                  type="text"
                  required
                  value={idOrEmail}
                  onChange={(e) => setIdOrEmail(e.target.value)}
                  placeholder="Enter your email or employee ID"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-4 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  autoComplete="username"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-bold text-slate-700">
                  Passcode
                </label>
                <Link
                  to="/forgot-password"
                  className="text-[12px] font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                >
                  Forgot passcode?
                </Link>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-blue-500">
                  <Lock size={18} />
                </div>
                <input
                  type={show ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your passcode"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/50 py-3 pl-11 pr-11 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all"
                  autoComplete="current-password"
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
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  <span>Sign in</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-100 text-center">
            <p className="text-[13px] text-slate-600">
              New to Dura Smart?{' '}
              <Link
                to="/signup"
                className="font-extrabold text-indigo-600 hover:text-indigo-700 transition-colors"
              >
                Create an account
              </Link>
            </p>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-center text-[11px] text-slate-400">
          DuraSmart Operations Suite &bull; Multi-Platform Cloud Connected
        </p>
      </div>
    </div>
  );
}
