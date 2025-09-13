import { type NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; bankIndex: string }> },
) {
  try {
    const { sessionId, bankIndex } = await params;
    const body = await request.json();
    const { status } = body;

    if (!status || !["approved", "rejected", "pending", "verified"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status. Must be one of: approved, rejected, pending, verified" },
        { status: 400 },
      );
    }

    // Forward the request to the Python API
    const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";

    const response = await fetch(
      `${pythonApiUrl}/reconcile/session/${sessionId}/match/${bankIndex}/status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(status),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Update match status error:", error);
    return NextResponse.json(
      { error: "Failed to update match status" },
      { status: 500 },
    );
  }
}
