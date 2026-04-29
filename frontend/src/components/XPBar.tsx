'use client';
import { useStore } from '@/store';
import { Star } from 'lucide-react';

export default function XPBar() {
  const { user } = useStore();
  
  if (!user) return null;
  
  const totalXPForLevel = 100 * Math.pow(user.level, 1.5);
  const progress = (user.experience / totalXPForLevel) * 100;
  
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-primary-500 to-purple-500">
            <Star className="w-4 h-4 text-white fill-white" />
          </div>
          <span className="text-lg font-bold text-white">Nivel {user.level}</span>
        </div>
        <span className="text-sm text-gray-400">
          {user.experience} / {totalXPForLevel} XP
        </span>
      </div>
      
      <div className="h-3 bg-white/10 rounded-full overflow-hidden">
        <div 
          className="h-full xp-progress rounded-full transition-all duration-500 ease-out"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
    </div>
  );
}
