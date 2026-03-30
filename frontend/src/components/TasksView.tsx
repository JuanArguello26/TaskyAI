'use client';
import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { Plus, CheckCircle, Circle, Trash2, Clock, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { Task } from '@/types';
import { format, isSameDay, parseISO } from 'date-fns';

export default function TasksView() {
  const { tasks, fetchTasks, createTask, updateTaskStatus, deleteTask } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState({ 
    title: '', 
    priority: 'medium' as const, 
    due_date: '',
    description: ''
  });

  useEffect(() => {
    if (tasks.length === 0) {
      fetchTasks();
    }
  }, [tasks.length, fetchTasks]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;
    await createTask({
      title: newTask.title,
      description: newTask.description || null,
      priority: newTask.priority,
      due_date: newTask.due_date || null,
    });
    setNewTask({ title: '', priority: 'medium', due_date: '', description: '' });
    setShowForm(false);
  };

  const handleToggleStatus = async (task: Task) => {
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    await updateTaskStatus(task.id, newStatus);
  };

  const priorityColors = {
    low: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    high: 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  const statusIcons = {
    pending: Circle,
    in_progress: Clock,
    completed: CheckCircle,
  };

  const pendingTasks = tasks.filter(t => t.status !== 'completed');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  const today = new Date();
  const upcomingTasks = tasks.filter(t => t.due_date && !isSameDay(parseISO(t.due_date), today) && t.status !== 'completed');

  return (
    <div className="p-6 space-y-6 animate-fade-in relative z-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Tareas</h1>
          <p className="text-gray-400 mt-1">Administra tus tareas</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl hover:from-primary-500 hover:to-purple-500 transition-all shadow-lg shadow-primary-500/30 btn-modern"
        >
          <Plus size={20} />
          Nueva tarea
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreateTask} className="glass-card rounded-2xl p-6 space-y-4 animate-fade-in-up">
          <input
            type="text"
            placeholder="Título de la tarea"
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          <input
            type="text"
            placeholder="Descripción (opcional)"
            value={newTask.description}
            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Prioridad</label>
              <select
                value={newTask.priority}
                onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as any })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary-500 [&>option]:text-gray-800"
              >
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                <Calendar className="inline w-4 h-4 mr-1" />
                Fecha límite
              </label>
              <input
                type="datetime-local"
                value={newTask.due_date}
                onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl hover:from-primary-500 hover:to-purple-500 transition-all"
          >
            Crear Tarea
          </button>
        </form>
      )}

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-white">Pendientes ({pendingTasks.length})</h2>
        {pendingTasks.length === 0 && (
          <p className="text-gray-500 text-center py-8">No hay tareas pendientes</p>
        )}
        {pendingTasks.map((task) => {
          const StatusIcon = statusIcons[task.status];
          return (
            <div
              key={task.id}
              className="glass-card rounded-xl p-4 flex items-center gap-4 hover:border-primary-500/50 transition-all card-hover"
            >
              <button onClick={() => handleToggleStatus(task)}>
                <StatusIcon
                  size={24}
                  className={clsx(
                    task.status === 'completed' ? 'text-green-400' : 'text-gray-400'
                  )}
                />
              </button>
              <div className="flex-1">
                <p className="font-medium text-white">{task.title}</p>
                {task.due_date && (
                  <p className="text-sm text-gray-400 flex items-center gap-1">
                    <Calendar size={12} />
                    Vence: {format(parseISO(task.due_date), 'dd MMM yyyy, HH:mm')}
                  </p>
                )}
              </div>
              <span className={clsx('px-3 py-1 rounded-full text-xs font-medium border', priorityColors[task.priority])}>
                {task.priority === 'high' ? 'Alta' : task.priority === 'medium' ? 'Media' : 'Baja'}
              </span>
              <button
                onClick={() => deleteTask(task.id)}
                className="p-2 text-red-400 hover:text-red-300 transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
          );
        })}
      </div>

      {completedTasks.length > 0 && (
        <div className="space-y-4 mt-8">
          <h2 className="text-lg font-semibold text-white">Completadas ({completedTasks.length})</h2>
          {completedTasks.map((task) => (
            <div
              key={task.id}
              className="glass-card rounded-xl p-4 flex items-center gap-4 opacity-60"
            >
              <button onClick={() => handleToggleStatus(task)}>
                <CheckCircle size={24} className="text-green-400" />
              </button>
              <div className="flex-1">
                <p className="font-medium text-white line-through">{task.title}</p>
              </div>
              <button
                onClick={() => deleteTask(task.id)}
                className="p-2 text-red-400 hover:text-red-300 transition-colors"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
