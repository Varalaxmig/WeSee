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

const Input = z.object({
  imageBase64: z.string().min(100),
});

export const describeScene = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return { success: false as const, error: "Vision service is not configured." };
    }

    const started = Date.now();
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        store: false,
        stream: true,
        reasoning: { effort: "low" },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: PROMPT },
              { type: "input_image", image_url: data.imageBase64 },
            ],
          },
        ],
      }),
    });

    if (!res.ok || !res.body) {
      const status = res.status;
      let message = "I could not scan that. Check your connection and tap to try again.";
      if (status === 429) message = "Too many scans right now. Wait a moment and tap again.";
      if (status === 402) message = "The vision service is out of credits.";
      return { success: false as const, error: message, status };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
              text += evt.delta;
            }
          } catch {
            // ignore partial frame
          }
        }
      }
    }

    const description = text.trim();
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
