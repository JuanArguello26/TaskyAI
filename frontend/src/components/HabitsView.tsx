'use client';
import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { Plus, Flame, Trash2, Check, Clock, Calendar, X } from 'lucide-react';
import { format } from 'date-fns';

const DAYS_OF_WEEK = [
  { key: 'monday', label: 'Lun' },
  { key: 'tuesday', label: 'Mar' },
  { key: 'wednesday', label: 'Mié' },
  { key: 'thursday', label: 'Jue' },
  { key: 'friday', label: 'Vie' },
  { key: 'saturday', label: 'Sáb' },
  { key: 'sunday', label: 'Dom' },
];

export default function HabitsView() {
  const { habits, fetchHabits, createHabit, toggleHabitLog, deleteHabit } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [newHabit, setNewHabit] = useState({
    name: '',
    description: '',
    frequency: 'daily',
    start_date: '',
    start_time: '',
    end_time: '',
    recurrence: [] as string[],
    reminder_minutes_before: 5,
  });
  const today = format(new Date(), 'yyyy-MM-dd');

  useEffect(() => {
    if (habits.length === 0) fetchHabits();
  }, [habits.length, fetchHabits]);

  const handleCreateHabit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHabit.name.trim()) return;
    
    const habitData: any = {
      name: newHabit.name,
      description: newHabit.description || null,
      frequency: newHabit.frequency,
      reminder_minutes_before: newHabit.reminder_minutes_before,
    };
    
    if (newHabit.start_date) {
      habitData.start_date = newHabit.start_date;
    }
    if (newHabit.start_time) {
      habitData.start_time = newHabit.start_time;
    }
    if (newHabit.end_time) {
      habitData.end_time = newHabit.end_time;
    }
    if (newHabit.recurrence.length > 0) {
      habitData.recurrence = newHabit.recurrence;
    }
    
    await createHabit(habitData);
    setNewHabit({
      name: '',
      description: '',
      frequency: 'daily',
      start_date: '',
      start_time: '',
      end_time: '',
      recurrence: [],
      reminder_minutes_before: 5,
    });
    setShowForm(false);
  };

  const handleToggleHabit = async (habitId: number, isCompleted: boolean) => {
    await toggleHabitLog(habitId, today, !isCompleted);
  };

  const toggleRecurrence = (day: string) => {
    setNewHabit(prev => ({
      ...prev,
      recurrence: prev.recurrence.includes(day)
        ? prev.recurrence.filter(d => d !== day)
        : [...prev.recurrence, day]
    }));
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in relative z-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Hábitos</h1>
          <p className="text-gray-400 mt-1">Construye tu racha diaria</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl hover:from-primary-500 hover:to-purple-500 transition-all shadow-lg shadow-primary-500/30 btn-modern"
        >
          <Plus size={20} />
          Nuevo hábito
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreateHabit} className="glass-card rounded-2xl p-6 space-y-4 animate-fade-in-up">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-white">Nuevo Hábito</h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-white">
              <X size={20} />
            </button>
          </div>
          
          <input
            type="text"
            placeholder="Nombre del hábito (ej. Gym)"
            value={newHabit.name}
            onChange={(e) => setNewHabit({ ...newHabit, name: e.target.value })}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          
          <input
            type="text"
            placeholder="Descripción (opcional)"
            value={newHabit.description}
            onChange={(e) => setNewHabit({ ...newHabit, description: e.target.value })}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Fecha de inicio</label>
              <input
                type="date"
                value={newHabit.start_date}
                onChange={(e) => setNewHabit({ ...newHabit, start_date: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Frecuencia</label>
              <select
                value={newHabit.frequency}
                onChange={(e) => setNewHabit({ ...newHabit, frequency: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 [&>option]:text-gray-800"
              >
                <option value="daily">Diario</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensual</option>
              </select>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                <Clock className="inline w-4 h-4 mr-1" />
                Hora de inicio
              </label>
              <input
                type="time"
                value={newHabit.start_time}
                onChange={(e) => setNewHabit({ ...newHabit, start_time: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                <Clock className="inline w-4 h-4 mr-1" />
                Hora de fin
              </label>
              <input
                type="time"
                value={newHabit.end_time}
                onChange={(e) => setNewHabit({ ...newHabit, end_time: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              <Calendar className="inline w-4 h-4 mr-1" />
              Repeticiones (días de la semana)
            </label>
            <div className="flex flex-wrap gap-2">
              {DAYS_OF_WEEK.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => toggleRecurrence(day.key)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    newHabit.recurrence.includes(day.key)
                      ? 'bg-primary-500 text-white'
                      : 'bg-white/10 text-gray-400 hover:bg-white/20'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <label className="block text-sm text-gray-400 mb-2">Recordatorio antes</label>
            <select
              value={newHabit.reminder_minutes_before}
              onChange={(e) => setNewHabit({ ...newHabit, reminder_minutes_before: parseInt(e.target.value) })}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 [&>option]:text-gray-800"
            >
              <option value={5}>5 minutos antes</option>
              <option value={10}>10 minutos antes</option>
              <option value={15}>15 minutos antes</option>
              <option value={30}>30 minutos antes</option>
              <option value={60}>1 hora antes</option>
            </select>
          </div>
          
          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl hover:from-primary-500 hover:to-purple-500 transition-all"
          >
            Crear Hábito
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {habits.map((habit) => (
          <HabitCard
            key={habit.id}
            habit={habit}
            today={today}
            onToggle={handleToggleHabit}
            onDelete={() => deleteHabit(habit.id)}
          />
        ))}
        {habits.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-500">
            <Flame size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-gray-400">No hay hábitos todavía</p>
            <p className="text-sm mt-2 text-gray-500">Crea tu primer hábito para empezar a construir tu racha</p>
          </div>
        )}
      </div>
    </div>
  );
}

function HabitCard({ habit, today, onToggle, onDelete }: {
  habit: any;
  today: string;
  onToggle: (id: number, completed: boolean) => void;
  onDelete: () => void;
}) {
  const isCompleted = habit.logs?.some((log: any) => log.date === today && log.is_completed);
  
  return (
    <div className="glass-card rounded-2xl p-5 card-hover">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${isCompleted ? 'bg-orange-500/30' : 'bg-white/10'}`}>
            <Flame className={isCompleted ? 'text-orange-400' : 'text-gray-400'} size={24} />
          </div>
          <div>
            <h3 className="font-semibold text-white">{habit.name}</h3>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              {habit.start_time && (
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {habit.start_time}
                  {habit.end_time && ` - ${habit.end_time}`}
                </span>
              )}
              {habit.recurrence && habit.recurrence.length > 0 && (
                <span className="text-xs bg-primary-500/20 px-2 py-0.5 rounded-full text-primary-400">
                  {habit.recurrence.length} días/semana
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="p-2 text-red-400 hover:text-red-300 transition-colors"
        >
          <Trash2 size={18} />
        </button>
      </div>
      
      <button
        onClick={() => onToggle(habit.id, !!isCompleted)}
        className={`w-full py-3 rounded-xl font-medium transition-all ${
          isCompleted
            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
            : 'bg-white/10 text-gray-400 hover:bg-white/20'
        }`}
      >
        {isCompleted ? (
          <span className="flex items-center justify-center gap-2">
            <Check size={20} />
            Completado
          </span>
        ) : (
          'Marcar como completado'
        )}
      </button>
      
      {habit.description && (
        <p className="mt-3 text-sm text-gray-400">{habit.description}</p>
      )}
      
      <div className="mt-4 pt-4 border-t border-white/10">
        <p className="text-xs text-gray-500">
          Creado el {new Date(habit.created_at).toLocaleDateString('es')}
        </p>
      </div>
    </div>
  );
}
