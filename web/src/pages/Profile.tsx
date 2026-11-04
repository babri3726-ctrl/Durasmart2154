import { useEffect, useState } from 'react';
import { Shield, KeyRound, User, Phone, Mail, MapPin, Target, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, PageHeader } from '../components/ui/Card';
import { fetchUserProfile, updateUserProfile, ServerError } from '../lib/serverApi';
import { toast } from '../lib/toast';

interface UserProfileData {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  department: string;
  employeeId?: string | null;
  salesTerritory?: string;
  monthlyTargetQty?: string;
  targetUnit?: string;
  isOwner?: boolean;
  isDispatch?: boolean;
}

export default function Profile() {
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Edit Phone / Name state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);

  // Change Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchUserProfile();
      setProfile(data);
      setName(data.name);
      setPhone(data.phone || '');
    } catch (cause) {
      setError(cause instanceof ServerError ? cause.message : 'Failed to load profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleUpdateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccess(false);
    setUpdatingProfile(true);
    try {
      const res = await updateUserProfile({ name: name.trim(), phone: phone.trim() });
      setProfile((prev) => (prev ? { ...prev, name: res.name, phone: res.phone } : prev));
      setProfileSuccess(true);
      toast.success('Profile details updated successfully');
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (cause) {
      toast.error(cause instanceof ServerError ? cause.message : 'Failed to update profile.');
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    if (!currentPassword) {
      setPasswordError('Current password is required.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setUpdatingPassword(true);
    try {
      await updateUserProfile({ currentPassword, newPassword });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed successfully');
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (cause) {
      setPasswordError(cause instanceof ServerError ? cause.message : 'Password update failed.');
    } finally {
      setUpdatingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-sm font-semibold text-muted">
        Loading user profile…
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <p className="font-bold text-brand-red">{error || 'User not found'}</p>
        <button type="button" onClick={load} className="btn-primary mt-3">
          Try Again
        </button>
      </div>
    );
  }

  const initials = (profile.name || 'User')
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Profile"
        subtitle="Manage your personal identity, contact details, assigned quotas, and security credentials."
      />

      {/* Profile Overview Card */}
      <Card>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-brand-grad text-2xl font-black text-white shadow-md">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-black text-ink">{profile.name}</h1>
              <span className="rounded-full bg-brand-blue/10 px-2.5 py-0.5 text-xs font-bold capitalize text-brand-blue">
                {profile.role}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-muted">
                {profile.department}
              </span>
              {profile.employeeId && (
                <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-mono font-semibold text-indigo-700">
                  {profile.employeeId}
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
              <div className="flex items-center gap-1.5">
                <Mail size={14} className="text-faint" />
                <span>{profile.email}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Phone size={14} className="text-faint" />
                <span>{profile.phone || 'No mobile linked'}</span>
              </div>
              {profile.salesTerritory && (
                <div className="flex items-center gap-1.5">
                  <MapPin size={14} className="text-faint" />
                  <span>{profile.salesTerritory}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Operational Authority & Quota Banner */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-line/60 pt-5">
          {profile.isOwner ? (
            <div className="rounded-field border border-brand-blue/20 bg-brand-blue/5 p-4">
              <div className="flex items-center gap-2 font-bold text-brand-blue">
                <Shield size={16} /> Owner Full Executive Authority
              </div>
              <p className="mt-1 text-xs text-muted">
                Full administrative access to financial balance sheets, debtor ledger adjustments, staff invitation generation, and master pricing.
              </p>
            </div>
          ) : (
            <div className="rounded-field border border-line bg-canvas/60 p-4">
              <div className="flex items-center gap-2 font-bold text-ink">
                <Target size={16} className="text-brand-blue" /> Monthly Target Quota
              </div>
              <p className="mt-1 text-xs text-muted">
                Assigned monthly dispatch target:{' '}
                <strong className="text-ink">
                  {profile.monthlyTargetQty || '100.000'} {profile.targetUnit || 'MT'}
                </strong>
                {profile.salesTerritory ? ` across ${profile.salesTerritory}` : ''}.
              </p>
            </div>
          )}

          <div className="rounded-field border border-line bg-canvas/60 p-4">
            <div className="flex items-center gap-2 font-bold text-ink">
              <CheckCircle2 size={16} className="text-emerald-600" /> Operational Rights
            </div>
            <p className="mt-1 text-xs text-muted">
              {profile.isDispatch
                ? 'Authorized yard dispatch personnel: can confirm loading tallies, record vehicle dispatches, and adjust weights.'
                : 'Authorized sales officer: can create customer orders, request credit reviews, and track personal dispatch achievements.'}
            </p>
          </div>
        </div>
      </Card>

      {/* Edit Contact & Security Forms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Contact Details Form */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <User size={18} className="text-brand-blue" />
            <h2 className="text-sm font-black text-ink">Update Contact Info</h2>
          </div>

          <form onSubmit={handleUpdateContact} className="space-y-4">
            <div>
              <label className="label">Full Name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Mobile Number</label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98140XXXXX"
              />
            </div>

            {profileSuccess && (
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                <CheckCircle2 size={14} /> Profile updated successfully!
              </div>
            )}

            <button type="submit" className="btn-primary" disabled={updatingProfile}>
              {updatingProfile ? 'Saving…' : 'Save Contact Info'}
            </button>
          </form>
        </Card>

        {/* Change Password Form */}
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <KeyRound size={18} className="text-brand-blue" />
            <h2 className="text-sm font-black text-ink">Change Password</h2>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="label">Current Password</label>
              <input
                type="password"
                className="input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <div>
              <label className="label">New Password</label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
              />
            </div>

            <div>
              <label className="label">Confirm New Password</label>
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                required
              />
            </div>

            {passwordError && (
              <div className="flex items-center gap-1.5 text-xs font-bold text-brand-red">
                <AlertCircle size={14} /> {passwordError}
              </div>
            )}

            {passwordSuccess && (
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600">
                <CheckCircle2 size={14} /> Password changed successfully!
              </div>
            )}

            <button type="submit" className="btn-outline font-bold" disabled={updatingPassword}>
              {updatingPassword ? 'Changing Password…' : 'Update Password'}
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
