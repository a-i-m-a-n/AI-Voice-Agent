# Voice Agent

A push-to-talk voice AI agent. Click the mic to record, click again to stop —
your speech is transcribed, sent to an LLM, and the reply is shown as text.
Click the speaker icon on a reply to have it spoken aloud.

Turn-based by design (not a continuously open microphone), so every request
finishes well within Vercel's free-tier 10-second function limit.

## Stack

- **Frontend + hosting:** Next.js 15 (App Router) on Vercel Hobby (free)
- **Speech-to-text:** Groq `whisper-large-v3-turbo` (free tier: 2,000 requests/day)
- **LLM:** Groq `openai/gpt-oss-120b`, with basic tool-calling wired in as an example
  (free tier: 1,000 requests/day, 12,000 tokens/minute)
- **Text-to-speech (default):** Microsoft Edge TTS via `edge-tts-universal` —
  free, unlimited, no API key. This uses an undocumented public Microsoft
  service, so treat it as unofficial and not guaranteed to stay online forever.
- **Text-to-speech (optional premium toggle):** ElevenLabs `eleven_multilingual_v2`
  (free tier: ~10,000 characters/month, no commercial rights on the free plan)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment file and add your key:
   ```bash
   cp .env.example .env.local
   ```
   - `GROQ_API_KEY` — required. Get a free key at https://console.groq.com/keys
   - `ELEVENLABS_API_KEY` — optional. Only needed if you turn on "premium voice"
     in the UI. Get a free key at https://elevenlabs.io/
3. Run locally:
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 and allow microphone access.

## Deploying to Vercel (free tier)

1. Push this project to a GitHub repo.
2. Go to https://vercel.com/new and import the repo.
3. In the project's Environment Variables settings, add `GROQ_API_KEY`
   (and `ELEVENLABS_API_KEY` if you want the premium voice option).
4. Deploy. No other configuration is needed — the API routes already run on
   the Node.js serverless runtime with `maxDuration: 30`, which fits Vercel
   Hobby's limits.

## Notes and limits

- Microphone access requires HTTPS (or localhost), which Vercel provides by
  default — no extra setup needed.
- Groq's free tier is rate-limited (requests/day and tokens/minute). If you
  hit a limit, either wait for the daily reset or add a card to move to
  Groq's Developer tier, which is still free and raises the limits.
- The default voice (Edge TTS) has no character cap. Reserve the ElevenLabs
  premium toggle for demos, since its free plan is capped at roughly
  10,000 characters per month.
- This is a turn-based agent (record → transcribe → reply → optionally
  speak), not a continuously streaming/interruptible voice call. A
  continuous, always-listening experience needs a persistent server
  connection, which isn't compatible with Vercel's serverless free tier.
