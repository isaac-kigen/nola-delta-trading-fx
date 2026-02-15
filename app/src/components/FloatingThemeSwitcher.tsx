'use client';

import { useTheme, colorMap, type PrimaryColor } from '@/context/ThemeContext';
import { Sun, Moon, Monitor, Palette } from 'lucide-react';
import { useState } from 'react';

const colors: PrimaryColor[] = [
  'blue', 'red', 'green', 'purple', 'pink', 'orange', 'yellow', 'indigo',
  'cyan', 'teal', 'emerald', 'lime', 'amber', 'rose', 'slate', 'zinc',
  'stone', 'neutral', 'gray', 'violet'
];

export function FloatingThemeSwitcher() {
  const { theme, setTheme, primaryColor, setPrimaryColor } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Floating Menu */}
      {isOpen && (
        <div className="absolute bottom-20 right-0 bg-white dark:bg-slate-800 rounded-lg shadow-2xl p-4 border border-slate-200 dark:border-slate-700 w-80 animate-in fade-in zoom-in-95">
          {/* Theme Selector */}
          <div className="mb-4">
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 block flex items-center gap-2">
              <Monitor className="w-4 h-4" />
              Theme
            </label>
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 py-2 px-3 rounded text-sm font-medium transition-all flex items-center justify-center gap-1 ${
                    theme === t
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                  }`}
                >
                  {t === 'light' && <Sun className="w-4 h-4" />}
                  {t === 'dark' && <Moon className="w-4 h-4" />}
                  {t === 'system' && <Monitor className="w-4 h-4" />}
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Color Selector */}
          <div>
            <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2 block flex items-center gap-2">
              <Palette className="w-4 h-4" />
              Primary Color
            </label>
            <div className="grid grid-cols-5 gap-2">
              {colors.map((color) => (
                <button
                  key={color}
                  onClick={() => setPrimaryColor(color)}
                  className={`w-full h-8 rounded transition-all transform hover:scale-110 ${
                    primaryColor === color
                      ? 'ring-2 ring-offset-2 ring-slate-400 dark:ring-offset-slate-800'
                      : 'hover:ring-2 hover:ring-offset-1 hover:ring-slate-300 dark:hover:ring-offset-slate-900'
                  }`}
                  style={{ backgroundColor: colorMap[color] }}
                  title={color}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg hover:shadow-xl transition-all transform hover:scale-110 active:scale-95 flex items-center justify-center"
        title="Theme Settings"
      >
        <Palette className="w-6 h-6" />
      </button>
    </div>
  );
}

export default FloatingThemeSwitcher;
