'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store';
import Sidebar from '@/components/Sidebar';
import DashboardView from '@/components/DashboardView';
import TasksView from '@/components/TasksView';
import CalendarView from '@/components/CalendarView';
import NotesView from '@/components/NotesView';
import HabitsView from '@/components/HabitsView';
import RemindersView from '@/components/RemindersView';
import AIView from '@/components/AIView';
import SettingsView from '@/components/SettingsView';

export default function AppPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { currentView, dashboardSummary } = useStore();

  useEffect(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    const loadData = async () => {
      try {
        const store = useStore.getState();
        await Promise.all([
          store.fetchUser(),
          store.fetchDashboard(),
          store.fetchTasks(),
          store.fetchNotes(),
          store.fetchEvents(),
          store.fetchHabits(),
          store.fetchReminders(),
        ]);
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [isReady, router]);

  if (!isReady || isLoading || !dashboardSummary) {
    return (
      <div className="flex h-screen bg-dark-bg">
        <Sidebar />
        <main className="flex-1 overflow-y-auto flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
        </main>
      </div>
    );
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <DashboardView />;
      case 'tasks':
        return <TasksView />;
      case 'calendar':
        return <CalendarView />;
      case 'notes':
        return <NotesView />;
      case 'habits':
        return <HabitsView />;
      case 'ai':
        return <AIView />;
      case 'reminders':
        return <RemindersView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="flex h-screen bg-dark-bg">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {renderView()}
      </main>
    </div>
  );
}
