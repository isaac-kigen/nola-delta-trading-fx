'use client';

import { useState } from 'react';
import { ThemeProvider } from '@/context/ThemeContext';
import { ToastProvider } from '@/context/ToastContext';
import { SystemDataProvider } from '@/context/SystemDataContext';
import LoginPage from '@/components/LoginPage';
import Layout from '@/components/Layout';
import OverviewPage from '@/components/dashboard/pages/01-overview';
import ActiveSignalsPage from '@/components/dashboard/pages/02-active-signals';
import TradingHistoryPage from '@/components/dashboard/pages/03-trading-history';
import StrategyConfigPage from '@/components/dashboard/pages/04-strategy-config';
import BacktestResultsPage from '@/components/dashboard/pages/05-backtest-results';
import MarketDataPage from '@/components/dashboard/pages/06-market-data';
import RiskManagementPage from '@/components/dashboard/pages/07-risk-management';
import SymbolManagementPage from '@/components/dashboard/pages/08-symbol-management';
import NotificationsPage from '@/components/dashboard/pages/09-notifications';
import AnalyticsPage from '@/components/dashboard/pages/10-analytics';

function DashboardContent() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);

  const pages = [
    { title: 'Overview', component: <OverviewPage /> },
    { title: 'Active Signals', component: <ActiveSignalsPage /> },
    { title: 'Trading History', component: <TradingHistoryPage /> },
    { title: 'Strategy Config', component: <StrategyConfigPage /> },
    { title: 'Backtest Results', component: <BacktestResultsPage /> },
    { title: 'Market Data', component: <MarketDataPage /> },
    { title: 'Risk Management', component: <RiskManagementPage /> },
    { title: 'Symbol Management', component: <SymbolManagementPage /> },
    { title: 'Notifications & Logs', component: <NotificationsPage /> },
    { title: 'Analytics', component: <AnalyticsPage /> },
  ];

  if (!isLoggedIn) {
    return <LoginPage onLoginSuccess={() => setIsLoggedIn(true)} />;
  }

  return (
    <Layout
      currentPage={currentPage}
      onPageChange={setCurrentPage}
      onLogout={() => setIsLoggedIn(false)}
    >
      {pages[currentPage].component}
    </Layout>
  );
}

export default function Dashboard() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <SystemDataProvider>
          <DashboardContent />
        </SystemDataProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
