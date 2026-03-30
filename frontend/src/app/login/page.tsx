'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/store';
import { useTheme } from '@/components/ThemeProvider';
import { Sun, Moon, Sparkles, ArrowRight } from 'lucide-react';

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

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();
  const { login, register } = useStore();
  const { theme, toggleTheme } = useTheme();

  const passwordStrength = getPasswordStrength(password);

  const validatePassword = (): boolean => {
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return false;
    }
    if (!/[A-Z]/.test(password)) {
      setError('La contraseña debe tener al menos 1 mayúscula');
      return false;
    }
    if (!/[a-z]/.test(password)) {
      setError('La contraseña debe tener al menos 1 letra minúscula');
      return false;
    }
    if (!/^[A-Za-z0-9]+$/.test(password)) {
      setError('La contraseña debe tener al menos 1 número o carácter especial');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!isLogin) {
      if (password !== confirmPassword) {
        setError('Las contraseñas no coinciden');
        return;
      }
      if (!validatePassword()) {
        return;
      }
    }

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, name, password);
      }
      router.push('/main');
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || 'Error al iniciar sesión';
      setError(typeof errorMsg === 'string' ? errorMsg : 'Error al conectar con el servidor');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary-900/50 via-purple-900/50 to-pink-900/50"></div>
      <div className="absolute inset-0 bg-[url('/background.png')] bg-cover bg-center opacity-30"></div>
      
      <button
        onClick={toggleTheme}
        className="absolute top-4 right-4 z-20 p-3 glass-card rounded-full text-white hover:bg-white/20 transition-all btn-modern"
      >
        {theme === 'dark' ? <Sun size={24} /> : <Moon size={24} />}
      </button>
      
      <div className="relative z-10 w-full max-w-md p-8 glass-card rounded-3xl shadow-2xl border border-white/10 animate-fade-in-scale">
        <div className="text-center mb-8">
          <div className="relative inline-block mb-4">
            <div className="absolute inset-0 bg-gradient-to-r from-primary-500 to-purple-500 blur-xl opacity-50 rounded-full"></div>
            <img src="/logo.png" alt="Tasky AI" className="relative w-24 h-24 mx-auto rounded-2xl shadow-lg" />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            Tasky AI
          </h1>
          <p className="text-gray-400 mt-2">Tu Life OS con Inteligencia Artificial</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <input
              type="text"
              placeholder="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent input-glow transition-all"
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent input-glow transition-all"
            required
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent input-glow transition-all"
            required
          />
          
          {!isLogin && (
            <>
              <input
                type="password"
                placeholder="Confirmar contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent input-glow transition-all"
                required
              />
              
                <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Nivel de seguridad:</span>
                  <span className={
                    passwordStrength.level === 'Fuerte' ? 'text-green-400' :
                    passwordStrength.level === 'Media' ? 'text-yellow-400' :
                    'text-red-400'
                  }>
                    {passwordStrength.level || 'Sin contraseña'}
                  </span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden relative">
                  <div
                    className={`h-full ${passwordStrength.color} transition-all duration-500 rounded-full`}
                    style={{ width: password ? passwordStrength.width : '0%' }}
                  />
                </div>
                <ul className="text-xs text-gray-500 space-y-1">
                  <li className={password.length >= 8 ? 'text-green-400' : ''}>
                    ✓ Al menos 8 caracteres
                  </li>
                  <li className={/[A-Z]/.test(password) ? 'text-green-400' : ''}>
                    ✓ Al menos 1 mayúscula
                  </li>
                  <li className={/[a-z]/.test(password) ? 'text-green-400' : ''}>
                    ✓ Al menos 1 minúscula
                  </li>
                  <li className={/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password) ? 'text-green-400' : ''}>
                    ✓ Al menos 1 número o carácter especial
                  </li>
                </ul>
              </div>
            </>
          )}
          
          {error && (
            <p className="text-red-400 text-sm text-center glass-card p-2 rounded-lg bg-red-500/10 border border-red-500/20">{error}</p>
          )}
          
          <button
            type="submit"
            className="w-full py-3 bg-gradient-to-r from-primary-600 to-purple-600 text-white rounded-xl font-medium hover:from-primary-500 hover:to-purple-500 transition-all shadow-lg shadow-primary-500/30 btn-modern group"
          >
            <span className="flex items-center justify-center gap-2">
              {isLogin ? 'Iniciar sesión' : 'Registrarse'}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </span>
          </button>
        </form>

        <p className="text-center mt-6 text-gray-400">
          {isLogin ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}{' '}
          <button
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
            className="text-primary-400 font-medium hover:text-primary-300 transition-colors"
          >
            {isLogin ? 'Regístrate' : 'Inicia sesión'}
          </button>
        </p>
      </div>
    </div>
  );
}
