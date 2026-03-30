export interface User {
  id: number;
  email: string;
  name: string;
  created_at: string;
}

export interface Task {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  created_at: string;
  completed_at: string | null;
  subtasks: SubTask[];
}

export interface SubTask {
  id: number;
  title: string;
  is_completed: boolean;
}

export interface Note {
  id: number;
  user_id: number;
  title: string;
  content: string | null;
  category: string;
  created_at: string;
  updated_at: string;
}

export interface Event {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  related_task_id: number | null;
  reminder_minutes_before: number;
  is_active: boolean;
  created_at: string;
}

export interface Habit {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  frequency: string;
  start_date: string | null;
  start_time: string | null;
  end_time: string | null;
  recurrence: string[] | null;
  reminder_minutes_before: number;
  is_active: boolean;
  created_at: string;
}

export interface HabitLog {
  id: number;
  habit_id: number;
  date: string;
  is_completed: boolean;
}

export interface Reminder {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  remind_at: string;
  related_task_id: number | null;
  related_habit_id: number | null;
  related_event_id: number | null;
  is_sent: boolean;
  is_dismissed: boolean;
  created_at: string;
}

export interface DashboardSummary {
  productivity_score: number;
  tasks_completed: number;
  tasks_pending: number;
  habits_completed: number;
  habits_total: number;
  events_today: number;
  streak: number;
}

export interface ProductivityDay {
  date: string;
  score: number;
  tasks_completed: number;
  habits_completed: number;
}

export interface ProductivityHistory {
  days: ProductivityDay[];
}

export interface MotivationalQuote {
  text: string;
  author: string | null;
}

export interface Token {
  access_token: string;
  refresh_token: string;
  token_type: string;
}
