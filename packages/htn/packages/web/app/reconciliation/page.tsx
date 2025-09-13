"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";

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

  return (
    <div className="min-h-screen bg-black p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-6">
            Bank Reconciliation
          </h1>

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
        </div>

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
            Upload your bank statement and general ledger files to view the data
          </div>
        )}
      </div>
    </div>
  );
}
