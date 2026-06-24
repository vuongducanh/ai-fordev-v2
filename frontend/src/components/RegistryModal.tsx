import React, { useState, useEffect } from "react";
import { X, Download, Plus, Check, Loader2, Sparkles, Terminal } from "lucide-react";
import { api, pullModelSSE, installPluginSSE } from "../lib/api";
import type { SuggestedModel, Plugin } from "../lib/api";

interface RegistryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export const RegistryModal: React.FC<RegistryModalProps> = ({ isOpen, onClose, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<"models" | "plugins">("models");
  const [suggestedModels, setSuggestedModels] = useState<SuggestedModel[]>([]);
  const [suggestedPlugins, setSuggestedPlugins] = useState<Plugin[]>([]);
  const [customModel, setCustomModel] = useState("");
  const [loading, setLoading] = useState(false);

  // Tracks active installation states: item_id -> progress status message
  const [installStates, setInstallStates] = useState<Record<string, { status: string; message: string; percent?: number }>>({});

  useEffect(() => {
    if (isOpen) {
      loadCatalog();
    }
  }, [isOpen]);

  const loadCatalog = async () => {
    setLoading(true);
    try {
      const [models, plugins] = await Promise.all([
        api.getSuggestedModels(),
        api.getSuggestedPlugins()
      ]);
      setSuggestedModels(models);
      setSuggestedPlugins(plugins);
    } catch (err) {
      console.error("Failed to load catalog recommendations", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePullModel = (modelName: string) => {
    if (installStates[modelName]?.status === "downloading" || installStates[modelName]?.status === "starting") {
      return;
    }

    setInstallStates(prev => ({
      ...prev,
      [modelName]: { status: "starting", message: "Đang khởi động..." }
    }));

    pullModelSSE(modelName, (_event, data) => {
      if (data.status === "downloading" && data.completed && data.total) {
        const percent = Math.round((data.completed / data.total) * 100);
        setInstallStates(prev => ({
          ...prev,
          [modelName]: { status: "downloading", message: `Đang tải: ${percent}%`, percent }
        }));
      } else if (data.status === "success" || data.status === "completed") {
        setInstallStates(prev => ({
          ...prev,
          [modelName]: { status: "completed", message: "Đã hoàn thành!" }
        }));
        onRefresh();
      } else if (data.status === "failed" || data.status === "error") {
        setInstallStates(prev => ({
          ...prev,
          [modelName]: { status: "failed", message: data.message || "Lỗi cài đặt" }
        }));
      } else {
        setInstallStates(prev => ({
          ...prev,
          [modelName]: { status: "starting", message: data.status || data.message }
        }));
      }
    });
  };

  const handleInstallPlugin = (pluginId: string) => {
    if (installStates[pluginId]?.status === "connecting" || installStates[pluginId]?.status === "installing") {
      return;
    }

    setInstallStates(prev => ({
      ...prev,
      [pluginId]: { status: "installing", message: "Đang cài đặt..." }
    }));

    installPluginSSE(pluginId, (_event, data) => {
      if (data.status === "completed") {
        setInstallStates(prev => ({
          ...prev,
          [pluginId]: { status: "completed", message: "Đã cài đặt thành công!" }
        }));
        onRefresh();
      } else if (data.status === "failed") {
        setInstallStates(prev => ({
          ...prev,
          [pluginId]: { status: "failed", message: data.message || "Lỗi kết nối" }
        }));
      } else {
        setInstallStates(prev => ({
          ...prev,
          [pluginId]: { status: data.status, message: data.message }
        }));
      }
    });
  };

  const handlePullCustomModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customModel.trim()) return;
    handlePullModel(customModel.trim());
    setCustomModel("");
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl flex flex-col max-h-[85vh] shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h2 className="text-xl font-semibold text-white">Thư viện Hub A2A</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 px-6 bg-slate-950/20">
          <button
            onClick={() => setActiveTab("models")}
            className={`py-3 px-4 border-b-2 font-medium text-sm transition-all cursor-pointer ${
              activeTab === "models"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-300"
            }`}
          >
            Mô hình gợi ý (Ollama)
          </button>
          <button
            onClick={() => setActiveTab("plugins")}
            className={`py-3 px-4 border-b-2 font-medium text-sm transition-all cursor-pointer ${
              activeTab === "plugins"
                ? "border-indigo-500 text-indigo-400"
                : "border-transparent text-slate-400 hover:text-slate-300"
            }`}
          >
            Plugin & MCP Servers
          </button>
        </div>

        {/* Content Container */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
              <p className="text-sm text-slate-400">Đang tải danh mục gợi ý...</p>
            </div>
          ) : activeTab === "models" ? (
            <div className="space-y-6">
              
              {/* Custom Model Form */}
              <form onSubmit={handlePullCustomModel} className="flex gap-2 p-4 bg-slate-950/40 border border-slate-800/80 rounded-xl">
                <input
                  type="text"
                  placeholder="Tải mô hình Ollama khác (vd: llama3, deepseek-r1:8b)..."
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  Tải
                </button>
              </form>

              {/* Suggestions List */}
              <div className="grid gap-4">
                {suggestedModels.map((m) => {
                  const state = installStates[m.name];
                  return (
                    <div key={m.name} className="flex items-center justify-between p-4 bg-slate-950/20 border border-slate-800/60 rounded-xl hover:border-slate-800 transition-all">
                      <div className="space-y-1 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white font-mono">{m.name}</span>
                          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-medium">{m.size}</span>
                          {m.vision && <span className="text-[10px] bg-indigo-950 text-indigo-400 px-1.5 py-0.5 rounded font-medium">Vision</span>}
                          {m.tools && <span className="text-[10px] bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded font-medium">Tools</span>}
                        </div>
                        <p className="text-xs text-slate-400">{m.description}</p>
                      </div>
                      
                      <div className="min-w-[120px] flex justify-end">
                        {state?.status === "completed" ? (
                          <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
                            <Check className="w-4 h-4" />
                            Sẵn sàng
                          </div>
                        ) : state?.status === "downloading" || state?.status === "starting" ? (
                          <div className="w-full text-right space-y-1">
                            <div className="text-xs text-indigo-400 font-medium flex items-center justify-end gap-1.5">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              {state.message}
                            </div>
                            {state.percent !== undefined && (
                              <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                                <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${state.percent}%` }} />
                              </div>
                            )}
                          </div>
                        ) : state?.status === "failed" ? (
                          <button
                            onClick={() => handlePullModel(m.name)}
                            className="bg-red-950/30 hover:bg-red-900/30 border border-red-800 text-red-400 text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            Thử lại
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePullModel(m.name)}
                            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Cài đặt
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            // Plugins recommendation list
            <div className="grid gap-4">
              {suggestedPlugins.map((p) => {
                const state = installStates[p.id];
                return (
                  <div key={p.id} className="p-4 bg-slate-950/20 border border-slate-800/60 rounded-xl flex items-start justify-between">
                    <div className="space-y-2 pr-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-white">{p.name}</span>
                          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono uppercase">{p.type}</span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">{p.description}</p>
                      </div>
                      
                      {p.install && (
                        <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded text-[11px] font-mono text-slate-400 w-fit">
                          <Terminal className="w-3 h-3 text-indigo-400" />
                          <span>{p.install.command} {p.install.args.join(" ")}</span>
                        </div>
                      )}
                    </div>

                    <div className="min-w-[120px] flex justify-end">
                      {state?.status === "completed" ? (
                        <div className="flex items-center gap-1 text-emerald-400 text-xs font-medium">
                          <Check className="w-4 h-4" />
                          Đã cài
                        </div>
                      ) : state?.status === "connecting" || state?.status === "installing" ? (
                        <div className="text-xs text-indigo-400 font-medium flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {state.message || "Đang kết nối..."}
                        </div>
                      ) : state?.status === "failed" ? (
                        <div className="text-right space-y-1">
                          <div className="text-[10px] text-red-400 font-medium">{state.message}</div>
                          <button
                            onClick={() => handleInstallPlugin(p.id)}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            Cài lại
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleInstallPlugin(p.id)}
                          className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Kích hoạt
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
