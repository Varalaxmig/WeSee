import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PROMPT = `You are WeSee, a vision assistant for a person with low vision in India.
Describe what is in front of the camera in ONE or TWO short sentences.
Rules:
- Mention any hazard first (step, stairs, pole, open door, vehicle, hole, obstacle).
- Be concrete and plain. No preamble, no "the image shows".
- If a rupee note is visible, say its value, or say you are not sure.
- If you are unsure, say "I am not sure" rather than guessing.
Keep the whole answer under 40 words.`;

const DescribeInput = z.object({
  imageBase64: z.string().min(100),
});

export const describeScene = createServerFn({ method: "POST" })
  .validator((data: unknown) => DescribeInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["GROQ_API_KEY"];
    if (!apiKey) {
      return { success: false as const, error: "Vision service is not configured. Set GROQ_API_KEY in .env" };
    }

    const started = Date.now();

    // Groq uses OpenAI-compatible chat completions with vision
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        max_tokens: 150,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              {
                type: "image_url",
                image_url: { url: data.imageBase64 },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const status = res.status;
      let errorDetail = "";
      try {
        const errorJson = (await res.json()) as { error?: { message?: string } };
        errorDetail = errorJson.error?.message || "";
      } catch {
        errorDetail = await res.text().catch(() => "");
      }
      console.error("[WeSee] Groq error:", status, errorDetail);
      let message = "I could not scan that. Check your connection and tap to try again.";
      if (status === 429) message = "Too many scans right now. Wait a moment and tap again.";
      if (status === 401) message = "Invalid API key. Check GROQ_API_KEY in your .env file.";
      if (status === 413) message = "Image is too large. Try moving closer and scanning again.";
      return { success: false as const, error: message, status };
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    let description = json.choices?.[0]?.message?.content?.trim() ?? "";
    description = description.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    if (!description) {
      return {
        success: false as const,
        error: "I could not describe that. Tap to try again.",
      };
    }

    return {
      success: true as const,
      description,
      latencyMs: Date.now() - started,
    };
  });

// Sarvam TTS server function
const TTSInput = z.object({
  text: z.string().min(1).max(2500),
  language: z.string().default("en-IN"),
});

export const speakWithSarvam = createServerFn({ method: "POST" })
  .validator((data: unknown) => TTSInput.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["SARVAM_API_KEY"];
    if (!apiKey) {
      // Graceful fallback — client will use browser speechSynthesis
      return { success: false as const, error: "Sarvam TTS not configured" };
    }

    const res = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify({
        inputs: [data.text],
        target_language_code: data.language,
        model: "bulbul:v3",
        speaker: "priya",
        pace: 1.0,
        enable_preprocessing: true,
      }),
    });

    if (!res.ok) {
      return { success: false as const, error: `Sarvam TTS error: ${res.status}` };
    }

    const json = await res.json() as { audios?: string[] };
    const audioBase64 = json.audios?.[0];

    if (!audioBase64) {
      return { success: false as const, error: "No audio returned from Sarvam" };
    }

    return {
      success: true as const,
      audioBase64,
    };
  });
