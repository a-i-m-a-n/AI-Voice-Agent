import { NextRequest, NextResponse } from "next/server";
import { Communicate } from "edge-tts-universal";

export const runtime = "nodejs";
export const maxDuration = 30;

const DEFAULT_EDGE_VOICE = "en-US-EmmaMultilingualNeural";

// Current stable ElevenLabs multilingual model.
const ELEVENLABS_MODEL = "eleven_multilingual_v2";
const ELEVENLABS_URL_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const ELEVENLABS_VOICES_URL = "https://api.elevenlabs.io/v1/voices";

// Free-tier accounts cannot use Voice Library voices via the API — only a
// voice you personally created (Voice Design / a voice clone) or, for
// accounts created before March 2026, a "Default" voice. So instead of a
// hardcoded voice ID, look up a voice this account can actually use.
let cachedVoiceId: string | null = null;

async function resolveUsableVoiceId(apiKey: string): Promise<string> {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  if (cachedVoiceId) return cachedVoiceId;

  const response = await fetch(ELEVENLABS_VOICES_URL, {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) {
    throw new Error("Could not look up your ElevenLabs voices. Check your API key.");
  }
  const data = await response.json();
  const voices: any[] = data.voices ?? [];

  if (voices.length === 0) {
    throw new Error(
      "No usable ElevenLabs voice found on this account. Free-tier accounts can't use " +
        "Voice Library voices via the API — go to elevenlabs.io, open Voices > Voice Design, " +
        "create a voice (free), then set ELEVENLABS_VOICE_ID to its voice ID."
    );
  }

  cachedVoiceId = voices[0].voice_id;
  return cachedVoiceId as string;
}

async function speakWithEdgeTTS(text: string): Promise<Buffer> {
  const communicate = new Communicate(text, { voice: DEFAULT_EDGE_VOICE });
  const chunks: Buffer[] = [];
  for await (const chunk of communicate.stream()) {
    if (chunk.type === "audio" && chunk.data) {
      chunks.push(Buffer.from(chunk.data));
    }
  }
  return Buffer.concat(chunks);
}

async function speakWithElevenLabs(text: string, apiKey: string): Promise<Buffer> {
  const voiceId = await resolveUsableVoiceId(apiKey);
  const response = await fetch(`${ELEVENLABS_URL_BASE}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: ELEVENLABS_MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs request failed: ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text: string = (body.text ?? "").trim();
    const usePremium: boolean = Boolean(body.premium);

    if (!text) {
      return NextResponse.json({ error: "No text provided." }, { status: 400 });
    }

    if (usePremium) {
      const elevenKey = process.env.ELEVENLABS_API_KEY;
      if (!elevenKey) {
        return NextResponse.json(
          { error: "Premium voice requested but ELEVENLABS_API_KEY is not set on the server." },
          { status: 500 }
        );
      }
      const audio = await speakWithElevenLabs(text, elevenKey);
      return new NextResponse(audio, {
        headers: { "Content-Type": "audio/mpeg" },
      });
    }

    const audio = await speakWithEdgeTTS(text);
    return new NextResponse(audio, {
      headers: { "Content-Type": "audio/mpeg" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during speech synthesis.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
