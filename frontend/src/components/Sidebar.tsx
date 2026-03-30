'use client';
import { useStore } from '@/store';
import { useTheme } from './ThemeProvider';
import { LayoutDashboard, CheckSquare, Calendar, FileText, Flame, LogOut, Sun, Moon, Bell, Sparkles } from 'lucide-react';
import clsx from 'clsx';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'tasks', label: 'Tareas', icon: CheckSquare },
  { id: 'calendar', label: 'Calendario', icon: Calendar },
  { id: 'notes', label: 'Notas', icon: FileText },
  { id: 'habits', label: 'Hábitos', icon: Flame },
  { id: 'ai', label: 'Tasky AI', icon: Sparkles },
  { id: 'reminders', label: 'Recordatorios', icon: Bell },
] as const;

export default function Sidebar() {
  const { currentView, setView, logout } = useStore();
  const { theme, toggleTheme } = useTheme();

  return (
    <aside className="sidebar-gradient w-64 flex flex-col h-screen border-r border-white/10 animate-slide-in-left">
      <div className="p-6 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary-500/20 to-purple-500/20 blur-xl rounded-full"></div>
        <div className="relative">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary-400 to-purple-400 bg-clip-text text-transparent">
            Tasky AI
          </h1>
          <p className="text-sm text-gray-400/80">Life OS con IA</p>
        </div>
      </div>
      
      <nav className="flex-1 px-3">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id as any)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all mb-2 relative overflow-hidden group",
                currentView === item.id
                  ? "bg-gradient-to-r from-primary-500/30 to-purple-500/30 text-white shadow-lg shadow-primary-500/20 border border-primary-500/30"
                  : "text-gray-300 hover:bg-white/10 hover:text-white"
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <span className="absolute inset-0 bg-gradient-to-r from-primary-500/0 to-purple-500/0 group-hover:from-primary-500/10 group-hover:to-purple-500/10 transition-all duration-300"></span>
              <Icon size={20} className={currentView === item.id ? "text-primary-400" : ""} />
              <span className="relative">{item.label}</span>
              {currentView === item.id && (
                <span className="absolute right-2 w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse"></span>
              )}
            </button>
          );
        })}
      </nav>
      
      <div className="p-3 border-t border-white/10">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-gray-300 hover:bg-white/10 transition-all mb-2 group"
        >
          <span className="group-hover:rotate-180 transition-transform duration-500">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </span>
          {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        </button>
        
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/20 transition-all group"
        >
          <LogOut size={20} className="group-hover:translate-x-1 transition-transform" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
