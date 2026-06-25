import { useState, useEffect } from "react";
import { MessageSquare, Cpu, Terminal, Settings as SettingsIcon, Sparkles, Wifi, WifiOff } from "lucide-react";
import { api } from "./lib/api";
import type { Agent, OllamaModel } from "./lib/api";
import { ChatView } from "./components/ChatView";
import { AgentsView } from "./components/AgentsView";

import { SettingsView } from "./components/SettingsView";
import { RegistryModal } from "./components/RegistryModal";

export default function App() {
  const [activeTab, setActiveTab] = useState<"chat" | "agents" | "settings">("chat");
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [agentsList, setAgentsList] = useState<Agent[]>([]);
  const [isRegistryOpen, setIsRegistryOpen] = useState(false);
  const [backendStatus, setBackendStatus] = useState<"online" | "offline">("online");

  // Load and refresh state databases
  const refreshHubData = async () => {
    try {
      const [models, agents] = await Promise.all([
        api.getOllamaModels(),
        api.getAgents()
      ]);
      setOllamaModels(models);
      setAgentsList(agents);
      setBackendStatus("online");
    } catch (err) {
      console.error("Failed to ping backend daemon status", err);
      setBackendStatus("offline");
    }
  };

  useEffect(() => {
    refreshHubData();
    // Poll backend health status every 10s
    const timer = setInterval(refreshHubData, 10000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      
      {/* Left Navigation Rail */}
      <div className="w-16 flex flex-col items-center justify-between py-6 border-r border-slate-900 bg-slate-950 flex-shrink-0 select-none">
        
        {/* App Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-400 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <span className="text-[11px] font-bold tracking-tighter text-white">A2A</span>
          </div>
          
          {/* Health indicator */}
          <div className="has-tooltip cursor-default">
            {backendStatus === "online" ? (
              <Wifi className="w-4 h-4 text-emerald-500" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-500" />
            )}
            <span className="tooltip">{backendStatus === "online" ? "Backend Online" : "Backend Offline"}</span>
          </div>
        </div>

        {/* Tab Selection icons */}
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setActiveTab("chat")}
            className={`p-3 rounded-xl transition-all cursor-pointer relative ${
              activeTab === "chat"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-900"
            }`}
          >
            <MessageSquare className="w-5 h-5" />
          </button>

          <button
            onClick={() => setActiveTab("agents")}
            className={`p-3 rounded-xl transition-all cursor-pointer relative ${
              activeTab === "agents"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-900"
            }`}
          >
            <Cpu className="w-5 h-5" />
          </button>

          <button
            onClick={() => setActiveTab("settings")}
            className={`p-3 rounded-xl transition-all cursor-pointer relative ${
              activeTab === "settings"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20"
                : "text-slate-500 hover:text-slate-300 hover:bg-slate-900"
            }`}
          >
            <SettingsIcon className="w-5 h-5" />
          </button>
        </div>

      </div>

      {/* Main Panel Content */}
      <div className="flex-1 flex flex-col overflow-hidden p-6 bg-slate-950/40">
        
        {/* Render Tab Views */}
        {activeTab === "chat" && <ChatView agentsList={agentsList} />}
        {activeTab === "agents" && (
          <AgentsView
            ollamaModels={ollamaModels}
            onRefreshHub={refreshHubData}
          />
        )}
        {activeTab === "settings" && <SettingsView onRefreshHub={refreshHubData} />}

      </div>

      {/* Suggested hub catalog overlay modal */}
      <RegistryModal
        isOpen={isRegistryOpen}
        onClose={() => setIsRegistryOpen(false)}
        onRefresh={refreshHubData}
      />

    </div>
  );
}
