'use client';
import { useState, useEffect } from 'react';
import { useStore } from '@/store';
import { useTheme } from '@/components/ThemeProvider';
import { User, Lock, Moon, Sun, Trash2, Save, AlertTriangle } from 'lucide-react';

function getPasswordStrength(password: string): { level: string; color: string; width: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { level: 'Débil', color: 'bg-red-500', width: '33%' };
  if (score <= 4) return { level: 'Media', color: 'bg-yellow-500', width: '66%' };
  return { level: 'Fuerte', color: 'bg-green-500', width: '100%' };
}

export default function SettingsView() {
  const { user, updateUser, changePassword, deleteAccount } = useStore();
  const { theme, toggleTheme } = useTheme();
  
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  useEffect(() => {
    if (user) {
      setName(user.name);
    }
  }, [user]);
  
  const passwordStrength = getPasswordStrength(newPassword);
  
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    
    try {
      await updateUser(name);
      setMessage('Perfil actualizado correctamente');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al actualizar perfil');
    }
  };
  
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden');
      return;
    }
    
    if (newPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    
    try {
      await changePassword(currentPassword, newPassword);
      setMessage('Contraseña cambiada correctamente');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al cambiar contraseña');
    }
  };
  
  const handleDeleteAccount = async () => {
    try {
      await deleteAccount();
      window.location.href = '/';
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Error al eliminar cuenta');
    }
  };
  
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8 bg-gradient-to-r from-primary-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
        Configuración
      </h1>
      
      {message && (
        <div className="mb-6 p-4 bg-green-500/20 border border-green-500/30 rounded-xl text-green-400">
          {message}
        </div>
      )}
      
      {error && (
        <div className="mb-6 p-4 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400">
          {error}
        </div>
      )}
      
      <div className="space-y-8">
        <section className="glass-card p-6 rounded-2xl">
          <div className="flex items-center gap-3 mb-6">
            <User className="w-5 h-5 text-primary-400" />
            <h2 className="text-xl font-semibold">Información del perfil</h2>
          </div>
          
          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Email</label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-gray-400 cursor-not-allowed"
              />
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-2">Nombre</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary-600 to-purple-600 rounded-xl font-medium hover:from-primary-500 hover:to-purple-500 transition-all"
            >
              <Save className="w-4 h-4" />
              Guardar cambios
            </button>
          </form>
        </section>
        
        <section className="glass-card p-6 rounded-2xl">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="w-5 h-5 text-primary-400" />
            <h2 className="text-xl font-semibold">Cambiar contraseña</h2>
          </div>
          
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Contraseña actual</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-2">Nueva contraseña</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
              {newPassword && (
                <div className="mt-2 space-y-2">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Seguridad:</span>
                    <span className={
                      passwordStrength.level === 'Fuerte' ? 'text-green-400' :
                      passwordStrength.level === 'Media' ? 'text-yellow-400' :
                      'text-red-400'
                    }>
                      {passwordStrength.level}
                    </span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${passwordStrength.color} transition-all`}
                      style={{ width: passwordStrength.width }}
                    />
                  </div>
                </div>
              )}
            </div>
            
            <div>
              <label className="block text-sm text-gray-400 mb-2">Confirmar contraseña</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                required
              />
            </div>
            
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary-600 to-purple-600 rounded-xl font-medium hover:from-primary-500 hover:to-purple-500 transition-all"
            >
              <Lock className="w-4 h-4" />
              Cambiar contraseña
            </button>
          </form>
        </section>
        
        <section className="glass-card p-6 rounded-2xl">
          <div className="flex items-center gap-3 mb-6">
            {theme === 'dark' ? <Moon className="w-5 h-5 text-primary-400" /> : <Sun className="w-5 h-5 text-primary-400" />}
            <h2 className="text-xl font-semibold">Apariencia</h2>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-gray-300">Tema</span>
            <button
              onClick={toggleTheme}
              className="flex items-center gap-3 px-4 py-2 bg-white/10 rounded-xl hover:bg-white/20 transition-all"
            >
              {theme === 'dark' ? (
                <>
                  <Moon className="w-4 h-4" />
                  <span>Oscuro</span>
                </>
              ) : (
                <>
                  <Sun className="w-4 h-4" />
                  <span>Claro</span>
                </>
              )}
            </button>
          </div>
        </section>
        
        <section className="glass-card p-6 rounded-2xl border-red-500/30">
          <div className="flex items-center gap-3 mb-6">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h2 className="text-xl font-semibold text-red-400">Zona danger</h2>
          </div>
          
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-2 px-6 py-3 bg-red-600/20 border border-red-500/30 rounded-xl text-red-400 hover:bg-red-600/30 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              Eliminar cuenta
            </button>
          ) : (
            <div className="space-y-4">
              <p className="text-red-400">¿Estás seguro? Esta acción no se puede deshacer.</p>
              <div className="flex gap-4">
                <button
                  onClick={handleDeleteAccount}
                  className="flex items-center gap-2 px-6 py-3 bg-red-600 rounded-xl text-white hover:bg-red-700 transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                  Sí, eliminar
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-6 py-3 bg-white/10 rounded-xl text-gray-300 hover:bg-white/20 transition-all"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
