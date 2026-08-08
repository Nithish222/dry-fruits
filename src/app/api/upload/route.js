import { NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";

// Initialize Google Cloud Storage (Uses your local gcloud login automatically)
const storage = new Storage();
const BUCKET_NAME = "dry-fruits-price";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }

    // Validate file extension
    const allowedExtensions = [".csv", ".xlsx"];
    const fileExtension = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    
    if (!allowedExtensions.includes(fileExtension)) {
      return NextResponse.json(
        { error: "Invalid file type. Only .csv and .xlsx files are allowed." },
        { status: 400 }
      );
    }

    // Convert file to buffer for storage stream upload
    const buffer = Buffer.from(await file.arrayBuffer());
    const bucket = storage.bucket(BUCKET_NAME);
    
    // We upload with the original filename so your Python Cloud Function can read it easily
    const gcsFile = bucket.file(file.name);

    // Save file buffer directly to GCS
    await gcsFile.save(buffer, {
      metadata: {
        contentType: file.type || "application/octet-stream",
      },
      resumable: false,
    });

    return NextResponse.json({
      success: true,
      message: "File uploaded successfully!",
      filePath: file.name,
    });
  } catch (error) {
    console.error("GCS Upload Error:", error);
    return NextResponse.json(
      { error: "Failed to upload file to Cloud Storage." },
      { status: 500 }
    );
  }
}