import React, { useState, useEffect } from "react";
import { Plus, Terminal, Link, Trash2, Check, AlertCircle, Loader2 } from "lucide-react";
import { api, installPluginSSE } from "../lib/api";
import type { Plugin } from "../lib/api";
import { useToast } from "../lib/toast";

export const PluginsView: React.FC = () => {
  const { success, error } = useToast();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form State
  const [form, setForm] = useState({
    id: "",
    name: "",
    description: "",
    type: "mcp_stdio" as "builtin" | "mcp_stdio" | "mcp_url",
    command: "",
    args: "",
    url: ""
  });

  // Track install stream progress
  const [installStates, setInstallStates] = useState<Record<string, { status: string; message: string }>>({});

  useEffect(() => {
    loadPlugins();
  }, []);

  const loadPlugins = async () => {
    setLoading(true);
    try {
      const allPlugins = await api.getPlugins();
      setPlugins(allPlugins);
    } catch (err) {
      console.error("Failed to load plugins list", err);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPlugin = (id: string) => {
    setInstallStates(prev => ({ ...prev, [id]: { status: "installing", message: "Đang kết nối..." } }));
    
    installPluginSSE(id, (_event, data) => {
      if (data.status === "completed") {
        setInstallStates(prev => ({ ...prev, [id]: { status: "completed", message: data.message } }));
        loadPlugins();
      } else if (data.status === "failed") {
        setInstallStates(prev => ({ ...prev, [id]: { status: "failed", message: data.message } }));
      } else {
        setInstallStates(prev => ({ ...prev, [id]: { status: data.status, message: data.message } }));
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id || !form.name) return;

    const newPlugin: Plugin = {
      id: form.id.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
      type: form.type,
      installed: false,
      enabled: false,
      tools: []
    };

    if (form.type === "mcp_stdio") {
      newPlugin.install = {
        command: form.command.trim(),
        args: form.args.split(",").map(a => a.trim()).filter(Boolean)
      };
    } else if (form.type === "mcp_url") {
      newPlugin.url = form.url.trim();
    } else {
      newPlugin.installed = true;
      newPlugin.enabled = true;
    }

    try {
      await api.upsertPlugin(newPlugin);
      setForm({
        id: "",
        name: "",
        description: "",
        type: "mcp_stdio",
        command: "",
        args: "",
        url: ""
      });
      setShowAddForm(false);
      await loadPlugins();
      success(`Đã lưu plugin "${newPlugin.name}"`);
    } catch (err) {
      console.error("Failed to upsert plugin", err);
      error(`Lưu plugin thất bại: ${err instanceof Error ? err.message : "lỗi không xác định"}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Bạn có chắc chắn muốn xoá plugin này?")) return;
    const name = plugins.find(p => p.id === id)?.name || id;
    try {
      await api.deletePlugin(id);
      await loadPlugins();
      success(`Đã xoá plugin "${name}"`);
    } catch (err) {
      console.error("Failed to delete plugin", err);
      error(`Xoá plugin thất bại: ${err instanceof Error ? err.message : "lỗi không xác định"}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
      
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Terminal className="w-6 h-6 text-indigo-400" />
            Quản lý Plugins & MCP Servers
          </h1>
          <p className="text-sm text-slate-400">Đăng ký các plugin in-process hoặc tích hợp ngoài thông qua Model Context Protocol (MCP).</p>
        </div>
        
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-all cursor-pointer shadow-lg hover:shadow-indigo-500/20"
        >
          <Plus className="w-4 h-4" />
          Thêm MCP Plugin
        </button>
      </div>

      {/* Add Form Accordion */}
      {showAddForm && (
        <form onSubmit={handleSubmit} className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl backdrop-blur-md space-y-4 animate-in slide-in-from-top-4 duration-200">
          <h2 className="text-base font-semibold text-white">Thêm cấu hình MCP Server mới</h2>
          
          <div className="grid md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase">Mã Plugin (ID)</label>
              <input
                type="text"
                placeholder="vd: duckduckgo-mcp"
                value={form.id}
                onChange={e => setForm(prev => ({ ...prev, id: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                required
              />
            </div>
            
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Tên hiển thị</label>
              <input
                type="text"
                placeholder="vd: DuckDuckGo Search"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-400 uppercase">Mô tả ngắn</label>
            <input
              type="text"
              placeholder="Nhập mô tả tính năng của plugin này..."
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="grid md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-400 uppercase">Loại giao thức (Type)</label>
              <select
                value={form.type}
                onChange={e => setForm(prev => ({ ...prev, type: e.target.value as any }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="mcp_stdio">MCP Server (Stdio)</option>
                <option value="mcp_url">MCP Server (HTTP SSE)</option>
                <option value="builtin">Built-in (Local)</option>
              </select>
            </div>

            {form.type === "mcp_stdio" ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase">Lệnh thực thi (Command)</label>
                  <input
                    type="text"
                    placeholder="vd: uvx hoặc npx"
                    value={form.command}
                    onChange={e => setForm(prev => ({ ...prev, command: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase">Tham số (Args - phân tách bằng dấu phẩy)</label>
                  <input
                    type="text"
                    placeholder="vd: duckduckgo-mcp-server"
                    value={form.args}
                    onChange={e => setForm(prev => ({ ...prev, args: e.target.value }))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </>
            ) : form.type === "mcp_url" ? (
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-semibold text-slate-400 uppercase">Địa chỉ HTTP / SSE URL</label>
                <input
                  type="url"
                  placeholder="vd: http://localhost:3000/sse"
                  value={form.url}
                  onChange={e => setForm(prev => ({ ...prev, url: e.target.value }))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer"
            >
              Lưu plugin
            </button>
          </div>
        </form>
      )}

      {/* Plugins List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
          <p className="text-sm text-slate-400">Đang tải danh sách plugin...</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {plugins.map((p) => {
            const state = installStates[p.id];
            return (
              <div key={p.id} className="p-5 bg-slate-900/60 border border-slate-800 hover:border-slate-800/80 rounded-2xl backdrop-blur-md flex flex-col justify-between space-y-4 transition-all">
                <div className="space-y-3">
                  {/* Name and badge */}
                  <div className="flex items-start justify-between">
                    <div className="space-y-0.5">
                      <h3 className="font-semibold text-white text-base">{p.name}</h3>
                      <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono uppercase tracking-wider">{p.type}</span>
                    </div>
                    
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="text-slate-500 hover:text-red-400 p-1 rounded hover:bg-red-500/10 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <p className="text-xs text-slate-400 leading-relaxed">{p.description}</p>
                  
                  {/* MCP Tool details */}
                  {p.type === "mcp_stdio" && p.install && (
                    <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded text-xs font-mono text-slate-400 w-fit select-all">
                      <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{p.install.command} {p.install.args.join(" ")}</span>
                    </div>
                  )}
                  {p.type === "mcp_url" && p.url && (
                    <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded text-xs font-mono text-indigo-400 w-fit select-all">
                      <Link className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[280px]">{p.url}</span>
                    </div>
                  )}

                  {/* Tool chips list */}
                  {p.tools && p.tools.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Công cụ phơi ra:</span>
                      <div className="flex flex-wrap gap-1">
                        {p.tools.map(tool => (
                          <span key={tool} className="text-[10px] font-mono bg-slate-950 text-indigo-300 px-1.5 py-0.5 rounded border border-indigo-950">{tool}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Connection verification area */}
                <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                  <div className="flex items-center gap-1">
                    {p.installed ? (
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                        <Check className="w-3.5 h-3.5" />
                        <span>Kết nối OK</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Chưa kết nối</span>
                      </div>
                    )}
                  </div>

                  {state?.status === "installing" || state?.status === "connecting" ? (
                    <div className="text-xs text-indigo-400 font-medium flex items-center gap-1.5 select-none">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {state.message}
                    </div>
                  ) : (
                    <button
                      onClick={() => handleVerifyPlugin(p.id)}
                      className="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                    >
                      {p.installed ? "Kiểm tra lại" : "Kết nối server"}
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

    </div>
  );
};
