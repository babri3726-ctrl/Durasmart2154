import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, Wallet, Truck, Boxes,
  Map, Route, AlarmClock, Users, ShoppingCart, FilePlus2, IdCard, BarChart3, Settings, ReceiptIndianRupee,
  Megaphone, Landmark,
  ChevronLeft, ChevronRight, LogOut, Menu,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useUi } from '../../lib/uiStore';
import { endLiveSession, useLiveSession } from '../../lib/liveSession';
import { serverHost } from '../../lib/serverApi';
import { APP_NAME, APP_SUBTITLE } from '../../lib/appConfig';
import { initials } from '../../lib/format';

/** `end` marks a nav entry whose own path is a prefix of another one: `/orders` stays highlighted
 *  for `/orders/new` unless it is matched exactly, and two lit rows say nothing about where the
 *  operator is. */
const NAV: { label: string; to: string; icon: LucideIcon; end?: boolean; hidden?: boolean }[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Sales', to: '/sales', icon: TrendingUp },
  { label: 'Payment', to: '/payment', icon: Wallet },
  { label: 'Marketing', to: '/marketing', icon: Megaphone },
  { label: 'Dispatch', to: '/dispatch', icon: Truck },
  { label: 'Stock', to: '/stock', icon: Boxes },
  { label: 'Account', to: '/account', icon: Landmark },
  { label: 'Vaccant Area', to: '/vaccant-area', icon: Map },
  { label: 'Tour Plan', to: '/tour-plan', icon: Route },
  { label: 'Task Alarm', to: '/task-alarm', icon: AlarmClock },
  { label: 'Customers', to: '/debtors', icon: Users, hidden: true },
  { label: 'Debtor List', to: '/debtors', icon: ReceiptIndianRupee, end: true },
  { label: 'Provisional Debtors', to: '/debtors', icon: ReceiptIndianRupee, hidden: true },
  { label: 'Orders', to: '/orders', icon: ShoppingCart, end: true },
  { label: 'New Order', to: '/orders/new', icon: FilePlus2, end: true },
  { label: 'Employees', to: '/employees', icon: IdCard },
  { label: 'Reports', to: '/reports', icon: BarChart3 },
  { label: 'Settings', to: '/settings', icon: Settings },
];

function Sidebar() {
  const collapsed = useUi((s) => s.collapsed);
  const toggle = useUi((s) => s.toggleCollapsed);
  const open = useUi((s) => s.mobileNavOpen);
  const setMobileNav = useUi((s) => s.setMobileNav);
  return (
    <aside className={`no-print fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-sidebar-grad transition-transform duration-200 lg:transition-all ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 ${collapsed ? 'lg:w-[68px]' : 'lg:w-60'}`}>
      <div className={`flex items-center gap-2.5 px-4 pb-2 pt-5 ${collapsed ? 'lg:justify-center' : ''}`}>
        <img src="/app-icon.png" alt={APP_NAME} className="h-9 w-9 rounded-xl" />
        <div className={collapsed ? 'lg:hidden' : ''}>
          <p className="text-[15px] font-black leading-tight text-white">{APP_NAME}</p>
          <p className="text-[10px] font-semibold text-indigo-200/80">{APP_SUBTITLE}</p>
        </div>
      </div>
      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
        {NAV.filter((n) => !n.hidden).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end ?? n.to === '/'}
            title={collapsed ? n.label : undefined}
            onClick={() => setMobileNav(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold transition-colors ${collapsed ? 'lg:justify-center lg:px-2' : ''} ${
                isActive ? 'bg-white text-navy shadow' : 'text-indigo-100/85 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <n.icon size={17} className="shrink-0" />
            <span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{n.label}</span>
          </NavLink>
        ))}
      </nav>
      <button onClick={toggle} className="mb-3 hidden items-center justify-center gap-2 py-1.5 text-[11px] font-bold text-indigo-200/70 hover:text-white lg:flex">
        {collapsed ? <ChevronRight size={15} /> : <><ChevronLeft size={15} /> Collapse</>}
      </button>
    </aside>
  );
}

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const user = useLiveSession((s) => s.user);
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <div className="relative">
      <button className="flex items-center gap-2.5 rounded-xl border border-line bg-white py-1.5 pl-1.5 pr-3 hover:bg-canvas" onClick={() => setOpen(!open)}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-grad text-[12px] font-black text-white">{initials(user.name)}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-[12px] font-black leading-tight">{user.name}</span>
          <span className="block text-[10px] font-semibold capitalize text-muted">{user.role} • {user.department}</span>
        </span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-tile border border-line bg-white py-1 shadow-pop">
            <p className="px-3 py-2 text-[11px] text-muted">{user.email}</p>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-bold hover:bg-canvas"
              onClick={() => { setOpen(false); navigate('/settings'); }}
            >
              <Settings size={14} /> Account settings
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-bold text-brand-red hover:bg-canvas"
              onClick={() => { setOpen(false); void endLiveSession(); navigate('/login'); }}
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Header() {
  const collapsed = useUi((s) => s.collapsed);
  const toggleMobileNav = useUi((s) => s.toggleMobileNav);
  return (
    <header
      className={`no-print sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-white/85 px-4 py-3 backdrop-blur transition-all sm:px-5 ${collapsed ? 'lg:ml-[68px]' : 'lg:ml-60'}`}
    >
      <button className="rounded-xl border border-line bg-white p-2 text-muted hover:text-ink lg:hidden" onClick={toggleMobileNav} aria-label="Open navigation">
        <Menu size={17} />
      </button>
      <div className="ml-auto flex items-center gap-2">
        <ProfileMenu />
      </div>
    </header>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const collapsed = useUi((s) => s.collapsed);
  const mobileNavOpen = useUi((s) => s.mobileNavOpen);
  const setMobileNav = useUi((s) => s.setMobileNav);
  const liveUser = useLiveSession((s) => s.user);
  return (
    <div className="min-h-screen">
      <Sidebar />
      {mobileNavOpen && <div className="no-print fixed inset-0 z-40 bg-navy/40 lg:hidden" onClick={() => setMobileNav(false)} />}
      <Header />
      <main className={`px-4 pb-12 pt-5 transition-all sm:px-5 ${collapsed ? 'lg:ml-[68px]' : 'lg:ml-60'}`}>
        {liveUser && (
          <div className="mb-4 rounded-field bg-brand-blue/10 px-4 py-2 text-xs font-bold text-brand-blue">
            Connected to {serverHost()} — signed in as {liveUser.name}.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
