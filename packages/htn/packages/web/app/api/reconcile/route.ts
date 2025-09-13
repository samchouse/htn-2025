import { type NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const bankStatement = formData.get("bank_statement") as File;
    const generalLedger = formData.get("general_ledger") as File;

    if (!bankStatement || !generalLedger) {
      return NextResponse.json(
        { error: "Both bank statement and general ledger files are required" },
        { status: 400 },
      );
    }

    // Forward the request to the Python API
    const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";

    const forwardFormData = new FormData();
    forwardFormData.append("bank_statement", bankStatement);
    forwardFormData.append("general_ledger", generalLedger);

    const response = await fetch(`${pythonApiUrl}/reconcile`, {
      method: "POST",
      body: forwardFormData,
    });

    if (!response.ok) {
      throw new Error(`Python API error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Reconciliation error:", error);
    return NextResponse.json(
      { error: "Failed to process reconciliation" },
      { status: 500 },
    );
  }
}
