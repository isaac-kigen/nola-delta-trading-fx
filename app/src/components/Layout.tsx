'use client';

import React, { useState } from 'react';
import { Menu, X, LogOut, BarChart3, Zap, TrendingUp, Settings, FileText, Bell, Activity, Shield, Palette, Home } from 'lucide-react';
import { useTheme, colorMap } from '@/context/ThemeContext';
import FloatingThemeSwitcher from '@/components/FloatingThemeSwitcher';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: number;
  onPageChange: (page: number) => void;
  onLogout: () => void;
}

const pages = [
  { icon: Home, label: 'Overview', id: 0 },
  { icon: Zap, label: 'Active Signals', id: 1 },
  { icon: TrendingUp, label: 'Trading History', id: 2 },
  { icon: Settings, label: 'Strategy Config', id: 3 },
  { icon: BarChart3, label: 'Backtest', id: 4 },
  { icon: FileText, label: 'Market Data', id: 5 },
  { icon: Shield, label: 'Risk Mgmt', id: 6 },
  { icon: Palette, label: 'Symbols', id: 7 },
  { icon: Bell, label: 'Notifications', id: 8 },
  { icon: Activity, label: 'Analytics', id: 9 },
];

export function Layout({ children, currentPage, onPageChange, onLogout }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isDark, primaryColor } = useTheme();

  const handlePageChange = (pageId: number) => {
    onPageChange(pageId);
  };

  const handleLogout = () => {
    onLogout();
  };

  return (
    <div className={`flex h-screen transition-colors ${isDark ? 'bg-slate-900' : 'bg-slate-50'}`}>
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} border-r transition-all duration-300 flex flex-col overflow-hidden`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-700">
          {sidebarOpen && (
            <div className="flex items-center gap-3">
              <div 
                className="w-8 h-8 rounded text-white flex items-center justify-center font-bold"
                style={{ backgroundColor: colorMap[primaryColor] }}
              >
                TD
              </div>
              <span className={`font-bold text-sm ${isDark ? 'text-white' : 'text-slate-900'}`}>
                Trading
              </span>
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`p-1 rounded hover:bg-slate-700 transition-colors ${isDark ? 'text-slate-400' : 'text-slate-500'}`}
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-2">
          {pages.map((page) => {
            const Icon = page.icon;
            const isActive = currentPage === page.id;
            return (
              <button
                key={page.id}
                onClick={() => {
                  handlePageChange(page.id);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all transform hover:scale-105 active:scale-95 ${
                  isActive
                    ? `text-white font-semibold`
                    : isDark
                    ? 'text-slate-300 hover:bg-slate-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
                style={{
                  backgroundColor: isActive ? colorMap[primaryColor] : undefined,
                }}
                title={page.label}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span className="text-sm">{page.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Logout Button */}
        <div className="p-3 border-t border-slate-700">
          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
              isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-600 hover:bg-red-50'
            }`}
            title="Logout"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <span className="text-sm font-medium">Logout</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`h-16 border-b ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} px-6 flex items-center justify-between`}>
          <div>
            <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {pages[currentPage].label}
            </h1>
            <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
              Page {currentPage + 1} of {pages.length}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button className={`p-2 rounded-lg hover:bg-slate-700 transition-colors ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              <Bell className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm">
              DU
            </div>
          </div>
        </div>

        {/* Page Content */}
        <div className="flex-1 overflow-auto">
          <div className="p-6">
            {children}
          </div>
        </div>

        {/* Floating Theme Switcher */}
        <FloatingThemeSwitcher />

        {/* Footer */}
        <div className={`h-12 border-t ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} px-6 flex items-center justify-between text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          <p>© 2026 Trading Dashboard. All rights reserved.</p>
          <p>v1.0.0 | Last updated: Feb 12, 2026</p>
        </div>
      </div>
    </div>
  );
}

export default Layout;
