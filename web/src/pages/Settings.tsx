import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Check,
  CheckCircle2,
  Cloud,
  Database,
  Lock,
  LogOut,
  RefreshCw,
  Save,
  Shield,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { Card, PageHeader } from '../components/ui/Card';
import { endLiveSession, useLiveSession } from '../lib/liveSession';
import {
  getSettings,
  updateSettings,
  serverHost,
  type ServerSettings,
  ServerError,
} from '../lib/serverApi';
import { toast } from '../lib/toast';

interface PermissionRow {
  module: string;
  owner: boolean | string;
  dispatch: boolean | string;
  sales: boolean | string;
}

const PERMISSION_ROWS: PermissionRow[] = [
  { module: 'Sales & Targets', owner: true, dispatch: true, sales: true },
  { module: 'Customer & Debtor Balances', owner: 'All Debtors', dispatch: 'All Debtors', sales: 'Assigned Only' },
  { module: 'Order Booking & Visibility', owner: 'All Orders', dispatch: 'All Orders', sales: 'Own Orders Only' },
  { module: 'Dispatch Desk & Execution', owner: 'Full Authority', dispatch: 'Full Authority', sales: '🔒 View Only' },
  { module: 'Tour Plans & Field Logs', owner: true, dispatch: false, sales: true },
  { module: 'Task Alarm & Reminders', owner: true, dispatch: true, sales: true },
  { module: 'Payment Register & Tally Import', owner: true, dispatch: false, sales: false },
  { module: 'Vaccant Area Management', owner: true, dispatch: false, sales: false },
  { module: 'Staff Administration & Settings', owner: true, dispatch: false, sales: false },
];

const THEME_CHIPS = [
  { label: 'Brand', bg: 'from-[#4F46E5] to-[#7C3AED]' },
  { label: 'Sales', bg: 'from-[#0EA5E9] to-[#2563EB]' },
  { label: 'Payment', bg: 'from-[#10B981] to-[#059669]' },
  { label: 'Area', bg: 'from-[#F59E0B] to-[#D97706]' },
  { label: 'Tour', bg: 'from-[#EC4899] to-[#DB2777]' },
  { label: 'Order', bg: 'from-[#8B5CF6] to-[#6D28D9]' },
  { label: 'Task', bg: 'from-[#F97316] to-[#EA580C]' },
  { label: 'Dispatch', bg: 'from-[#14B8A6] to-[#0D9488]' },
];

