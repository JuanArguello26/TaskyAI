'use client';
import { useStore } from '@/store';
import { CheckCircle, Clock, Flame, Calendar as CalendarIcon, TrendingUp, Target, Sparkles, Bell, ListTodo } from 'lucide-react';
import { format, isSameDay, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isAfter, isBefore } from 'date-fns';

export default function DashboardView() {
  const { dashboardSummary, productivityHistory, quote, tasks, events, reminders, setView } = useStore();

  if (!dashboardSummary) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  const maxScore = Math.max(...(productivityHistory?.days.map(d => d.score) || [1]));

  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getItemsForDay = (day: Date) => {
    const dayTasks = tasks.filter(t => t.due_date && isSameDay(parseISO(t.due_date), day));
    const dayEvents = events.filter(e => isSameDay(parseISO(e.start_time), day));
    const dayReminders = reminders.filter(r => isSameDay(parseISO(r.remind_at), day));
    return { tasks: dayTasks, events: dayEvents, reminders: dayReminders };
  };

  const getUpcomingItems = () => {
    const now = new Date();
    const upcomingReminders = reminders
      .filter(r => !r.is_dismissed && isAfter(parseISO(r.remind_at), now))
      .sort((a, b) => parseISO(a.remind_at).getTime() - parseISO(b.remind_at).getTime())
      .slice(0, 3);
    
    const upcomingTasks = tasks
      .filter(t => t.due_date && t.status !== 'completed' && isAfter(parseISO(t.due_date), now))
      .sort((a, b) => parseISO(a.due_date!).getTime() - parseISO(b.due_date!).getTime())
      .slice(0, 2);

    return { upcomingReminders, upcomingTasks };
  };

  const { upcomingReminders, upcomingTasks } = getUpcomingItems();

  return (
    <div className="p-6 space-y-6 relative z-10">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">Tu resumen de productividad</p>
        </div>
        <div className="text-right glass-card rounded-2xl p-4 animate-pulse-glow">
          <div className="text-4xl font-bold bg-gradient-to-r from-primary-400 to-purple-400 bg-clip-text text-transparent">
            {dashboardSummary.productivity_score}%
          </div>
          <p className="text-gray-400 text-sm">Productividad</p>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-5 card-hover animate-fade-in-up delay-100 cursor-pointer" onClick={() => setView('tasks')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Tareas completadas</p>
              <p className="text-3xl font-bold text-green-400">{dashboardSummary.tasks_completed}</p>
            </div>
            <div className="p-3 bg-green-500/20 rounded-xl backdrop-blur-sm">
              <CheckCircle className="text-green-400" size={24} />
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-2">{dashboardSummary.tasks_pending} pendientes</p>
        </div>
        
        <div className="glass-card rounded-2xl p-5 card-hover animate-fade-in-up delay-200 cursor-pointer" onClick={() => setView('habits')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Hábitos</p>
              <p className="text-3xl font-bold text-orange-400">{dashboardSummary.habits_completed}/{dashboardSummary.habits_total}</p>
            </div>
            <div className="p-3 bg-orange-500/20 rounded-xl backdrop-blur-sm">
              <Flame className="text-orange-400 animate-bounce-gentle" size={24} />
            </div>
          </div>
        </div>
        
        <div className="glass-card rounded-2xl p-5 card-hover animate-fade-in-up delay-300 cursor-pointer" onClick={() => setView('calendar')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Racha</p>
              <p className="text-3xl font-bold text-purple-400">{dashboardSummary.streak} días</p>
            </div>
            <div className="p-3 bg-purple-500/20 rounded-xl backdrop-blur-sm">
              <Target className="text-purple-400" size={24} />
            </div>
          </div>
        </div>
        
        <div className="glass-card rounded-2xl p-5 card-hover animate-fade-in-up delay-400 cursor-pointer" onClick={() => setView('calendar')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-400">Eventos hoy</p>
              <p className="text-3xl font-bold text-blue-400">{dashboardSummary.events_today}</p>
            </div>
            <div className="p-3 bg-blue-500/20 rounded-xl backdrop-blur-sm">
              <CalendarIcon className="text-blue-400" size={24} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card rounded-2xl p-6 animate-fade-in-up delay-500">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="text-primary-400" size={20} />
              <h2 className="text-lg font-semibold text-white">Productividad (últimos 7 días)</h2>
            </div>
            <div className="flex items-end justify-between h-40 gap-2">
              {productivityHistory?.days.map((day, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2 group">
                  <div
                    className="w-full bg-gradient-to-t from-primary-600 to-primary-400 rounded-t-xl transition-all duration-500 group-hover:shadow-[0_0_20px_rgba(14,165,233,0.5)]"
                    style={{ height: `${(day.score / maxScore) * 100}%`, minHeight: '4px' }}
                  />
                  <span className="text-xs text-gray-500 group-hover:text-gray-300 transition-colors">
                    {format(new Date(day.date), 'EE').slice(0, 2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="glass-card rounded-2xl p-6 animate-fade-in-up delay-600">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="text-yellow-400" size={20} />
              <h2 className="text-lg font-semibold text-white">Cita Motivacional</h2>
            </div>
            <blockquote className="border-l-4 border-primary-500 pl-4 py-2">
              <p className="text-white italic text-lg">"{quote?.text}"</p>
              {quote?.author && (
                <p className="text-gray-400 mt-3">— {quote.author}</p>
              )}
            </blockquote>
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card rounded-2xl p-4 animate-fade-in-up delay-500">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">{format(today, 'MMMM yyyy')}</h3>
              <button onClick={() => setView('calendar')} className="text-primary-400 text-sm hover:underline">
                Ver más
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day, i) => (
                <div key={i} className="text-xs text-gray-500 font-medium">{day}</div>
              ))}
              {Array.from({ length: (monthStart.getDay() + 6) % 7 }).map((_, i) => (
                <div key={`empty-${i}`} className="p-2"></div>
              ))}
              {calendarDays.map(day => {
                const { tasks: dayTasks, events: dayEvents, reminders: dayReminders } = getItemsForDay(day);
                const isToday = isSameDay(day, today);
                const hasItems = dayTasks.length > 0 || dayEvents.length > 0 || dayReminders.length > 0;
                return (
                  <div
                    key={day.toISOString()}
                    className={`p-2 text-xs rounded-lg relative cursor-pointer hover:scale-110 transition-transform ${
                      isToday 
                        ? 'bg-primary-500 text-white font-bold' 
                        : hasItems
                        ? 'bg-purple-500/30 text-white'
                        : 'text-gray-400 hover:bg-white/10'
                    }`}
                    onClick={() => setView('calendar')}
                  >
                    {format(day, 'd')}
                    {hasItems && (
                      <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                        isToday ? 'bg-yellow-400' : dayEvents.length > 0 ? 'bg-blue-500' : 'bg-purple-500'
                      }`}></span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 animate-fade-in-up delay-600">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">
                <Bell className="inline w-4 h-4 mr-1" />
                Próximos
              </h3>
              <button onClick={() => setView('reminders')} className="text-primary-400 text-sm hover:underline">
                Ver todos
              </button>
            </div>
            {upcomingReminders.map(reminder => (
              <div key={`reminder-${reminder.id}`} className="flex items-center gap-2 p-2 bg-white/5 rounded-lg mb-2 cursor-pointer hover:bg-white/10" onClick={() => setView('reminders')}>
                <Bell size={14} className="text-yellow-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{reminder.title}</p>
                  <p className="text-xs text-gray-500">{format(parseISO(reminder.remind_at), 'd MMM, HH:mm')}</p>
                </div>
              </div>
            ))}
            {upcomingTasks.map(task => (
              <div key={`task-${task.id}`} className="flex items-center gap-2 p-2 bg-white/5 rounded-lg mb-2 cursor-pointer hover:bg-white/10" onClick={() => setView('tasks')}>
                <ListTodo size={14} className="text-primary-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{task.title}</p>
                  <p className="text-xs text-gray-500">{task.due_date && format(parseISO(task.due_date), 'd MMM, HH:mm')}</p>
                </div>
              </div>
            ))}
            {upcomingReminders.length === 0 && upcomingTasks.length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No hay recordatorios próximos</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
