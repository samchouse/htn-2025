import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files: File[] = [];

    // Extract all files from form data
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("document_") && value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    // Create documents directory if it doesn't exist
    const documentsDir = join(process.cwd(), "api", "documents");
    if (!existsSync(documentsDir)) {
      await mkdir(documentsDir, { recursive: true });
    }

    const uploadedFiles: string[] = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Save each file
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Validate file type
      if (
        file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")
      ) {
        return NextResponse.json(
          { error: `File ${file.name} is not a PDF` },
          { status: 400 },
        );
      }

      // Create unique filename with timestamp
      const fileExtension = file.name.split(".").pop();
      const baseName = file.name.replace(/\.[^/.]+$/, "");
      const fileName = `${baseName}_${timestamp}_${i}.${fileExtension}`;
      const filePath = join(documentsDir, fileName);

      // Convert file to buffer and save
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      await writeFile(filePath, buffer);
      uploadedFiles.push(fileName);
    }

    return NextResponse.json({
      message: `Successfully uploaded ${files.length} document(s)`,
      files: uploadedFiles,
      uploaded_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error uploading documents:", error);
    return NextResponse.json(
      { error: "Failed to upload documents" },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const documentsDir = join(process.cwd(), "api", "documents");

    if (!existsSync(documentsDir)) {
      return NextResponse.json({ documents: [] });
    }

    // For now, just return a success message
    // In a real implementation, you'd list the files in the directory
    return NextResponse.json({
      message: "Documents endpoint ready",
      documents: [],
    });
  } catch (error) {
    console.error("Error listing documents:", error);
    return NextResponse.json(
      { error: "Failed to list documents" },
      { status: 500 },
    );
  }
}
