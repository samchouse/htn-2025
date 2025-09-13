"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";

interface BankTransaction {
  date: string;
  description: string;
  amount: number;
  balance: number;
}

interface GLTransaction {
  date: string;
  account: string;
  description: string;
  debit: number;
  credit: number;
}

interface BankMatchData {
  bank_index: number;
  gl_index: number | null;
  confidence: number;
}

interface APIReconciliationResult {
  bank_matches: BankMatchData[];
}

interface ReconciliationResult {
  matched_transactions: Array<{
    bank_transaction: any;
    gl_transaction: any;
    confidence: number;
    bank_index: number;
    gl_index: number | null;
  }>;
  unmatched_bank: any[];
  unmatched_gl: any[];
  summary: {
    total_matched: number;
    total_unmatched_bank: number;
    total_unmatched_gl: number;
  };
}

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

function DataTable<T>({
  data,
  columns,
  title,
  matchedIndices = new Set(),
  side,
  result,
}: {
  data: T[];
  columns: ColumnDef<T, any>[];
  title: string;
  matchedIndices?: Set<number>;
  side: "bank" | "ledger";
  result?: ReconciliationResult | null;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const getRowClassName = (rowIndex: number) => {
    const baseClasses = "border-b border-slate-600";

    if (matchedIndices.has(rowIndex)) {
      return `${baseClasses} bg-green-700/50 hover:bg-green-600/60`;
    }
    return `${baseClasses} bg-red-800/50 hover:bg-red-700/60`;
  };

  const getMatchForRow = (rowIndex: number) => {
    if (!result || side === "ledger") return null;
    return result.matched_transactions.find(
      (match) => match.bank_index === rowIndex,
    );
  };

  const roundedClass =
    side === "bank"
      ? "rounded-l-3xl"
      : "rounded-r-3xl border-l-2 border-slate-600";

  return (
    <div className={`flex-1 ${roundedClass} overflow-hidden`}>
      <div className="bg-slate-800 text-white px-6 py-4 border-b-2 border-slate-500">
        <h2 className="text-xl font-bold">{title}</h2>
      </div>
      <div className="overflow-auto max-h-[600px] bg-slate-900">
        <table className="w-full">
          <thead className="bg-slate-700 text-white sticky top-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-4 text-left font-semibold border-b border-slate-600 text-sm"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
                {side === "bank" && (
                  <th className="px-4 py-4 text-left font-semibold border-b border-slate-600 text-sm w-12">
                    ...
                  </th>
                )}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, index) => (
              <tr key={row.id} className={getRowClassName(index)}>
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className="px-4 py-4 border-r border-slate-600 last:border-r-0 text-slate-100 text-sm h-12"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
                {side === "bank" && (
                  <td className="px-4 py-4 text-slate-100 text-sm w-12 text-center h-12">
                    {getMatchForRow(index) && (
                      <span className="text-slate-300 font-bold text-lg cursor-pointer hover:text-white">
                        More
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseCSV(csvText: string): any[] {
  const lines = csvText.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/"/g, ""));
    const row: any = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return row;
  });
}

function transformAPIResult(
  apiResult: APIReconciliationResult,
  bankData: any[],
  glData: any[],
): ReconciliationResult {
  const matched_transactions = apiResult.bank_matches
    .filter((match) => match.gl_index !== null)
    .map((match) => ({
      bank_transaction: bankData[match.bank_index] || null,
      gl_transaction:
        match.gl_index !== null ? glData[match.gl_index] || null : null,
      confidence: match.confidence,
      bank_index: match.bank_index,
      gl_index: match.gl_index,
    }));

  const matched_bank_indices = new Set(
    matched_transactions.map((t) => t.bank_index),
  );
  const matched_gl_indices = new Set(
    matched_transactions.map((t) => t.gl_index).filter((idx) => idx !== null),
  );

  const unmatched_bank = bankData.filter(
    (_, index) => !matched_bank_indices.has(index),
  );
  const unmatched_gl = glData.filter(
    (_, index) => !matched_gl_indices.has(index),
  );

  return {
    matched_transactions,
    unmatched_bank,
    unmatched_gl,
    summary: {
      total_matched: matched_transactions.length,
      total_unmatched_bank: unmatched_bank.length,
      total_unmatched_gl: unmatched_gl.length,
    },
  };
}

export default function ReconciliationPage() {
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [glFile, setGLFile] = useState<File | null>(null);
  const [bankData, setBankData] = useState<any[]>([]);
  const [glData, setGLData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bulk upload state
  const [uploadedFiles, setUploadedFiles] = useState<UploadedDocument[]>([]);
  const [isProcessingDocuments, setIsProcessingDocuments] = useState(false);
  const [progress, setProgress] = useState<ProcessingProgress>({
    total: 0,
    completed: 0,
    failed: 0,
  });
  const [showResults, setShowResults] = useState(false);
  const [activeTab, setActiveTab] = useState<"reconciliation" | "bulk-upload">(
    "reconciliation",
  );

  const handleBankFileChange = async (file: File | null) => {
    setBankFile(file);
    if (file) {
      try {
        const text = await file.text();
        const data = parseCSV(text);
        setBankData(data);
      } catch (err) {
        setError("Error parsing bank statement file");
        setBankData([]);
      }
    } else {
      setBankData([]);
    }
  };

  const handleGLFileChange = async (file: File | null) => {
    setGLFile(file);
    if (file) {
      try {
        const text = await file.text();
        const data = parseCSV(text);
        setGLData(data);
      } catch (err) {
        setError("Error parsing general ledger file");
        setGLData([]);
      }
    } else {
      setGLData([]);
    }
  };

  const bankColumns = useMemo(() => {
    if (bankData.length === 0) return [];
    const keys = Object.keys(bankData[0]);
    return keys.map((key) => ({
      accessorKey: key,
      header: key,
      cell: (info: any) => info.getValue(),
    }));
  }, [bankData]);

  const glColumns = useMemo(() => {
    if (glData.length === 0) return [];
    const keys = Object.keys(glData[0]);
    return keys.map((key) => ({
      accessorKey: key,
      header: key,
      cell: (info: any) => info.getValue(),
    }));
  }, [glData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bankFile || !glFile) {
      setError("Please select both bank statement and general ledger files");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("bank_statement", bankFile);
      formData.append("general_ledger", glFile);

      const response = await fetch("/api/reconcile", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Transform API response to match frontend expectations
      const apiResult: APIReconciliationResult = data.reconciliation;
      const transformedResult = transformAPIResult(apiResult, bankData, glData);
      setResult(transformedResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

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
              onClick={() => setActiveTab("reconciliation")}
              className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                activeTab === "reconciliation"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              Bank Reconciliation
            </button>
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
          </div>
        </div>

        {/* Reconciliation Tab Content */}
        {activeTab === "reconciliation" && (
          <>
            {/* File Upload Form */}
            <div className="bg-slate-800 rounded-2xl p-6 border border-slate-600">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="space-y-3">
                  <label
                    htmlFor="bank-file"
                    className="block text-lg font-medium text-white"
                  >
                    Bank Statement (CSV)
                  </label>
                  <div className="relative">
                    <input
                      id="bank-file"
                      type="file"
                      accept=".csv"
                      onChange={(e) =>
                        handleBankFileChange(e.target.files?.[0] || null)
                      }
                      className="w-full px-4 py-3 border border-slate-500 rounded-lg bg-slate-700 text-white file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                    />
                    {bankFile && (
                      <div className="mt-2 text-sm text-slate-300">
                        Selected: {bankFile.name}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <label
                    htmlFor="gl-file"
                    className="block text-lg font-medium text-white"
                  >
                    General Ledger (CSV)
                  </label>
                  <div className="relative">
                    <input
                      id="gl-file"
                      type="file"
                      accept=".csv"
                      onChange={(e) =>
                        handleGLFileChange(e.target.files?.[0] || null)
                      }
                      className="w-full px-4 py-3 border border-slate-500 rounded-lg bg-slate-700 text-white file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                    />
                    {glFile && (
                      <div className="mt-2 text-sm text-slate-300">
                        Selected: {glFile.name}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isLoading || !bankFile || !glFile}
                className="bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed transition-colors duration-200 min-w-[140px]"
              >
                {isLoading ? "Processing..." : "Reconcile Files"}
              </button>
            </div>

            {error && (
              <div className="mt-6 p-4 bg-red-900/30 border border-red-600/50 text-red-200 rounded-lg">
                {error}
              </div>
            )}

            {/* Main Tables - NO GAP BETWEEN THEM */}
            {(bankData.length > 0 || glData.length > 0) && (
              <div className="flex rounded-3xl overflow-hidden border-2 border-slate-500">
                <DataTable
                  data={bankData}
                  columns={bankColumns}
                  title="Bank statement"
                  matchedIndices={
                    result
                      ? new Set(
                          result.matched_transactions.map((t) => t.bank_index),
                        )
                      : new Set()
                  }
                  side="bank"
                  result={result}
                />
                <DataTable
                  data={glData}
                  columns={glColumns}
                  title="Ledger"
                  matchedIndices={
                    result
                      ? new Set(
                          result.matched_transactions
                            .map((t) => t.gl_index)
                            .filter((idx) => idx !== null),
                        )
                      : new Set()
                  }
                  side="ledger"
                />
              </div>
            )}

            {bankData.length === 0 && glData.length === 0 && !isLoading && (
              <div className="text-center text-slate-400 mt-16 text-lg">
                Upload your bank statement and general ledger files to view the
                data
              </div>
            )}
          </>
        )}

        {/* Bulk Upload Tab Content */}
        {activeTab === "bulk-upload" && (
          <>
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
                  <div className="text-6xl">📄</div>
                  <div>
                    <p className="text-xl text-white font-medium">
                      {isDragActive
                        ? "Drop your PDF files here"
                        : "Drag & drop PDF files here, or click to select"}
                    </p>
                    <p className="text-slate-400 mt-2">
                      Supports multiple PDF files (invoices, receipts, etc.)
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
                Upload PDF documents to get started with bulk processing
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
