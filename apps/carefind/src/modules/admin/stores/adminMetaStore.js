import { create } from 'zustand'

export const useAdminMetaStore = create((set) => ({
  activeTab: 'overview',
  setActiveTab: (tab) => set({ activeTab: tab }),
}))
