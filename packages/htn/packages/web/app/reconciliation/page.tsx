'use client';

import { useState, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type ColumnDef,
} from '@tanstack/react-table';

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
  title
}: {
  data: T[];
  columns: ColumnDef<T, any>[];
  title: string;
}) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="flex-1 border border-gray-300 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 font-semibold border-b border-gray-300">
        {title}
      </div>
      <div className="overflow-auto max-h-96">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 sticky top-0">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2 text-left font-medium text-gray-700 border-b border-gray-300"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-gray-50 border-b border-gray-200">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 border-r border-gray-200 last:border-r-0">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function parseCSV(csvText: string): any[] {
  const lines = csvText.split('\n').filter(line => line.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
    const row: any = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

function transformAPIResult(
  apiResult: APIReconciliationResult,
  bankData: any[],
  glData: any[]
): ReconciliationResult {
  const matched_transactions = apiResult.bank_matches
    .filter(match => match.gl_index !== null)
    .map(match => ({
      bank_transaction: bankData[match.bank_index] || null,
      gl_transaction: match.gl_index !== null ? glData[match.gl_index] || null : null,
      confidence: match.confidence,
      bank_index: match.bank_index,
      gl_index: match.gl_index,
    }));

  const matched_bank_indices = new Set(matched_transactions.map(t => t.bank_index));
  const matched_gl_indices = new Set(
    matched_transactions.map(t => t.gl_index).filter(idx => idx !== null)
  );

  const unmatched_bank = bankData.filter((_, index) => !matched_bank_indices.has(index));
  const unmatched_gl = glData.filter((_, index) => !matched_gl_indices.has(index));

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
        setError('Error parsing bank statement file');
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
        setError('Error parsing general ledger file');
        setGLData([]);
      }
    } else {
      setGLData([]);
    }
  };

  const bankColumns = useMemo(() => {
    if (bankData.length === 0) return [];
    const keys = Object.keys(bankData[0]);
    return keys.map(key => ({
      accessorKey: key,
      header: key,
      cell: (info: any) => info.getValue(),
    }));
  }, [bankData]);

  const glColumns = useMemo(() => {
    if (glData.length === 0) return [];
    const keys = Object.keys(glData[0]);
    return keys.map(key => ({
      accessorKey: key,
      header: key,
      cell: (info: any) => info.getValue(),
    }));
  }, [glData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!bankFile || !glFile) {
      setError('Please select both bank statement and general ledger files');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('bank_statement', bankFile);
      formData.append('general_ledger', glFile);

      const response = await fetch('/api/reconcile', {
        method: 'POST',
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
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <h1 className="text-3xl font-bold mb-6">Bank Reconciliation</h1>

      <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 rounded-lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label htmlFor="bank-file" className="block text-sm font-medium text-gray-700 mb-2">
              Bank Statement (CSV)
            </label>
            <input
              id="bank-file"
              type="file"
              accept=".csv"
              onChange={(e) => handleBankFileChange(e.target.files?.[0] || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="gl-file" className="block text-sm font-medium text-gray-700 mb-2">
              General Ledger (CSV)
            </label>
            <input
              id="gl-file"
              type="file"
              accept=".csv"
              onChange={(e) => handleGLFileChange(e.target.files?.[0] || null)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading || !bankFile || !glFile}
          className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Processing...' : 'Reconcile Files'}
        </button>
      </form>

      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {(bankData.length > 0 || glData.length > 0) && (
        <div className="flex gap-4 mb-6">
          <DataTable
            data={bankData}
            columns={bankColumns}
            title="Bank Statement"
          />
          <DataTable
            data={glData}
            columns={glColumns}
            title="General Ledger"
          />
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h2 className="text-lg font-semibold mb-2">Reconciliation Summary</h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium">Matched:</span> {result.summary.total_matched}
              </div>
              <div>
                <span className="font-medium">Unmatched Bank:</span> {result.summary.total_unmatched_bank}
              </div>
              <div>
                <span className="font-medium">Unmatched GL:</span> {result.summary.total_unmatched_gl}
              </div>
            </div>
          </div>

          {result.matched_transactions.length > 0 && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="text-lg font-semibold mb-4 text-green-800">Matched Transactions</h3>
              <div className="space-y-4">
                {result.matched_transactions.map((match, index) => (
                  <div key={index} className="p-3 bg-white border border-green-300 rounded-md">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-green-700">
                        Match {index + 1} (Confidence: {(match.confidence * 100).toFixed(1)}%)
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="font-medium text-gray-700 mb-1">Bank Transaction:</div>
                        <div className="bg-gray-50 p-2 rounded text-xs">
                          {JSON.stringify(match.bank_transaction, null, 2)}
                        </div>
                      </div>
                      <div>
                        <div className="font-medium text-gray-700 mb-1">GL Transaction:</div>
                        <div className="bg-gray-50 p-2 rounded text-xs">
                          {JSON.stringify(match.gl_transaction, null, 2)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-4">
            {result.unmatched_bank.length > 0 && (
              <DataTable
                data={result.unmatched_bank}
                columns={bankColumns}
                title={`Unmatched Bank Transactions (${result.unmatched_bank.length})`}
              />
            )}
            {result.unmatched_gl.length > 0 && (
              <DataTable
                data={result.unmatched_gl}
                columns={glColumns}
                title={`Unmatched GL Transactions (${result.unmatched_gl.length})`}
              />
            )}
          </div>
        </div>
      )}

      {bankData.length === 0 && glData.length === 0 && !isLoading && (
        <div className="text-center text-gray-500 mt-8">
          Upload your bank statement and general ledger files to view the data
        </div>
      )}
    </div>
  );
}