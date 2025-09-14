"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";


interface UploadedDocument {
  file: File;
  id: string;
  status: "pending" | "processing" | "completed" | "error";
  result?: {
    extraction: {
      seller: string;
      customer: string;
      date: string;
      amount: number;
      invoice_number: string;
      description: string;
    };
    processing_notes: string;
    saved_to?: string;
  };
  error?: string;
}

interface ProcessingProgress {
  total: number;
  completed: number;
  failed: number;
  current?: string;
}



export default function ReconciliationPage() {
  // Bulk upload state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedDocument[]>([]);
  const [isProcessingDocuments, setIsProcessingDocuments] = useState(false);
  const [progress, setProgress] = useState<ProcessingProgress>({
    total: 0,
    completed: 0,
    failed: 0,
  });
  const [showResults, setShowResults] = useState(false);
  const [activeTab, setActiveTab] = useState<"bulk-upload">(
    "bulk-upload",
  );


  // Bulk upload functions
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: UploadedDocument[] = acceptedFiles.map((file) => ({
      file,
      id: Math.random().toString(36).substr(2, 9),
      status: "pending",
    }));

    setUploadedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpeg"],
    },
    multiple: true,
  });

  const removeFile = (id: string) => {
    setUploadedFiles((prev) => prev.filter((file) => file.id !== id));
  };

  const processDocuments = async () => {
    if (uploadedFiles.length === 0) return;

    setIsProcessingDocuments(true);
    setProgress({ total: uploadedFiles.length, completed: 0, failed: 0 });
    setShowResults(false);

    for (let i = 0; i < uploadedFiles.length; i++) {
      const uploadedDoc = uploadedFiles[i];

      // Update current file being processed
      setProgress((prev) => ({
        ...prev,
        current: uploadedDoc.file.name,
      }));

      // Update file status to processing
      const updatedDoc = { ...uploadedDoc, status: "processing" as const };
      setUploadedFiles((prev) =>
        prev.map((doc) => (doc.id === uploadedDoc.id ? updatedDoc : doc)),
      );

      try {
        const formData = new FormData();
        formData.append("document", uploadedDoc.file);

        const response = await fetch("/api/process-document", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Update with successful result
        const completedDoc = {
          ...uploadedDoc,
          status: "completed" as const,
          result: data,
        };

        setUploadedFiles((prev) =>
          prev.map((doc) => (doc.id === uploadedDoc.id ? completedDoc : doc)),
        );

        setProgress((prev) => ({
          ...prev,
          completed: prev.completed + 1,
        }));
      } catch (error) {
        const errorDoc = {
          ...uploadedDoc,
          status: "error" as const,
          error: error instanceof Error ? error.message : "Unknown error",
        };

        setUploadedFiles((prev) =>
          prev.map((doc) => (doc.id === uploadedDoc.id ? errorDoc : doc)),
        );

        setProgress((prev) => ({
          ...prev,
          failed: prev.failed + 1,
        }));
      }
    }

    setIsProcessingDocuments(false);
    setShowResults(true);
    setProgress((prev) => ({ ...prev, current: undefined }));
  };

  const clearAll = () => {
    setUploadedFiles([]);
    setProgress({ total: 0, completed: 0, failed: 0 });
    setShowResults(false);
  };

  const downloadResults = () => {
    const successfulResults = uploadedFiles
      .filter((doc) => doc.status === "completed" && doc.result)
      .map((doc) => {
        if (!doc.result) return null;
        return {
          filename: doc.file.name,
          extraction: doc.result.extraction,
          processing_notes: doc.result.processing_notes,
        };
      })
      .filter((result) => result !== null);

    const dataStr = JSON.stringify(successfulResults, null, 2);
    const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;

    const exportFileDefaultName = `bulk_upload_results_${new Date().toISOString().split("T")[0]}.json`;

    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "text-yellow-400";
      case "processing":
        return "text-blue-400";
      case "completed":
        return "text-green-400";
      case "error":
        return "text-red-400";
      default:
        return "text-slate-400";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return "⏳";
      case "processing":
        return "🔄";
      case "completed":
        return "✅";
      case "error":
        return "❌";
      default:
        return "📄";
    }
  };

  return (
    <div className="min-h-screen bg-black p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-6">
            Financial Tools
          </h1>

          {/* Tab Navigation */}
          <div className="flex space-x-4 mb-6">
            <button
              type="button"
              onClick={() => setActiveTab("bulk-upload")}
              className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                activeTab === "bulk-upload"
                  ? "bg-green-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              Bulk Document Upload
            </button>
            <a
              href="/reconciliation/agent"
              className="px-6 py-3 rounded-lg font-medium transition-colors bg-purple-600 text-white hover:bg-purple-700"
            >
              🤖 AI Agent Chat
            </a>
          </div>
        </div>


        {/* Bulk Upload Content */}
        <div>
            {/* Upload Area */}
            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-600 mb-6">
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
                  <div className="text-6xl">💻</div>
                  <div>
                    <p className="text-xl text-white font-medium">
                      {isDragActive
                        ? "Drop your invoices and receipts here"
                        : "Upload all your invoices and receipts here"}
                    </p>
                    <p className="text-slate-400 mt-2">
                      Drag & drop PDF or PNG files or click to select multiple files
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* File List */}
            {uploadedFiles.length > 0 && (
              <div className="bg-slate-800 rounded-2xl p-6 border border-slate-600 mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-white">
                    Uploaded Files ({uploadedFiles.length})
                  </h2>
                  <div className="space-x-3">
                    <button
                      type="button"
                      onClick={clearAll}
                      disabled={isProcessingDocuments}
                      className="px-4 py-2 text-slate-300 hover:text-white disabled:opacity-50"
                    >
                      Clear All
                    </button>
                    <button
                      type="button"
                      onClick={processDocuments}
                      disabled={
                        isProcessingDocuments || uploadedFiles.length === 0
                      }
                      className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors"
                    >
                      {isProcessingDocuments
                        ? "Processing..."
                        : "Process All Documents"}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {uploadedFiles.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-4 bg-slate-700 rounded-lg"
                    >
                      <div className="flex items-center space-x-4">
                        <span className="text-2xl">📄</span>
                        <div>
                          <p className="text-white font-medium">
                            {doc.file.name}
                          </p>
                          <p className="text-slate-400 text-sm">
                            {formatFileSize(doc.file.size)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="flex items-center space-x-2">
                          <span className="text-lg">
                            {getStatusIcon(doc.status)}
                          </span>
                          <span
                            className={`font-medium ${getStatusColor(doc.status)}`}
                          >
                            {doc.status.charAt(0).toUpperCase() +
                              doc.status.slice(1)}
                          </span>
                        </div>
                        {doc.status === "pending" && (
                          <button
                            type="button"
                            onClick={() => removeFile(doc.id)}
                            className="text-red-400 hover:text-red-300"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Progress */}
            {isProcessingDocuments && (
              <div className="bg-slate-800 rounded-2xl p-6 border border-slate-600 mb-6">
                <h3 className="text-xl font-bold text-white mb-4">
                  Processing Progress
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between text-white">
                    <span>
                      Progress: {progress.completed + progress.failed} /{" "}
                      {progress.total}
                    </span>
                    <span>
                      {progress.current && `Processing: ${progress.current}`}
                    </span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-3">
                    <div
                      className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                      style={{
                        width: `${((progress.completed + progress.failed) / progress.total) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-green-400">
                      ✅ Completed: {progress.completed}
                    </span>
                    <span className="text-red-400">
                      ❌ Failed: {progress.failed}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Results */}
            {showResults && (
              <div className="bg-slate-800 rounded-2xl p-6 border border-slate-600">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-bold text-white">
                    Processing Results
                  </h3>
                  <button
                    type="button"
                    onClick={downloadResults}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition-colors"
                  >
                    Download Results
                  </button>
                </div>

                <div className="grid gap-4">
                  {uploadedFiles
                    .filter((doc) => doc.status === "completed")
                    .map((doc) => (
                      <div key={doc.id} className="bg-slate-700 rounded-lg p-4">
                        <h4 className="text-white font-medium mb-3">
                          {doc.file.name}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-slate-400">Seller:</span>
                            <p className="text-white">
                              {doc.result?.extraction?.seller || "N/A"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Customer:</span>
                            <p className="text-white">
                              {doc.result?.extraction?.customer || "N/A"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Date:</span>
                            <p className="text-white">
                              {doc.result?.extraction?.date || "N/A"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Amount:</span>
                            <p className="text-white">
                              {doc.result?.extraction?.amount
                                ? `$${doc.result.extraction.amount}`
                                : "N/A"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Invoice #:</span>
                            <p className="text-white">
                              {doc.result?.extraction?.invoice_number || "N/A"}
                            </p>
                          </div>
                          <div>
                            <span className="text-slate-400">Description:</span>
                            <p className="text-white">
                              {doc.result?.extraction?.description || "N/A"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>

                {uploadedFiles.filter((doc) => doc.status === "error").length >
                  0 && (
                  <div className="mt-6">
                    <h4 className="text-red-400 font-medium mb-3">
                      Failed Documents
                    </h4>
                    <div className="space-y-2">
                      {uploadedFiles
                        .filter((doc) => doc.status === "error")
                        .map((doc) => (
                          <div
                            key={doc.id}
                            className="bg-red-900/30 border border-red-600/50 rounded-lg p-3"
                          >
                            <p className="text-red-200 font-medium">
                              {doc.file.name}
                            </p>
                            <p className="text-red-300 text-sm">{doc.error}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {uploadedFiles.length === 0 && (
              <div className="text-center text-slate-400 mt-16 text-lg">
                Upload your invoices and receipts to get started with bulk reconciliation
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
