'use client';

import { useState } from 'react';
import { LogIn, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useTheme, colorMap } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { primaryColor, isDark } = useTheme();
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    // Simulate login
    setTimeout(() => {
      if (email && password) {
        showToast('✓ Signed in successfully!', 'success');
        onLoginSuccess();
      } else {
        const errorMsg = 'Please fill in all fields';
        setError(errorMsg);
        showToast(errorMsg, 'error');
      }
      setIsLoading(false);
    }, 800);
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 transition-colors ${
      isDark ? 'bg-slate-900' : 'bg-slate-50'
    }`}>
      <div className={`w-full max-w-md transition-colors ${
        isDark ? 'bg-slate-800' : 'bg-white'
      } rounded-lg shadow-xl p-8`}>
        {/* Logo/Header */}
        <div className="flex items-center justify-center mb-8">
          <div 
            className="w-12 h-12 rounded-lg flex items-center justify-center text-white shadow-lg"
            style={{ backgroundColor: colorMap[primaryColor] }}
          >
            <LogIn className="w-6 h-6" />
          </div>
        </div>

        <h1 className={`text-3xl font-bold text-center mb-2 ${
          isDark ? 'text-white' : 'text-slate-900'
        }`}>
          Trading Dashboard
        </h1>
        <p className={`text-center mb-8 ${
          isDark ? 'text-slate-400' : 'text-slate-600'
        }`}>
          Sign in to your account
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${
              isDark ? 'text-slate-300' : 'text-slate-700'
            }`}>
              Email Address
            </label>
            <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border transition-all ${
              isDark 
                ? 'bg-slate-700 border-slate-600 focus-within:border-blue-500' 
                : 'bg-slate-50 border-slate-200 focus-within:border-blue-500'
            }`}>
              <Mail className="w-5 h-5 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={`flex-1 bg-transparent outline-none ${
                  isDark ? 'text-white placeholder-slate-500' : 'text-slate-900 placeholder-slate-400'
                }`}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${
              isDark ? 'text-slate-300' : 'text-slate-700'
            }`}>
              Password
            </label>
            <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border transition-all ${
              isDark 
                ? 'bg-slate-700 border-slate-600 focus-within:border-blue-500' 
                : 'bg-slate-50 border-slate-200 focus-within:border-blue-500'
            }`}>
              <Lock className="w-5 h-5 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`flex-1 bg-transparent outline-none ${
                  isDark ? 'text-white placeholder-slate-500' : 'text-slate-900 placeholder-slate-400'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`p-1 rounded hover:bg-slate-600 transition-colors ${
                  isDark ? 'text-slate-400 hover:text-slate-300' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-3 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <p className={`text-sm ${
                isDark ? 'text-red-300' : 'text-red-700'
              }`}>
                {error}
              </p>
            </div>
          )}

          {/* Login Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2 px-4 rounded-lg font-medium text-white transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ 
              backgroundColor: colorMap[primaryColor],
              opacity: isLoading ? 0.7 : 1
            }}
          >
            {isLoading ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Sign In
              </>
            )}
          </button>
        </form>

        {/* Demo Credentials */}
        <div className={`mt-6 p-4 rounded-lg ${
          isDark ? 'bg-slate-700' : 'bg-slate-100'
        }`}>
          <p className={`text-xs font-semibold mb-2 ${
            isDark ? 'text-slate-400' : 'text-slate-600'
          }`}>
            DEMO CREDENTIALS
          </p>
          <p className={`text-xs ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            Email: demo@trading.com<br />
            Password: anything
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
