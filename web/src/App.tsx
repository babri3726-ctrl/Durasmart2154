import { useEffect } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { startLiveSession, useLiveSession } from './lib/liveSession';
import { Shell } from './components/layout/Shell';
import { Toaster } from './components/ui/Toaster';
import { Card } from './components/ui/Card';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sales from './pages/Sales';
import Payment from './pages/Payment';
import Marketing from './pages/Marketing';
import Dispatch from './pages/Dispatch';
import DispatchHistory from './pages/DispatchHistory';
import DispatchNew from './pages/DispatchNew';
import Stock from './pages/Stock';
import Account from './pages/Account';
import VaccantArea from './pages/VaccantArea';
import TourPlan from './pages/TourPlan';
import TaskAlarm from './pages/TaskAlarm';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Debtors from './pages/Debtors';
import ProvisionalDebtors from './pages/ProvisionalDebtors';
import Orders from './pages/Orders';
import OrderNew from './pages/OrderNew';
import OrderDetail from './pages/OrderDetail';
import Employees from './pages/Employees';
import EmployeeDetail from './pages/EmployeeDetail';
import Reports from './pages/Reports';
import SettingsPage from './pages/Settings';
import NotFound from './pages/NotFound';

/** The panel is live-only: there is one signed-in kind of user, the backend's own.
 *
 *  Both guards read the live session directly and synchronously — on a reload the stored token
 *  has already been re-checked against `/me` before the first route renders (the boot gate
 *  below), so `user` here is the server's answer, not a local guess. */
function RequireAuth() {
  const user = useLiveSession((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}

/** Route-level role enforcement — employee access is not controlled by
 *  hiding buttons alone; these modules are refused for non-owner accounts. */
function RequireOwner() {
  const user = useLiveSession((s) => s.user);
  if (user && user.role !== 'owner') {
    return (
      <div className="mx-auto max-w-lg py-16">
        <Card className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-red/10 text-brand-red">
            <Lock size={22} />
          </div>
          <h2 className="text-[15px] font-black text-ink">Owner access required</h2>
          <p className="mt-1.5 text-[13px] text-muted">
            You are signed in as {user.name} ({user.role} • {user.department}). This module contains
            company financials, master settings or staff administration and is restricted to owner accounts.
          </p>
          <Link to="/" className="btn-primary mt-4 inline-block">Back to Dashboard</Link>
        </Card>
      </div>
    );
  }
  return <Outlet />;
}

export default function App() {
  const checked = useLiveSession((s) => s.checked);
  useEffect(() => {
    void startLiveSession();
  }, []);

  // False only until the stored token has been re-checked with the data source, so a signed-in
  // operator never sees a login-screen flash on reload.
  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="text-center">
          <img src="/app-icon.png" alt="Owner Panel" className="mx-auto h-12 w-12 rounded-2xl" />
          <p className="mt-3 text-sm font-bold text-muted">Checking your session…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Dashboard />} />
          <Route element={<RequireOwner />}>
            <Route path="/sales" element={<Sales />} />
            <Route path="/account" element={<Account />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/employees/:id" element={<EmployeeDetail />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<SettingsPage />} />
            {/* The provisional list's corrections, review sign-offs and salesperson assignments are
                company financial working papers. `RequireOwner` is the second fence; every backend
                route is behind `OwnerUser` and refuses a non-owner before reading a body. */}
            <Route path="/debtors/provisional" element={<ProvisionalDebtors />} />
          </Route>
          <Route path="/payment" element={<Payment />} />
          <Route path="/marketing" element={<Marketing />} />
          <Route path="/dispatch" element={<Dispatch />} />
          {/* The dispatch desk is not under `RequireOwner`, and it is not a new menu item either: the
              capability on the employee record is what opens it (`GET /dispatches` answers `403`
              without it), the owner alone is not the rule, and navigation has never been the
              permission model on this panel. */}
          <Route path="/dispatch/history" element={<DispatchHistory />} />
          <Route path="/dispatch/record/:orderId" element={<DispatchNew />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/vaccant-area" element={<VaccantArea />} />
          <Route path="/tour-plan" element={<TourPlan />} />
          <Route path="/task-alarm" element={<TaskAlarm />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          {/* Employees read this too, scoped by the server to their own parties; the owner-only
              workbook preview inside the page is hidden for them and refused by the backend. */}
          <Route path="/debtors" element={<Debtors />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/new" element={<OrderNew />} />
          {/* A saved draft is opened at its own address rather than edited in place: the screen has to
              read the row — its lines and its `version` — before it can send the whole line list back. */}
          <Route path="/orders/:id/edit" element={<OrderNew />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
