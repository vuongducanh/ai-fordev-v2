import React, { useState, useEffect, useRef } from "react";
import { Send, Square, RefreshCw, ThumbsUp, ThumbsDown, Copy, Check, MessageSquare, Trash2, Plus, User, Cpu, Loader2 } from "lucide-react";
import { chatStream } from "../lib/api";
import type { Agent } from "../lib/api";
import { getMentionQuery, filterCandidates } from "../lib/mention";
import { estimateStats } from "../lib/stats";
import type { Stats } from "../lib/stats";
import { Markdown } from "./Markdown";

// Helper to translate MCP/Builtin tool names to Vietnamese labels
function translateToolName(name: string): string {
  const map: Record<string, string> = {
    "search": "Tìm kiếm Web (DDG)",
    "fetch_content": "Đọc nội dung URL",
    "get_current_time": "Đọc giờ hệ thống",
    "add": "Cộng hai số",
    "multiply": "Nhân hai số",
    "duckduckgo_search": "Tìm kiếm DuckDuckGo",
    "duckduckgo_web_search": "Tìm kiếm DDG chuyên sâu"
  };
  return map[name] || name;
}

interface ToolUsage {
  agent: string;
  tool: string;
  status: "start" | "done" | "error";
  detail: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "model";
  content: string;
  status?: string;
  routing?: string;
  agentsUsed?: string[];
  toolsUsed?: ToolUsage[];
  stats?: Stats;
  rating?: "up" | "down";
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
}

interface ChatViewProps {
  agentsList: Agent[];
}

