'use client';
import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { Bell, Plus, Trash2, Clock, Calendar, X } from 'lucide-react';
import { format, parseISO, isSameDay, addDays, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';

export default function RemindersView() {
  const { reminders, fetchReminders, createReminder, deleteReminder, dismissReminder, tasks } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [newReminder, setNewReminder] = useState({
    title: '',
    description: '',
    remind_at: '',
    related_task_id: null as number | null,
  });

  useEffect(() => {
    if (reminders.length === 0) fetchReminders();
  }, [reminders.length, fetchReminders]);

  const handleCreateReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReminder.title.trim() || !newReminder.remind_at) return;
    await createReminder(newReminder);
    setNewReminder({ title: '', description: '', remind_at: '', related_task_id: null });
    setShowForm(false);
  };

  const pendingReminders = reminders.filter(r => !r.is_dismissed);
  const pastReminders = reminders.filter(r => r.is_dismissed);

  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const getRemindersForDay = (day: Date) => {
    return reminders.filter(r => isSameDay(parseISO(r.remind_at), day));
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in relative z-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Recordatorios</h1>
          <p className="text-gray-400 mt-1">No olvides tus tareas importantes</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl hover:from-primary-500 hover:to-purple-500 transition-all shadow-lg shadow-primary-500/30 btn-modern"
        >
          <Plus size={20} />
          Nuevo recordatorio
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreateReminder} className="glass-card rounded-2xl p-6 space-y-4 animate-fade-in-up">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Nuevo Recordatorio</h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">
              <X size={20} />
            </button>
          </div>
          
          <input
            type="text"
            placeholder="Título del recordatorio"
            value={newReminder.title}
            onChange={(e) => setNewReminder({ ...newReminder, title: e.target.value })}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          <input
            type="text"
            placeholder="Descripción (opcional)"
            value={newReminder.description}
            onChange={(e) => setNewReminder({ ...newReminder, description: e.target.value })}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                <Calendar className="inline w-4 h-4 mr-1" />
                Fecha y hora
              </label>
              <input
                type="datetime-local"
                value={newReminder.remind_at}
                onChange={(e) => setNewReminder({ ...newReminder, remind_at: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Tarea relacionada</label>
              <select
                value={newReminder.related_task_id || ''}
                onChange={(e) => setNewReminder({ ...newReminder, related_task_id: e.target.value ? Number(e.target.value) : null })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">Ninguna</option>
                {tasks.map(task => (
                  <option key={task.id} value={task.id}>{task.title}</option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl hover:from-primary-500 hover:to-purple-500 transition-all"
          >
            Crear Recordatorio
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-semibold text-white">Próximos ({pendingReminders.length})</h2>
          {pendingReminders.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Bell size={48} className="mx-auto mb-4 opacity-50" />
              <p>No hay recordatorios pendientes</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingReminders.map(reminder => (
                <ReminderCard
                  key={reminder.id}
                  reminder={reminder}
                  onDismiss={() => dismissReminder(reminder.id)}
                  onDelete={() => deleteReminder(reminder.id)}
                />
              ))}
            </div>
          )}

          {pastReminders.length > 0 && (
            <>
              <h2 className="text-xl font-semibold text-white mt-6">Historial ({pastReminders.length})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
                {pastReminders.slice(0, 6).map(reminder => (
                  <ReminderCard
                    key={reminder.id}
                    reminder={reminder}
                    onDismiss={() => {}}
                    onDelete={() => deleteReminder(reminder.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="glass-card rounded-2xl p-4">
          <h3 className="text-lg font-semibold text-white mb-4 text-center">
            {format(today, 'MMMM yyyy')}
          </h3>
          <div className="grid grid-cols-7 gap-1 text-center">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day, i) => (
              <div key={i} className="text-xs text-gray-500 font-medium">{day}</div>
            ))}
            {Array.from({ length: (monthStart.getDay() + 6) % 7 }).map((_, i) => (
              <div key={`empty-${i}`} className="p-2"></div>
            ))}
            {calendarDays.map(day => {
              const dayReminders = getRemindersForDay(day);
              const isToday = isSameDay(day, today);
              return (
                <div
                  key={day.toISOString()}
                  className={`p-2 text-sm rounded-lg relative ${
                    isToday 
                      ? 'bg-primary-500 text-white font-bold' 
                      : 'text-gray-300 hover:bg-white/10'
                  }`}
                >
                  {format(day, 'd')}
                  {dayReminders.length > 0 && (
                    <span className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
                      isToday ? 'bg-yellow-400' : 'bg-yellow-500'
                    }`}></span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReminderCard({ reminder, onDismiss, onDelete }: {
  reminder: any;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const reminderDate = parseISO(reminder.remind_at);
  const isPast = reminderDate < new Date();

  return (
    <div className={`glass-card rounded-xl p-5 ${isPast ? 'border-red-500/30' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${isPast ? 'bg-red-500/20' : 'bg-primary-500/20'}`}>
            <Clock className={isPast ? 'text-red-400' : 'text-primary-400'} size={20} />
          </div>
          <div>
            <h3 className="font-semibold text-white">{reminder.title}</h3>
            <p className="text-sm text-gray-400">
              {format(reminderDate, 'dd MMM yyyy, HH:mm')}
            </p>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="p-2 text-red-400 hover:text-red-300 transition-colors"
        >
          <Trash2 size={18} />
        </button>
      </div>
      
      {reminder.description && (
        <p className="text-sm text-gray-400 mb-3">{reminder.description}</p>
      )}
      
      {!reminder.is_dismissed && (
        <button
          onClick={onDismiss}
          className="w-full py-2 rounded-xl font-medium transition-all bg-white/10 text-gray-400 hover:bg-primary-500/20 hover:text-primary-400"
        >
          Marcar como visto
        </button>
      )}
    </div>
  );
}