export default function Settings() {
  const navigate = useNavigate();
  const user = useLiveSession((s) => s.user);
  const isOwner = user?.role === 'owner';

  const [saving, setSaving] = useState(false);

  // Form edit states matching ServerSettings
  const [companyName, setCompanyName] = useState('Dura Smart Operations Suite');
  const [legalName, setLegalName] = useState('Dura Smart Steel & Tubes Pvt Ltd');
  const [email, setEmail] = useState('jindalbrothers@gmail.com');
  const [phone, setPhone] = useState('+91 98140 10001');
  const [gstin, setGstin] = useState('03AABCD1234E1Z5');
  const [address, setAddress] = useState('Dura Ldh, Phase VII, Focal Point, Ludhiana, Punjab 141010');
  const [defaultCreditDays, setDefaultCreditDays] = useState(30);
  const [financialYear, setFinancialYear] = useState('2026-2027');
  const [currency, setCurrency] = useState('INR (₹)');

  // Notifications (persisted in server & localStorage)
  const [notifOrder, setNotifOrder] = useState(() => localStorage.getItem('pref_notif_order') !== 'false');
  const [notifDispatch, setNotifDispatch] = useState(() => localStorage.getItem('pref_notif_dispatch') !== 'false');
  const [notifTask, setNotifTask] = useState(() => localStorage.getItem('pref_notif_task') !== 'false');

  const loadSettings = async () => {
    try {
      const data: ServerSettings = await getSettings();
      if (data) {
        if (data.companyName) setCompanyName(data.companyName);
        if (data.legalName) setLegalName(data.legalName);
        if (data.email) setEmail(data.email);
        if (data.phone) setPhone(data.phone);
        if (data.gstin) setGstin(data.gstin);
        if (data.address) setAddress(data.address);
        if (data.defaultCreditDays != null) setDefaultCreditDays(data.defaultCreditDays);
        if (data.financialYear) setFinancialYear(data.financialYear);
        if (data.currency) setCurrency(data.currency);
        if (data.notifications) {
          setNotifOrder(data.notifications.orderUpdates ?? true);
          setNotifDispatch(data.notifications.dispatchReminders ?? true);
          setNotifTask(data.notifications.taskDueAlerts ?? true);
        }
      }
    } catch (err) {
      console.error('Failed to load settings from server:', err);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner) {
      toast.error('Only the Managing Director (Owner) has authority to save master settings.');
      return;
    }
    setSaving(true);
    try {
      const res = await updateSettings({
        companyName: companyName.trim(),
        legalName: legalName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        gstin: gstin.trim(),
        address: address.trim(),
        defaultCreditDays: Number(defaultCreditDays),
        financialYear: financialYear.trim(),
        currency: currency.trim(),
        notifications: {
          orderUpdates: notifOrder,
          dispatchReminders: notifDispatch,
          taskDueAlerts: notifTask,
        },
      });
      if (res.settings) {
        setCompanyName(res.settings.companyName);
        setLegalName(res.settings.legalName);
        setEmail(res.settings.email);
      }
      toast.success('Master settings saved successfully!');
    } catch (err) {
      toast.error(err instanceof ServerError ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleNotif = (key: 'order' | 'dispatch' | 'task', val: boolean) => {
    if (key === 'order') {
      setNotifOrder(val);
      localStorage.setItem('pref_notif_order', String(val));
    } else if (key === 'dispatch') {
      setNotifDispatch(val);
      localStorage.setItem('pref_notif_dispatch', String(val));
    } else {
      setNotifTask(val);
      localStorage.setItem('pref_notif_task', String(val));
    }
    toast.success('Notification preference updated.');
  };

  const handleCheckUpdates = () => {
    toast.success(`DuraSmart is up to date (v2.0.0 Build 26). Connected to ${serverHost()}.`);
  };

  const handleSignOut = async () => {
    if (window.confirm('Are you sure you want to sign out? Your active session will end.')) {
      await endLiveSession();
      navigate('/login');
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Settings"
        subtitle="Theme styling, live server connection, system preferences, and role authority matrix"
        actions={
          <button
            type="button"
            onClick={handleSignOut}
            className="btn-ghost inline-flex items-center gap-1.5 text-xs text-brand-red border border-brand-red/30 hover:bg-brand-red/5"
          >
            <LogOut size={14} /> Sign out
          </button>
        }
      />

      {/* Grid: Theme & Server Info */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Theme & Styling Card (Mirrored from mobile _themeCard) */}
        <Card className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-brand-purple" />
                <h3 className="text-sm font-bold text-ink">Theme & Application Design</h3>
              </div>
              <span className="rounded bg-brand-purple/10 px-2 py-0.5 text-[10px] font-black text-brand-purple">
                Option 3 Gradient
              </span>
            </div>

            <p className="mt-3 text-xs text-muted">
              Active design tokens and gradient color surfaces applied across mobile and desktop interfaces:
            </p>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {THEME_CHIPS.map((chip) => (
                <div
                  key={chip.label}
                  className={`flex h-11 items-center justify-center rounded-xl bg-gradient-to-r ${chip.bg} text-[11px] font-bold text-white shadow-sm select-none`}
                >
                  {chip.label}
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-2 border-t border-line/60 pt-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">App Version</span>
                <span className="font-semibold text-ink">v2.0.0 (Build 26)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Theme Palette</span>
                <span className="font-semibold text-ink">Option 3 • Colourful Gradient</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Active Surfaces</span>
                <span className="font-semibold text-ink">Blue, Purple, Orange, Teal, Pink, Emerald</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCheckUpdates}
            className="btn-ghost mt-4 w-full inline-flex items-center justify-center gap-2 border border-line text-xs font-bold text-brand-purple hover:bg-canvas"
          >
            <RefreshCw size={13} /> Check for Online Updates
          </button>
        </Card>

        {/* Server Connection Card (Mirrored from mobile _serverConnectionCard) */}
        <Card className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Cloud size={18} className="text-brand-blue" />
                <h3 className="text-sm font-bold text-ink">Server Connection & Database</h3>
              </div>
              <span className="inline-flex items-center gap-1 rounded bg-brand-green/10 px-2 py-0.5 text-[10px] font-bold text-brand-green">
                <span className="h-1.5 w-1.5 rounded-full bg-brand-green animate-pulse" /> Connected
              </span>
            </div>

            <div className="mt-3 rounded-xl border border-line bg-canvas p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-muted">
                <Database size={13} /> Active Backend Host
              </div>
              <p className="mt-1 font-mono text-sm font-bold text-brand-blue truncate">
                {serverHost()}
              </p>
              <p className="mt-1 text-[11px] text-muted">
                FastAPI Python Gateway • SQLite WAL persistent storage (`operations.db`)
              </p>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-muted">
              Connect from anywhere using your Tailscale VPN mesh IP, Cloudflare Tunnel, or Local LAN.
              All master records, order registers, and debtor balances are synchronized live with the backend.
            </p>
          </div>

          <div className="mt-4 rounded-xl border border-line/60 bg-white p-3 text-xs text-muted flex items-center justify-between">
            <span>Client Identity Mode</span>
            <span className="font-semibold text-ink">
              {user ? `${user.name} (${user.role})` : 'Anonymous'}
            </span>
          </div>
        </Card>
      </div>

      {/* Role & Permissions Authority Matrix (Mirrored from mobile _permissionRows + Dispatch Person) */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-line">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-brand-blue" />
            <h3 className="text-sm font-bold text-ink">Role & Authority Matrix</h3>
          </div>
          <span className="text-xs text-muted">
            Executive privilege, dispatch execution authority, and salesperson scoping rules
          </span>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line/80 text-[11px] font-bold text-muted uppercase tracking-wider">
                <th className="py-2.5 px-3">System Module</th>
                <th className="py-2.5 px-3 text-center">Owner (Executive)</th>
                <th className="py-2.5 px-3 text-center">Dispatch Person</th>
                <th className="py-2.5 px-3 text-center">Sales Officer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/40">
              {PERMISSION_ROWS.map((row) => (
                <tr key={row.module} className="hover:bg-canvas/50 transition">
                  <td className="py-2.5 px-3 font-semibold text-ink">{row.module}</td>
                  <td className="py-2.5 px-3 text-center">
                    {typeof row.owner === 'boolean' ? (
                      row.owner ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-green/15 text-brand-green">
                          <Check size={13} />
                        </span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-line text-muted">
                          <X size={13} />
                        </span>
                      )
                    ) : (
                      <span className="rounded bg-brand-purple/10 px-2 py-0.5 text-[10px] font-bold text-brand-purple">
                        {row.owner}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {typeof row.dispatch === 'boolean' ? (
                      row.dispatch ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-green/15 text-brand-green">
                          <Check size={13} />
                        </span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-line text-muted">
                          <X size={13} />
                        </span>
                      )
                    ) : (
                      <span className="rounded bg-brand-blue/10 px-2 py-0.5 text-[10px] font-bold text-brand-blue">
                        {row.dispatch}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {typeof row.sales === 'boolean' ? (
                      row.sales ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-green/15 text-brand-green">
                          <Check size={13} />
                        </span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-line text-muted">
                          <X size={13} />
                        </span>
                      )
                    ) : (
                      <span className="rounded bg-canvas border border-line px-2 py-0.5 text-[10px] font-bold text-muted">
                        {row.sales}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Grid: Master Settings Form & Notifications */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Company Master Settings (2 cols) */}
        <Card className="lg:col-span-2">
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Building2 size={18} className="text-brand-purple" />
                <h3 className="text-sm font-bold text-ink">Company Profile & Master Policies</h3>
              </div>
              {!isOwner ? (
                <span className="rounded bg-muted/10 px-2 py-0.5 text-[10px] font-bold text-muted flex items-center gap-1">
                  <Lock size={10} /> View Only (Owner Edit Required)
                </span>
              ) : (
                <span className="rounded bg-brand-green/10 px-2 py-0.5 text-[10px] font-bold text-brand-green flex items-center gap-1">
                  <CheckCircle2 size={10} /> Owner Executive Authority
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-bold text-muted block mb-1">Company Display Name</label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="input !py-1.5 text-xs w-full disabled:bg-canvas disabled:text-muted"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted block mb-1">Legal Entity Name</label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="input !py-1.5 text-xs w-full disabled:bg-canvas disabled:text-muted"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted block mb-1">Official Email</label>
                <input
                  type="email"
                  disabled={!isOwner}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input !py-1.5 text-xs w-full disabled:bg-canvas disabled:text-muted"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted block mb-1">Phone Number</label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input !py-1.5 text-xs w-full disabled:bg-canvas disabled:text-muted"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted block mb-1">GSTIN</label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                  className="input !py-1.5 text-xs w-full uppercase disabled:bg-canvas disabled:text-muted"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted block mb-1">Financial Year</label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={financialYear}
                  onChange={(e) => setFinancialYear(e.target.value)}
                  className="input !py-1.5 text-xs w-full disabled:bg-canvas disabled:text-muted"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted block mb-1">Operating Currency</label>
                <input
                  type="text"
                  disabled={!isOwner}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="input !py-1.5 text-xs w-full disabled:bg-canvas disabled:text-muted"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-muted block mb-1">Default Credit Terms</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    disabled={!isOwner}
                    value={defaultCreditDays}
                    onChange={(e) => setDefaultCreditDays(Number(e.target.value))}
                    className="input !py-1.5 text-xs w-28 disabled:bg-canvas disabled:text-muted"
                  />
                  <span className="text-xs text-muted">Days</span>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-muted block mb-1">Operating Yard Address</label>
              <textarea
                rows={2}
                disabled={!isOwner}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="input !py-1.5 text-xs w-full disabled:bg-canvas disabled:text-muted"
              />
            </div>

            {isOwner && (
              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary inline-flex items-center gap-1.5 font-bold text-xs"
                >
                  <Save size={14} /> {saving ? 'Saving Changes…' : 'Save Master Settings'}
                </button>
              </div>
            )}
          </form>
        </Card>

        {/* Notifications & System Toggles (Mirrored from mobile _notificationsCard) */}
        <Card className="flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2">
                <Sliders size={18} className="text-brand-orange" />
                <h3 className="text-sm font-bold text-ink">Device Notifications</h3>
              </div>
              <span className="text-[10px] text-muted">Preferences</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl border border-line p-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-ink">Order Updates</p>
                  <p className="text-[11px] text-muted">New orders and approval alerts</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifOrder}
                  onChange={(e) => handleToggleNotif('order', e.target.checked)}
                  className="h-4 w-4 rounded text-brand-blue"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-line p-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-ink">Dispatch Reminders</p>
                  <p className="text-[11px] text-muted">Pending consignment nudges</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifDispatch}
                  onChange={(e) => handleToggleNotif('dispatch', e.target.checked)}
                  className="h-4 w-4 rounded text-brand-blue"
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-line p-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-bold text-ink">Task Due Alarms</p>
                  <p className="text-[11px] text-muted">Customer collection follow-ups</p>
                </div>
                <input
                  type="checkbox"
                  checked={notifTask}
                  onChange={(e) => handleToggleNotif('task', e.target.checked)}
                  className="h-4 w-4 rounded text-brand-blue"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-line bg-canvas p-3 text-[11px] text-muted leading-relaxed">
            Settings and authority scoping are actively enforced across both mobile application and enterprise web cockpit.
          </div>
        </Card>
      </div>
    </div>
  );
}
