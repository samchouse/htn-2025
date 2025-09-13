"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";

interface BankMatchData {
  bank_index: number;
  gl_indexes: number[];
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
  bank_data: Record<string, unknown>[];
  gl_data: Record<string, unknown>[];
}

interface MatchDetails {
  bankIndex: number;
  glIndexes: number[];
  confidence: number;
  reasoning: string;
  status: string;
}

export default function AgentReconciliationPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentSession, setCurrentSession] =
    useState<ReconciliationSession | null>(null);
  const [uploadedFiles, setUploadedFiles] = useState<{
    bank: File | null;
    gl: File | null;
  }>({ bank: null, gl: null });
  const [dragOverType, setDragOverType] = useState<"bank" | "gl" | null>(null);
  const [showFileUpload, setShowFileUpload] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<MatchDetails | null>(null);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [agentMessage, setAgentMessage] = useState<string>("");
  const [isUpdatingMatch, setIsUpdatingMatch] = useState(false);

  // Fetch session details to get bank_data and gl_data
  const fetchSessionDetails = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/reconcile/session/${sessionId}`);
      if (response.ok) {
        const sessionData = await response.json();
        setCurrentSession((prev) =>
          prev
            ? {
                ...prev,
                bank_data: sessionData.bank_data || [],
                gl_data: sessionData.gl_data || [],
              }
            : null,
        );
      }
    } catch (error) {
      console.error("Error fetching session details:", error);
    }
  };

  const onDrop = useCallback(
    (acceptedFiles: File[], fileType: "bank" | "gl") => {
      const csvFile = acceptedFiles.find((file) => file.name.endsWith(".csv"));
      if (csvFile) {
        setUploadedFiles((prev) => ({
          ...prev,
          [fileType]: csvFile,
        }));
      }
    },
    [],
  );

  const createDropzoneProps = (fileType: "bank" | "gl") => ({
    onDrop: (acceptedFiles: File[]) => onDrop(acceptedFiles, fileType),
    accept: {
      "text/csv": [".csv"],
    },
    multiple: false,
  });

  const bankDropzone = useDropzone({
    ...createDropzoneProps("bank"),
    onDragEnter: () => setDragOverType("bank"),
    onDragLeave: () => setDragOverType(null),
  });

  const glDropzone = useDropzone({
    ...createDropzoneProps("gl"),
    onDragEnter: () => setDragOverType("gl"),
    onDragLeave: () => setDragOverType(null),
  });

  const clearFile = (fileType: "bank" | "gl") => {
    setUploadedFiles((prev) => ({
      ...prev,
      [fileType]: null,
    }));
  };

  const startReconciliation = async () => {
    if (!uploadedFiles.bank || !uploadedFiles.gl) {
      setAgentMessage(
        "Please upload both bank statement and general ledger CSV files to begin.",
      );
      return;
    }

    setIsLoading(true);
    setShowFileUpload(false);

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

      const data = (await response.json()) as {
        reconciliation: Record<string, unknown>;
      };
      const reconciliation = data.reconciliation;

      setSessionId(reconciliation.session_id as string);
      setCurrentSession({
        session_id: reconciliation.session_id as string,
        agent_state: reconciliation.agent_state as string,
        iteration_count: 0,
        matches: reconciliation.bank_matches as BankMatchData[],
        agent_thoughts: reconciliation.agent_thoughts as AgentThought[],
        user_feedback: [],
        processing_notes: reconciliation.processing_notes as string,
        bank_data: [], // Will be populated from session details
        gl_data: [], // Will be populated from session details
      });

      // Fetch session details to get bank_data and gl_data
      await fetchSessionDetails(reconciliation.session_id as string);

      // Set agent message
      const matchCount = (
        reconciliation.bank_matches as BankMatchData[]
      ).filter((m) => m.gl_indexes.length > 0).length;
      setAgentMessage(
        `AI Agent has analyzed your data and found ${matchCount} potential matches out of ${(reconciliation.bank_matches as BankMatchData[]).length} bank entries. ${reconciliation.processing_notes as string}`,
      );
    } catch (error) {
      setAgentMessage(
        `Error starting reconciliation: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const continueProcessing = async () => {
    if (!sessionId) return;

    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/reconcile/session/${sessionId}/continue`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_feedback: "Continue processing",
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

      // Update agent message
      if (data.agent_thoughts && data.agent_thoughts.length > 0) {
        const latestThought =
          data.agent_thoughts[data.agent_thoughts.length - 1];
        setAgentMessage(
          `${latestThought.reasoning}\n\nNext Action: ${data.next_action}`,
        );
      }
    } catch (error) {
      setAgentMessage(
        `Error processing: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const getMatchForBankEntry = (bankIndex: number): MatchDetails | null => {
    if (!currentSession) return null;
    const match = currentSession.matches.find(
      (m) => m.bank_index === bankIndex,
    );
    if (!match) return null;

    return {
      bankIndex: match.bank_index,
      glIndexes: match.gl_indexes,
      confidence: match.confidence,
      reasoning: match.reasoning,
      status: match.status,
    };
  };

  const getMatchForGLEntry = (glIndex: number): MatchDetails | null => {
    if (!currentSession) return null;
    const match = currentSession.matches.find((m) =>
      m.gl_indexes.includes(glIndex),
    );
    if (!match) return null;

    return {
      bankIndex: match.bank_index,
      glIndexes: match.gl_indexes,
      confidence: match.confidence,
      reasoning: match.reasoning,
      status: match.status,
    };
  };

  const handleCellClick = (match: MatchDetails) => {
    setSelectedMatch(match);
    setShowMatchModal(true);
  };

  const updateMatchStatus = async (
    bankIndex: number,
    status: "approved" | "rejected",
  ) => {
    if (!sessionId) return;

    setIsUpdatingMatch(true);
    try {
      const response = await fetch(
        `/api/reconcile/session/${sessionId}/match/${bankIndex}/status`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status }),
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Update the local session state
      setCurrentSession((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          matches: prev.matches.map((match) =>
            match.bank_index === bankIndex
              ? {
                  ...match,
                  status: status as
                    | "pending"
                    | "approved"
                    | "rejected"
                    | "verified",
                }
              : match,
          ),
        };
      });

      // Close the modal
      setShowMatchModal(false);
      setSelectedMatch(null);
    } catch (error) {
      console.error("Error updating match status:", error);
      setAgentMessage(
        `Error updating match status: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsUpdatingMatch(false);
    }
  };

  const getRowClassName = (index: number, type: "bank" | "gl") => {
    const match =
      type === "bank" ? getMatchForBankEntry(index) : getMatchForGLEntry(index);
    if (match && match.glIndexes.length > 0) {
      // Show green for high confidence matches, but don't auto-approve
      if (match.confidence >= 0.8) {
        return "bg-green-600/20 hover:bg-green-600/30 cursor-pointer border-l-4 border-green-500";
      }
      if (match.confidence >= 0.5) {
        return "bg-yellow-600/20 hover:bg-yellow-600/30 cursor-pointer border-l-4 border-yellow-500";
      }
      return "bg-orange-600/20 hover:bg-orange-600/30 cursor-pointer border-l-4 border-orange-500";
    }
    return "bg-slate-800/50 hover:bg-slate-700/60";
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

  const createSideBySideGroupedData = () => {
    if (!currentSession || !currentSession.bank_data.length || !currentSession.gl_data.length) {
      return { bankRows: [], glRows: [] };
    }

    // Create array of bank transactions with their matches, sorted by date
    const bankTransactions = currentSession.bank_data.map((bankEntry, bankIndex) => {
      const match = getMatchForBankEntry(bankIndex);
      return {
        bankEntry,
        bankIndex,
        match,
        date: bankEntry.date ? new Date(bankEntry.date as string) : new Date(0)
      };
    });

    // Sort by date
    bankTransactions.sort((a, b) => a.date.getTime() - b.date.getTime());

    const bankRows: Array<{
      type: 'bank' | 'spacer';
      bankIndex?: number;
      data?: Record<string, unknown>;
      match?: MatchDetails | null;
    }> = [];

    const glRows: Array<{
      type: 'gl' | 'spacer';
      glIndex?: number;
      data?: Record<string, unknown>;
      match?: MatchDetails | null;
    }> = [];

    bankTransactions.forEach((bankTransaction, index) => {
      // Add bank transaction
      bankRows.push({
        type: 'bank',
        bankIndex: bankTransaction.bankIndex,
        data: bankTransaction.bankEntry,
        match: bankTransaction.match
      });

      if (bankTransaction.match && bankTransaction.match.glIndexes.length > 0) {
        // Add first GL entry aligned with bank transaction
        const firstGlIndex = bankTransaction.match.glIndexes[0];
        glRows.push({
          type: 'gl',
          glIndex: firstGlIndex,
          data: currentSession.gl_data[firstGlIndex],
          match: bankTransaction.match
        });

        // Add remaining GL entries with spacers on bank side
        for (let i = 1; i < bankTransaction.match.glIndexes.length; i++) {
          const glIndex = bankTransaction.match.glIndexes[i];

          // Add spacer row to bank side
          bankRows.push({ type: 'spacer' });

          // Add GL entry
          glRows.push({
            type: 'gl',
            glIndex,
            data: currentSession.gl_data[glIndex],
            match: bankTransaction.match
          });
        }
      } else {
        // No GL match, add spacer to GL side
        glRows.push({ type: 'spacer' });
      }
    });

    return { bankRows, glRows };
  };

  return (
    <div className="min-h-screen bg-black flex flex-col">
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
                  Matches:{" "}
                  {
                    currentSession.matches.filter(
                      (m) => m.gl_indexes.length > 0,
                    ).length
                  }
                  /{currentSession.matches.length}
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
          <div className="max-w-4xl mx-auto">
            <h2 className="text-xl font-semibold text-white mb-6 text-center">
              Upload Your Files
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Bank Statement Upload */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-white flex items-center">
                    <span className="mr-2">🏦</span>
                    Bank Statement
                  </h3>
                  {uploadedFiles.bank && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFile("bank");
                      }}
                      className="text-slate-400 hover:text-white text-sm"
                    >
                      ✕ Clear
                    </button>
                  )}
                </div>
                <div
                  {...bankDropzone.getRootProps()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                    dragOverType === "bank"
                      ? "border-blue-400 bg-blue-900/20"
                      : uploadedFiles.bank
                        ? "border-green-500 bg-green-900/20"
                        : "border-slate-500 hover:border-slate-400"
                  }`}
                >
                  <input {...bankDropzone.getInputProps()} />
                  <div className="space-y-3">
                    <div className="text-4xl">📄</div>
                    <div>
                      <p className="text-white font-medium">
                        {uploadedFiles.bank
                          ? uploadedFiles.bank.name
                          : dragOverType === "bank"
                            ? "Drop your bank statement CSV here"
                            : "Drag & drop bank statement CSV here, or click to select"}
                      </p>
                      <p className="text-slate-400 text-sm mt-1">
                        Bank transaction data
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* General Ledger Upload */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-medium text-white flex items-center">
                    <span className="mr-2">📊</span>
                    General Ledger
                  </h3>
                  {uploadedFiles.gl && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearFile("gl");
                      }}
                      className="text-slate-400 hover:text-white text-sm"
                    >
                      ✕ Clear
                    </button>
                  )}
                </div>
                <div
                  {...glDropzone.getRootProps()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                    dragOverType === "gl"
                      ? "border-blue-400 bg-blue-900/20"
                      : uploadedFiles.gl
                        ? "border-green-500 bg-green-900/20"
                        : "border-slate-500 hover:border-slate-400"
                  }`}
                >
                  <input {...glDropzone.getInputProps()} />
                  <div className="space-y-3">
                    <div className="text-4xl">📋</div>
                    <div>
                      <p className="text-white font-medium">
                        {uploadedFiles.gl
                          ? uploadedFiles.gl.name
                          : dragOverType === "gl"
                            ? "Drop your GL CSV here"
                            : "Drag & drop general ledger CSV here, or click to select"}
                      </p>
                      <p className="text-slate-400 text-sm mt-1">
                        GL transaction data
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {uploadedFiles.bank && uploadedFiles.gl && (
              <div className="mt-6 text-center">
                <div className="mb-4 space-y-2">
                  <div className="text-green-400 flex items-center justify-center">
                    <span className="mr-2">✓</span>
                    Bank Statement: {uploadedFiles.bank.name}
                  </div>
                  <div className="text-green-400 flex items-center justify-center">
                    <span className="mr-2">✓</span>
                    General Ledger: {uploadedFiles.gl.name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={startReconciliation}
                  className="bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                >
                  Start AI Reconciliation
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent Status and Controls */}
      {currentSession && (
        <div className="bg-slate-800 border-b border-slate-600 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-slate-300 text-sm">{agentMessage}</p>
            </div>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={continueProcessing}
                disabled={isLoading}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? "Processing..." : "Continue Processing"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Merged Table Interface */}
      {currentSession && currentSession.bank_data.length > 0 && (
        <div className="flex-1 overflow-auto">
          <div className="bg-slate-800 px-4 py-3 border-b border-slate-600">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Bank Statement & General Ledger
                </h3>
                <p className="text-slate-400 text-sm">
                  {currentSession.bank_data.length} bank entries, {currentSession.gl_data.length} ledger entries
                </p>
              </div>
              <div className="flex space-x-8 text-sm">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-blue-600 rounded"></div>
                  <span className="text-slate-300">Bank Statement</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-purple-600 rounded"></div>
                  <span className="text-slate-300">General Ledger</span>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-auto max-h-full">
            <table className="w-full text-sm">
              <thead className="bg-slate-700 sticky top-0">
                <tr>
                  {/* Bank Statement Headers */}
                  <th className="px-4 py-3 text-left text-blue-300 font-medium border-r border-slate-600">
                    Bank #
                  </th>
                  {currentSession.bank_data[0] &&
                    Object.keys(currentSession.bank_data[0]).map((key) => (
                      <th
                        key={key}
                        className="px-4 py-3 text-left text-blue-300 font-medium border-r border-slate-600"
                      >
                        {key.replace(/_/g, " ").toUpperCase()}
                      </th>
                    ))}
                  <th className="px-4 py-3 text-left text-blue-300 font-medium border-r-4 border-slate-500">
                    Match
                  </th>

                  {/* General Ledger Headers */}
                  <th className="px-4 py-3 text-left text-purple-300 font-medium">
                    GL #
                  </th>
                  {currentSession.gl_data[0] &&
                    Object.keys(currentSession.gl_data[0]).map((key) => (
                      <th
                        key={key}
                        className="px-4 py-3 text-left text-purple-300 font-medium"
                      >
                        {key.replace(/_/g, " ").toUpperCase()}
                      </th>
                    ))}
                  <th className="px-4 py-3 text-left text-purple-300 font-medium">
                    Match
                  </th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const { bankRows, glRows } = createSideBySideGroupedData();
                  const maxRows = Math.max(bankRows.length, glRows.length);
                  const rows = [];

                  for (let i = 0; i < maxRows; i++) {
                    const bankRow = bankRows[i];
                    const glRow = glRows[i];

                    // Determine row styling based on match
                    const getRowStyling = () => {
                      const bankMatch = bankRow?.match;
                      const glMatch = glRow?.match;

                      if (bankMatch && bankMatch.glIndexes.length > 0) {
                        if (bankMatch.confidence >= 0.8) {
                          return "bg-green-600/20 hover:bg-green-600/30 cursor-pointer border-l-4 border-green-500";
                        }
                        if (bankMatch.confidence >= 0.5) {
                          return "bg-yellow-600/20 hover:bg-yellow-600/30 cursor-pointer border-l-4 border-yellow-500";
                        }
                        return "bg-orange-600/20 hover:bg-orange-600/30 cursor-pointer border-l-4 border-orange-500";
                      }
                      return "bg-slate-800/50 hover:bg-slate-700/60";
                    };

                    rows.push(
                      <tr
                        key={`merged-row-${i}`}
                        className={getRowStyling()}
                        onClick={() => {
                          const match = bankRow?.match || glRow?.match;
                          if (match) handleCellClick(match);
                        }}
                      >
                        {/* Bank Statement Columns */}
                        <td className="px-4 py-3 text-slate-400 border-r border-slate-600">
                          {bankRow?.type === 'bank' ? bankRow.bankIndex : ''}
                        </td>
                        {currentSession.bank_data[0] &&
                          Object.keys(currentSession.bank_data[0]).map((key, keyIndex) => (
                            <td key={keyIndex} className="px-4 py-3 text-white border-r border-slate-600">
                              {bankRow?.type === 'bank' ? String(bankRow.data![key] || '') : ''}
                            </td>
                          ))}
                        <td className="px-4 py-3 border-r-4 border-slate-500">
                          {bankRow?.type === 'bank' && bankRow.match ? (
                            <div className="flex items-center space-x-2">
                              {bankRow.match.status === "approved" ? (
                                <span className="text-green-400">✓</span>
                              ) : bankRow.match.status === "rejected" ? (
                                <span className="text-red-400">✗</span>
                              ) : (
                                <span className="text-yellow-400">?</span>
                              )}
                              <span className="text-slate-300 text-xs">
                                GL [{bankRow.match.glIndexes.join(", ")}]
                              </span>
                              <span className="text-slate-400 text-xs">
                                ({(bankRow.match.confidence * 100).toFixed(0)}%)
                              </span>
                            </div>
                          ) : bankRow?.type === 'bank' ? (
                            <span className="text-slate-500 text-xs">No match</span>
                          ) : null}
                        </td>

                        {/* General Ledger Columns */}
                        <td className="px-4 py-3 text-slate-400">
                          {glRow?.type === 'gl' ? glRow.glIndex : ''}
                        </td>
                        {currentSession.gl_data[0] &&
                          Object.keys(currentSession.gl_data[0]).map((key, keyIndex) => (
                            <td key={keyIndex} className="px-4 py-3 text-white">
                              {glRow?.type === 'gl' ? String(glRow.data![key] || '') : ''}
                            </td>
                          ))}
                        <td className="px-4 py-3">
                          {glRow?.type === 'gl' && glRow.match ? (
                            <div className="flex items-center space-x-2">
                              {glRow.match.status === "approved" ? (
                                <span className="text-green-400">✓</span>
                              ) : glRow.match.status === "rejected" ? (
                                <span className="text-red-400">✗</span>
                              ) : (
                                <span className="text-yellow-400">?</span>
                              )}
                              <span className="text-slate-300 text-xs">
                                Bank {glRow.match.bankIndex}
                              </span>
                              <span className="text-slate-400 text-xs">
                                ({(glRow.match.confidence * 100).toFixed(0)}%)
                              </span>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  }

                  return rows;
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Match Details Modal */}
      {showMatchModal && selectedMatch && currentSession && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-white">Match Review</h3>
              <button
                type="button"
                onClick={() => setShowMatchModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              {/* Match Information */}
              <div>
                <h4 className="text-slate-300 font-medium mb-2">
                  Match Information
                </h4>
                <div className="bg-slate-700 p-4 rounded">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-white font-medium">
                        Bank Entry #{selectedMatch.bankIndex}
                      </p>
                      <p className="text-slate-400 text-sm">
                        Confidence:{" "}
                        {(selectedMatch.confidence * 100).toFixed(1)}%
                      </p>
                    </div>
                    <div>
                      <p className="text-white font-medium">
                        GL Entries [#{selectedMatch.glIndexes.join(", ")}]
                      </p>
                      <p className="text-slate-400 text-sm">
                        Status: {selectedMatch.status}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bank Statement Entry */}
              <div>
                <h4 className="text-slate-300 font-medium mb-2">
                  Bank Statement Entry
                </h4>
                <div className="bg-slate-700 p-4 rounded">
                  <div className="grid grid-cols-2 gap-4">
                    {currentSession.bank_data[selectedMatch.bankIndex] &&
                      Object.entries(
                        currentSession.bank_data[selectedMatch.bankIndex],
                      ).map(([key, value]) => (
                        <div key={key}>
                          <span className="text-slate-400 text-sm">
                            {key.replace(/_/g, " ").toUpperCase()}:
                          </span>
                          <p className="text-white font-medium">
                            {String(value)}
                          </p>
                        </div>
                      ))}
                  </div>
                  <p className="text-slate-400">
                    Transaction Lifecycle: {selectedMatch.glIndexes.length} GL
                    entries
                  </p>
                </div>
              </div>

              {/* General Ledger Entry */}
              {selectedMatch.glIndexes !== null &&
                selectedMatch.glIndexes.length > 0 && (
                  <div>
                    <h4 className="text-slate-300 font-medium mb-2">
                      General Ledger Entries
                    </h4>
                    {selectedMatch.glIndexes.map((glIndex) => (
                      <div className="bg-slate-700 p-4 rounded" key={glIndex}>
                        <span className="text-slate-400 text-sm">
                          GL Entry #{glIndex}:
                        </span>
                        <div className="grid grid-cols-2 gap-4">
                          {currentSession.gl_data[glIndex] &&
                            Object.entries(currentSession.gl_data[glIndex]).map(
                              ([key, value]) => (
                                <div key={key}>
                                  <span className="text-slate-400 text-sm">
                                    {key.replace(/_/g, " ").toUpperCase()}:
                                  </span>
                                  <p className="text-white font-medium">
                                    {String(value)}
                                  </p>
                                </div>
                              ),
                            )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              {/* AI Reasoning */}
              <div>
                <h4 className="text-slate-300 font-medium mb-2">
                  AI Reasoning
                </h4>
                <div className="bg-slate-700 p-4 rounded">
                  <p className="text-slate-300">{selectedMatch.reasoning}</p>
                </div>
              </div>

              {/* Action Buttons */}
              {selectedMatch.status === "pending" && (
                <div className="flex space-x-4 pt-4">
                  <button
                    type="button"
                    onClick={() =>
                      updateMatchStatus(selectedMatch.bankIndex, "approved")
                    }
                    disabled={isUpdatingMatch}
                    className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
                  >
                    {isUpdatingMatch ? "Processing..." : "✓ Approve Match"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateMatchStatus(selectedMatch.bankIndex, "rejected")
                    }
                    disabled={isUpdatingMatch}
                    className="flex-1 bg-red-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-red-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
                  >
                    {isUpdatingMatch ? "Processing..." : "✗ Reject Match"}
                  </button>
                </div>
              )}

              {/* Status Display for Approved/Rejected */}
              {selectedMatch.status !== "pending" && (
                <div className="pt-4">
                  <div
                    className={`p-4 rounded-lg ${
                      selectedMatch.status === "approved"
                        ? "bg-green-900/30 border border-green-500"
                        : "bg-red-900/30 border border-red-500"
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {selectedMatch.status === "approved" ? (
                        <>
                          <span className="text-green-400 text-xl">✓</span>
                          <span className="text-green-400 font-medium">
                            Match Approved
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-red-400 text-xl">✗</span>
                          <span className="text-red-400 font-medium">
                            Match Rejected
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
