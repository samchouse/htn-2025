import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } },
) {
  try {
    const sessionId = params.sessionId;
    const body = await request.json();
    const { bank_index, gl_indexes, explanation } = body;

    if (!bank_index && bank_index !== 0) {
      return NextResponse.json(
        { error: "bank_index is required" },
        { status: 400 },
      );
    }

    if (!gl_indexes || !Array.isArray(gl_indexes) || gl_indexes.length === 0) {
      return NextResponse.json(
        { error: "gl_indexes must be a non-empty array" },
        { status: 400 },
      );
    }

    if (
      !explanation ||
      typeof explanation !== "string" ||
      explanation.trim().length === 0
    ) {
      return NextResponse.json(
        { error: "explanation is required" },
        { status: 400 },
      );
    }

    // Load session data
    const sessionFilePath = join(
      process.cwd(),
      "packages",
      "htn",
      "packages",
      "api",
      "data",
      `session_${sessionId}.json`,
    );

    if (!existsSync(sessionFilePath)) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sessionData = JSON.parse(await readFile(sessionFilePath, "utf-8"));

    // Check if manual match already exists
    const existingMatch = sessionData.bank_matches.find(
      (match: { bank_index: number }) => match.bank_index === bank_index,
    );

    if (existingMatch) {
      return NextResponse.json(
        { error: "A match already exists for this bank entry" },
        { status: 400 },
      );
    }

    // Create new manual match
    const newMatch = {
      bank_index: bank_index,
      gl_indexes: gl_indexes,
      confidence: 1.0, // Manual matches have 100% confidence
      reasoning: `Manual match created by user: ${explanation}`,
      status: "approved",
      linked_documents: [],
      created_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
      user_feedback: explanation,
    };

    // Add the new match to the session
    sessionData.bank_matches.push(newMatch);

    // Update session metadata
    sessionData.last_updated = new Date().toISOString();
    sessionData.manual_matches_count =
      (sessionData.manual_matches_count || 0) + 1;

    // Save updated session data
    await writeFile(sessionFilePath, JSON.stringify(sessionData, null, 2));

    return NextResponse.json({
      message: "Manual match created successfully",
      match: newMatch,
      session_updated: true,
    });
  } catch (error) {
    console.error("Error creating manual match:", error);
    return NextResponse.json(
      { error: "Failed to create manual match" },
      { status: 500 },
    );
  }
}
