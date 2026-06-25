import React, { useState, useEffect, useRef } from "react";
import { Plus, Play, Square, Cpu, Check, Trash2, ShieldAlert, Loader2, X, Pencil } from "lucide-react";
import { api, installAgentSSE } from "../lib/api";
import type { Agent, Plugin, OllamaModel } from "../lib/api";
import { useToast } from "../lib/toast";

interface AgentsViewProps {
  ollamaModels: OllamaModel[];
  pluginsList: Plugin[];
  onRefreshHub: () => void;
}

export const AgentsView: React.FC<AgentsViewProps> = ({ ollamaModels, pluginsList, onRefreshHub }) => {
  const { success, error } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  // null = creating a new agent; otherwise the id of the agent being edited
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [form, setForm] = useState({
    id: "",
    name: "",
    description: "",
    model: "qwen3:1.7b",
    system_prompt: "",
    temperature: 0,
    top_p: 0.9,
    top_k: 40,
    num_ctx: 8192,
    thinking: false,
    vision: false,
    plugins: [] as string[]
  });

  // Installation stream state
  const [installStates, setInstallStates] = useState<Record<string, { status: string; message: string; percent?: number }>>({});

  useEffect(() => {
    loadAgents();
  }, []);

  // Close the Add Agent modal on Escape
  useEffect(() => {
    if (!showAddForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeForm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAddForm]);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const allAgents = await api.getAgents();
      setAgents(allAgents);
    } catch (err) {
      console.error("Failed to load agents list", err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectToggle = async (agent: Agent) => {
    try {
      if (agent.enabled) {
        await api.disconnectAgent(agent.id);
        success(`Đã ngắt kết nối "${agent.card.name}"`);
      } else {
        await api.connectAgent(agent.id);
        success(`Đã kết nối "${agent.card.name}"`);
      }
      await loadAgents();
      onRefreshHub();
    } catch (err) {
      console.error("Failed to toggle connection status", err);
      error(`Không thể đổi trạng thái kết nối: ${err instanceof Error ? err.message : "lỗi không xác định"}`);
    }
  };

  const handleInstallModel = (agentId: string) => {
    setInstallStates(prev => ({ ...prev, [agentId]: { status: "starting", message: "Đang tải..." } }));
    
    installAgentSSE(agentId, (_event, data) => {
      if (data.status === "downloading" && data.completed && data.total) {
        const percent = Math.round((data.completed / data.total) * 100);
        setInstallStates(prev => ({
          ...prev,
          [agentId]: { status: "downloading", message: `Đang tải: ${percent}%`, percent }
        }));
      } else if (data.status === "completed") {
        setInstallStates(prev => ({ ...prev, [agentId]: { status: "completed", message: "Hoàn tất!" } }));
        loadAgents();
        onRefreshHub();
        success(`Đã cài mô hình cho "${agentId}"`);
      } else if (data.status === "failed") {
        setInstallStates(prev => ({ ...prev, [agentId]: { status: "failed", message: data.message || "Lỗi tải model" } }));
        error(`Cài mô hình thất bại: ${data.message || "lỗi không xác định"}`);
      } else {
        setInstallStates(prev => ({ ...prev, [agentId]: { status: "starting", message: data.status || data.message } }));
      }
    });
  };

  const emptyForm = () => ({
    id: "",
    name: "",
    description: "",
    model: "qwen3:1.7b",
    system_prompt: "",
    temperature: 0,
    top_p: 0.9,
    top_k: 40,
    num_ctx: 8192,
    thinking: false,
    vision: false,
    plugins: [] as string[]
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowAddForm(true);
  };

  const openEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setForm({
      id: agent.id,
      name: agent.card.name,
      description: agent.card.description,
      model: agent.llm.model,
      system_prompt: agent.llm.system_prompt,
      temperature: agent.llm.temperature,
      top_p: agent.llm.top_p,
      top_k: agent.llm.top_k,
      num_ctx: agent.llm.num_ctx,
      thinking: agent.llm.thinking,
      vision: agent.llm.vision,
      plugins: agent.plugins || []
    });
    setShowAddForm(true);
  };

  const closeForm = () => {
    setShowAddForm(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id || !form.name) return;

    // When editing, preserve the agent's current connection/install state
    const existing = editingId ? agents.find(a => a.id === editingId) : undefined;

    // Check if model is already pulled
    const isModelPulled = ollamaModels.some(m => m.name === form.model || m.model === form.model);

    const newAgent: Agent = {
      id: form.id.trim(),
      // Preserve connection state when editing; new agents start disconnected.
      enabled: existing ? existing.enabled : false,
      // Editing keeps installed unless the model changed to a non-pulled one.
      installed: existing && existing.llm.model === form.model ? existing.installed : isModelPulled,
      card: {
        name: form.name.trim(),
        description: form.description.trim(),
        skills: [{
          id: "general",
          name: "Kỹ năng tổng hợp",
          description: form.description.trim(),
          tags: ["general"],
          examples: []
        }]
      },
      llm: {
        provider: "ollama",
        model: form.model,
        system_prompt: form.system_prompt.trim(),
        temperature: form.temperature,
        top_p: form.top_p,
        top_k: form.top_k,
        num_ctx: form.num_ctx,
        thinking: form.thinking,
        vision: form.vision
      },
      plugins: form.plugins
    };

    try {
      const wasEditing = !!editingId;
      await api.upsertAgent(newAgent);
      closeForm();
      await loadAgents();
      onRefreshHub();
      success(wasEditing ? `Đã cập nhật agent "${newAgent.card.name}"` : `Đã tạo agent "${newAgent.card.name}"`);
    } catch (err) {
      console.error("Failed to create agent", err);
      error(`Lưu agent thất bại: ${err instanceof Error ? err.message : "lỗi không xác định"}`);
    }
  };

  const handleDeleteAgent = async (id: string) => {
    if (!confirm("Bạn có chắc chắn muốn xoá agent này?")) return;
    const name = agents.find(a => a.id === id)?.card.name || id;
    try {
      await api.deleteAgent(id);
      await loadAgents();
      onRefreshHub();
      success(`Đã xoá agent "${name}"`);
    } catch (err) {
      console.error("Failed to delete agent", err);
      error(`Xoá agent thất bại: ${err instanceof Error ? err.message : "lỗi không xác định"}`);
    }
  };

  const handlePluginToggle = (pid: string) => {
    setForm(prev => {
      const alreadyChecked = prev.plugins.includes(pid);
      const nextPlugins = alreadyChecked
        ? prev.plugins.filter(id => id !== pid)
        : [...prev.plugins, pid];
      return { ...prev, plugins: nextPlugins };
    });
  };

  return (
    <div className="max-w-5xl w-full h-full mx-auto flex flex-col space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">

      {/* Title */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Cpu className="w-6 h-6 text-indigo-400" />
            Quản lý Backend Agents (BE)
          </h1>
          <p className="text-sm text-slate-400">Thiết lập cấu hình LLM, Prompt, bật/tắt endpoint A2A của từng Agent chuyên môn.</p>
        </div>
        
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all cursor-pointer shadow-lg hover:shadow-indigo-500/20"
        >
          <Plus className="w-4 h-4" />
          Tạo Agent Mới
        </button>
      </div>

      {/* Add Agent Modal */}
      {showAddForm && (
        <div
          className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-slate-950/70 backdrop-blur-sm p-4 sm:p-8 animate-in fade-in duration-150"
          onMouseDown={(e) => {
            // Close only when clicking the backdrop itself, not its children
            if (e.target === e.currentTarget) closeForm();
          }}
        >
          <form
            onSubmit={handleSubmit}
            className="relative w-full max-w-3xl my-auto p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl space-y-5 animate-in zoom-in-95 slide-in-from-bottom-2 duration-200"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">
                {editingId ? "Sửa Agent chuyên môn" : "Thêm Agent chuyên môn mới"}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                className="text-slate-500 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase">Mã Agent (ID)</label>
              <input
                type="text"
                placeholder="vd: researcher"
                value={form.id}
                onChange={e => setForm(prev => ({ ...prev, id: e.target.value }))}
                disabled={!!editingId}
                title={editingId ? "Không thể đổi ID của agent đã tạo" : undefined}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                required
              />
            </div>
            
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Tên hiển thị</label>
              <input
                type="text"
                placeholder="vd: Chuyên gia Nghiên cứu"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase">Mô tả vai trò (BFF dùng để định tuyến)</label>
            <input
              type="text"
              placeholder="Giải thích rõ năng lực, vd: Phân tích sâu sắc tài liệu và tìm kiếm thông tin trên internet..."
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Prompt and Model Selector */}
          <div className="grid md:grid-cols-3 gap-6">
            
            <div className="md:col-span-2 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase">Chỉ thị hệ thống (System Prompt)</label>
                <textarea
                  placeholder="Chỉ dẫn vai trò chi tiết cho agent..."
                  value={form.system_prompt}
                  onChange={e => setForm(prev => ({ ...prev, system_prompt: e.target.value }))}
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 resize-none font-mono"
                />
              </div>
            </div>

            <div className="space-y-4">
              
              {/* Model Picker */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase">Mô hình LLM</label>
                <ModelPicker
                  value={form.model}
                  options={ollamaModels.map(m => m.name)}
                  onChange={val => setForm(prev => ({ ...prev, model: val }))}
                />
              </div>

              {/* Context window size */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase">Ngữ cảnh (Num Ctx)</label>
                <select
                  value={form.num_ctx}
                  onChange={e => setForm(prev => ({ ...prev, num_ctx: parseInt(e.target.value) }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value={2048}>2048 (2K)</option>
                  <option value={4096}>4096 (4K)</option>
                  <option value={8192}>8192 (8K)</option>
                  <option value={16384}>16384 (16K)</option>
                </select>
              </div>

            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/60">
            <button
              type="button"
              onClick={closeForm}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              {editingId ? "Cập nhật Agent" : "Lưu Agent"}
            </button>
          </div>
          </form>
        </div>
      )}

      {/* Agents List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-400">Đang tải danh sách Agent...</p>
        </div>
      ) : (
        // Scrollable wrapper fills remaining height and scrolls when many agents are present
        <div className="flex-1 min-h-0 overflow-y-auto pr-2">
          <div className="grid md:grid-cols-2 gap-6">
            {agents.map((a) => {
              const state = installStates[a.id];
              return (
                <div key={a.id} className="p-6 bg-slate-900/60 border border-slate-800 hover:border-slate-800/80 rounded-2xl backdrop-blur-md flex flex-col justify-between space-y-5 transition-all">
                  <div className="space-y-4">
                    {/* Name and Action buttons */}
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-white text-lg">{a.card.name}</h3>
                          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono select-all">@{a.id}</span>
                        </div>
                        <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
                          <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                          {a.llm.model}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(a)}
                          className="text-slate-500 hover:text-indigo-400 p-1.5 rounded-lg hover:bg-indigo-500/10 transition-all cursor-pointer"
                          aria-label="Sửa agent"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAgent(a.id)}
                          className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-500/10 transition-all cursor-pointer"
                          aria-label="Xoá agent"
                        >
                          <Trash2 className="w-4.5 h-4.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">{a.card.description}</p>

                    {/* Skills tags */}
                    {a.card.skills && a.card.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {a.card.skills[0]?.tags?.map(tag => (
                          <span key={tag} className="text-[10px] bg-slate-950 text-indigo-400 border border-indigo-950 px-2 py-0.5 rounded-full">{tag}</span>
                        ))}
                      </div>
                    )}

                    {/* Active plugins indicators */}
                    {a.plugins && a.plugins.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Plugins liên kết:</span>
                        <div className="flex flex-wrap gap-1">
                          {a.plugins.map(pid => (
                            <span key={pid} className="text-[10px] font-mono bg-slate-950 text-slate-300 px-2 py-0.5 rounded border border-slate-800">{pid}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Connection status controller */}
                  <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
                    <div className="flex items-center gap-1.5">
                      {a.installed ? (
                        a.enabled ? (
                          <div className="flex items-center gap-1 text-xs font-semibold text-emerald-400 select-none">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span>Đang chạy</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-xs font-semibold text-slate-400 select-none">
                            <span className="w-2 h-2 rounded-full bg-slate-600" />
                            <span>Đã dừng</span>
                          </div>
                        )
                      ) : (
                        <div className="flex items-center gap-1 text-xs font-semibold text-amber-500 select-none">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>Chưa có model</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Pull model button if not installed */}
                      {!a.installed ? (
                        state?.status === "downloading" || state?.status === "starting" ? (
                          <div className="text-xs text-indigo-400 font-medium flex items-center gap-1.5 select-none">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {state.message}
                          </div>
                        ) : (
                          <button
                            onClick={() => handleInstallModel(a.id)}
                            className="bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/50 text-indigo-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            Cài mô hình
                          </button>
                        )
                      ) : (
                        <button
                          onClick={() => handleConnectToggle(a)}
                          className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                            a.enabled
                              ? "bg-red-950/20 border-red-900/60 text-red-400 hover:bg-red-900/20"
                              : "bg-emerald-950/20 border-emerald-900/60 text-emerald-400 hover:bg-emerald-900/20"
                          }`}
                        >
                          {a.enabled ? (
                            <>
                              <Square className="w-3 h-3 fill-red-400/20" />
                              Ngắt kết nối
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-emerald-400/20" />
                              Kết nối A2A
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
};

// --- Sub-component ModelPicker using position: fixed ---
interface ModelPickerProps {
  value: string;
  options: string[];
  onChange: (val: string) => void;
}

const ModelPicker: React.FC<ModelPickerProps> = ({ value, options, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, maxHeight: 200, direction: "down" });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleScrollOrResize = () => {
      if (isOpen && buttonRef.current) {
        updateCoords();
      }
    };
    
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen && 
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    document.addEventListener("mousedown", handleClickOutside);
    
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const updateCoords = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    
    // Dropdown default height limit
    const desiredHeight = 220; 
    
    // Choose direction based on space constraints
    const direction = spaceBelow < desiredHeight && spaceAbove > spaceBelow ? "up" : "down";
    const maxHeight = direction === "down" ? Math.max(100, spaceBelow - 20) : Math.max(100, spaceAbove - 20);
    const top = direction === "down" ? rect.bottom + 4 : rect.top - 4 - Math.min(desiredHeight, maxHeight);

    setCoords({
      top,
      left: rect.left,
      width: rect.width,
      maxHeight: Math.min(desiredHeight, maxHeight),
      direction
    });
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isOpen) {
      updateCoords();
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative w-full">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        type="button"
        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-left text-white flex justify-between items-center cursor-pointer focus:outline-none focus:border-indigo-500 font-mono"
      >
        <span className="truncate">{value || "Chọn mô hình..."}</span>
        <span className="text-slate-500 text-[10px]">▼</span>
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            width: `${coords.width}px`,
            maxHeight: `${coords.maxHeight}px`
          }}
          className="z-[999] bg-slate-950 border border-slate-800 rounded-lg shadow-xl overflow-y-auto font-mono text-xs text-slate-300 divide-y divide-slate-900"
        >
          {options.length > 0 ? (
            options.map((opt) => (
              <div
                key={opt}
                onClick={() => {
                  onChange(opt);
                  setIsOpen(false);
                }}
                className={`px-3 py-2.5 hover:bg-indigo-600 hover:text-white cursor-pointer truncate transition-colors flex items-center justify-between ${
                  value === opt ? "bg-indigo-950 text-indigo-400" : ""
                }`}
              >
                <span>{opt}</span>
                {value === opt && <Check className="w-3.5 h-3.5" />}
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-slate-500 italic">Không có mô hình nào</div>
          )}
        </div>
      )}
    </div>
  );
};
