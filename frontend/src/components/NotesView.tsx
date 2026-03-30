'use client';
import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { Plus, Trash2, FileText } from 'lucide-react';

export default function NotesView() {
  const { notes, fetchNotes, createNote, updateNote, deleteNote } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [newNote, setNewNote] = useState({ title: '', content: '', category: 'general' });

  useEffect(() => {
    if (notes.length === 0) fetchNotes();
  }, [notes.length, fetchNotes]);

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.title.trim()) return;
    await createNote(newNote);
    setNewNote({ title: '', content: '', category: 'general' });
    setShowForm(false);
  };

  const categories = ['general', 'trabajo', 'personal', 'ideas', 'proyectos'];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-dark-text">Notas</h1>
          <p className="text-dark-muted mt-1">Tu segundo cerebro</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors shadow-lg shadow-primary-500/20"
        >
          <Plus size={20} />
          Nueva nota
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreateNote} className="bg-dark-surface rounded-xl p-4 shadow-lg border border-dark-border space-y-4">
          <input
            type="text"
            placeholder="Título"
            value={newNote.title}
            onChange={(e) => setNewNote({ ...newNote, title: e.target.value })}
            className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-dark-text placeholder-dark-muted focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          <textarea
            placeholder="Contenido (soporta Markdown)"
            value={newNote.content}
            onChange={(e) => setNewNote({ ...newNote, content: e.target.value })}
            rows={4}
            className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-dark-text placeholder-dark-muted focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          />
          <div className="flex gap-4">
            <select
              value={newNote.category}
              onChange={(e) => setNewNote({ ...newNote, category: e.target.value })}
              className="px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-dark-text focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
              ))}
            </select>
            <button
              type="submit"
              className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors"
            >
              Crear
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {notes.map((note) => (
          <div
            key={note.id}
            className="bg-dark-surface rounded-xl p-4 shadow-lg border border-dark-border hover:border-primary-500/50 transition-colors"
          >
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-dark-text truncate">{note.title}</h3>
              <button
                onClick={() => deleteNote(note.id)}
                className="p-1 text-red-400 hover:text-red-300 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
            <p className="text-sm text-dark-muted line-clamp-4 whitespace-pre-wrap">
              {note.content || 'Sin contenido...'}
            </p>
            <div className="mt-3 pt-3 border-t border-dark-border flex items-center justify-between">
              <span className="text-xs px-2 py-1 bg-dark-border text-dark-muted rounded">
                {note.category}
              </span>
              <span className="text-xs text-dark-muted">
                {new Date(note.updated_at).toLocaleDateString('es')}
              </span>
            </div>
          </div>
        ))}
        {notes.length === 0 && (
          <div className="col-span-full text-center py-12 text-dark-muted">
            <FileText size={48} className="mx-auto mb-4 opacity-50" />
            <p>No hay notas todavía</p>
          </div>
        )}
      </div>
    </div>
  );
}
