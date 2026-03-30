'use client';
import SettingsView from '@/components/SettingsView';
import Sidebar from '@/components/Sidebar';

export default function SettingsPage() {
  return (
    <div className="flex h-screen bg-dark-bg">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <SettingsView />
      </main>
    </div>
  );
}
