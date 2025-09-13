import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();

    // Forward the request to the Python API
    const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";

    const response = await fetch(
      `${pythonApiUrl}/reconcile/session/${sessionId}/save`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "Failed to save session" },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Save session error:", error);
    return NextResponse.json(
      { error: "Failed to save session" },
      { status: 500 },
    );
  }
}
