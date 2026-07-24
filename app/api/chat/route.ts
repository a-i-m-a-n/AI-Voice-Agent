import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
// gpt-oss-120b is Groq's current recommended general-purpose model
// (llama-3.3-70b-versatile was deprecated in June 2026 in favor of this model).
const CHAT_MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT =
  "You are a helpful voice assistant. The user is speaking to you, and your reply will be read " +
  "aloud, so keep answers concise, conversational, and free of markdown formatting, bullet points, " +
  "or code blocks unless the user explicitly asks for code.";

// A minimal example tool so the agent can call out to the real world when needed.
// Add more tools here following the same pattern.
const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "Get the current date and time.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
];

function runTool(name: string): string {
  if (name === "get_current_time") {
    return new Date().toString();
  }
  return `Unknown tool: ${name}`;
}

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing GROQ_API_KEY. Add it in your environment variables." },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const history: ChatMessage[] = Array.isArray(body.history) ? body.history : [];

    const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];

    const firstResponse = await fetch(GROQ_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.6,
      }),
    });

    if (!firstResponse.ok) {
      const errorText = await firstResponse.text();
      return NextResponse.json(
        { error: `Chat request failed: ${errorText}` },
        { status: firstResponse.status }
      );
    }

    const firstData = await firstResponse.json();
    const choice = firstData.choices?.[0];
    const assistantMessage = choice?.message;

    // If the model asked to call a tool, run it and send the result back for a final reply.
    if (assistantMessage?.tool_calls?.length) {
      const toolMessages = assistantMessage.tool_calls.map((call: any) => ({
        role: "tool",
        tool_call_id: call.id,
        content: runTool(call.function?.name),
      }));

      const secondResponse = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: CHAT_MODEL,
          messages: [...messages, assistantMessage, ...toolMessages],
          temperature: 0.6,
        }),
      });

      if (!secondResponse.ok) {
        const errorText = await secondResponse.text();
        return NextResponse.json(
          { error: `Chat follow-up request failed: ${errorText}` },
          { status: secondResponse.status }
        );
      }

      const secondData = await secondResponse.json();
      const finalText = secondData.choices?.[0]?.message?.content ?? "";
      return NextResponse.json({ text: finalText.trim() });
    }

    const text = assistantMessage?.content ?? "";
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during chat completion.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
