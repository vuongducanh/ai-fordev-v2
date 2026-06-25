// Detect if running inside Electron wrapper
const IS_ELECTRON = typeof window !== "undefined" && 
  ((window as any).process || (window as any).navigator?.userAgent?.toLowerCase().includes("electron"));

export const BASE_URL = IS_ELECTRON ? "http://localhost:8090" : "";

export interface Agent {
  id: string;
  enabled: boolean;
  installed: boolean;
  card: {
    name: string;
    description: string;
    skills: Array<{ id: string; name: string; description: string; tags: string[]; examples: string[] }>;
  };
  llm: {
    provider: string;
    model: string;
    system_prompt: string;
    temperature: number;
    top_p: number;
    top_k: number;
    num_ctx: number;
    thinking: boolean;
    vision: boolean;
  };
  plugins: string[];
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  type: "builtin" | "mcp_stdio" | "mcp_url";
  install?: { command: string; args: string[] };
  url?: string;
  installed: boolean;
  enabled: boolean;
  tools: string[];
}

export interface SuggestedModel {
  name: string;
  description: string;
  size: string;
  vision: boolean;
  tools: boolean;
}

export interface OllamaModel {
  name: string;
  model: string;
  size: number;
  details?: {
    parameter_size?: string;
    family?: string;
    families?: string[];
  };
}

// REST helper functions
async function request(path: string, options?: RequestInit) {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`API Request to ${path} failed: ${response.statusText}`);
  }
  return response.json();
}

export const api = {
  // Agents REST
  getAgents: (): Promise<Agent[]> => request("/api/agents"),
  upsertAgent: (agent: Agent): Promise<any> => request("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agent)
  }),
  deleteAgent: (id: string): Promise<any> => request(`/api/agents/${id}`, { method: "DELETE" }),
  connectAgent: (id: string): Promise<any> => request(`/api/agents/${id}/connect`, { method: "POST" }),
  disconnectAgent: (id: string): Promise<any> => request(`/api/agents/${id}/disconnect`, { method: "POST" }),

  // Plugins REST
  upsertPlugin: (plugin: Plugin): Promise<any> => request("/api/plugins", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(plugin)
  }),
  deletePlugin: (id: string): Promise<any> => request(`/api/plugins/${id}`, { method: "DELETE" }),

  // Registry suggestions
  getSuggestedModels: (): Promise<SuggestedModel[]> => request("/api/registry/models"),
  getSuggestedPlugins: (): Promise<Plugin[]> => request("/api/registry/plugins"),

  // Native Ollama controller
  getOllamaModels: (): Promise<OllamaModel[]> => request("/api/models"),
  deleteOllamaModel: (name: string): Promise<any> => request("/api/models/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  }),

  // Orchestrator Coordinator settings
  getOrchestratorSettings: (): Promise<any> => request("/api/orchestrator"),
  updateOrchestratorSettings: (settings: any): Promise<any> => request("/api/orchestrator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  })
};

// SSE Parser
export async function consumeSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: string, data: any) => void
) {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let currentEvent = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("event:")) {
        currentEvent = trimmed.slice(6).trim();
      } else if (trimmed.startsWith("data:")) {
        const dataStr = trimmed.slice(5).trim();
        try {
          const parsed = JSON.parse(dataStr);
          onEvent(currentEvent || "message", parsed);
        } catch (e) {
          console.error("Failed to parse SSE data line", dataStr, e);
        }
        currentEvent = "";
      }
    }
  }
}

// SSE Chat streaming client initiator
export async function chatStream(
  message: string,
  history: Array<{ role: string; content: any }>,
  onEvent: (event: string, data: any) => void,
  signal?: AbortSignal
) {
  const response = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
    signal
  });

  if (!response.ok) {
    throw new Error(`Streaming failed: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No readable stream reader available on response body");
  }

  await consumeSSE(reader, onEvent);
}

// Model installation SSE trigger
export function installAgentSSE(agentId: string, onEvent: (event: string, data: any) => void) {
  return triggerSSE(`/api/agents/${agentId}/install`, onEvent);
}

// Plugin installation SSE trigger
export function installPluginSSE(pluginId: string, onEvent: (event: string, data: any) => void) {
  return triggerSSE(`/api/plugins/${pluginId}/install`, onEvent);
}

// Custom Model pull SSE trigger
export function pullModelSSE(modelName: string, onEvent: (event: string, data: any) => void) {
  return triggerSSE_Post(`/api/models/pull`, { name: modelName }, onEvent);
}

// Base SSE helper
function triggerSSE(path: string, onEvent: (event: string, data: any) => void) {
  const controller = new AbortController();
  fetch(`${BASE_URL}${path}`, { method: "POST", signal: controller.signal })
    .then(async (resp) => {
      const reader = resp.body?.getReader();
      if (reader) {
        await consumeSSE(reader, onEvent);
      }
    })
    .catch((err) => {
      console.error("SSE trigger error", path, err);
      onEvent("progress", { status: "failed", message: String(err) });
    });
  return controller;
}

// Base SSE POST helper
function triggerSSE_Post(path: string, body: any, onEvent: (event: string, data: any) => void) {
  const controller = new AbortController();
  fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal
  })
    .then(async (resp) => {
      const reader = resp.body?.getReader();
      if (reader) {
        await consumeSSE(reader, onEvent);
      }
    })
    .catch((err) => {
      console.error("SSE POST trigger error", path, err);
      onEvent("progress", { status: "failed", message: String(err) });
    });
  return controller;
}
