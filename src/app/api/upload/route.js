import { NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";

// Explicit service-account credentials, not bare `new Storage()`. This app
// runs on Vercel, not a GCP-hosted runtime - bare Application Default
// Credentials only resolves via a local `gcloud auth application-default
// login` (developer machines) or a GCP metadata server (Cloud Run/Functions/
// GCE), neither of which exists on Vercel, so uploads would fail in
// production with a "Could not load the default credentials" error despite
// working fine locally. Reuses the same GOOGLE_CLOUD_PROJECT_ID/
// GOOGLE_CLOUD_CLIENT_EMAIL/GOOGLE_CLOUD_PRIVATE_KEY service account already
// provisioned in Vercel's Preview and Production env vars for
// src/app/api/export-tally/route.js. Private keys stored in env vars
// typically have their newlines escaped as literal "\n" sequences, hence
// the .replace() below.
const storage = new Storage({
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
    private_key: (process.env.GOOGLE_CLOUD_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },
});
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