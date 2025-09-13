"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";

interface ChatMessage {
  id: string;
  type: "user" | "agent" | "system";
  content: string;
  timestamp: Date;
  metadata?: {
    agentState?: string;
    confidence?: number;
    reasoning?: string;
    matches?: BankMatchData[];
    nextAction?: string;
  };
}

interface BankMatchData {
  bank_index: number;
  gl_index: number | null;
  confidence: number;
  reasoning: string;
  status: "pending" | "approved" | "rejected" | "verified";
  linked_documents: string[];
  created_at: string;
  verified_at?: string;
  user_feedback?: string;
}

interface AgentThought {
  step: string;
  reasoning: string;
  action: string;
  confidence: number;
  timestamp: string;
}

interface UserFeedback {
  timestamp: string;
  feedback: string;
  iteration: number;
}

interface ReconciliationSession {
  session_id: string;
  agent_state: string;
  iteration_count: number;
  matches: BankMatchData[];
  agent_thoughts: AgentThought[];
  user_feedback: UserFeedback[];
  processing_notes: string;
}

export default function AgentReconciliationPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] =
    useState<ReconciliationSession | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<{
    bank: File | null;
    gl: File | null;
  }>({ bank: null, gl: null });
  const [showFileUpload, setShowFileUpload] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const addMessage = (message: Omit<ChatMessage, "id" | "timestamp">) => {
    const newMessage: ChatMessage = {
      ...message,
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const csvFiles = acceptedFiles.filter((file) => file.name.endsWith(".csv"));
    if (csvFiles.length >= 2) {
      setUploadedFiles({
        bank: csvFiles[0],
        gl: csvFiles[1],
      });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
    },
    multiple: true,
  });

  const startReconciliation = async () => {
    if (!uploadedFiles.bank || !uploadedFiles.gl) {
      addMessage({
        type: "system",
        content:
          "Please upload both bank statement and general ledger CSV files to begin.",
      });
      return;
    }

    setIsLoading(true);
    setShowFileUpload(false);

    addMessage({
      type: "system",
      content: "Starting AI agent reconciliation process...",
    });

    try {
      const formData = new FormData();
      formData.append("bank_statement", uploadedFiles.bank);
      formData.append("general_ledger", uploadedFiles.gl);

      const response = await fetch("/api/reconcile", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as { reconciliation: any };
      const reconciliation = data.reconciliation;

      setSessionId(reconciliation.session_id);
      setCurrentSession({
        session_id: reconciliation.session_id,
        agent_state: reconciliation.agent_state,
        iteration_count: 0,
        matches: reconciliation.bank_matches,
        agent_thoughts: reconciliation.agent_thoughts,
        user_feedback: [],
        processing_notes: reconciliation.processing_notes,
      });

      // Add agent's initial analysis
      addMessage({
        type: "agent",
        content: `Hello! I'm your AI reconciliation agent. I've analyzed your data and found ${reconciliation.bank_matches.filter((m: any) => m.gl_index !== null).length} potential matches out of ${reconciliation.bank_matches.length} bank entries.

${reconciliation.processing_notes}

${reconciliation.next_action}`,
        metadata: {
          agentState: reconciliation.agent_state,
          matches: reconciliation.bank_matches,
          nextAction: reconciliation.next_action,
        },
      });

      // Show agent's thoughts
      if (
        reconciliation.agent_thoughts &&
        reconciliation.agent_thoughts.length > 0
      ) {
        const latestThought =
          reconciliation.agent_thoughts[
            reconciliation.agent_thoughts.length - 1
          ];
        addMessage({
          type: "agent",
          content: `**My Analysis:**\n\n${latestThought.reasoning}\n\n**Confidence:** ${(latestThought.confidence * 100).toFixed(1)}%`,
          metadata: {
            reasoning: latestThought.reasoning,
            confidence: latestThought.confidence,
          },
        });
      }
    } catch (error) {
      addMessage({
        type: "system",
        content: `Error starting reconciliation: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !sessionId) return;

    const userMessage = inputMessage.trim();
    setInputMessage("");
    setIsLoading(true);

    // Add user message
    addMessage({
      type: "user",
      content: userMessage,
    });

    try {
      const response = await fetch(
        `/api/reconcile/session/${sessionId}/continue`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_feedback: userMessage,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Update current session
      setCurrentSession((prev) =>
        prev
          ? {
              ...prev,
              agent_state: data.agent_state,
              iteration_count: data.iteration_count,
              matches: data.matches,
              agent_thoughts: data.agent_thoughts,
            }
          : null,
      );

      // Add agent's response
      if (data.agent_thoughts && data.agent_thoughts.length > 0) {
        const latestThought =
          data.agent_thoughts[data.agent_thoughts.length - 1];
        addMessage({
          type: "agent",
          content: `**My Response:**\n\n${latestThought.reasoning}\n\n**Next Action:** ${data.next_action}`,
          metadata: {
            agentState: data.agent_state,
            reasoning: latestThought.reasoning,
            confidence: latestThought.confidence,
            nextAction: data.next_action,
          },
        });
      }
    } catch (error) {
      addMessage({
        type: "system",
        content: `Error processing your message: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "initial_matching":
        return "text-blue-400";
      case "user_review":
        return "text-yellow-400";
      case "document_linking":
        return "text-purple-400";
      case "final_verification":
        return "text-orange-400";
      case "iterative_processing":
        return "text-cyan-400";
      case "completed":
        return "text-green-400";
      default:
        return "text-slate-400";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "initial_matching":
        return "🔍";
      case "user_review":
        return "👀";
      case "document_linking":
        return "📄";
      case "final_verification":
        return "✅";
      case "iterative_processing":
        return "🔄";
      case "completed":
        return "🎉";
      default:
        return "🤖";
    }
  };

  return (
    <div className="min-h-screen bg-black flex">
      {/* Main Chat Interface */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-slate-800 border-b border-slate-600 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">
                AI Reconciliation Agent
              </h1>
              {currentSession && (
                <div className="flex items-center space-x-4 mt-2">
                  <span
                    className={`flex items-center space-x-2 ${getStatusColor(currentSession.agent_state)}`}
                  >
                    <span className="text-lg">
                      {getStatusIcon(currentSession.agent_state)}
                    </span>
                    <span className="text-sm font-medium capitalize">
                      {currentSession.agent_state.replace("_", " ")}
                    </span>
                  </span>
                  <span className="text-slate-400 text-sm">
                    Iteration: {currentSession.iteration_count}
                  </span>
                  <span className="text-slate-400 text-sm">
                    Matches: {currentSession.matches.length}
                  </span>
                </div>
              )}
            </div>
            {sessionId && (
              <div className="text-slate-400 text-sm">Session: {sessionId}</div>
            )}
          </div>
        </div>

        {/* File Upload Section */}
        {showFileUpload && (
          <div className="p-6 border-b border-slate-600">
            <div className="max-w-2xl mx-auto">
              <h2 className="text-xl font-semibold text-white mb-4">
                Upload Your Files
              </h2>
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? "border-blue-400 bg-blue-900/20"
                    : "border-slate-500 hover:border-slate-400"
                }`}
              >
                <input {...getInputProps()} />
                <div className="space-y-4">
                  <div className="text-6xl">📊</div>
                  <div>
                    <p className="text-xl text-white font-medium">
                      {isDragActive
                        ? "Drop your CSV files here"
                        : "Drag & drop your CSV files here, or click to select"}
                    </p>
                    <p className="text-slate-400 mt-2">
                      Upload both bank statement and general ledger CSV files
                    </p>
                  </div>
                </div>
              </div>

              {uploadedFiles.bank && uploadedFiles.gl && (
                <div className="mt-4 space-y-2">
                  <div className="text-green-400">
                    ✓ Bank Statement: {uploadedFiles.bank.name}
                  </div>
                  <div className="text-green-400">
                    ✓ General Ledger: {uploadedFiles.gl.name}
                  </div>
                  <button
                    type="button"
                    onClick={startReconciliation}
                    className="mt-4 bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                  >
                    Start AI Reconciliation
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-3xl rounded-lg p-4 ${
                  message.type === "user"
                    ? "bg-blue-600 text-white"
                    : message.type === "agent"
                      ? "bg-slate-700 text-white"
                      : "bg-slate-800 text-slate-300"
                }`}
              >
                <div className="flex items-center space-x-2 mb-2">
                  {message.type === "agent" && (
                    <span className="text-lg">🤖</span>
                  )}
                  {message.type === "user" && (
                    <span className="text-lg">👤</span>
                  )}
                  {message.type === "system" && (
                    <span className="text-lg">⚙️</span>
                  )}
                  <span className="text-sm opacity-70">
                    {message.timestamp.toLocaleTimeString()}
                  </span>
                </div>

                <div className="whitespace-pre-wrap">{message.content}</div>

                {message.metadata && (
                  <div className="mt-3 pt-3 border-t border-slate-600">
                    {message.metadata.confidence && (
                      <div className="text-sm text-slate-400">
                        Confidence:{" "}
                        {(message.metadata.confidence * 100).toFixed(1)}%
                      </div>
                    )}
                    {message.metadata.nextAction && (
                      <div className="text-sm text-blue-400 mt-1">
                        Next: {message.metadata.nextAction}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-slate-700 text-white rounded-lg p-4">
                <div className="flex items-center space-x-2">
                  <span className="text-lg">🤖</span>
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-white rounded-full animate-bounce" />
                    <div
                      className="w-2 h-2 bg-white rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    />
                    <div
                      className="w-2 h-2 bg-white rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    />
                  </div>
                  <span className="text-sm">Agent is thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        {sessionId && (
          <div className="border-t border-slate-600 p-4">
            <div className="max-w-4xl mx-auto flex space-x-4">
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask the agent about matches, provide feedback, or request specific actions..."
                className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-3 border border-slate-500 focus:border-blue-400 focus:outline-none resize-none"
                rows={2}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={isLoading || !inputMessage.trim()}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sidebar with Session Info */}
      {currentSession && (
        <div className="w-80 bg-slate-800 border-l border-slate-600 p-4 overflow-y-auto">
          <h3 className="text-lg font-semibold text-white mb-4">
            Session Details
          </h3>

          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-slate-300 mb-2">
                Current State
              </h4>
              <div
                className={`p-2 rounded ${getStatusColor(currentSession.agent_state)} bg-slate-700`}
              >
                {getStatusIcon(currentSession.agent_state)}{" "}
                {currentSession.agent_state.replace("_", " ")}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-slate-300 mb-2">
                Matches Found
              </h4>
              <div className="space-y-2">
                {currentSession.matches.slice(0, 5).map((match, index) => (
                  <div key={index} className="bg-slate-700 p-2 rounded text-sm">
                    <div className="text-white">
                      Bank Entry {match.bank_index}
                    </div>
                    <div className="text-slate-400">
                      {match.gl_index !== null
                        ? `→ GL Entry ${match.gl_index}`
                        : "No match"}
                    </div>
                    <div className="text-slate-400">
                      Confidence: {(match.confidence * 100).toFixed(1)}%
                    </div>
                    <div className="text-slate-400 text-xs mt-1">
                      {match.reasoning}
                    </div>
                  </div>
                ))}
                {currentSession.matches.length > 5 && (
                  <div className="text-slate-400 text-sm">
                    ... and {currentSession.matches.length - 5} more
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-slate-300 mb-2">
                Agent Thoughts
              </h4>
              <div className="space-y-2">
                {currentSession.agent_thoughts
                  .slice(-3)
                  .map((thought, index) => (
                    <div
                      key={index}
                      className="bg-slate-700 p-2 rounded text-sm"
                    >
                      <div className="text-white text-xs mb-1">
                        {thought.step}
                      </div>
                      <div className="text-slate-400 text-xs">
                        {thought.reasoning.substring(0, 100)}...
                      </div>
                      <div className="text-slate-400 text-xs mt-1">
                        Confidence: {(thought.confidence * 100).toFixed(1)}%
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
