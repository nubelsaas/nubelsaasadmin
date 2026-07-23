'use client';
import { create } from 'zustand';
import { Session, User } from '@supabase/supabase-js';

export type AdminProfile = {
  id: string;
  email: string;
  name: string | null;
};

type AdminStore = {
  session: Session | null;
  admin: AdminProfile | null;
  setSession: (session: Session | null) => void;
  setAdmin: (admin: AdminProfile | null) => void;
  clear: () => void;
};

export const useAdminStore = create<AdminStore>((set) => ({
  session: null,
  admin: null,
  setSession: (session) => set({ session }),
  setAdmin: (admin) => set({ admin }),
  clear: () => set({ session: null, admin: null }),
}));
