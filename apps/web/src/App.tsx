import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MainLayout } from './layouts/MainLayout';
import { DashboardPage, RunsPage, AgentsPage, ProvidersPage, SystemPage } from './pages';
import { useAppStore } from './stores/useAppStore';
import { useWebSocketConnection } from './hooks/useWebSocketConnection';
import { ToastContainer } from './components/Toast';

export default function App() {
  const { fetchRuns, fetchProviders, fetchAgentRoles, toasts, removeToast } = useAppStore();
  
  // Initialize WebSocket connection
  useWebSocketConnection();
  
  // Load initial data - only once on mount
  useEffect(() => {
    fetchRuns(true);
    fetchProviders(true);
    fetchAgentRoles();
  }, []);

  return (
    <BrowserRouter>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunsPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="providers" element={<ProvidersPage />} />
          <Route path="system" element={<SystemPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
