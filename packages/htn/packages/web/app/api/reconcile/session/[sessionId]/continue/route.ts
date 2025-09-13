import { type NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  try {
    const { sessionId } = params;
    const body = await request.json();
    const { user_feedback } = body;

    // Forward the request to the Python API
    const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";

    const response = await fetch(
      `${pythonApiUrl}/reconcile/session/${sessionId}/continue`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_feedback }),
      },
    );

    if (!response.ok) {
      throw new Error(`Python API error: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Continue agent processing error:", error);
    return NextResponse.json(
      { error: "Failed to continue agent processing" },
      { status: 500 },
    );
  }
}
