import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useLiveSession } from '../lib/liveSession';
import { ServerError, serverHost, signIn } from '../lib/serverApi';
import { APP_NAME, APP_SUBTITLE, APP_TAGLINE } from '../lib/appConfig';
import { toast } from '../lib/toast';

/** The panel's only sign-in: the data source's own.
 *
 *  The stored token this screen produces is what every screen sends, and the rights behind it are
 *  decided by whatever answered — a real backend when `VITE_API_BASE_URL` is set, the built-in
 *  store otherwise. With no backend there is nothing to ask an office for, so the two demo logins
 *  are printed below the form rather than hidden in the source. */
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
    setBusy(true);
    try {
      const serverUser = await signIn(idOrEmail, password);
      useLiveSession.getState().setUser(serverUser);
      toast.success(`Signed in as ${serverUser.name}`);
      navigate('/');
    } catch (cause) {
      setError(cause instanceof ServerError ? cause.message : 'The backend could not be reached.');
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
            <ShieldCheck size={14} /> Owner Control Centre
          </div>
          <h1 className="max-w-md text-4xl font-black leading-tight text-white">
            Run your entire business from <span className="bg-brand-grad bg-clip-text text-transparent">one panel</span>.
          </h1>
          <p className="mt-3 max-w-md text-sm text-indigo-200/80">
            {APP_TAGLINE}
          </p>
        </div>
        <p className="text-[11px] text-indigo-300/60">
          © {new Date().getFullYear()} {APP_NAME}. Screens reused from the Dura Smart owner panel;
          every record on them is fictional.
        </p>
      </div>

      <div className="flex items-center justify-center bg-canvas p-6">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <img src="/app-icon.png" alt={APP_NAME} className="h-10 w-10 rounded-xl" />
            <p className="text-lg font-black">{APP_NAME} {APP_SUBTITLE}</p>
          </div>
          <div className="card p-7">
            <h2 className="text-xl font-black">Sign in</h2>
            <p className="mt-1 text-sm text-muted">Use your email, mobile or employee ID.</p>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <div>
                <label className="label">Email / Mobile / Employee ID</label>
                <input className="input" value={idOrEmail} onChange={(e) => setIdOrEmail(e.target.value)} placeholder="name@company.com" autoComplete="username" />
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input
                    className="input pr-10"
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-ink" onClick={() => setShow(!show)}>
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              {error && <p className="rounded-field bg-brand-red/10 px-3 py-2 text-xs font-bold text-brand-red">{error}</p>}
              <button className="btn-grad w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in to Operations Panel'}</button>
            </form>

            <div className="mt-4 text-center text-xs text-muted">
              Have an invitation code?{' '}
              <Link to="/signup" className="font-bold text-brand-blue hover:underline">
                Sign up here
              </Link>
            </div>

            <p className="mt-5 border-t border-line pt-4 text-[10px] leading-relaxed text-faint">
              Signing in against the active backend at {serverHost()}. Roles & territories are managed on the server.
            </p>
            <div className="mt-3 rounded-field border border-line/60 bg-canvas p-3 text-[11px] leading-relaxed text-muted">
              <p className="font-bold text-ink">Sign-in Roles:</p>
              <ul className="mt-1.5 space-y-1">
                <li><strong className="text-ink">Executive / Owner:</strong> <span className="font-mono text-ink">owner</span></li>
                <li><strong className="text-ink">Yard Dispatch Desk:</strong> <span className="font-mono text-ink">harpreet</span></li>
                <li><strong className="text-ink">Area Sales Officers:</strong> <span className="font-mono text-ink">moziram</span> (Haryana), <span className="font-mono text-ink">jagdeep</span> (Punjab), <span className="font-mono text-ink">ajay</span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
