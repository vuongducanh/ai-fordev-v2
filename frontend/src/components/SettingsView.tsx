import React, { useState, useEffect } from "react";
import { Sliders, RefreshCw, Trash2, Cpu, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import type { OllamaModel } from "../lib/api";
import { useToast } from "../lib/toast";

interface SettingsViewProps {
  onRefreshHub: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onRefreshHub }) => {
  const { success, error } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [orchestratorSettings, setOrchestratorSettings] = useState({
    model: "qwen2.5:7b",
    temperature: 0.3,
    top_p: 0.9,
    top_k: 40
  });
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    loadSettingsAndModels();
  }, []);

  const loadSettingsAndModels = async () => {
    setLoading(true);
    try {
      const [allModels, settings] = await Promise.all([
        api.getOllamaModels(),
        api.getOrchestratorSettings()
      ]);
      setModels(allModels);
      if (settings && Object.keys(settings).length > 0) {
        setOrchestratorSettings(prev => ({ ...prev, ...settings }));
      }
    } catch (err) {
      console.error("Failed to load settings or models list", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setStatusMessage("");
    try {
      await api.updateOrchestratorSettings(orchestratorSettings);
      setStatusMessage("Đã lưu cấu hình thành công!");
      setTimeout(() => setStatusMessage(""), 3000);
      onRefreshHub();
      success("Đã lưu cấu hình điều phối (BFF)");
    } catch (err) {
      console.error("Failed to save orchestrator config", err);
      setStatusMessage("Lỗi lưu cấu hình.");
      error(`Lưu cấu hình thất bại: ${err instanceof Error ? err.message : "lỗi không xác định"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteModel = async (name: string) => {
    if (!confirm(`Bạn có chắc chắn muốn xoá mô hình ${name}? Tác vụ này sẽ giải phóng dung lượng đĩa.`)) {
      return;
    }
    try {
      await api.deleteOllamaModel(name);
      await loadSettingsAndModels();
      onRefreshHub();
      success(`Đã xoá mô hình "${name}"`);
    } catch (err) {
      console.error("Failed to delete model", name, err);
      error(`Không thể xoá mô hình "${name}": ${err instanceof Error ? err.message : "lỗi không xác định"}`);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Cpu className="w-6 h-6 text-indigo-400" />
          Hệ thống & Cài đặt BFF
        </h1>
        <p className="text-sm text-slate-400">Cấu hình mô hình điều phối BFF (BFF Orchestrator) và quản lý tài nguyên mô hình cục bộ.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 items-start">
        
        {/* BFF settings card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 backdrop-blur-md space-y-6">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Sliders className="w-4.5 h-4.5 text-indigo-400" />
            Tham số bộ điều phối BFF
          </h2>

          <form onSubmit={handleSaveSettings} className="space-y-4">
            
            {/* Model Dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase">Mô hình định tuyến (BFF)</label>
              <select
                value={orchestratorSettings.model}
                onChange={(e) => setOrchestratorSettings(prev => ({ ...prev, model: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                {models.length > 0 ? (
                  models.map(m => (
                    <option key={m.name} value={m.name}>{m.name}</option>
                  ))
                ) : (
                  <option value="qwen2.5:7b">qwen2.5:7b (Chưa cài)</option>
                )}
              </select>
            </div>

            {/* Temperature slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold text-slate-400 uppercase">
                <span>Nhiệt độ (Temperature)</span>
                <span className="font-mono text-indigo-400">{orchestratorSettings.temperature}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={orchestratorSettings.temperature}
                onChange={(e) => setOrchestratorSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <p className="text-[10px] text-slate-500">Thấp hơn = câu trả lời chính xác, nhất quán. Cao hơn = sáng tạo.</p>
            </div>

            {/* Top P slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold text-slate-400 uppercase">
                <span>Top P</span>
                <span className="font-mono text-indigo-400">{orchestratorSettings.top_p}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={orchestratorSettings.top_p}
                onChange={(e) => setOrchestratorSettings(prev => ({ ...prev, top_p: parseFloat(e.target.value) }))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <p className="text-[10px] text-slate-500">Thấp hơn = AI chỉ chọn trong những phương án phổ biến và an toàn nhất. Cao hơn = AI cân nhắc nhiều phương án hơn, câu trả lời đa dạng hơn.</p>
            </div>

            {/* Top K input */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold text-slate-400 uppercase">
                <span>Top K</span>
                <span className="font-mono text-indigo-400">{orchestratorSettings.top_k}</span>
              </div>
              <input
                type="range"
                min="1"
                max="100"
                step="1"
                value={orchestratorSettings.top_k}
                onChange={(e) => setOrchestratorSettings(prev => ({ ...prev, top_k: parseInt(e.target.value) }))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <p className="text-[10px] text-slate-500">Thấp hơn = AI chỉ xem xét một số ít lựa chọn tốt nhất. Cao hơn = AI xem xét nhiều lựa chọn hơn trước khi trả lời.</p>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-slate-800">
              <span className="text-xs text-emerald-400 font-medium">{statusMessage}</span>
              <button
                type="submit"
                disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu cấu hình"}
              </button>
            </div>

          </form>
        </div>

        {/* Local Ollama Models List */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 backdrop-blur-md space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Cpu className="w-4.5 h-4.5 text-indigo-400" />
              Mô hình đã cài (Ollama)
            </h2>
            <button
              onClick={loadSettingsAndModels}
              disabled={loading}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
            {models.length > 0 ? (
              models.map((m) => (
                <div key={m.name} className="flex items-center justify-between p-3 bg-slate-950/40 border border-slate-800/80 rounded-xl">
                  <div className="space-y-0.5">
                    <span className="font-semibold text-sm text-slate-200 font-mono">{m.name}</span>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono">
                      <span>{formatSize(m.size)}</span>
                      {m.details?.parameter_size && <span>· Size: {m.details.parameter_size}</span>}
                    </div>
                  </div>
                  
                  <button
                    onClick={() => handleDeleteModel(m.name)}
                    className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition-all cursor-pointer"
                    title="Xoá mô hình"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-12 border border-dashed border-slate-800 rounded-xl space-y-2">
                <AlertTriangle className="w-6 h-6 text-amber-500/80 animate-pulse" />
                <p className="text-xs text-slate-500">Chưa phát hiện mô hình nào trong Ollama local.</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
