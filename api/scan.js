import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Best-effort in-memory rate limiting (resets per cold start, good enough for MVP)
const rateLimitMap = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const sportLabels = {
  cykling: "cycling activities (Ride, GravelRide, VirtualRide, MountainBikeRide)",
  lob: "running activities (Run, TrailRun, VirtualRun)",
  svomning: "swimming activities (Swim, OpenWaterSwim)",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Rate limit by IP
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + RATE_WINDOW_MS; }
  if (entry.count >= RATE_LIMIT) {
    return res.status(429).json({ error: "For mange forsøg. Prøv igen om en time." });
  }
  entry.count++;
  rateLimitMap.set(ip, entry);

  const { image, mediaType, sport } = req.body || {};

  if (!image || !mediaType) {
    return res.status(400).json({ error: "Mangler billede." });
  }

  const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (!validTypes.includes(mediaType)) {
    return res.status(400).json({ error: "Ugyldigt billedformat. Brug PNG, JPG eller WebP." });
  }

  const sportLabel = sportLabels[sport] || "fitness activities";

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: image },
            },
            {
              type: "text",
              text:
                `This is a screenshot from a fitness tracking app. Extract all visible ${sportLabel}. ` +
                `For each activity, return: date (YYYY-MM-DD format), name (the activity title), and distance in km as a number. ` +
                `If the distance is shown in miles, convert to km (1 mile = 1.609 km). ` +
                `If date shows only day/time without year, use today's year. ` +
                `Respond ONLY with a valid JSON array, no other text: ` +
                `[{"date":"2026-08-20","name":"Morning ride","km":42}]. ` +
                `If no matching activities are visible, return an empty array: [].`,
            },
          ],
        },
      ],
    });

    const raw = message.content[0].text.trim();
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    const activities = JSON.parse(cleaned);

    if (!Array.isArray(activities)) throw new Error("Not an array");

    return res.status(200).json({ activities });
  } catch (e) {
    console.error("scan error:", e);
    return res.status(500).json({ error: "Kunne ikke analysere billedet. Prøv med et tydeligere screenshot." });
  }
}
