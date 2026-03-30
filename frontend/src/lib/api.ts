import axios from 'axios';
import { Token, User, Task, Note, Event, Habit, Reminder, DashboardSummary, ProductivityHistory, MotivationalQuote } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api/v1';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken });
          localStorage.setItem('access_token', data.access_token);
          localStorage.setItem('refresh_token', data.refresh_token);
          originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
          return api(originalRequest);
        } catch {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

export const auth = {
  login: async (email: string, password: string) => {
    const formData = new URLSearchParams();
    formData.append('username', email);
    formData.append('password', password);
    const { data } = await api.post<Token>('/auth/login', formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    return data;
  },
  register: async (email: string, name: string, password: string) => {
    const { data } = await api.post<{ id: number; email: string; name: string }>('/auth/register', { email, name, password });
    return data;
  },
  logout: () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  },
};

export const tasks = {
  list: async (status?: string) => {
    const { data } = await api.get<Task[]>('/tasks', { params: { status } });
    return data;
  },
  get: async (id: number) => {
    const { data } = await api.get<Task>(`/tasks/${id}`);
    return data;
  },
  create: async (task: Partial<Task>) => {
    const { data } = await api.post<Task>('/tasks', task);
    return data;
  },
  update: async (id: number, task: Partial<Task>) => {
    const { data } = await api.put<Task>(`/tasks/${id}`, task);
    return data;
  },
  updateStatus: async (id: number, status: string) => {
    const { data } = await api.put<Task>(`/tasks/${id}/status`, { status });
    return data;
  },
  delete: async (id: number) => {
    await api.delete(`/tasks/${id}`);
  },
};

export const notes = {
  list: async (category?: string) => {
    const { data } = await api.get<Note[]>('/notes', { params: { category } });
    return data;
  },
  get: async (id: number) => {
    const { data } = await api.get<Note>(`/notes/${id}`);
    return data;
  },
  create: async (note: Partial<Note>) => {
    const { data } = await api.post<Note>('/notes', note);
    return data;
  },
  update: async (id: number, note: Partial<Note>) => {
    const { data } = await api.put<Note>(`/notes/${id}`, note);
    return data;
  },
  delete: async (id: number) => {
    await api.delete(`/notes/${id}`);
  },
};

export const events = {
  list: async (startDate?: string, endDate?: string) => {
    const { data } = await api.get<Event[]>('/events', { params: { start_date: startDate, end_date: endDate } });
    return data;
  },
  create: async (event: Partial<Event>) => {
    const { data } = await api.post<Event>('/events', event);
    return data;
  },
  update: async (id: number, event: Partial<Event>) => {
    const { data } = await api.put<Event>(`/events/${id}`, event);
    return data;
  },
  delete: async (id: number) => {
    await api.delete(`/events/${id}`);
  },
};

export const habits = {
  list: async () => {
    const { data } = await api.get<Habit[]>('/habits');
    return data;
  },
  create: async (habit: Partial<Habit>) => {
    const { data } = await api.post<Habit>('/habits', habit);
    return data;
  },
  update: async (id: number, habit: Partial<Habit>) => {
    const { data } = await api.put<Habit>(`/habits/${id}`, habit);
    return data;
  },
  delete: async (id: number) => {
    await api.delete(`/habits/${id}`);
  },
  log: async (id: number, date: string, isCompleted: boolean) => {
    const { data } = await api.post(`/habits/${id}/log`, { date, is_completed: isCompleted });
    return data;
  },
};

export const reminders = {
  list: async () => {
    const { data } = await api.get<Reminder[]>('/reminders');
    return data;
  },
  create: async (reminder: Partial<Reminder>) => {
    const { data } = await api.post<Reminder>('/reminders', reminder);
    return data;
  },
  delete: async (id: number) => {
    await api.delete(`/reminders/${id}`);
  },
  dismiss: async (id: number) => {
    const { data } = await api.put<Reminder>(`/reminders/${id}/dismiss`);
    return data;
  },
};

export const dashboard = {
  summary: async () => {
    const { data } = await api.get<DashboardSummary>('/dashboard/summary');
    return data;
  },
  productivity: async (days = 7) => {
    const { data } = await api.get<ProductivityHistory>('/dashboard/productivity', { params: { days } });
    return data;
  },
  quote: async () => {
    const { data } = await api.get<MotivationalQuote>('/dashboard/quote');
    return data;
  },
};

export interface ProductivitySummary {
  week_summary: string;
  trends: string[];
  score_change: number;
}

export interface HabitSuggestion {
  habit_name: string;
  reason: string;
  difficulty: string;
  description: string;
  tips: string[];
  types: string[];
  resources: { title: string; url: string }[];
}

export interface TaskSuggestion {
  task_title: string;
  reason: string;
  priority: string;
  description: string;
  steps: string[];
  benefits: string[];
}

export interface AIResponse {
  summary: ProductivitySummary;
  habit_suggestions: HabitSuggestion[];
  task_suggestions: TaskSuggestion[];
  insights: string[];
}

export const ai = {
  insights: async () => {
    const { data } = await api.get<AIResponse>('/ai/insights');
    return data;
  },
  habitSuggestions: async () => {
    const { data } = await api.get<HabitSuggestion[]>('/ai/habit-suggestions');
    return data;
  },
  taskSuggestions: async () => {
    const { data } = await api.get<TaskSuggestion[]>('/ai/task-suggestions');
    return data;
  },
};

export default api;
