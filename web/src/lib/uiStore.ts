import { create } from 'zustand';

interface UiState {
  collapsed: boolean;
  toggleCollapsed: () => void;
  /** Off-canvas sidebar on narrow screens. */
  mobileNavOpen: boolean;
  setMobileNav: (open: boolean) => void;
  toggleMobileNav: () => void;
}

export const useUi = create<UiState>((set) => ({
  collapsed: false,
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
  mobileNavOpen: false,
  setMobileNav: (mobileNavOpen) => set({ mobileNavOpen }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
}));
