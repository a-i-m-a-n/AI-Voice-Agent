import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing GROQ_API_KEY. Add it in your environment variables." },
      { status: 500 }
    );
  }

  try {
    const incomingForm = await req.formData();
    const audioFile = incomingForm.get("audio");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: "No audio file received." }, { status: 400 });
    }

    const forwardForm = new FormData();
    forwardForm.append("file", audioFile, "speech.webm");
    forwardForm.append("model", TRANSCRIPTION_MODEL);
    forwardForm.append("response_format", "json");

    const groqResponse = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: forwardForm,
    });

    if (!groqResponse.ok) {
      const errorText = await groqResponse.text();
      return NextResponse.json(
        { error: `Transcription failed: ${errorText}` },
        { status: groqResponse.status }
      );
    }

    const data = await groqResponse.json();
    return NextResponse.json({ text: (data.text ?? "").trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during transcription.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
