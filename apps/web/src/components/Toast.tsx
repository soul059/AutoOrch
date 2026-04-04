import React, { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastMessage;
  onClose: (id: string) => void;
}

const TOAST_ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TOAST_STYLES = {
  success: 'bg-emerald-950/80 border-emerald-500/50 text-emerald-100',
  error: 'bg-red-950/80 border-red-500/50 text-red-100',
  warning: 'bg-amber-950/80 border-amber-500/50 text-amber-100',
  info: 'bg-blue-950/80 border-blue-500/50 text-blue-100',
};

const ICON_STYLES = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-blue-400',
};

function Toast({ toast, onClose }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsExiting(true);
        setTimeout(() => onClose(toast.id), 300);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, onClose]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => onClose(toast.id), 300);
  };

  const Icon = TOAST_ICONS[toast.type];

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 rounded-lg border backdrop-blur-xl max-w-[400px] mb-2 shadow-lg',
        TOAST_STYLES[toast.type],
        isExiting ? 'animate-slide-out' : 'animate-slide-in'
      )}
    >
      <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', ICON_STYLES[toast.type])} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">{toast.title}</div>
        {toast.message && (
          <div className="text-sm opacity-80 mt-0.5 break-words">{toast.message}</div>
        )}
      </div>
      <button
        onClick={handleClose}
        className="text-current opacity-60 hover:opacity-100 transition-opacity p-1"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-5 right-5 z-[9999] flex flex-col items-end">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
}

let toastIdCounter = 0;

export function createToast(
  type: ToastMessage['type'],
  title: string,
  message?: string,
  duration?: number
): ToastMessage {
  return {
    id: `toast-${Date.now()}-${toastIdCounter++}`,
    type,
    title,
    message,
    duration,
  };
}
