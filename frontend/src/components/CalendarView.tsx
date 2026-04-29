'use client';
import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { Plus, Trash2, Flame, Bell, X, Calendar, Clock, FileText, CheckCircle } from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
}

function Modal({ isOpen, onClose, children, title }: ModalProps) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-white/20 rounded-2xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto animate-fade-in-up">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">
          <X size={24} />
        </button>
        <h2 className="text-xl font-bold text-white mb-4 pr-8">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export default function CalendarView() {
  const { events, tasks, habits, reminders, fetchEvents, fetchHabits, fetchReminders, createEvent, deleteEvent, deleteTask, deleteHabit, updateTaskStatus } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [selectedType, setSelectedType] = useState<'event' | 'task' | 'habit' | 'reminder' | null>(null);
  const [newEvent, setNewEvent] = useState({ 
    title: '', 
    description: '',
    start_time: '', 
    end_time: '',
    reminder_minutes_before: 5 
  });
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    if (events.length === 0) fetchEvents();
    if (habits.length === 0) fetchHabits();
    if (reminders.length === 0) fetchReminders();
  }, [events.length, habits.length, reminders.length, fetchEvents, fetchHabits, fetchReminders]);

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEvent.title.trim() || !newEvent.start_time) return;
    await createEvent({
      title: newEvent.title,
      description: newEvent.description || null,
      start_time: newEvent.start_time,
      end_time: newEvent.end_time || null,
      reminder_minutes_before: newEvent.reminder_minutes_before,
    });
    setNewEvent({ title: '', description: '', start_time: '', end_time: '', reminder_minutes_before: 5 });
    setShowForm(false);
  };

  const handleItemClick = (item: any, type: 'event' | 'task' | 'habit' | 'reminder') => {
    setSelectedItem(item);
    setSelectedType(type);
  };

  const handleCloseModal = () => {
    setSelectedItem(null);
    setSelectedType(null);
  };

  const handleDeleteFromModal = async () => {
    if (!selectedItem || !selectedType) return;
    
    if (selectedType === 'event') {
      await deleteEvent(selectedItem.id);
    } else if (selectedType === 'task') {
      await deleteTask(selectedItem.id);
    } else if (selectedType === 'habit') {
      await deleteHabit(selectedItem.id);
    }
    handleCloseModal();
  };

  const handleCompleteTask = async () => {
    if (!selectedItem || selectedType !== 'task') return;
    await updateTaskStatus(selectedItem.id, 'completed');
    handleCloseModal();
  };

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const getEventsForDay = (day: Date) => {
    return events.filter(event => isSameDay(parseISO(event.start_time), day));
  };

  const getHabitsForDay = (day: Date) => {
    const dayName = format(day, 'EEEE').toLowerCase();
    return habits.filter(habit => {
      if (!habit.start_time) return false;
      if (habit.recurrence && habit.recurrence.length > 0) {
        return habit.recurrence.includes(dayName);
      }
      return true;
    });
  };

  const getRemindersForDay = (day: Date) => {
    return reminders.filter(reminder => 
      isSameDay(parseISO(reminder.remind_at), day) && 
      !reminder.is_dismissed
    );
  };

  const getTasksForDay = (day: Date) => {
    return tasks.filter(task => task.due_date && isSameDay(parseISO(task.due_date), day));
  };

  const navigateWeek = (direction: number) => {
    setCurrentDate(prev => addDays(prev, direction * 7));
  };

  const renderModalContent = () => {
    if (!selectedItem || !selectedType) return null;

    switch (selectedType) {
      case 'event':
        return (
          <div className="space-y-4">
            {selectedItem.description && (
              <p className="text-gray-300">{selectedItem.description}</p>
            )}
            <div className="flex items-center gap-2 text-gray-400">
              <Calendar className="w-4 h-4" />
              <span>{format(parseISO(selectedItem.start_time), 'EEEE d, MMMM yyyy', { locale: es })}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-400">
              <Clock className="w-4 h-4" />
              <span>
                {format(parseISO(selectedItem.start_time), 'HH:mm')}
                {selectedItem.end_time && ` - ${format(parseISO(selectedItem.end_time), 'HH:mm')}`}
              </span>
            </div>
            {selectedItem.reminder_minutes_before && (
              <div className="flex items-center gap-2 text-gray-400">
                <Bell className="w-4 h-4" />
                <span>Recordatorio: {selectedItem.reminder_minutes_before} minutos antes</span>
              </div>
            )}
            <div className="flex gap-2 pt-4">
              <button
                onClick={handleDeleteFromModal}
                className="flex-1 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
              >
                Eliminar evento
              </button>
            </div>
          </div>
        );

      case 'task':
        return (
          <div className="space-y-4">
            {selectedItem.description && (
              <p className="text-gray-300">{selectedItem.description}</p>
            )}
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                selectedItem.priority === 'high' 
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : selectedItem.priority === 'medium'
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                  : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              }`}>
                Prioridad: {selectedItem.priority === 'high' ? 'Alta' : selectedItem.priority === 'medium' ? 'Media' : 'Baja'}
              </span>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                selectedItem.status === 'completed'
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : selectedItem.status === 'in_progress'
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                  : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
              }`}>
                {selectedItem.status === 'completed' ? 'Completada' : selectedItem.status === 'in_progress' ? 'En progreso' : 'Pendiente'}
              </span>
            </div>
            {selectedItem.due_date && (
              <div className="flex items-center gap-2 text-gray-400">
                <Calendar className="w-4 h-4" />
                <span>Vence: {format(parseISO(selectedItem.due_date), 'd MMM yyyy, HH:mm', { locale: es })}</span>
              </div>
            )}
            <div className="flex gap-2 pt-4">
              {selectedItem.status !== 'completed' && (
                <button
                  onClick={handleCompleteTask}
                  className="flex-1 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  Marcar completada
                </button>
              )}
              <button
                onClick={handleDeleteFromModal}
                className="py-2 px-4 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        );

      case 'habit':
        return (
          <div className="space-y-4">
            {selectedItem.description && (
              <p className="text-gray-300">{selectedItem.description}</p>
            )}
            <div className="flex items-center gap-2 text-gray-400">
              <Clock className="w-4 h-4" />
              <span>
                {selectedItem.start_time && `${selectedItem.start_time}`}
                {selectedItem.end_time && ` - ${selectedItem.end_time}`}
              </span>
            </div>
            {selectedItem.recurrence && selectedItem.recurrence.length > 0 && (
              <div>
                <span className="text-gray-400 text-sm">Días: </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedItem.recurrence.map((day: string) => (
                    <span key={day} className="text-xs px-2 py-1 bg-primary-500/20 text-primary-400 rounded-full">
                      {day.charAt(0).toUpperCase() + day.slice(1, 3)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-4">
              <button
                onClick={handleDeleteFromModal}
                className="flex-1 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
              >
                Eliminar hábito
              </button>
            </div>
          </div>
        );

      case 'reminder':
        return (
          <div className="space-y-4">
            {selectedItem.description && (
              <p className="text-gray-300">{selectedItem.description}</p>
            )}
            <div className="flex items-center gap-2 text-gray-400">
              <Calendar className="w-4 h-4" />
              <span>{format(parseISO(selectedItem.remind_at), 'EEEE d, MMMM yyyy', { locale: es })}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-400">
              <Clock className="w-4 h-4" />
              <span>{format(parseISO(selectedItem.remind_at), 'HH:mm')}</span>
            </div>
            <div className="pt-4">
              <button
                onClick={handleDeleteFromModal}
                className="w-full py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
              >
                Eliminar recordatorio
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in relative z-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Calendario</h1>
          <p className="text-gray-400 mt-1">{format(currentDate, 'MMMM yyyy', { locale: es })}</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl hover:from-primary-500 hover:to-purple-500 transition-all shadow-lg shadow-primary-500/30 btn-modern"
        >
          <Plus size={20} />
          Nuevo evento
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreateEvent} className="glass-card rounded-2xl p-6 space-y-4 animate-fade-in-up">
          <input
            type="text"
            placeholder="Título del evento"
            value={newEvent.title}
            onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          <input
            type="text"
            placeholder="Descripción (opcional)"
            value={newEvent.description}
            onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Inicio</label>
              <input
                type="datetime-local"
                value={newEvent.start_time}
                onChange={(e) => setNewEvent({ ...newEvent, start_time: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Fin (opcional)</label>
              <input
                type="datetime-local"
                value={newEvent.end_time}
                onChange={(e) => setNewEvent({ ...newEvent, end_time: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Recordatorio</label>
              <select
                value={newEvent.reminder_minutes_before}
                onChange={(e) => setNewEvent({ ...newEvent, reminder_minutes_before: parseInt(e.target.value) })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 [&>option]:text-gray-800"
              >
                <option value={5}>5 minutos antes</option>
                <option value={10}>10 minutos antes</option>
                <option value={15}>15 minutos antes</option>
                <option value={30}>30 minutos antes</option>
                <option value={60}>1 hora antes</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            className="px-6 py-3 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl hover:from-primary-500 hover:to-purple-500 transition-all"
          >
            Crear Evento
          </button>
        </form>
      )}

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <button
            onClick={() => navigateWeek(-1)}
            className="px-3 py-1 rounded-lg bg-white/10 text-white hover:bg-white/20"
          >
            ← Anterior
          </button>
          <span className="text-white font-medium">
            {format(weekStart, 'd MMM')} - {format(addDays(weekStart, 6), 'd MMM yyyy', { locale: es })}
          </span>
          <button
            onClick={() => navigateWeek(1)}
            className="px-3 py-1 rounded-lg bg-white/10 text-white hover:bg-white/20"
          >
            Siguiente →
          </button>
        </div>
        
        <div className="grid grid-cols-8 border-b border-white/10">
          <div className="p-3 text-center text-sm font-medium text-gray-400"></div>
          {weekDays.map((day) => {
            const dayTasks = getTasksForDay(day);
            const dayReminders = getRemindersForDay(day);
            return (
              <div
                key={day.toISOString()}
                className="p-3 text-center border-l border-white/10"
              >
                <p className="text-sm text-gray-400">{format(day, 'EEE', { locale: es })}</p>
                <p className={`text-lg font-semibold ${isSameDay(day, new Date()) ? 'text-primary-400' : 'text-white'}`}>
                  {format(day, 'd')}
                </p>
                {(dayTasks.length > 0 || dayReminders.length > 0) && (
                  <div className="mt-1 space-y-1">
                    {dayTasks.slice(0, 2).map(task => (
                      <div
                        key={task.id}
                        className="text-xs bg-primary-500/20 text-primary-400 p-1 rounded truncate border border-primary-500/30 cursor-pointer hover:bg-primary-500/40"
                        onClick={() => handleItemClick(task, 'task')}
                      >
                        {task.title}
                      </div>
                    ))}
                    {dayReminders.slice(0, 2).map(reminder => (
                      <div
                        key={reminder.id}
                        className="text-xs bg-yellow-500/20 text-yellow-400 p-1 rounded truncate border border-yellow-500/30 flex items-center gap-1 cursor-pointer hover:bg-yellow-500/40"
                        onClick={() => handleItemClick(reminder, 'reminder')}
                      >
                        <Bell size={10} />
                        {reminder.title}
                      </div>
                    ))}
                    {(dayTasks.length > 2 || dayReminders.length > 2) && (
                      <div className="text-xs text-gray-500">+{dayTasks.length + dayReminders.length - 2} más</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      
        <div className="max-h-[500px] overflow-y-auto">
          {hours.map((hour) => (
            <div key={hour} className="grid grid-cols-8 border-b border-white/10">
              <div className="p-2 text-xs text-gray-500 text-right pr-3">
                {hour.toString().padStart(2, '0')}:00
              </div>
              {weekDays.map((day) => {
                const dayEvents = getEventsForDay(day).filter(event => {
                  const eventHour = parseISO(event.start_time).getHours();
                  return eventHour === hour;
                });
                const dayHabits = getHabitsForDay(day).filter(habit => {
                  if (!habit.start_time) return false;
                  const habitHour = parseInt(habit.start_time.split(':')[0]);
                  return habitHour === hour;
                });
                const dayReminders = getRemindersForDay(day).filter(reminder => {
                  const reminderHour = parseISO(reminder.remind_at).getHours();
                  return reminderHour === hour;
                });
                const dayTasks = getTasksForDay(day).filter(task => {
                  if (!task.due_date) return false;
                  const taskHour = parseISO(task.due_date).getHours();
                  return taskHour === hour;
                });
                const allItems = [
                  ...dayEvents.map(e => ({ ...e, type: 'event' })),
                  ...dayHabits.map(h => ({ ...h, type: 'habit' })),
                  ...dayReminders.map(r => ({ ...r, type: 'reminder' })),
                  ...dayTasks.map(t => ({ ...t, type: 'task' }))
                ];
                
                return (
                  <div
                    key={`${day.toISOString()}-${hour}`}
                    className="min-h-[50px] border-l border-white/10 p-1"
                  >
                    {allItems.map((item: any, idx) => (
                      <div
                        key={idx}
                        className={`text-xs p-1 rounded mb-1 truncate border cursor-pointer hover:opacity-80 transition-opacity ${
                          item.type === 'habit'
                            ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                            : item.type === 'reminder'
                            ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                            : item.type === 'task'
                            ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                            : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                        }`}
                        onClick={() => handleItemClick(item, item.type)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate flex items-center gap-1">
                            {item.type === 'habit' && <Flame size={10} />}
                            {item.type === 'reminder' && <Bell size={10} />}
                            {item.title}
                          </span>
                          {item.type !== 'reminder' && (
                            <button
                              onClick={(e) => { e.stopPropagation(); 
                                item.type === 'event' ? deleteEvent(item.id) : deleteHabit(item.id);
                              }}
                              className="text-current hover:opacity-70"
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </div>
                        {(item.type === 'event' || item.type === 'task') && (item.start_time || item.due_date) && (
                          <span className="text-[10px] opacity-70">
                            {format(parseISO(item.start_time || item.due_date), 'HH:mm')}
                          </span>
                        )}
                        {item.type === 'habit' && item.start_time && (
                          <span className="text-[10px] opacity-70">{item.start_time}</span>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <Modal
        isOpen={!!selectedItem}
        onClose={handleCloseModal}
        title={
          selectedType === 'event' ? selectedItem?.title :
          selectedType === 'task' ? selectedItem?.title :
          selectedType === 'habit' ? selectedItem?.name :
          selectedType === 'reminder' ? selectedItem?.title : ''
        }
      >
        {renderModalContent()}
      </Modal>
    </div>
  );
}
