import { type NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;

    // Forward the request to the Python API
    const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";

    const response = await fetch(
      `${pythonApiUrl}/reconcile/session/${sessionId}`,
      {
        method: "GET",
      },
    );

    if (!response.ok) {
      throw new Error(`Python API error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Get session error:", error);
    return NextResponse.json(
      { error: "Failed to get session details" },
      { status: 500 },
    );
  }
}
