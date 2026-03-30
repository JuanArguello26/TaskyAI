import { create } from 'zustand';
import { Task, Note, Event, Habit, Reminder, DashboardSummary, ProductivityHistory, MotivationalQuote, UserWithXP } from '@/types';
import { tasks, notes, events, habits, reminders, dashboard, auth, users } from '@/lib/api';

interface AppState {
  isAuthenticated: boolean;
  currentView: 'dashboard' | 'tasks' | 'calendar' | 'notes' | 'habits' | 'ai' | 'reminders' | 'settings';
  user: UserWithXP | null;
  tasks: Task[];
  notes: Note[];
  events: Event[];
  habits: Habit[];
  reminders: Reminder[];
  dashboardSummary: DashboardSummary | null;
  productivityHistory: ProductivityHistory | null;
  quote: MotivationalQuote | null;
  isLoading: boolean;
  
  setView: (view: AppState['currentView']) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => void;
  
  fetchUser: () => Promise<void>;
  updateUser: (name: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  
  fetchTasks: () => Promise<void>;
  createTask: (task: Partial<Task>) => Promise<void>;
  updateTask: (id: number, task: Partial<Task>) => Promise<void>;
  updateTaskStatus: (id: number, status: string) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  
  fetchNotes: () => Promise<void>;
  createNote: (note: Partial<Note>) => Promise<void>;
  updateNote: (id: number, note: Partial<Note>) => Promise<void>;
  deleteNote: (id: number) => Promise<void>;
  
  fetchEvents: () => Promise<void>;
  createEvent: (event: Partial<Event>) => Promise<void>;
  deleteEvent: (id: number) => Promise<void>;
  
  fetchHabits: () => Promise<void>;
  createHabit: (habit: Partial<Habit>) => Promise<void>;
  toggleHabitLog: (habitId: number, date: string, isCompleted: boolean) => Promise<void>;
  deleteHabit: (id: number) => Promise<void>;
  
  fetchReminders: () => Promise<void>;
  createReminder: (reminder: Partial<Reminder>) => Promise<void>;
  deleteReminder: (id: number) => Promise<void>;
  dismissReminder: (id: number) => Promise<void>;
  
  fetchDashboard: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  isAuthenticated: false,
  currentView: 'dashboard',
  user: null,
  tasks: [],
  notes: [],
  events: [],
  habits: [],
  reminders: [],
  dashboardSummary: null,
  productivityHistory: null,
  quote: null,
  isLoading: false,
  
  setView: (view) => set({ currentView: view }),
  
  login: async (email, password) => {
    await auth.login(email, password);
    set({ isAuthenticated: true });
    await get().fetchUser();
    await get().fetchDashboard();
  },
  
  register: async (email, name, password) => {
    await auth.register(email, name, password);
    await get().login(email, password);
  },
  
  logout: () => {
    auth.logout();
    set({
      isAuthenticated: false,
      user: null,
      tasks: [],
      notes: [],
      events: [],
      habits: [],
      reminders: [],
      dashboardSummary: null,
      productivityHistory: null,
      quote: null,
    });
  },
  
  fetchUser: async () => {
    const user = await users.me();
    set({ user });
  },
  
  updateUser: async (name) => {
    await users.update(name);
    await get().fetchUser();
  },
  
  changePassword: async (currentPassword, newPassword) => {
    await users.changePassword(currentPassword, newPassword);
  },
  
  deleteAccount: async () => {
    await users.delete();
    get().logout();
  },
  
  fetchTasks: async () => {
    const data = await tasks.list();
    set({ tasks: data });
  },
  
  createTask: async (task) => {
    const newTask = await tasks.create(task);
    set(state => ({ tasks: [...state.tasks, newTask] }));
    await get().fetchDashboard();
  },
  
  updateTask: async (id, task) => {
    const updatedTask = await tasks.update(id, task);
    set(state => ({
      tasks: state.tasks.map(t => t.id === id ? updatedTask : t)
    }));
  },

  updateTaskStatus: async (id, status) => {
    const updatedTask = await tasks.updateStatus(id, status);
    set(state => ({
      tasks: state.tasks.map(t => t.id === id ? updatedTask : t)
    }));
    await get().fetchDashboard();
  },

  deleteTask: async (id) => {
    await tasks.delete(id);
    set(state => ({
      tasks: state.tasks.filter(t => t.id !== id)
    }));
    await get().fetchDashboard();
  },
  
  fetchNotes: async () => {
    const data = await notes.list();
    set({ notes: data });
  },
  
  createNote: async (note) => {
    const newNote = await notes.create(note);
    set(state => ({ notes: [...state.notes, newNote] }));
  },

  updateNote: async (id, note) => {
    const updatedNote = await notes.update(id, note);
    set(state => ({
      notes: state.notes.map(n => n.id === id ? updatedNote : n)
    }));
  },

  deleteNote: async (id) => {
    await notes.delete(id);
    set(state => ({
      notes: state.notes.filter(n => n.id !== id)
    }));
  },

  fetchEvents: async () => {
    const data = await events.list();
    set({ events: data });
  },

  createEvent: async (event) => {
    const newEvent = await events.create(event);
    set(state => ({ events: [...state.events, newEvent] }));
    await get().fetchDashboard();
  },

  deleteEvent: async (id) => {
    await events.delete(id);
    set(state => ({
      events: state.events.filter(e => e.id !== id)
    }));
    await get().fetchDashboard();
  },

  fetchHabits: async () => {
    const data = await habits.list();
    set({ habits: data });
  },

  createHabit: async (habit) => {
    const newHabit = await habits.create(habit);
    set(state => ({ habits: [...state.habits, newHabit] }));
    await get().fetchDashboard();
  },

  toggleHabitLog: async (habitId, date, isCompleted) => {
    await habits.log(habitId, date, isCompleted);
    await get().fetchHabits();
    await get().fetchDashboard();
  },

  deleteHabit: async (id) => {
    await habits.delete(id);
    set(state => ({
      habits: state.habits.filter(h => h.id !== id)
    }));
    await get().fetchDashboard();
  },

  fetchReminders: async () => {
    const data = await reminders.list();
    set({ reminders: data });
  },

  createReminder: async (reminder) => {
    const newReminder = await reminders.create(reminder);
    set(state => ({ reminders: [...state.reminders, newReminder] }));
  },

  deleteReminder: async (id) => {
    await reminders.delete(id);
    set(state => ({
      reminders: state.reminders.filter(r => r.id !== id)
    }));
  },

  dismissReminder: async (id) => {
    const updatedReminder = await reminders.dismiss(id);
    set(state => ({
      reminders: state.reminders.map(r => r.id === id ? updatedReminder : r)
    }));
  },
  
  fetchDashboard: async () => {
    const [summary, history, quote] = await Promise.all([
      dashboard.summary(),
      dashboard.productivity(),
      dashboard.quote(),
    ]);
    set({ dashboardSummary: summary, productivityHistory: history, quote });
  },
}));
