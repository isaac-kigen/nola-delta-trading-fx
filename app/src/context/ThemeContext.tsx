'use client';

import React, { createContext, useContext, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
export type PrimaryColor = 
  | 'blue' | 'red' | 'green' | 'purple' | 'pink' | 'orange' | 'yellow' 
  | 'indigo' | 'cyan' | 'teal' | 'emerald' | 'lime' | 'amber' | 'rose'
  | 'slate' | 'zinc' | 'stone' | 'neutral' | 'gray' | 'violet';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  primaryColor: PrimaryColor;
  setPrimaryColor: (color: PrimaryColor) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [primaryColor, setPrimaryColor] = useState<PrimaryColor>('blue');

  const isDark = theme === 'dark' || (theme === 'system' && 
    typeof window !== 'undefined' && 
    window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, primaryColor, setPrimaryColor, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (undefined === context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}

export const colorMap: Record<PrimaryColor, string> = {
  blue: '#3b82f6',
  red: '#ef4444',
  green: '#10b981',
  purple: '#a855f7',
  pink: '#ec4899',
  orange: '#f97316',
  yellow: '#eab308',
  indigo: '#6366f1',
  cyan: '#06b6d4',
  teal: '#14b8a6',
  emerald: '#059669',
  lime: '#84cc16',
  amber: '#f59e0b',
  rose: '#f43f5e',
  slate: '#64748b',
  zinc: '#71717a',
  stone: '#78716c',
  neutral: '#737373',
  gray: '#6b7280',
  violet: '#8b5cf6',
};
