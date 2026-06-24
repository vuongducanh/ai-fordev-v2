import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = ++idRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    // Auto-dismiss after 3.5s
    setTimeout(() => remove(id), 3500);
  }, [remove]);

  const success = useCallback((m: string) => toast(m, "success"), [toast]);
  const error = useCallback((m: string) => toast(m, "error"), [toast]);
  const info = useCallback((m: string) => toast(m, "info"), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info }}>
      {children}

      {/* Toast stack */}
      <div className="fixed bottom-6 right-6 z-[2000] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2.5 min-w-[260px] max-w-sm px-4 py-3 rounded-xl border shadow-2xl backdrop-blur-md text-sm font-medium animate-in slide-in-from-right-4 fade-in duration-200 ${
              t.type === "success"
                ? "bg-emerald-950/80 border-emerald-800 text-emerald-200"
                : t.type === "error"
                ? "bg-red-950/80 border-red-800 text-red-200"
                : "bg-slate-900/90 border-slate-700 text-slate-200"
            }`}
          >
            {t.type === "success" ? (
              <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 flex-shrink-0" />
            ) : t.type === "error" ? (
              <XCircle className="w-4.5 h-4.5 text-red-400 flex-shrink-0" />
            ) : (
              <Info className="w-4.5 h-4.5 text-indigo-400 flex-shrink-0" />
            )}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              onClick={() => remove(t.id)}
              className="text-current/60 hover:text-current transition-colors cursor-pointer flex-shrink-0"
              aria-label="Đóng"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
