import { type NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; bankIndex: string }> },
) {
  try {
    const { sessionId, bankIndex } = await params;

    // Forward the request to the Python API
    const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";

    const response = await fetch(
      `${pythonApiUrl}/reconcile/session/${sessionId}/match/${bankIndex}/documents`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Get matching documents error:", error);
    return NextResponse.json(
      { error: "Failed to get matching documents" },
      { status: 500 },
    );
  }
}