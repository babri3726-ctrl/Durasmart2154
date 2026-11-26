import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  LayoutDashboard, TrendingUp, Wallet, Truck, Boxes,
  Map, Route, AlarmClock, ShoppingCart, IdCard, BarChart3, Settings, ReceiptIndianRupee,
  KeyRound, Building2,
  ChevronLeft, ChevronRight, LogOut, Menu, User,
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
interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    group: 'Executive & Overview',
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard },
      { label: 'Reports', to: '/reports', icon: BarChart3 },
    ],
  },
  {
    group: 'Finance & Accounts',
    items: [
      { label: 'Payment Control', to: '/payment', icon: Wallet },
      { label: 'Day Book', to: '/daybook', icon: BookOpen },
      { label: 'Debtor Master', to: '/debtors', icon: ReceiptIndianRupee, end: true },
      { label: 'Creditor Master', to: '/creditors', icon: Building2, end: true },
    ],
  },
  {
    group: 'Sales & Yard Operations',
    items: [
      { label: 'Sales & Targets', to: '/sales', icon: TrendingUp },
      { label: 'Sales Orders', to: '/orders', icon: ShoppingCart, end: true },
      { label: 'Dispatch Queue', to: '/dispatch', icon: Truck },
      { label: 'Stock Inventory', to: '/stock', icon: Boxes },
    ],
  },
  {
    group: 'Field & Organization',
    items: [
      { label: 'Tour Plan', to: '/tour-plan', icon: Route },
      { label: 'Vaccant Area', to: '/vaccant-area', icon: Map },
      { label: 'Task Alarm', to: '/task-alarm', icon: AlarmClock },
      { label: 'Staff & Team', to: '/employees', icon: IdCard },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
];

function Sidebar() {
  const collapsed = useUi((s) => s.collapsed);
  const toggle = useUi((s) => s.toggleCollapsed);
  const open = useUi((s) => s.mobileNavOpen);
  const setMobileNav = useUi((s) => s.setMobileNav);
  return (
    <aside
      className={`no-print fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar-grad transition-transform duration-200 lg:transition-all ${
        open ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 ${collapsed ? 'w-60 lg:w-[72px]' : 'w-64'}`}
    >
      <div className={`flex items-center gap-3 px-4 pb-3 pt-5 ${collapsed ? 'lg:justify-center' : ''}`}>
        <img src="/app-icon.png" alt={APP_NAME} className="h-9 w-9 rounded-xl shadow-sm" />
        <div className={collapsed ? 'lg:hidden' : ''}>
          <p className="text-[15px] font-black leading-tight tracking-wide text-white">{APP_NAME}</p>
          <p className="text-[10px] font-bold text-indigo-200/90">{APP_SUBTITLE}</p>
        </div>
      </div>

      <nav className="mt-2 flex-1 space-y-4 overflow-y-auto px-2.5 pb-4">
        {NAV_GROUPS.map((g) => (
          <div key={g.group} className="space-y-1">
            <p
              className={`px-3 text-[10px] font-extrabold uppercase tracking-wider text-indigo-200/60 ${
                collapsed ? 'lg:hidden' : ''
              }`}
            >
              {g.group}
            </p>
            <div className="space-y-0.5">
              {g.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end ?? n.to === '/'}
                  title={collapsed ? n.label : undefined}
                  onClick={() => setMobileNav(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-xl px-3 py-2 text-[12.5px] font-bold transition-all duration-150 ${
                      collapsed ? 'lg:justify-center lg:px-2' : ''
                    } ${
                      isActive
                        ? 'bg-white text-navy shadow-sm font-black'
                        : 'text-indigo-100/80 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  <n.icon size={17} className="shrink-0" />
                  <span className={`truncate ${collapsed ? 'lg:hidden' : ''}`}>{n.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-2.5 py-2">
        <button
          onClick={toggle}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-[11px] font-bold text-indigo-200/80 hover:bg-white/10 hover:text-white transition-colors"
        >
          {collapsed ? <ChevronRight size={15} /> : <><ChevronLeft size={15} /> Collapse Sidebar</>}
        </button>
      </div>
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
              onClick={() => { setOpen(false); navigate('/profile'); }}
            >
              <User size={14} /> My Profile
            </button>
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
  const user = useLiveSession((s) => s.user);
  return (
    <header
      className={`no-print sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-white/90 px-4 py-3 backdrop-blur transition-all sm:px-6 ${
        collapsed ? 'lg:ml-[72px]' : 'lg:ml-64'
      }`}
    >
      <button
        className="rounded-xl border border-line bg-white p-2 text-muted hover:text-ink lg:hidden"
        onClick={toggleMobileNav}
        aria-label="Open navigation"
      >
        <Menu size={17} />
      </button>

      <div className="flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          Connected
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        {user?.role === 'owner' && (
          <NavLink
            to="/employees"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#4F46E5] to-[#7C3AED] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:opacity-95 transition-opacity"
          >
            <KeyRound size={13} />
            <span>Generate Invite Code</span>
          </NavLink>
        )}
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
    <div className="min-h-screen bg-canvas">
      <Sidebar />
      {mobileNavOpen && (
        <div
          className="no-print fixed inset-0 z-40 bg-navy/40 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileNav(false)}
        />
      )}
      <Header />
      <main
        className={`px-4 pb-12 pt-5 transition-all sm:px-6 ${
          collapsed ? 'lg:ml-[72px]' : 'lg:ml-64'
        }`}
      >
        {liveUser && (
          <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-2.5 text-xs font-semibold text-blue-900 flex items-center justify-between">
            <span>
              Connected to <strong>{serverHost()}</strong> — signed in as{' '}
              <strong>{liveUser.name}</strong> ({liveUser.role} • {liveUser.department}).
            </span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
