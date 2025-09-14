"use client";

import { useCallback, useEffect, useState } from "react";
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

interface Document {
  filename?: string;
  file_path?: string;
  confidence?: number;
  extraction?: Record<string, unknown>;
  processing_notes?: string;
}

export default function AgentReconciliationPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
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
  const [_isUpdatingMatch, _setIsUpdatingMatch] = useState(false);
  const [updatingMatches, setUpdatingMatches] = useState<Set<number>>(
    new Set(),
  );
  const [showDocumentUpload, setShowDocumentUpload] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState<File[]>([]);
  const [isUploadingDocuments, setIsUploadingDocuments] = useState(false);
  const [manualMatchMode, setManualMatchMode] = useState(false);
  const [selectedBankEntry, setSelectedBankEntry] = useState<number | null>(
    null,
  );
  const [selectedGlEntries, setSelectedGlEntries] = useState<number[]>([]);
  const [showExplanationModal, setShowExplanationModal] = useState(false);
  const [explanationText, setExplanationText] = useState("");
  const [isCreatingManualMatch, setIsCreatingManualMatch] = useState(false);
  const [matchingDocuments, setMatchingDocuments] = useState<Document[]>([]);
  const [_isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [hoveredGroupId, setHoveredGroupId] = useState<string | null>(null);
  const [matchesWithDocuments, setMatchesWithDocuments] = useState<Set<number>>(
    new Set(),
  );
  const [searchingDocumentsFor, setSearchingDocumentsFor] = useState<
    Set<number>
  >(new Set());
  const [documentsByMatch, setDocumentsByMatch] = useState<
    Map<number, Document[]>
  >(new Map());
  const [showDocumentSidePanel, setShowDocumentSidePanel] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(
    null,
  );
  const [rejectionComment, setRejectionComment] = useState("");
  const [, _setIsRejectingDocument] = useState(false);
  const [rejectionQueue, setRejectionQueue] = useState<
    Array<{
      id: string;
      document: Document;
      bankIndex: number;
      comment: string;
      status: "pending" | "processing" | "completed" | "error";
    }>
  >([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  // Process rejection queue
  useEffect(() => {
    const processQueue = async () => {
      if (rejectionQueue.length === 0 || isProcessingQueue) return;

      const pendingItems = rejectionQueue.filter(
        (item) => item.status === "pending",
      );
      if (pendingItems.length === 0) return;

      setIsProcessingQueue(true);

      for (const item of pendingItems) {
        // Mark as processing
        setRejectionQueue((prev) =>
          prev.map((queueItem) =>
            queueItem.id === item.id
              ? { ...queueItem, status: "processing" as const }
              : queueItem,
          ),
        );

        try {
          const response = await fetch(
            `/api/reconcile/session/${sessionId}/match/${item.bankIndex}/reject-document`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                document_path: item.document.file_path,
                rejection_reason: item.comment,
              }),
            },
          );

          if (!response.ok) {
            throw new Error(
              `Failed to reject document: ${response.statusText}`,
            );
          }

          const result = await response.json();

          // Update documents cache
          if (result.new_documents) {
            setDocumentsByMatch(
              (prev) => new Map(prev.set(item.bankIndex, result.new_documents)),
            );

            // Update matches with documents set
            if (result.new_documents.length > 0) {
              setMatchesWithDocuments(
                (prev) => new Set([...prev, item.bankIndex]),
              );
            } else {
              setMatchesWithDocuments((prev) => {
                const newSet = new Set(prev);
                newSet.delete(item.bankIndex);
                return newSet;
              });
            }
          }

          // Mark as completed
          setRejectionQueue((prev) =>
            prev.map((queueItem) =>
              queueItem.id === item.id
                ? { ...queueItem, status: "completed" as const }
                : queueItem,
            ),
          );

          // Update agent message
          setAgentMessage(
            `Document rejected: "${item.comment}". Found ${result.new_matches_found} new matching documents.`,
          );
        } catch (error) {
          console.error("Error rejecting document:", error);

          // Mark as error
          setRejectionQueue((prev) =>
            prev.map((queueItem) =>
              queueItem.id === item.id
                ? { ...queueItem, status: "error" as const }
                : queueItem,
            ),
          );

          setAgentMessage(
            `Error rejecting document: ${error instanceof Error ? error.message : "Unknown error"}`,
          );
        }

        // Add a small delay between processing items for smooth animation
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Remove completed items after a delay
      setTimeout(() => {
        setRejectionQueue((prev) =>
          prev.filter((item) => item.status !== "completed"),
        );
      }, 2000);

      setIsProcessingQueue(false);
    };

    processQueue();
  }, [rejectionQueue, isProcessingQueue, sessionId]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && showMatchModal) {
        setShowMatchModal(false);
        setSelectedMatch(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showMatchModal]);

  // Load documents when modal opens for a match that has documents
  useEffect(() => {
    if (
      showMatchModal &&
      selectedMatch &&
      matchesWithDocuments.has(selectedMatch.bankIndex)
    ) {
      // If we don't have documents cached for this match, fetch them
      if (!documentsByMatch.has(selectedMatch.bankIndex)) {
        getDocumentsForMatch(selectedMatch.bankIndex).then((documents) => {
          setDocumentsByMatch(
            (prev) => new Map(prev.set(selectedMatch.bankIndex, documents)),
          );
        });
      }
    }
  }, [showMatchModal, selectedMatch, matchesWithDocuments, documentsByMatch]);

  // Helper functions for group hover effects
  const handleGroupMouseEnter = (groupId: string) => {
    setHoveredGroupId(groupId);
  };

  const handleGroupMouseLeave = () => {
    setHoveredGroupId(null);
  };

  const getGroupHoverClass = (groupId: string) => {
    return hoveredGroupId === groupId ? "bg-neutral-800/50" : "";
  };

  // Helper function to save session to backend
  const _saveSessionToBackend = async (
    sessionId: string,
    changeDescription: string,
  ) => {
    if (!currentSession) return;

    try {
      console.log(
        `💾 Saving session ${sessionId} with change: ${changeDescription}`,
      );

      const response = await fetch(`/api/reconcile/session/${sessionId}/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...currentSession,
          bank_matches: currentSession.matches, // Ensure bank_matches field exists for backend compatibility
          change_description: changeDescription,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Failed to save session:", errorText);
        throw new Error(`Failed to save session: ${errorText}`);
      }

      const result = await response.json();
      console.log("✅ Session saved successfully:", result);
      return result;
    } catch (error) {
      console.error("❌ Error saving session:", error);
      throw error;
    }
  };

  // Helper function to add a manual match to local session state
  const _addManualMatchToSession = (
    bankIndex: number,
    glIndexes: number[],
    explanation: string,
  ) => {
    if (!currentSession) return;

    const newMatch: BankMatchData = {
      bank_index: bankIndex,
      gl_indexes: glIndexes,
      confidence: 1.0,
      reasoning: `Manual match created by user: ${explanation}`,
      status: "approved" as const,
      linked_documents: [],
      created_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
      user_feedback: explanation,
    };

    setCurrentSession((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        matches: [...prev.matches, newMatch],
      };
    });

    return newMatch;
  };

  // Helper function to reject a match in local session state
  const _rejectMatchInSession = (bankIndex: number, reason: string) => {
    if (!currentSession) return;

    setCurrentSession((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        matches: prev.matches.map((match) =>
          match.bank_index === bankIndex
            ? { ...match, status: "rejected" as const, user_feedback: reason }
            : match,
        ),
      };
    });
  };

  // Fetch session details to get bank_data, gl_data, and matches
  const fetchSessionDetails = async (sessionId: string) => {
    setIsInitializing(true);
    try {
      console.log("🔍 Fetching session details for:", sessionId);
      const response = await fetch(`/api/reconcile/session/${sessionId}`);
      if (response.ok) {
        const sessionData = await response.json();

        setCurrentSession((prev) => {
          return prev
            ? {
                ...prev,
                bank_data: sessionData.bank_data || [],
                gl_data: sessionData.gl_data || [],
                matches: sessionData.bank_matches || [],
              }
            : null;
        });
      } else {
        console.error(
          "❌ Failed to fetch session details:",
          response.status,
          response.statusText,
        );
      }
    } catch (error) {
      console.error("❌ Error fetching session details:", error);
    } finally {
      setIsInitializing(false);
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

  const _continueProcessing = async () => {
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
    if (!currentSession) {
      console.log("❌ No current session in getMatchForBankEntry");
      return null;
    }

    // Find all matches for this bank entry
    const allMatches = currentSession.matches.filter(
      (m) => m.bank_index === bankIndex,
    );

    // Prioritize non-rejected matches over rejected ones
    const match =
      allMatches.find((m) => m.status !== "rejected") || allMatches[0];

    console.log(`🔍 getMatchForBankEntry(${bankIndex}):`, {
      totalMatches: currentSession.matches.length,
      allMatchesForBank: allMatches.length,
      foundMatch: !!match,
      matchStatus: match?.status,
      matchGlIndexes: match?.gl_indexes,
      prioritizedNonRejected: allMatches.some((m) => m.status !== "rejected"),
    });

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
    if (!sessionId || !currentSession) return;

    // Add this match to the updating set
    setUpdatingMatches((prev) => new Set([...prev, bankIndex]));

    try {
      // 1. Update session data in frontend
      const updatedSession = {
        ...currentSession,
        matches: currentSession.matches.map((match) =>
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

      setCurrentSession(updatedSession);

      // 2. Save to backend
      const changeDescription = `Match status updated: Bank #${bankIndex} -> ${status}`;

      const response = await fetch(`/api/reconcile/session/${sessionId}/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...updatedSession,
          bank_matches: updatedSession.matches,
          change_description: changeDescription,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Failed to save session:", errorText);
        throw new Error(`Failed to save session: ${errorText}`);
      }

      const result = await response.json();
      console.log("✅ Session saved successfully:", result);

      // 3. Close the modal immediately
      setShowMatchModal(false);
      setSelectedMatch(null);

      // 4. Show immediate success message
      setAgentMessage(`Successfully ${status} match for Bank #${bankIndex}`);
    } catch (error) {
      console.error("❌ Match status update error:", error);
      setAgentMessage(
        `Error updating match status: ${error instanceof Error ? error.message : "Unknown error"}`,
      );

      // Revert the local state on error
      if (currentSession) {
        setCurrentSession(currentSession);
      }
    } finally {
      // Remove this match from the updating set
      setUpdatingMatches((prev) => {
        const newSet = new Set(prev);
        newSet.delete(bankIndex);
        return newSet;
      });
    }

    // 5. If match was approved, start document search in background (completely non-blocking)
    if (status === "approved") {
      // Start document search immediately in background (completely non-blocking)
      startDocumentSearch(bankIndex);
    }
  };

  // Function to start document search in background (completely non-blocking)
  const startDocumentSearch = async (bankIndex: number) => {
    // Mark this match as searching for documents
    setSearchingDocumentsFor((prev) => new Set([...prev, bankIndex]));

    // Update message to indicate document search is starting
    setAgentMessage(
      `Match approved for Bank #${bankIndex}. Finding documents...`,
    );

    try {
      // Start document search in background (completely non-blocking)
      const documents = await fetchMatchingDocuments(bankIndex);

      // Update message with results
      if (documents && documents.length > 0) {
        setAgentMessage(
          `Successfully approved match for Bank #${bankIndex} and found ${documents.length} matching documents`,
        );
        // Mark this match as having documents
        setMatchesWithDocuments((prev) => new Set([...prev, bankIndex]));
      } else {
        setAgentMessage(
          `Match approved for Bank #${bankIndex}, but no documents found`,
        );
      }
    } catch (docError) {
      console.warn("Document matching failed after approval:", docError);
      setAgentMessage(
        `Match approved for Bank #${bankIndex}, but document search failed`,
      );
    } finally {
      // Remove from searching state
      setSearchingDocumentsFor((prev) => {
        const newSet = new Set(prev);
        newSet.delete(bankIndex);
        return newSet;
      });
    }
  };

  // Function to fetch matching documents
  const fetchMatchingDocuments = async (
    bankIndex: number,
    showModal = false,
  ): Promise<Document[]> => {
    if (!sessionId) return [];

    setIsLoadingDocuments(true);
    try {
      const response = await fetch(
        `/api/reconcile/session/${sessionId}/match/${bankIndex}/documents`,
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const documents = data.matching_documents || [];
      setMatchingDocuments(documents);

      // Store documents by match
      setDocumentsByMatch((prev) => new Map(prev.set(bankIndex, documents)));

      // Track which matches have documents
      if (documents.length > 0) {
        setMatchesWithDocuments((prev) => new Set([...prev, bankIndex]));
      }

      // Only show modal if explicitly requested
      if (showModal) {
        setShowDocuments(true);
      }

      return documents;
    } catch (error) {
      console.error("Error fetching matching documents:", error);
      setAgentMessage(
        `Error fetching documents: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return [];
    } finally {
      setIsLoadingDocuments(false);
    }
  };

  // Function to get documents for a specific match (for preview)
  const getDocumentsForMatch = async (bankIndex: number) => {
    if (!sessionId) return [];

    try {
      const response = await fetch(
        `/api/reconcile/session/${sessionId}/match/${bankIndex}/documents`,
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data.matching_documents || [];
    } catch (error) {
      console.error("Error fetching documents for match:", error);
      return [];
    }
  };

  // Function to view documents for a specific match
  const viewDocumentsForMatch = async (bankIndex: number) => {
    await fetchMatchingDocuments(bankIndex, true);
  };

  // Function to open document in side panel
  const openDocumentInSidePanel = (document: Document) => {
    setSelectedDocument(document);
    setShowDocumentSidePanel(true);
    setRejectionComment("");
  };

  // Function to close document side panel
  const closeDocumentSidePanel = () => {
    setShowDocumentSidePanel(false);
    setSelectedDocument(null);
    setRejectionComment("");
  };

  // Function to reject document and trigger re-search
  const rejectDocument = () => {
    if (
      !selectedDocument ||
      !rejectionComment.trim() ||
      !sessionId ||
      !selectedMatch
    )
      return;

    // Add to rejection queue
    const rejectionId = `rejection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newRejectionItem = {
      id: rejectionId,
      document: selectedDocument,
      bankIndex: selectedMatch.bankIndex,
      comment: rejectionComment,
      status: "pending" as const,
    };

    setRejectionQueue((prev) => [...prev, newRejectionItem]);

    // Close the side panel immediately
    closeDocumentSidePanel();

    // Show immediate feedback
    setAgentMessage(
      `Document rejection queued: "${rejectionComment}". Processing...`,
    );
  };

  // Function to download document
  const downloadDocument = async (doc: Document) => {
    try {
      // Extract the filename from the file path
      const filename =
        doc.filename || doc.file_path?.split("/").pop() || "document.pdf";

      // Get the PDF file path by removing .json extension if present
      let pdfPath = doc.file_path;
      if (pdfPath?.endsWith(".json")) {
        pdfPath = pdfPath.replace(".json", "");
      }

      // Remove 'data/' prefix if present since the API expects relative to data directory
      if (pdfPath?.startsWith("data/")) {
        pdfPath = pdfPath.substring(5); // Remove 'data/' prefix
      }

      // Create a download endpoint that serves the PDF from the Python API
      const response = await fetch(
        `/api/download-document?path=${encodeURIComponent(pdfPath || "")}`,
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Create a blob from the response
      const blob = await response.blob();

      // Create a temporary URL for the blob
      const url = window.URL.createObjectURL(blob);

      // Create a temporary anchor element and trigger download
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      // Clean up
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Error downloading document:", error);
      setAgentMessage(
        `Error downloading document: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  // Document upload handlers
  const onDocumentDrop = useCallback((acceptedFiles: File[]) => {
    const supportedFiles = acceptedFiles.filter(
      (file) =>
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf"),
    );
    setUploadedDocuments((prev) => [...prev, ...supportedFiles]);
  }, []);

  const documentDropzone = useDropzone({
    onDrop: onDocumentDrop,
    accept: {
      "application/pdf": [".pdf"],
    },
    multiple: true,
  });

  const removeDocument = (index: number) => {
    setUploadedDocuments((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadDocuments = async () => {
    if (uploadedDocuments.length === 0) return;

    setIsUploadingDocuments(true);
    try {
      const formData = new FormData();
      uploadedDocuments.forEach((file, index) => {
        formData.append(`document_${index}`, file);
      });

      const response = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      await response.json();
      setAgentMessage(
        `Successfully uploaded ${uploadedDocuments.length} document(s) for processing.`,
      );
      setUploadedDocuments([]);
      setShowDocumentUpload(false);
    } catch (error) {
      setAgentMessage(
        `Error uploading documents: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsUploadingDocuments(false);
    }
  };

  // Manual match handlers
  const toggleManualMatchMode = () => {
    setManualMatchMode(!manualMatchMode);
    setSelectedBankEntry(null);
    setSelectedGlEntries([]);
  };

  const selectBankEntry = (bankIndex: number) => {
    if (manualMatchMode) {
      setSelectedBankEntry(bankIndex);
      setSelectedGlEntries([]);
    }
  };

  const selectGlEntry = (glIndex: number) => {
    if (manualMatchMode && selectedBankEntry !== null) {
      setSelectedGlEntries((prev) => {
        const newEntries = prev.includes(glIndex)
          ? prev.filter((index) => index !== glIndex)
          : [...prev, glIndex];

        console.log("🔍 GL entry selection:", {
          glIndex,
          selectedBankEntry,
          prevEntries: prev,
          newEntries: newEntries,
        });

        return newEntries;
      });
    }
  };

  const confirmManualMatch = () => {
    if (selectedBankEntry !== null && selectedGlEntries.length > 0) {
      setShowExplanationModal(true);
    }
  };

  const createManualMatch = async () => {
    if (
      !sessionId ||
      selectedBankEntry === null ||
      selectedGlEntries.length === 0 ||
      !currentSession
    ) {
      console.log("❌ Missing required data for manual match");
      return;
    }

    setIsCreatingManualMatch(true);

    // Store the original session state for potential reversion
    const originalSession = currentSession;

    try {
      // 1. Create the new match
      console.log("🔍 Manual match creation debug:", {
        selectedBankEntry,
        selectedGlEntries,
        selectedGlEntriesLength: selectedGlEntries.length,
        explanationText,
      });

      const newMatch: BankMatchData = {
        bank_index: selectedBankEntry,
        gl_indexes: selectedGlEntries,
        confidence: 1.0,
        reasoning: `Manual match created by user: ${explanationText}`,
        status: "approved" as const,
        linked_documents: [],
        created_at: new Date().toISOString(),
        verified_at: new Date().toISOString(),
        user_feedback: explanationText,
      };

      // 2. Save to backend first (before updating local state)
      const changeDescription = `Manual match created: Bank #${selectedBankEntry} -> GL [${selectedGlEntries.join(", ")}] - ${explanationText}`;

      const updatedSession = {
        ...currentSession,
        matches: [...currentSession.matches, newMatch],
      };

      console.log("🔍 Before save - matches", updatedSession.matches);

      const response = await fetch(`/api/reconcile/session/${sessionId}/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...updatedSession,
          bank_matches: updatedSession.matches,
          change_description: changeDescription,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Failed to save session:", errorText);
        throw new Error(`Failed to save session: ${errorText}`);
      }

      const result = await response.json();
      console.log("✅ Session saved successfully:", result);

      console.log("🔍 About to update session state:", {
        beforeMatches: currentSession.matches.length,
        afterMatches: updatedSession.matches.length,
        newMatch: newMatch,
      });

      setCurrentSession(updatedSession);

      console.log("🔍 Session state updated, should trigger re-render");

      // 4. Update UI state
      setAgentMessage(
        `Successfully created manual match between Bank #${selectedBankEntry} and GL entries [${selectedGlEntries.join(", ")}]`,
      );

      // Reset selection
      setSelectedBankEntry(null);
      setSelectedGlEntries([]);
      setManualMatchMode(false);
      setShowExplanationModal(false);
      setExplanationText("");
    } catch (error) {
      console.error("❌ Manual match error:", error);
      setAgentMessage(
        `Error creating manual match: ${error instanceof Error ? error.message : "Unknown error"}`,
      );

      // Revert to the original session state on error
      setCurrentSession(originalSession);
    } finally {
      setIsCreatingManualMatch(false);
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
        return "text-neutral-400";
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

  const createGroupedData = () => {
    console.log("🔄 Creating grouped data...", {
      currentSession: !!currentSession,
      bank_data_length: currentSession?.bank_data?.length || 0,
      gl_data_length: currentSession?.gl_data?.length || 0,
      matches_length: currentSession?.matches?.length || 0,
      matches:
        currentSession?.matches?.map((m) => ({
          bank_index: m.bank_index,
          status: m.status,
          gl_indexes: m.gl_indexes,
        })) || [],
    });

    if (
      !currentSession ||
      !currentSession.bank_data.length ||
      !currentSession.gl_data.length
    ) {
      console.log("❌ Missing session data, returning empty array");
      return [];
    }

    // Create array of bank transactions with their matches, sorted by date
    const bankTransactions = currentSession.bank_data.map(
      (bankEntry, bankIndex) => {
        const match = getMatchForBankEntry(bankIndex);
        return {
          bankEntry,
          bankIndex,
          match,
          date:
            bankEntry.Date || bankEntry.date
              ? new Date((bankEntry.Date || bankEntry.date) as string)
              : new Date(0),
        };
      },
    );

    // Sort bank transactions by date
    bankTransactions.sort((a, b) => a.date.getTime() - b.date.getTime());

    // Create groups where each group contains a bank entry and its matching GL entries
    const groups = bankTransactions.map((bankTransaction) => {
      const glEntries: Array<{
        glIndex: number;
        data: Record<string, unknown>;
        match: MatchDetails | null;
      }> = [];

      // Only include GL entries if the match is not rejected
      if (
        bankTransaction.match &&
        bankTransaction.match.glIndexes.length > 0 &&
        bankTransaction.match.status !== "rejected"
      ) {
        bankTransaction.match.glIndexes.forEach((glIndex) => {
          const glEntry = currentSession.gl_data[glIndex];
          const glMatch = getMatchForGLEntry(glIndex);
          glEntries.push({
            glIndex,
            data: glEntry,
            match: glMatch,
          });
        });
      }

      return {
        bankEntry: bankTransaction.bankEntry,
        bankIndex: bankTransaction.bankIndex,
        bankMatch: bankTransaction.match,
        glEntries,
        // Determine group styling based on match status and confidence
        groupStyle:
          bankTransaction.match &&
          bankTransaction.match.glIndexes.length > 0 &&
          bankTransaction.match.status !== "rejected"
            ? bankTransaction.match.status === "approved"
              ? "approved"
              : bankTransaction.match.confidence >= 0.7
                ? "high-confidence"
                : "low-confidence"
            : "no-match",
        isUnmatchedGl: false,
        isRejected: bankTransaction.match?.status === "rejected",
        isUnmatchedBank: false,
      };
    });

    // Separate approved/pending groups from rejected/unmatched groups
    const activeGroups = groups.filter(
      (group) => !group.isRejected && group.glEntries.length > 0,
    );
    const rejectedGroups = groups.filter((group) => group.isRejected);
    const unmatchedBankGroups = groups.filter(
      (group) => !group.isRejected && group.glEntries.length === 0,
    );

    console.log("🔍 Group separation results:", {
      totalGroups: groups.length,
      activeGroups: activeGroups.length,
      rejectedGroups: rejectedGroups.length,
      unmatchedBankGroups: unmatchedBankGroups.length,
      activeGroupsDetails: activeGroups.map((g) => ({
        bankIndex: g.bankIndex,
        status: g.bankMatch?.status,
        glEntriesCount: g.glEntries.length,
      })),
    });

    // Find unmatched GL entries (not matched to any non-rejected match in the session)
    const matchedGlIndexes = new Set<number>();
    const matchedBankIndexes = new Set<number>();

    // Check all matches in the session, but only count non-rejected matches
    currentSession.matches.forEach((match) => {
      if (match.gl_indexes.length > 0 && match.status !== "rejected") {
        match.gl_indexes.forEach((glIndex) => {
          matchedGlIndexes.add(glIndex);
        });
        matchedBankIndexes.add(match.bank_index);
      }
    });

    // Add unmatched GL entries as separate groups
    const unmatchedGlEntries = currentSession.gl_data
      .map((glEntry, glIndex) => ({ glEntry, glIndex }))
      .filter(({ glIndex }) => !matchedGlIndexes.has(glIndex));

    // Create separate unmatched entries for side-by-side display
    // Filter out bank entries that have matches
    const allUnmatchedGroups = [...rejectedGroups, ...unmatchedBankGroups];

    const unmatchedBankEntries = allUnmatchedGroups
      .filter((group) => !matchedBankIndexes.has(group.bankIndex))
      .map((group) => ({
        ...group,
        isUnmatchedBank: true,
        date:
          group.bankEntry?.Date || group.bankEntry?.date
            ? new Date((group.bankEntry.Date || group.bankEntry.date) as string)
            : new Date(0),
      }));

    const unmatchedGlEntriesFormatted = unmatchedGlEntries.map(
      ({ glEntry, glIndex }) => ({
        bankEntry: null,
        bankIndex: null,
        bankMatch: null,
        glEntries: [
          {
            glIndex,
            data: glEntry,
            match: null,
          },
        ],
        groupStyle: "no-match" as const,
        isUnmatchedGl: true,
        isRejected: false,
        isUnmatchedBank: false,
        date:
          glEntry.Date || glEntry.date
            ? new Date((glEntry.Date || glEntry.date) as string)
            : new Date(0),
      }),
    );

    // Sort unmatched entries by date
    unmatchedBankEntries.sort((a, b) => a.date.getTime() - b.date.getTime());
    unmatchedGlEntriesFormatted.sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );

    // Store unmatched entries separately for side-by-side rendering
    const unmatchedEntriesData = {
      bankEntries: unmatchedBankEntries,
      glEntries: unmatchedGlEntriesFormatted,
    };

    return [...activeGroups, unmatchedEntriesData];
  };

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col">
      {/* Header */}
      <div className="bg-neutral-900 border-b border-neutral-900 px-6 py-4">
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
                <span className="text-neutral-400 text-sm">
                  Iteration: {currentSession.iteration_count}
                </span>
                <span className="text-neutral-400 text-sm">
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
            <div className="text-neutral-400 text-sm">Session: {sessionId}</div>
          )}
        </div>
      </div>

      {/* Rejection Queue Animation */}
      {rejectionQueue.length > 0 && (
        <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                <span className="text-white text-sm font-medium">
                  Processing Document Rejections
                </span>
              </div>
              <div className="text-neutral-400 text-xs">
                {
                  rejectionQueue.filter((item) => item.status === "processing")
                    .length
                }{" "}
                processing,{" "}
                {
                  rejectionQueue.filter((item) => item.status === "pending")
                    .length
                }{" "}
                queued
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {rejectionQueue.map((item, index) => (
                <div
                  key={item.id}
                  className={`w-3 h-3 rounded-full transition-all duration-300 ${
                    item.status === "pending"
                      ? "bg-yellow-400 animate-pulse"
                      : item.status === "processing"
                        ? "bg-blue-400 animate-spin"
                        : item.status === "completed"
                          ? "bg-green-400"
                          : "bg-red-400"
                  }`}
                  style={{
                    animationDelay: `${index * 100}ms`,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Queue Items */}
          <div className="mt-3 space-y-2 max-h-32 overflow-y-auto">
            {rejectionQueue.map((item) => (
              <div
                key={item.id}
                className={`flex items-center justify-between p-2 rounded-lg transition-all duration-500 ${
                  item.status === "pending"
                    ? "bg-yellow-900/20 border border-yellow-500/30"
                    : item.status === "processing"
                      ? "bg-blue-900/20 border border-blue-500/30"
                      : item.status === "completed"
                        ? "bg-green-900/20 border border-green-500/30"
                        : "bg-red-900/20 border border-red-500/30"
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      item.status === "pending"
                        ? "bg-yellow-400 animate-pulse"
                        : item.status === "processing"
                          ? "bg-blue-400 animate-spin"
                          : item.status === "completed"
                            ? "bg-green-400"
                            : "bg-red-400"
                    }`}
                  />
                  <div>
                    <div className="text-white text-sm font-medium">
                      {item.document.filename || "Document"}
                    </div>
                    <div className="text-neutral-400 text-xs">
                      Bank #{item.bankIndex} • {item.comment}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-neutral-400">
                  {item.status === "pending" && "Queued"}
                  {item.status === "processing" && "Processing..."}
                  {item.status === "completed" && "Completed"}
                  {item.status === "error" && "Error"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* File Upload Section */}
      {showFileUpload && (
        <div className="p-6 border-b border-neutral-900">
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
                      className="text-neutral-400 hover:text-white text-sm"
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
                        : "border-neutral-900 hover:border-neutral-700"
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
                      <p className="text-neutral-400 text-sm mt-1">
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
                      className="text-neutral-400 hover:text-white text-sm"
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
                        : "border-neutral-900 hover:border-neutral-700"
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
                      <p className="text-neutral-400 text-sm mt-1">
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

      {/* Initial Loading State */}
      {isInitializing && (
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-neutral-950 rounded-lg p-8 border border-neutral-900">
            <div className="flex flex-col items-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" />
              <div className="text-center">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Loading Session
                </h3>
                <p className="text-neutral-300 text-sm">
                  Fetching reconciliation data...
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-neutral-950 rounded-lg p-8 border border-neutral-900">
            <div className="flex flex-col items-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400" />
              <div className="text-center">
                <h3 className="text-lg font-semibold text-white mb-2">
                  Agent is Reconciling
                </h3>
                <p className="text-neutral-300 text-sm">
                  The AI agent is analyzing your financial data and finding
                  matches...
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Table Interface */}
      {currentSession && currentSession.bank_data.length > 0 && !isLoading && (
        <div className="flex-1 overflow-auto">
          <div className="bg-neutral-950 px-6 py-4 border-b border-neutral-900">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  Reconciliation Table
                </h3>
                <p className="text-neutral-400 text-sm">
                  {currentSession.bank_data.length} bank entries,{" "}
                  {currentSession.gl_data.length} ledger entries
                </p>
              </div>
              <div className="flex items-center space-x-6">
                <div className="flex space-x-6 text-sm">
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-green-500 rounded" />
                    <span className="text-neutral-300">
                      High Confidence Match
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-yellow-500 rounded" />
                    <span className="text-neutral-300">
                      Low Confidence Match
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 bg-neutral-500 rounded" />
                    <span className="text-neutral-300">No Match</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleManualMatchMode}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    manualMatchMode
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"
                  }`}
                >
                  {manualMatchMode ? "Exit Selection" : "Select Matches"}
                </button>
                {manualMatchMode &&
                  selectedBankEntry !== null &&
                  selectedGlEntries.length > 0 && (
                    <button
                      type="button"
                      onClick={confirmManualMatch}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition-colors"
                    >
                      Confirm Match
                    </button>
                  )}
              </div>
            </div>
            <div className="p-2 bg-blue-500/20 rounded-lg mt-2">
              <div className="flex items-center space-x-2">
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    agentMessage.includes("Finding documents") ||
                    agentMessage.includes("Searching")
                      ? "bg-blue-500 animate-pulse"
                      : agentMessage.includes("Error") ||
                          agentMessage.includes("failed")
                        ? "bg-red-500"
                        : agentMessage.includes("Successfully") ||
                            agentMessage.includes("approved")
                          ? "bg-green-500"
                          : "bg-blue-400"
                  }`}
                >
                  {agentMessage.includes("Finding documents") ||
                  agentMessage.includes("Searching") ? (
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
                  ) : agentMessage.includes("Error") ||
                    agentMessage.includes("failed") ? (
                    <span className="text-white text-xs font-bold">!</span>
                  ) : agentMessage.includes("Successfully") ||
                    agentMessage.includes("approved") ? (
                    <span className="text-white text-xs font-bold">✓</span>
                  ) : (
                    <span className="text-white text-xs font-bold">i</span>
                  )}
                </div>
                <p className="text-neutral-300 text-sm flex-1">
                  {manualMatchMode
                    ? selectedBankEntry !== null
                      ? selectedGlEntries.length > 0
                        ? `Manual Match Mode: Bank #${selectedBankEntry} → GL [${selectedGlEntries.join(", ")}] selected. Click "Confirm Match" to proceed.`
                        : `Manual Match Mode: Bank #${selectedBankEntry} selected. Now select one or more GL entries to match.`
                      : "Manual Match Mode: Click on a bank entry number to start creating a match."
                    : agentMessage}
                </p>
                {/* Document search progress indicator */}
                {searchingDocumentsFor.size > 0 && (
                  <div className="flex items-center space-x-1 text-xs text-blue-400">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400" />
                    <span>{searchingDocumentsFor.size} searching</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-auto m-6">
            <table className="w-full border-collapse">
              {/* Table Header */}
              <thead className="bg-neutral-900 border-b border-neutral-900 sticky top-0 z-10">
                <tr>
                  <th
                    colSpan={6}
                    className="text-white font-semibold text-center py-3 border-r-4 border-r-neutral-700 text-sm bg-neutral-900"
                  >
                    Bank Statement
                  </th>
                  <th
                    colSpan={5}
                    className="text-white font-semibold text-center py-3 text-sm bg-neutral-900"
                  >
                    General Ledger
                  </th>
                </tr>
                <tr className="bg-neutral-900">
                  {/* Bank Statement Columns */}
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 border-r border-neutral-900 text-xs">
                    #
                  </th>
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 border-r border-neutral-900 text-xs">
                    Date
                  </th>
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 border-r border-neutral-900 text-xs">
                    Description
                  </th>
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 border-r border-neutral-900 text-xs">
                    Amount
                  </th>
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 border-r border-neutral-900 text-xs">
                    Type
                  </th>
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 border-r-4 border-r-neutral-700 text-xs">
                    Balance
                  </th>
                  {/* General Ledger Columns */}
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 border-r border-neutral-900 text-xs">
                    #
                  </th>
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 border-r border-neutral-900 text-xs">
                    Date
                  </th>
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 border-r border-neutral-900 text-xs">
                    Account
                  </th>
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 border-r border-neutral-900 text-xs">
                    Debit
                  </th>
                  <th className="text-neutral-200 font-medium text-center py-2 px-3 text-xs">
                    Credit
                  </th>
                </tr>
              </thead>

              {/* Table Body */}
              <tbody className="bg-black">
                {(() => {
                  const rows: React.ReactNode[] = [];
                  const _rowIndex = 0;

                  createGroupedData().forEach((group, groupIndex) => {
                    // Handle unmatched entries section
                    if (
                      group &&
                      typeof group === "object" &&
                      "bankEntries" in group &&
                      "glEntries" in group
                    ) {
                      // Add section header for unmatched
                      rows.push(
                        <tr
                          key="unmatched-header"
                          className="bg-neutral-900 border-t-2 border-neutral-900"
                        >
                          <td
                            colSpan={11}
                            className="text-white font-medium py-2 px-4 text-sm"
                          >
                            Unmatched Entries
                          </td>
                        </tr>,
                      );

                      const bankEntries = group.bankEntries;
                      const glEntries = group.glEntries;
                      const maxEntries = Math.max(
                        bankEntries.length,
                        glEntries.length,
                      );

                      for (let i = 0; i < maxEntries; i++) {
                        const bankEntry = bankEntries[i];
                        const glEntry = glEntries[i]?.glEntries[0];

                        rows.push(
                          <tr
                            key={`unmatched-${i}`}
                            className={`border-b border-neutral-900 hover:bg-neutral-950/50 ${
                              manualMatchMode &&
                              bankEntry &&
                              selectedBankEntry === bankEntry.bankIndex
                                ? "bg-blue-900/20"
                                : ""
                            }`}
                          >
                            {/* Bank Entry Cells */}
                            <td
                              className={`py-2 px-3 text-center text-xs border-r border-neutral-900 ${
                                manualMatchMode && bankEntry
                                  ? selectedBankEntry === bankEntry.bankIndex
                                    ? "text-blue-400 font-bold cursor-pointer bg-blue-900/20"
                                    : "text-neutral-300 hover:text-white cursor-pointer hover:bg-neutral-800/50"
                                  : "text-neutral-300"
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (manualMatchMode && bankEntry) {
                                  console.log(
                                    "🔍 Bank entry clicked:",
                                    bankEntry.bankIndex,
                                  );
                                  selectBankEntry(bankEntry.bankIndex);
                                }
                              }}
                            >
                              {bankEntry
                                ? `${bankEntry.bankIndex}${manualMatchMode && selectedBankEntry === bankEntry.bankIndex ? " ✓" : ""}`
                                : ""}
                            </td>
                            <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900 truncate">
                              {bankEntry?.bankEntry?.Date
                                ? String(bankEntry.bankEntry.Date)
                                : null}
                            </td>
                            <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900 truncate max-w-32">
                              {bankEntry?.bankEntry?.Description
                                ? String(bankEntry.bankEntry.Description)
                                : null}
                            </td>
                            <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900">
                              {bankEntry?.bankEntry?.Amount
                                ? String(bankEntry.bankEntry.Amount)
                                : null}
                            </td>
                            <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900">
                              {bankEntry?.bankEntry?.Type
                                ? String(bankEntry.bankEntry.Type)
                                : null}
                            </td>
                            <td className="py-2 px-3 text-center text-xs text-white border-r-4 border-r-neutral-700">
                              {bankEntry?.bankEntry?.Balance
                                ? String(bankEntry.bankEntry.Balance)
                                : null}
                            </td>

                            {/* GL Entry Cells */}
                            <td
                              className={`py-2 px-3 text-center text-xs border-r border-neutral-900 ${
                                manualMatchMode &&
                                glEntry &&
                                selectedBankEntry !== null
                                  ? selectedGlEntries.includes(glEntry.glIndex)
                                    ? "text-blue-400 font-bold cursor-pointer bg-blue-900/20"
                                    : "text-neutral-300 hover:text-white cursor-pointer hover:bg-neutral-800/50"
                                  : "text-neutral-300"
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (manualMatchMode && glEntry) {
                                  console.log(
                                    "🔍 GL entry clicked:",
                                    glEntry.glIndex,
                                  );
                                  selectGlEntry(glEntry.glIndex);
                                }
                              }}
                            >
                              {glEntry
                                ? `${glEntry.glIndex}${manualMatchMode && selectedGlEntries.includes(glEntry.glIndex) ? " ✓" : ""}`
                                : ""}
                            </td>
                            <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900 truncate">
                              {glEntry?.data["Date (MM/DD/YYYY)"]
                                ? String(glEntry.data["Date (MM/DD/YYYY)"])
                                : glEntry?.data.Date
                                  ? String(glEntry.data.Date)
                                  : null}
                            </td>
                            <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900 truncate max-w-24">
                              {glEntry?.data.Account
                                ? String(glEntry.data.Account)
                                : null}
                            </td>
                            <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900">
                              {glEntry?.data.Debit
                                ? String(glEntry.data.Debit)
                                : null}
                            </td>
                            <td className="py-2 px-3 text-center text-xs text-white">
                              {glEntry?.data.Credit
                                ? String(glEntry.data.Credit)
                                : null}
                            </td>
                          </tr>,
                        );
                      }
                      return;
                    }

                    // Handle regular matched groups
                    if (group.isUnmatchedGl) {
                      return;
                    }

                    const getRowClass = () => {
                      switch (group.groupStyle) {
                        case "approved":
                          return "bg-green-900/20 border-l-4 border-l-green-500";
                        case "high-confidence":
                          return "bg-green-800/20 border-l-4 border-l-green-400";
                        case "low-confidence":
                          return "bg-yellow-800/20 border-l-4 border-l-yellow-400";
                        default:
                          return "bg-neutral-950";
                      }
                    };

                    const _getStatusIcon = () => {
                      switch (group.groupStyle) {
                        case "approved":
                          // Check if this approved match has documents
                          if (matchesWithDocuments.has(group.bankIndex)) {
                            return "✓"; // Approved with documents
                          }
                          return "✓"; // Approved without documents - we'll add a separate indicator
                        case "high-confidence":
                          return "?";
                        case "low-confidence":
                          return "?";
                        default:
                          return "○";
                      }
                    };

                    const rowsNeeded = Math.max(
                      1,
                      group.glEntries ? group.glEntries.length : 0,
                    );
                    const groupId = `group-${groupIndex}`;

                    for (let rowIdx = 0; rowIdx < rowsNeeded; rowIdx++) {
                      const glEntry = group.glEntries?.[rowIdx];
                      const isFirstRow = rowIdx === 0;

                      rows.push(
                        <tr
                          key={`group-${groupIndex}-${rowIdx}`}
                          className={`border-b border-neutral-900 ${group.bankMatch && !updatingMatches.has(group.bankMatch.bankIndex) ? "cursor-pointer" : "cursor-not-allowed"} ${getGroupHoverClass(groupId)} ${
                            isFirstRow
                              ? `${getRowClass()} border-t-2 border-t-neutral-800`
                              : ""
                          } ${group.bankMatch && updatingMatches.has(group.bankMatch.bankIndex) ? "opacity-50" : ""} ${
                            group.groupStyle === "approved" &&
                            !matchesWithDocuments.has(group.bankIndex) &&
                            !searchingDocumentsFor.has(group.bankIndex)
                              ? "bg-amber-50/5 border-l-4 border-l-amber-400"
                              : ""
                          }`}
                          onClick={() =>
                            group.bankMatch &&
                            !updatingMatches.has(group.bankMatch.bankIndex) &&
                            handleCellClick(group.bankMatch)
                          }
                          onMouseEnter={() => handleGroupMouseEnter(groupId)}
                          onMouseLeave={handleGroupMouseLeave}
                        >
                          {/* Bank Entry Cells - only show on first row */}
                          <td
                            className={`py-2 px-3 text-center text-xs text-neutral-300 border-r border-neutral-900 ${!isFirstRow ? "border-l-4 border-l-neutral-600" : ""}`}
                          >
                            {isFirstRow && (
                              <div className="flex items-center justify-center space-x-1">
                                <span>
                                  {group.bankIndex}
                                  {/* Status with descriptive text */}
                                  {group.groupStyle === "approved" && (
                                    <span
                                      className="text-green-400 text-xs ml-1"
                                      title="Approved by user"
                                    >
                                      ✓ approved
                                    </span>
                                  )}
                                  {group.groupStyle === "high-confidence" && (
                                    <span
                                      className="text-yellow-400 text-xs ml-1"
                                      title="High confidence match"
                                    >
                                      ? high conf
                                    </span>
                                  )}
                                  {group.groupStyle === "low-confidence" && (
                                    <span
                                      className="text-orange-400 text-xs ml-1"
                                      title="Low confidence match"
                                    >
                                      ? low conf
                                    </span>
                                  )}
                                  {!group.groupStyle ||
                                    (group.groupStyle !== "approved" &&
                                      group.groupStyle !== "high-confidence" &&
                                      group.groupStyle !== "low-confidence" && (
                                        <span
                                          className="text-neutral-400 text-xs ml-1"
                                          title="Pending review"
                                        >
                                          ○ pending
                                        </span>
                                      ))}
                                </span>
                                {/* Show searching indicator */}
                                {searchingDocumentsFor.has(group.bankIndex) && (
                                  <div className="flex items-center space-x-1 text-blue-400 text-xs">
                                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400" />
                                    <span>searching docs</span>
                                  </div>
                                )}
                                {updatingMatches.has(group.bankIndex) && (
                                  <div className="flex items-center space-x-1 text-blue-400 text-xs">
                                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400" />
                                    <span>updating</span>
                                  </div>
                                )}
                                {matchesWithDocuments.has(group.bankIndex) && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      viewDocumentsForMatch(group.bankIndex);
                                    }}
                                    className="text-blue-400 hover:text-blue-300 text-xs flex items-center space-x-1"
                                    title="View Documents"
                                  >
                                    <span>📄</span>
                                    <span>found docs</span>
                                  </button>
                                )}
                                {/* Show indicator for approved matches without documents */}
                                {group.groupStyle === "approved" &&
                                  !matchesWithDocuments.has(group.bankIndex) &&
                                  !searchingDocumentsFor.has(
                                    group.bankIndex,
                                  ) && (
                                    <span
                                      className="text-amber-400 text-xs flex items-center space-x-1"
                                      title="Approved but no supporting documents found"
                                    >
                                      <span>📄❌</span>
                                      <span>no docs</span>
                                    </span>
                                  )}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900 truncate">
                            {isFirstRow && group.bankEntry?.Date
                              ? String(group.bankEntry.Date)
                              : null}
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900 truncate max-w-32">
                            {isFirstRow && group.bankEntry?.Description
                              ? String(group.bankEntry.Description)
                              : null}
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900">
                            {isFirstRow && group.bankEntry?.Amount
                              ? String(group.bankEntry.Amount)
                              : null}
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900">
                            {isFirstRow && group.bankEntry?.Type
                              ? String(group.bankEntry.Type)
                              : null}
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-white border-r-4 border-r-neutral-700">
                            {isFirstRow && group.bankEntry?.Balance
                              ? String(group.bankEntry.Balance)
                              : null}
                          </td>

                          {/* GL Entry Cells */}
                          <td className="py-2 px-3 text-center text-xs text-neutral-300 border-r border-neutral-900">
                            {glEntry ? glEntry.glIndex : null}
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900 truncate">
                            {glEntry
                              ? glEntry.data["Date (MM/DD/YYYY)"]
                                ? String(glEntry.data["Date (MM/DD/YYYY)"])
                                : glEntry.data.Date
                                  ? String(glEntry.data.Date)
                                  : null
                              : null}
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900 truncate max-w-24">
                            {glEntry
                              ? glEntry.data.Account
                                ? String(glEntry.data.Account)
                                : null
                              : glEntry === undefined &&
                                  group.glEntries?.length === 0
                                ? "No match"
                                : null}
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-white border-r border-neutral-900">
                            {glEntry?.data.Debit
                              ? String(glEntry.data.Debit)
                              : null}
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-white">
                            {glEntry?.data.Credit
                              ? String(glEntry.data.Credit)
                              : null}
                          </td>
                        </tr>,
                      );
                    }
                  });

                  return rows;
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Match Details Modal */}
      {showMatchModal && selectedMatch && currentSession && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowMatchModal(false)}
        >
          <div
            className="bg-neutral-950 rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Subtle Loading Indicator */}
            {selectedMatch && updatingMatches.has(selectedMatch.bankIndex) && (
              <div className="absolute top-4 right-4 z-10">
                <div className="flex items-center space-x-2 bg-neutral-800/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-neutral-700">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
                  <p className="text-neutral-300 text-xs">Updating...</p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-white">Match Review</h3>
              <button
                type="button"
                onClick={() => {
                  setShowMatchModal(false);
                  setSelectedMatch(null);
                }}
                className="text-neutral-400 hover:text-white p-2 rounded-lg hover:bg-neutral-800 transition-colors"
                title="Close modal"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* AI Reasoning - Priority Section */}
              <div>
                <h4 className="text-white font-semibold mb-3 text-lg">
                  AI Reasoning
                </h4>
                <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-lg">
                  <p className="text-blue-100 leading-relaxed">
                    {selectedMatch.reasoning}
                  </p>
                </div>
              </div>

              {/* Document Preview Section */}
              <div>
                <h4 className="text-neutral-300 font-medium mb-2 text-sm">
                  Supporting Documents
                </h4>
                <div className="bg-neutral-900 p-3 rounded">
                  {searchingDocumentsFor.has(selectedMatch.bankIndex) ? (
                    // Loading state when searching for documents
                    <div className="flex items-center space-x-3">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400" />
                      <span className="text-blue-400 text-sm">
                        Searching for documents...
                      </span>
                    </div>
                  ) : matchesWithDocuments.has(selectedMatch.bankIndex) ? (
                    // Show document preview when documents are available
                    <div className="space-y-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-green-400 text-sm">📄</span>
                        <span className="text-green-400 text-sm font-medium">
                          {
                            (
                              documentsByMatch.get(selectedMatch.bankIndex) ||
                              []
                            ).length
                          }{" "}
                          document(s) found
                        </span>
                      </div>
                      <div className="space-y-1">
                        {(documentsByMatch.get(selectedMatch.bankIndex) || [])
                          .slice(0, 2)
                          .map((doc, index) => (
                            <div
                              key={index}
                              className="flex items-center justify-between bg-neutral-800 p-2 rounded text-xs cursor-pointer hover:bg-neutral-700 transition-colors"
                              onClick={() => openDocumentInSidePanel(doc)}
                            >
                              <div className="flex items-center space-x-2">
                                <span className="text-neutral-400">📄</span>
                                <span className="text-white truncate">
                                  {doc.filename || "Document"}
                                </span>
                              </div>
                              {doc.confidence && (
                                <span className="text-green-400 text-xs">
                                  {Math.round(doc.confidence * 100)}%
                                </span>
                              )}
                            </div>
                          ))}
                        {(documentsByMatch.get(selectedMatch.bankIndex) || [])
                          .length > 2 && (
                          <div className="text-neutral-400 text-xs text-center">
                            +
                            {(
                              documentsByMatch.get(selectedMatch.bankIndex) ||
                              []
                            ).length - 2}{" "}
                            more documents
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          viewDocumentsForMatch(selectedMatch.bankIndex)
                        }
                        className="text-blue-400 hover:text-blue-300 text-xs underline"
                      >
                        View all documents
                      </button>
                    </div>
                  ) : selectedMatch.status === "approved" ? (
                    // No documents found state
                    <div className="flex items-center space-x-2">
                      <span className="text-neutral-400 text-sm">📄</span>
                      <span className="text-neutral-400 text-sm">
                        No supporting documents found
                      </span>
                    </div>
                  ) : (
                    // Pending state - documents will be searched after approval
                    <div className="flex items-center space-x-2">
                      <span className="text-neutral-400 text-sm">📄</span>
                      <span className="text-neutral-400 text-sm">
                        Documents will be searched after approval
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Match Information - Compact */}
              <div>
                <h4 className="text-neutral-300 font-medium mb-2 text-sm">
                  Match Information
                </h4>
                <div className="bg-neutral-900 p-3 rounded">
                  <div className="flex justify-between items-center text-sm">
                    <div className="flex items-center space-x-4">
                      <span className="text-white">
                        Bank #{selectedMatch.bankIndex}
                      </span>
                      <span className="text-neutral-400">→</span>
                      <span className="text-white">
                        GL [{selectedMatch.glIndexes.join(", ")}]
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 text-xs">
                      <span className="text-neutral-400">
                        Confidence:{" "}
                        {(selectedMatch.confidence * 100).toFixed(1)}%
                      </span>
                      <span className="text-neutral-400">
                        Status: {selectedMatch.status}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bank Statement Entry - Compact */}
              <div>
                <h4 className="text-neutral-300 font-medium mb-2 text-sm">
                  Bank Statement Entry
                </h4>
                <div className="bg-neutral-900 p-3 rounded">
                  <div className="grid grid-cols-4 gap-3 text-sm">
                    {currentSession.bank_data[selectedMatch.bankIndex] &&
                      Object.entries(
                        currentSession.bank_data[selectedMatch.bankIndex],
                      ).map(([key, value]) => (
                        <div key={key} className="text-center">
                          <span className="text-neutral-400 text-xs block">
                            {key.replace(/_/g, " ").toUpperCase()}
                          </span>
                          <p className="text-white font-medium text-sm">
                            {String(value)}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* General Ledger Entries - Compact */}
              {selectedMatch.glIndexes !== null &&
                selectedMatch.glIndexes.length > 0 && (
                  <div>
                    <h4 className="text-neutral-300 font-medium mb-2 text-sm">
                      General Ledger Entries ({selectedMatch.glIndexes.length})
                    </h4>
                    <div className="space-y-2">
                      {selectedMatch.glIndexes.map((glIndex) => (
                        <div
                          className="bg-neutral-900 p-3 rounded"
                          key={glIndex}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-neutral-400 text-xs">
                              GL Entry #{glIndex}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-3 text-sm">
                            {currentSession.gl_data[glIndex] &&
                              Object.entries(
                                currentSession.gl_data[glIndex],
                              ).map(([key, value]) => (
                                <div key={key} className="text-center">
                                  <span className="text-neutral-400 text-xs block">
                                    {key.replace(/_/g, " ").toUpperCase()}
                                  </span>
                                  <p className="text-white font-medium text-sm">
                                    {String(value)}
                                  </p>
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Action Buttons - Only show if there's a match to approve/reject */}
              {selectedMatch.status === "pending" &&
                selectedMatch.glIndexes.length > 0 && (
                  <div className="flex space-x-4 pt-4">
                    <button
                      type="button"
                      onClick={() =>
                        updateMatchStatus(selectedMatch.bankIndex, "approved")
                      }
                      disabled={
                        selectedMatch &&
                        updatingMatches.has(selectedMatch.bankIndex)
                      }
                      className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:bg-neutral-700 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center space-x-2"
                    >
                      {selectedMatch &&
                      updatingMatches.has(selectedMatch.bankIndex) ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <span>✓</span>
                          <span>Approve Match</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateMatchStatus(selectedMatch.bankIndex, "rejected")
                      }
                      disabled={
                        selectedMatch &&
                        updatingMatches.has(selectedMatch.bankIndex)
                      }
                      className="flex-1 bg-red-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-red-700 disabled:bg-neutral-700 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center space-x-2"
                    >
                      {selectedMatch &&
                      updatingMatches.has(selectedMatch.bankIndex) ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <span>✗</span>
                          <span>Reject Match</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMatchModal(false);
                        setSelectedMatch(null);
                      }}
                      className="px-4 py-3 bg-neutral-700 text-white rounded-lg font-medium hover:bg-neutral-600 transition-all duration-200"
                      title="Close modal (Escape)"
                    >
                      Cancel
                    </button>
                  </div>
                )}

              {/* No Match Message */}
              {selectedMatch.status === "pending" &&
                selectedMatch.glIndexes.length === 0 && (
                  <div className="pt-4">
                    <div className="p-4 rounded-lg bg-neutral-900 border border-neutral-900">
                      <div className="flex items-center space-x-2">
                        <span className="text-neutral-400 text-xl">ℹ️</span>
                        <span className="text-neutral-300">
                          No match suggested by AI. This transaction requires
                          manual review or additional data.
                        </span>
                      </div>
                    </div>
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

      {/* Document Upload Modal */}
      {showDocumentUpload && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-950 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto relative">
            {/* Loading Overlay */}
            {isUploadingDocuments && (
              <div className="absolute inset-0 bg-neutral-950/80 rounded-lg flex items-center justify-center z-10">
                <div className="flex flex-col items-center space-y-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
                  <p className="text-neutral-300 text-sm">
                    Uploading documents...
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-white">
                Upload Financial Documents
              </h3>
              <button
                type="button"
                onClick={() => setShowDocumentUpload(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <p className="text-neutral-300 text-sm mb-4">
                  Upload PDF documents (invoices, receipts, statements) to
                  enhance the reconciliation process.
                </p>

                <div
                  {...documentDropzone.getRootProps()}
                  className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                    documentDropzone.isDragActive
                      ? "border-purple-400 bg-purple-900/20"
                      : "border-neutral-900 hover:border-neutral-700"
                  }`}
                >
                  <input {...documentDropzone.getInputProps()} />
                  <div className="space-y-3">
                    <div className="text-4xl">📄</div>
                    <div>
                      <p className="text-white font-medium">
                        {documentDropzone.isDragActive
                          ? "Drop your PDF documents here"
                          : "Drag & drop PDF documents here, or click to select"}
                      </p>
                      <p className="text-neutral-400 text-sm mt-1">
                        Supports PDF files only
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Uploaded Documents List */}
              {uploadedDocuments.length > 0 && (
                <div>
                  <h4 className="text-lg font-medium text-white mb-3">
                    Selected Documents
                  </h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {uploadedDocuments.map((file, index) => (
                      <div
                        key={index}
                        className="bg-neutral-900 rounded p-3 flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-3">
                          <span className="text-neutral-400">📄</span>
                          <div>
                            <p className="text-white text-sm font-medium">
                              {file.name}
                            </p>
                            <p className="text-neutral-400 text-xs">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeDocument(index)}
                          className="text-neutral-400 hover:text-white"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex space-x-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowDocumentUpload(false)}
                  className="flex-1 bg-neutral-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-neutral-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={uploadDocuments}
                  disabled={
                    uploadedDocuments.length === 0 || isUploadingDocuments
                  }
                  className="flex-1 bg-purple-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-purple-700 disabled:bg-neutral-900 disabled:cursor-not-allowed transition-colors"
                >
                  {isUploadingDocuments
                    ? "Uploading..."
                    : `Upload ${uploadedDocuments.length} Document${uploadedDocuments.length !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manual Match Explanation Modal */}
      {showExplanationModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-950 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto relative">
            {/* Loading Overlay */}
            {isCreatingManualMatch && (
              <div className="absolute inset-0 bg-neutral-950/80 rounded-lg flex items-center justify-center z-10">
                <div className="flex flex-col items-center space-y-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400" />
                  <p className="text-neutral-300 text-sm">
                    Creating manual match...
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-white">
                Explain Manual Match
              </h3>
              <button
                type="button"
                onClick={() => setShowExplanationModal(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              <div>
                <p className="text-neutral-300 text-sm mb-4">
                  Please explain what to look for to find the supporting
                  document for this match between Bank #{selectedBankEntry} and
                  GL entries [{selectedGlEntries.join(", ")}].
                </p>

                <div className="space-y-3">
                  <div className="bg-neutral-900 p-3 rounded">
                    <h4 className="text-sm font-medium text-white mb-2">
                      Selected Bank Entry #{selectedBankEntry}
                    </h4>
                    {currentSession?.bank_data &&
                      selectedBankEntry !== null &&
                      currentSession.bank_data[selectedBankEntry] && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {Object.entries(
                            currentSession.bank_data[selectedBankEntry],
                          )
                            .slice(0, 4)
                            .map(([key, value]) => (
                              <div key={key}>
                                <span className="text-neutral-400 text-xs block">
                                  {key.replace(/_/g, " ").toUpperCase()}
                                </span>
                                <span className="text-white text-xs">
                                  {String(value)}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                  </div>

                  <div className="bg-neutral-900 p-3 rounded">
                    <h4 className="text-sm font-medium text-white mb-2">
                      Selected GL Entries [{selectedGlEntries.join(", ")}]
                    </h4>
                    {selectedGlEntries.map((glIndex) => (
                      <div key={glIndex} className="mb-2 last:mb-0">
                        <span className="text-neutral-400 text-xs">
                          GL #{glIndex}:
                        </span>
                        {currentSession?.gl_data[glIndex] && (
                          <div className="grid grid-cols-2 gap-2 text-xs mt-1">
                            {Object.entries(currentSession.gl_data[glIndex])
                              .slice(0, 4)
                              .map(([key, value]) => (
                                <div key={key}>
                                  <span className="text-neutral-400 text-xs block">
                                    {key.replace(/_/g, " ").toUpperCase()}
                                  </span>
                                  <span className="text-white text-xs">
                                    {String(value)}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label
                  htmlFor="explanation"
                  className="block text-sm font-medium text-white mb-2"
                >
                  Explanation *
                </label>
                <textarea
                  id="explanation"
                  value={explanationText}
                  onChange={(e) => setExplanationText(e.target.value)}
                  placeholder="Describe what to look for in the supporting document (e.g., vendor name, invoice number, date, amount, purpose of transaction, etc.)"
                  className="w-full h-32 px-3 py-2 bg-neutral-900 border border-neutral-900 rounded-lg text-white placeholder-neutral-400 focus:outline-none focus:border-blue-400 resize-none"
                  required
                />
                <p className="text-neutral-400 text-xs mt-1">
                  This explanation will help the AI find the relevant supporting
                  document.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowExplanationModal(false)}
                  className="flex-1 bg-neutral-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-neutral-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={createManualMatch}
                  disabled={!explanationText.trim() || isCreatingManualMatch}
                  className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 disabled:bg-neutral-900 disabled:cursor-not-allowed transition-colors"
                >
                  {isCreatingManualMatch
                    ? "Creating..."
                    : "Create Manual Match"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Documents Display Modal */}
      {showDocuments && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-950 rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto relative">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-white">
                Matching Documents
              </h3>
              <button
                type="button"
                onClick={() => setShowDocuments(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-6">
              {matchingDocuments.length > 0 ? (
                <>
                  <p className="text-neutral-300 text-sm">
                    Found {matchingDocuments.length} document(s) that match this
                    transaction:
                  </p>
                  {matchingDocuments.map((doc, index) => (
                    <div
                      key={index}
                      className="bg-neutral-900 rounded-lg p-4 cursor-pointer hover:bg-neutral-800 transition-colors"
                      onClick={() => openDocumentInSidePanel(doc)}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-white font-medium flex items-center">
                          📄 {doc.filename || "Unknown Document"}
                        </h4>
                        <div className="flex items-center space-x-2">
                          {doc.confidence && (
                            <span className="text-xs bg-green-600 px-2 py-1 rounded">
                              {Math.round(doc.confidence * 100)}% confident
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => downloadDocument(doc)}
                            className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700 transition-colors"
                          >
                            ⬇️ Download
                          </button>
                        </div>
                      </div>

                      {doc.extraction && (
                        <div className="bg-neutral-900 rounded p-3">
                          <h5 className="text-white text-sm font-medium mb-2">
                            Document Details:
                          </h5>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            {Object.entries(doc.extraction).map(
                              ([key, value]) => (
                                <div key={key}>
                                  <span className="text-neutral-400 text-xs block">
                                    {key.replace(/_/g, " ").toUpperCase()}:
                                  </span>
                                  <span className="text-white">
                                    {String(value)}
                                  </span>
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      )}

                      {doc.processing_notes && (
                        <div className="mt-2 text-neutral-400 text-sm">
                          {doc.processing_notes}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="text-neutral-500 text-4xl mb-2">📄</div>
                  <p className="text-neutral-400">
                    No matching documents found for this transaction.
                  </p>
                  <p className="text-neutral-500 text-sm mt-1">
                    You may need to upload relevant documents first.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 mt-6 border-t border-neutral-900">
              <button
                type="button"
                onClick={() => setShowDocuments(false)}
                className="bg-neutral-900 text-white px-6 py-2 rounded-lg font-medium hover:bg-neutral-800 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Side Panel */}
      {showDocumentSidePanel && selectedDocument && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-end z-50">
          <div className="bg-neutral-950 border-l border-neutral-800 w-full max-w-2xl h-full overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-neutral-950 border-b border-neutral-800 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white flex items-center">
                  📄 {selectedDocument.filename || "Document"}
                </h3>
                <button
                  type="button"
                  onClick={closeDocumentSidePanel}
                  className="text-neutral-400 hover:text-white text-xl"
                >
                  ✕
                </button>
              </div>
              {selectedDocument.confidence && (
                <div className="mt-2">
                  <span className="text-xs bg-green-600 px-2 py-1 rounded text-white">
                    {Math.round(selectedDocument.confidence * 100)}% confident
                    match
                  </span>
                </div>
              )}
            </div>

            {/* Document Content */}
            <div className="p-4 space-y-6">
              {/* Document Preview */}
              <div>
                <h4 className="text-white font-medium mb-3">
                  Document Preview
                </h4>
                <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
                  <div className="text-center py-8">
                    <div className="text-6xl mb-4">📄</div>
                    <p className="text-neutral-300 mb-2">
                      {selectedDocument.filename || "Document"}
                    </p>
                    <p className="text-neutral-400 text-sm">PDF Document</p>
                    <button
                      type="button"
                      onClick={() => downloadDocument(selectedDocument)}
                      className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                    >
                      ⬇️ Download Document
                    </button>
                  </div>
                </div>
              </div>

              {/* Document Details */}
              {selectedDocument.extraction && (
                <div>
                  <h4 className="text-white font-medium mb-3">
                    Extracted Information
                  </h4>
                  <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
                    <div className="grid grid-cols-1 gap-3">
                      {Object.entries(selectedDocument.extraction).map(
                        ([key, value]) => (
                          <div
                            key={key}
                            className="flex justify-between items-start"
                          >
                            <span className="text-neutral-400 text-sm font-medium">
                              {key.replace(/_/g, " ").toUpperCase()}:
                            </span>
                            <span className="text-white text-sm text-right max-w-xs break-words">
                              {String(value)}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Processing Notes */}
              {selectedDocument.processing_notes && (
                <div>
                  <h4 className="text-white font-medium mb-3">
                    Processing Notes
                  </h4>
                  <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
                    <p className="text-neutral-300 text-sm">
                      {selectedDocument.processing_notes}
                    </p>
                  </div>
                </div>
              )}

              {/* Rejection Section */}
              <div>
                <h4 className="text-white font-medium mb-3">
                  Document Actions
                </h4>
                <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
                  {/* Queue Status */}
                  {rejectionQueue.length > 0 && (
                    <div className="mb-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                        <span className="text-blue-400 text-sm font-medium">
                          {
                            rejectionQueue.filter(
                              (item) => item.status === "processing",
                            ).length
                          }{" "}
                          processing,{" "}
                          {
                            rejectionQueue.filter(
                              (item) => item.status === "pending",
                            ).length
                          }{" "}
                          queued
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label
                        htmlFor="rejection-comment"
                        className="block text-sm font-medium text-white mb-2"
                      >
                        Reject Document (with reason)
                      </label>
                      <textarea
                        id="rejection-comment"
                        value={rejectionComment}
                        onChange={(e) => setRejectionComment(e.target.value)}
                        placeholder="Explain why this document doesn't match the transaction (e.g., wrong vendor, different amount, incorrect date, etc.)"
                        className="w-full h-24 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-white placeholder-neutral-400 focus:outline-none focus:border-red-400 resize-none"
                      />
                    </div>
                    <div className="flex space-x-3">
                      <button
                        type="button"
                        onClick={rejectDocument}
                        disabled={!rejectionComment.trim() || isProcessingQueue}
                        className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 disabled:bg-neutral-700 disabled:cursor-not-allowed transition-colors"
                      >
                        {isProcessingQueue
                          ? "Processing Queue..."
                          : "✗ Reject & Re-search"}
                      </button>
                      <button
                        type="button"
                        onClick={closeDocumentSidePanel}
                        className="px-4 py-2 bg-neutral-700 text-white rounded-lg font-medium hover:bg-neutral-600 transition-colors"
                      >
                        Close
                      </button>
                    </div>
                    <p className="text-neutral-400 text-xs">
                      Rejecting this document will trigger a new search for
                      better matching documents.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
