'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Lightbulb, TrendingUp, Brain, RefreshCw, CheckCircle, Plus, X, ExternalLink, BookOpen, ListChecks, Target } from 'lucide-react';
import { ai, AIResponse, HabitSuggestion, TaskSuggestion } from '@/lib/api';
import { useStore } from '@/store';

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

export default function AIView() {
  const [insights, setInsights] = useState<AIResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedHabit, setSelectedHabit] = useState<HabitSuggestion | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskSuggestion | null>(null);
  const { createHabit, createTask } = useStore();

  useEffect(() => {
    fetchInsights();
  }, []);

  const fetchInsights = async () => {
    setLoading(true);
    try {
      const data = await ai.insights();
      setInsights(data);
    } catch (error) {
      console.error('Error fetching AI insights:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddHabit = async (suggestion: HabitSuggestion) => {
    await createHabit({
      name: suggestion.habit_name,
      description: suggestion.reason,
      frequency: 'daily',
    });
  };

  const handleAddTask = async (suggestion: TaskSuggestion) => {
    await createTask({
      title: suggestion.task_title,
      description: suggestion.reason,
      priority: suggestion.priority as 'low' | 'medium' | 'high',
      status: 'pending',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full relative z-10">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 relative z-10">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div className="flex items-center gap-4">
          <div className="p-4 bg-gradient-to-br from-primary-500 to-purple-600 rounded-2xl shadow-lg shadow-primary-500/30 animate-float">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">
              Asistente de IA
            </h1>
            <p className="text-gray-400">
              Insights personalizados para optimizar tu productividad
            </p>
          </div>
        </div>
        <button
          onClick={fetchInsights}
          className="glass-card p-3 rounded-xl hover:bg-white/20 transition-all btn-modern group"
        >
          <RefreshCw className="w-5 h-5 text-white group-hover:rotate-180 transition-transform duration-500" />
        </button>
      </div>

      {insights && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-card rounded-2xl p-5 card-hover animate-fade-in-up delay-100">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-5 h-5 text-primary-400" />
                <span className="font-medium text-gray-300">Cambio de Score</span>
              </div>
              <p className="text-3xl font-bold bg-gradient-to-r from-primary-400 to-green-400 bg-clip-text text-transparent">
                {insights.summary.score_change > 0 ? '+' : ''}{insights.summary.score_change}%
              </p>
              <p className="text-gray-500 text-sm mt-1">Esta semana</p>
            </div>
            
            <div className="glass-card rounded-2xl p-5 card-hover animate-fade-in-up delay-200">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="w-5 h-5 text-purple-400" />
                <span className="font-medium text-gray-300">Insights</span>
              </div>
              <p className="text-3xl font-bold text-white">{insights.insights.length}</p>
              <p className="text-gray-500 text-sm mt-1">Análisis generados</p>
            </div>
            
            <div className="glass-card rounded-2xl p-5 card-hover animate-fade-in-up delay-300">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-5 h-5 text-yellow-400" />
                <span className="font-medium text-gray-300">Sugerencias</span>
              </div>
              <p className="text-3xl font-bold text-white">
                {insights.habit_suggestions.length + insights.task_suggestions.length}
              </p>
              <p className="text-gray-500 text-sm mt-1">Recomendaciones</p>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-6 animate-fade-in-up delay-400">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-primary-400" />
              <h2 className="text-lg font-semibold text-white">Resumen de Productividad</h2>
            </div>
            <p className="text-gray-300 mb-4">{insights.summary.week_summary}</p>
            <div className="space-y-2">
              <h3 className="font-medium text-white">Tendencias:</h3>
              <ul className="space-y-2">
                {insights.summary.trends.map((trend, index) => (
                  <li key={index} className="flex items-center gap-2 text-gray-400">
                    <TrendingUp className="w-4 h-4 text-green-400" />
                    {trend}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="glass-card rounded-2xl p-6 animate-fade-in-up delay-500">
              <div className="flex items-center gap-2 mb-4">
                <Lightbulb className="w-5 h-5 text-purple-400" />
                <h2 className="text-lg font-semibold text-white">Sugerencias de Hábitos</h2>
              </div>
              <div className="space-y-4">
                {insights.habit_suggestions.map((suggestion, index) => (
                  <div 
                    key={index} 
                    className="p-4 bg-white/5 rounded-xl border border-white/10 hover:border-purple-500/30 transition-all group cursor-pointer"
                    onClick={() => setSelectedHabit(suggestion)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-white group-hover:text-purple-400 transition-colors flex items-center gap-2">
                          {suggestion.habit_name}
                          <Sparkles className="w-4 h-4 text-purple-400 opacity-50" />
                        </h3>
                        <p className="text-sm text-gray-400 mt-1">{suggestion.reason}</p>
                        <span className={`inline-block mt-2 text-xs px-3 py-1 rounded-full ${
                          suggestion.difficulty === 'baja' 
                            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                            : suggestion.difficulty === 'media'
                            ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                            : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}>
                          Dificultad: {suggestion.difficulty}
                        </span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAddHabit(suggestion); }}
                        className="p-2 text-purple-400 hover:bg-purple-500/20 rounded-lg transition-all hover:scale-110"
                        title="Agregar hábito"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card rounded-2xl p-6 animate-fade-in-up delay-600">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="w-5 h-5 text-blue-400" />
                <h2 className="text-lg font-semibold text-white">Sugerencias de Tareas</h2>
              </div>
              <div className="space-y-4">
                {insights.task_suggestions.map((suggestion, index) => (
                  <div 
                    key={index} 
                    className="p-4 bg-white/5 rounded-xl border border-white/10 hover:border-blue-500/30 transition-all group cursor-pointer"
                    onClick={() => setSelectedTask(suggestion)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-white group-hover:text-blue-400 transition-colors flex items-center gap-2">
                          {suggestion.task_title}
                          <Sparkles className="w-4 h-4 text-blue-400 opacity-50" />
                        </h3>
                        <p className="text-sm text-gray-400 mt-1">{suggestion.reason}</p>
                        <span className={`inline-block mt-2 text-xs px-3 py-1 rounded-full ${
                          suggestion.priority === 'alta' 
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : suggestion.priority === 'media'
                            ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                        }`}>
                          Prioridad: {suggestion.priority}
                        </span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAddTask(suggestion); }}
                        className="p-2 text-blue-400 hover:bg-blue-500/20 rounded-lg transition-all hover:scale-110"
                        title="Agregar tarea"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-6 animate-fade-in-up delay-600">
            <div className="flex items-center gap-2 mb-4">
              <Brain className="w-5 h-5 text-yellow-400" />
              <h2 className="text-lg font-semibold text-white">Insights Personalizados</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {insights.insights.map((insight, index) => (
                <div 
                  key={index} 
                  className="flex items-start gap-3 p-4 bg-white/5 rounded-xl border border-white/10 hover:border-yellow-500/30 transition-all group"
                >
                  <Sparkles className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5 group-hover:animate-spin" />
                  <p className="text-gray-300">{insight}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <Modal
        isOpen={!!selectedHabit}
        onClose={() => setSelectedHabit(null)}
        title={selectedHabit?.habit_name || ''}
      >
        {selectedHabit && (
          <div className="space-y-4">
            <p className="text-gray-300">{selectedHabit.description}</p>
            
            <div>
              <h3 className="text-white font-medium flex items-center gap-2 mb-2">
                <Lightbulb className="w-4 h-4 text-yellow-400" />
                Tips para comenzar
              </h3>
              <ul className="space-y-2">
                {selectedHabit.tips.map((tip, i) => (
                  <li key={i} className="text-gray-400 text-sm flex items-start gap-2">
                    <span className="text-purple-400">•</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-white font-medium flex items-center gap-2 mb-2">
                <BookOpen className="w-4 h-4 text-blue-400" />
                Tipos de {selectedHabit.habit_name}
              </h3>
              <div className="flex flex-wrap gap-2">
                {selectedHabit.types.map((type, i) => (
                  <span key={i} className="text-xs px-3 py-1 bg-white/10 text-gray-300 rounded-full">
                    {type}
                  </span>
                ))}
              </div>
            </div>

            {selectedHabit.resources.length > 0 && (
              <div>
                <h3 className="text-white font-medium flex items-center gap-2 mb-2">
                  <ExternalLink className="w-4 h-4 text-green-400" />
                  Recursos útiles
                </h3>
                <div className="space-y-2">
                  {selectedHabit.resources.map((resource, i) => (
                    <a
                      key={i}
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-primary-400 hover:text-primary-300 text-sm"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {resource.title}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => { handleAddHabit(selectedHabit); setSelectedHabit(null); }}
              className="w-full py-3 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl hover:from-primary-500 hover:to-purple-500 transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Agregar a mis hábitos
            </button>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!selectedTask}
        onClose={() => setSelectedTask(null)}
        title={selectedTask?.task_title || ''}
      >
        {selectedTask && (
          <div className="space-y-4">
            <p className="text-gray-300">{selectedTask.description}</p>
            
            <div>
              <h3 className="text-white font-medium flex items-center gap-2 mb-2">
                <ListChecks className="w-4 h-4 text-green-400" />
                Pasos para completar
              </h3>
              <ul className="space-y-2">
                {selectedTask.steps.map((step, i) => (
                  <li key={i} className="text-gray-400 text-sm flex items-start gap-2">
                    <span className="text-blue-400 font-medium">{i + 1}.</span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-white font-medium flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-purple-400" />
                Beneficios
              </h3>
              <ul className="space-y-2">
                {selectedTask.benefits.map((benefit, i) => (
                  <li key={i} className="text-gray-400 text-sm flex items-start gap-2">
                    <span className="text-green-400">✓</span>
                    {benefit}
                  </li>
                ))}
              </ul>
            </div>

            <button
              onClick={() => { handleAddTask(selectedTask); setSelectedTask(null); }}
              className="w-full py-3 bg-gradient-to-r from-primary-600 to-blue-600 text-white rounded-xl hover:from-primary-500 hover:to-blue-500 transition-all flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Agregar a mis tareas
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