export const ChatView: React.FC<ChatViewProps> = ({ agentsList }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>("");
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);

  // Mention Popup state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionCands, setMentionCands] = useState<Agent[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);

  // Stopwatch state
  const [timerSeconds, setTimerSeconds] = useState(0);

  // Copy status per message
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<any>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mentionPopupRef = useRef<HTMLDivElement>(null);

  // Timing helper refs for client-side stats estimation fallback
  const streamStartRef = useRef<number>(0);
  const streamFirstChunkRef = useRef<number>(0);
  const streamLastChunkRef = useRef<number>(0);
  const textChunksRef = useRef<string[]>([]);

  // Load conversations on mount
  useEffect(() => {
    const saved = localStorage.getItem("a2a.conversations");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Conversation[];
        setConversations(parsed);
        if (parsed.length > 0) {
          setActiveConvId(parsed[0].id);
        }
      } catch (err) {
        console.error("Failed to parse conversations from localStorage", err);
      }
    }
  }, []);

  // Save conversations on change
  const saveConversations = (updated: Conversation[]) => {
    setConversations(updated);
    localStorage.setItem("a2a.conversations", JSON.stringify(updated));
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversations, activeConvId, loading]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Get active conversation
  const activeConv = conversations.find(c => c.id === activeConvId);

  // Handle creating new conversation
  const handleNewChat = () => {
    const newConv: Conversation = {
      id: "conv_" + Date.now(),
      title: "Cuộc hội thoại mới",
      messages: []
    };
    const updated = [newConv, ...conversations];
    saveConversations(updated);
    setActiveConvId(newConv.id);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Handle renaming conversation
  const handleRenameChat = (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    const updated = conversations.map(c => (c.id === id ? { ...c, title: newTitle.trim() } : c));
    saveConversations(updated);
  };

  // Handle deleting conversation
  const handleDeleteChat = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = conversations.filter(c => c.id !== id);
    saveConversations(updated);
    if (activeConvId === id) {
      if (updated.length > 0) {
        setActiveConvId(updated[0].id);
      } else {
        setActiveConvId("");
      }
    }
  };

  // Handle input keydown for @mention popup or submitting
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore keys while an IME composition is in progress (e.g. typing Vietnamese
    // on macOS). Enter/Escape during composition only confirm/cancel the IME
    // candidate and must not trigger send or mention handling.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    if (mentionQuery !== null && mentionCands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex(prev => {
          const next = (prev + 1) % mentionCands.length;
          scrollMentionIntoView(next);
          return next;
        });
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex(prev => {
          const next = (prev - 1 + mentionCands.length) % mentionCands.length;
          scrollMentionIntoView(next);
          return next;
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        selectMention(mentionCands[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const scrollMentionIntoView = (index: number) => {
    setTimeout(() => {
      const container = mentionPopupRef.current;
      const item = container?.children[index] as HTMLElement;
      if (container && item) {
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.clientHeight;
        const itemTop = item.offsetTop;
        const itemBottom = itemTop + item.clientHeight;

        if (itemTop < containerTop) {
          container.scrollTop = itemTop;
        } else if (itemBottom > containerBottom) {
          container.scrollTop = itemBottom - container.clientHeight;
        }
      }
    }, 10);
  };

  const selectMention = (agent: Agent) => {
    if (!inputRef.current) return;
    const text = inputText;
    const pos = cursorPos;
    const beforeCursor = text.slice(0, pos);
    const lastAt = beforeCursor.lastIndexOf("@");
    
    if (lastAt !== -1) {
      const before = text.slice(0, lastAt);
      const after = text.slice(pos);
      const replacement = `@${agent.id} `;
      const newText = before + replacement + after;
      setInputText(newText);
      setMentionQuery(null);
      
      const newCursorPos = before.length + replacement.length;
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.selectionStart = newCursorPos;
          inputRef.current.selectionEnd = newCursorPos;
          inputRef.current.focus();
        }
      }, 50);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    const selStart = e.target.selectionStart || 0;
    setCursorPos(selStart);

    // Parse mention query
    const q = getMentionQuery(val, selStart);
    setMentionQuery(q);
    if (q !== null) {
      const cands = filterCandidates(q, agentsList);
      setMentionCands(cands);
      setMentionIndex(0);
    }
  };

  const handleSend = async (overrideText?: string) => {
    const textToSend = overrideText || inputText;
    if (!textToSend.trim() || loading) return;

    let conv = activeConv;
    let currentConvId = activeConvId;

    // Create a conversation if none exists
    if (!conv) {
      const newConvId = "conv_" + Date.now();
      const newConv: Conversation = {
        id: newConvId,
        title: textToSend.trim().slice(0, 24) || "Hội thoại",
        messages: []
      };
      conv = newConv;
      currentConvId = newConvId;
      saveConversations([newConv, ...conversations]);
      setActiveConvId(newConvId);
    } else if (conv.messages.length === 0) {
      conv.title = textToSend.trim().slice(0, 24);
    }

    setInputText("");
    setMentionQuery(null);
    setLoading(true);
    setTimerSeconds(0);

    // Append user message
    const userMsg: ChatMessage = {
      id: "msg_" + Date.now(),
      role: "user",
      content: textToSend.trim()
    };

    // Append assistant template message
    const assistantMsgId = "msg_as_" + Date.now();
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: "model",
      content: "",
      status: "Đang định tuyến yêu cầu...",
      toolsUsed: [],
      routing: "direct",
      agentsUsed: []
    };

    const updatedMessages = [...conv.messages, userMsg, assistantMsg];
    const updatedConversations = conversations.map(c =>
      c.id === currentConvId ? { ...c, messages: updatedMessages } : c
    );
    saveConversations(updatedConversations);

    // Initialize stream performance variables
    streamStartRef.current = Date.now();
    streamFirstChunkRef.current = 0;
    streamLastChunkRef.current = 0;
    textChunksRef.current = [];

    // Start stopwatch
    timerRef.current = setInterval(() => {
      setTimerSeconds(prev => prev + 1);
    }, 1000);

    // Set abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Build history for endpoint consumption
    const filteredHistory = updatedMessages.slice(0, -2).map(m => ({
      role: m.role,
      content: m.content
    }));

    try {
      await chatStream(
        userMsg.content,
        filteredHistory,
        (event, data) => {
          // Refresh references to latest conversations list
          const latestConvs = JSON.parse(localStorage.getItem("a2a.conversations") || "[]") as Conversation[];
          const targetConv = latestConvs.find(c => c.id === currentConvId);
          if (!targetConv) return;
          const msgToUpdate = targetConv.messages.find(m => m.id === assistantMsgId);
          if (!msgToUpdate) return;

          if (event === "status") {
            msgToUpdate.status = data.text;
          } else if (event === "meta") {
            msgToUpdate.routing = data.routing;
            msgToUpdate.agentsUsed = data.agents_used;
          } else if (event === "tool") {
            const toolData = data as ToolUsage;
            if (!msgToUpdate.toolsUsed) msgToUpdate.toolsUsed = [];
            
            // Deduplicate/upsert tool state based on agent, tool and detail properties
            const idx = msgToUpdate.toolsUsed.findIndex(
              t => t.agent === toolData.agent && t.tool === toolData.tool && t.detail === toolData.detail
            );
            if (idx !== -1) {
              msgToUpdate.toolsUsed[idx] = toolData;
            } else {
              msgToUpdate.toolsUsed.push(toolData);
            }
          } else if (event === "delta") {
            if (streamFirstChunkRef.current === 0) {
              streamFirstChunkRef.current = Date.now();
            }
            streamLastChunkRef.current = Date.now();
            textChunksRef.current.push(data.text);

            msgToUpdate.content += data.text;
          } else if (event === "stats") {
            msgToUpdate.stats = data as Stats;
          } else if (event === "error") {
            msgToUpdate.content += `\n\n[Lỗi hệ thống: ${data.text}]`;
            msgToUpdate.status = "error";
          }

          saveConversations(latestConvs);
        },
        controller.signal
      );

      // Successfully finished: clear the loading status and ensure stats exist
      const finalConvs = JSON.parse(localStorage.getItem("a2a.conversations") || "[]") as Conversation[];
      const finConv = finalConvs.find(c => c.id === currentConvId);
      const finMsg = finConv?.messages.find(m => m.id === assistantMsgId);
      if (finMsg) {
        // Clear the "Đang…" status so this message no longer shows a spinner
        finMsg.status = undefined;
        if (!finMsg.stats) {
          finMsg.stats = estimateStats(
            textChunksRef.current,
            streamFirstChunkRef.current,
            streamLastChunkRef.current,
            streamStartRef.current,
            Date.now()
          );
        }
        saveConversations(finalConvs);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Stream failed", err);
        const finalConvs = JSON.parse(localStorage.getItem("a2a.conversations") || "[]") as Conversation[];
        const finConv = finalConvs.find(c => c.id === currentConvId);
        const finMsg = finConv?.messages.find(m => m.id === assistantMsgId);
        if (finMsg) {
          finMsg.content += `\n\n[Mất kết nối server: ${err.message}]`;
          finMsg.status = "error";
          saveConversations(finalConvs);
        }
      }
    } finally {
      clearInterval(timerRef.current);
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      clearInterval(timerRef.current);
      setLoading(false);
      
      // Calculate estimation stats on stop
      if (activeConv) {
        const finMsg = activeConv.messages[activeConv.messages.length - 1];
        if (finMsg && !finMsg.stats) {
          finMsg.stats = estimateStats(
            textChunksRef.current,
            streamFirstChunkRef.current,
            streamLastChunkRef.current,
            streamStartRef.current,
            Date.now()
          );
          saveConversations([...conversations]);
        }
      }
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy text", err);
    }
  };

  const handleRating = (msgId: string, rating: "up" | "down") => {
    if (!activeConv) return;
    const updated = activeConv.messages.map(m =>
      m.id === msgId ? { ...m, rating: m.rating === rating ? undefined : rating } : m
    );
    const updatedConvs = conversations.map(c =>
      c.id === activeConvId ? { ...c, messages: updated } : c
    );
    saveConversations(updatedConvs);
  };

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-950/20 rounded-2xl border border-slate-800">
      
      {/* Sidebar - Conversations list */}
      <div className="w-64 border-r border-slate-800 flex flex-col bg-slate-950/50 backdrop-blur-md">
        <div className="p-4 border-b border-slate-800 flex flex-col gap-2">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Cuộc hội thoại mới
          </button>
        </div>

        {/* Conversations History List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {conversations.length > 0 ? (
            conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => setActiveConvId(c.id)}
                className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all border ${
                  activeConvId === c.id
                    ? "bg-slate-900 border-slate-800 text-white font-medium"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/40"
                }`}
              >
                <div className="flex items-center gap-2 truncate pr-2">
                  <MessageSquare className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <input
                    type="text"
                    value={c.title}
                    onChange={(e) => handleRenameChat(c.id, e.target.value)}
                    className="bg-transparent border-none p-0 text-xs focus:outline-none focus:ring-0 truncate w-full cursor-pointer"
                  />
                </div>
                <button
                  onClick={(e) => handleDeleteChat(c.id, e)}
                  className="text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded cursor-pointer"
                  title="Xoá hội thoại"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-slate-600 text-xs italic">Không có lịch sử</div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-900/10">
        
        {/* Messages list scroll area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeConv && activeConv.messages.length > 0 ? (
            activeConv.messages.map((m, mIdx) => (
              <div
                key={m.id}
                data-last={mIdx === activeConv.messages.length - 1}
                className={`flex gap-4 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {/* Avatar */}
                {m.role === "model" && (
                  <div className="w-8 h-8 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 select-none">
                    <Cpu className="w-4 h-4 text-indigo-400" />
                  </div>
                )}

                {/* Message Bubble wrapper */}
                <div className={`max-w-[80%] space-y-2`}>
                  {m.role === "model" && m.routing && m.routing !== "direct" && (
                    <div className="flex items-center gap-1.5 text-[10px] bg-slate-950/40 border border-slate-800/80 px-2 py-1 rounded-md text-slate-400 font-mono w-fit uppercase select-none">
                      <span className="text-indigo-400 font-semibold">{m.routing}</span>
                      <span>·</span>
                      <span>Agents: {m.agentsUsed?.map(id => agentsList.find(a => a.id === id)?.card.name || id).join(", ")}</span>
                    </div>
                  )}

                  {/* Real-time Tool Telemetry log */}
                  {m.role === "model" && m.toolsUsed && m.toolsUsed.length > 0 && (
                    <div className="p-3 bg-slate-950/40 border border-slate-800 rounded-xl space-y-2 max-w-lg">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider select-none">Công cụ đã dùng:</div>
                      <div className="space-y-1.5">
                        {m.toolsUsed.map((t, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs font-mono">
                            <div className="flex items-center gap-1.5">
                              {t.status === "start" ? (
                                <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                              ) : t.status === "done" ? (
                                <span className="text-emerald-400">✓</span>
                              ) : (
                                <span className="text-red-400">✗</span>
                              )}
                              <span className="bg-slate-900 border border-slate-800 text-indigo-300 px-1 rounded text-[10px]">{t.tool}</span>
                              <span className="text-slate-400">{translateToolName(t.tool)}</span>
                            </div>
                            <span className="text-slate-500 text-[10px] truncate max-w-[120px]" title={t.detail}>{t.detail}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Main Bubble Content */}
                  <div
                    className={`p-4 rounded-2xl ${
                      m.role === "user"
                        ? "bg-indigo-600 text-white rounded-br-none shadow-md shadow-indigo-600/10"
                        : "bg-slate-900 border border-slate-800 rounded-bl-none"
                    }`}
                  >
                    {m.role === "user" ? (
                      <p className="whitespace-pre-wrap leading-relaxed text-sm">{m.content}</p>
                    ) : (
                      <div className="space-y-4">
                        <Markdown content={m.content} />
                        
                        {/* Status text delta — only for the currently streaming (last) message */}
                        {loading && mIdx === activeConv.messages.length - 1 && m.status && m.status !== "error" && (
                          <div className="flex items-center gap-1.5 text-xs text-indigo-400 animate-pulse select-none">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>{m.status} ({timerSeconds}s)</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action Bars for assistant replies */}
                  {m.role === "model" && (
                    <div className="flex items-center gap-3 px-1">
                      
                      {/* Rating buttons */}
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRating(m.id, "up")}
                          className={`p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer ${
                            m.rating === "up" ? "text-indigo-400" : "text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleRating(m.id, "down")}
                          className={`p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer ${
                            m.rating === "down" ? "text-indigo-400" : "text-slate-500 hover:text-slate-300"
                          }`}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Utility buttons */}
                      <button
                        onClick={() => handleCopy(m.id, m.content)}
                        className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1"
                        title="Sao chép câu trả lời"
                      >
                        {copiedId === m.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {/* Resend button */}
                      <button
                        onClick={() => {
                          // Find corresponding prompt (user message before this message)
                          if (activeConv) {
                            const idx = activeConv.messages.findIndex(msg => msg.id === m.id);
                            if (idx > 0) {
                              const promptText = activeConv.messages[idx - 1].content;
                              handleSend(promptText);
                            }
                          }
                        }}
                        className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1"
                        title="Gửi lại câu hỏi"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>

                      {/* Token Speed / timing stats */}
                      {m.stats && (
                        <span className="text-[10px] font-mono text-slate-500 select-none">
                          ⚡ {m.stats.tps} tok/s · {m.stats.tokens} tokens · {m.stats.seconds}s
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {m.role === "user" && (
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 border border-indigo-500 flex items-center justify-center flex-shrink-0 select-none">
                    <User className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            ))
          ) : (
            // Empty State
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center select-none shadow-lg animate-glow">
                <Cpu className="w-8 h-8 text-indigo-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Xin chào! Tôi là Trợ lý Anhvd</h3>
                <p className="text-sm text-slate-400 mt-1 leading-relaxed">
                  Tôi là bộ điều phối A2A (BFF) kết nối tới các agent chuyên môn cục bộ. Gõ lệnh <span className="font-mono text-indigo-400 bg-slate-900 px-1 rounded">@agent</span> để trực tiếp chỉ định, hoặc gửi câu hỏi để tôi tự động định tuyến.
                </p>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input box section */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/20 relative">
          
          {/* Mention Popup selector dropdown */}
          {mentionQuery !== null && mentionCands.length > 0 && (
            <div
              ref={mentionPopupRef}
              className="absolute bottom-full left-4 mb-2 w-64 bg-slate-950 border border-slate-800 rounded-xl shadow-2xl overflow-y-auto max-h-[180px] divide-y divide-slate-900 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
            >
              {mentionCands.map((a, idx) => (
                <div
                  key={a.id}
                  onClick={() => selectMention(a)}
                  className={`flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors ${
                    idx === mentionIndex
                      ? "bg-indigo-600 text-white"
                      : "text-slate-300 hover:bg-slate-900"
                  }`}
                >
                  <div className="space-y-0.5">
                    <span className="text-xs font-semibold block">{a.card.name}</span>
                    <span className={`text-[10px] font-mono block ${idx === mentionIndex ? "text-indigo-200" : "text-slate-500"}`}>@{a.id}</span>
                  </div>
                  <span className={`text-[9px] font-mono px-1 rounded uppercase ${idx === mentionIndex ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-400"}`}>
                    {a.llm.model.split(":")[0]}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Text Input area */}
          <div className="flex gap-2 bg-slate-950 border border-slate-800 rounded-2xl p-2 focus-within:border-indigo-500/80 transition-colors shadow-inner">
            <textarea
              ref={inputRef}
              placeholder="Nhập câu hỏi tại đây... (Dùng @ để chỉ định agent cụ thể)"
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={2}
              className="flex-1 bg-transparent border-none resize-none focus:outline-none focus:ring-0 text-sm text-white px-2 py-1 placeholder-slate-600 leading-relaxed"
            />
            
            {/* Action buttons (Send or Stop) */}
            <div className="flex items-end pr-1 pb-1">
              {loading ? (
                <button
                  onClick={handleStop}
                  className="bg-red-600 hover:bg-red-500 text-white p-2 rounded-xl transition-all cursor-pointer shadow-md hover:shadow-red-500/20 flex items-center justify-center"
                  title="Dừng sinh phản hồi"
                >
                  <Square className="w-4 h-4 fill-white" />
                </button>
              ) : (
                <button
                  onClick={() => handleSend()}
                  disabled={!inputText.trim()}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white p-2 rounded-xl transition-all cursor-pointer shadow-md hover:shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  <Send className="w-4 h-4 fill-white" />
                </button>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
