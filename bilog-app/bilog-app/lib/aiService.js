// lib/aiService.js
//
// ONE CENTRAL AI SERVICE for Bilog.
// Every AI-powered feature (analyzeLesson, chat, flashcards, mnemonics, etc.)
// goes through this single module. To add a new feature, add a new entry to
// OPERATIONS below — you do NOT need a new API route or a new key.
//
// This file runs SERVER-SIDE ONLY. It reads the secret key from
// process.env.AI_API_KEY, which is never sent to the browser.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.AI_MODEL || "claude-sonnet-5";
const MAX_RETRIES = 1;

// ---------------------------------------------------------------------------
// OPERATIONS: add new AI features here. Each operation returns a system
// prompt + how to shape the user's payload into a message. Every operation
// must instruct the model to return STRICT JSON so the server can validate
// it before handing it to the frontend (no fabricated/fake content ever
// reaches the user if the model or network fails — see callAI()).
// ---------------------------------------------------------------------------
const OPERATIONS = {
  analyzeLesson: {
    system: `Ikaw ay isang katulong na naghahati ng study notes sa Taglish para sa isang character na tinatawag na Bilog. Sumagot LAMANG ng STRICT JSON, walang preamble, walang markdown fences.
Format:
{"subtopics":[{"title":"...","content":"..."},{"title":"...","content":"..."},{"title":"...","content":"..."}],
"quiz":[{"question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"..."},{"question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"..."},{"question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"..."}]}
Panuto: Hatiin ang notes sa eksaktong 3 madaling-intindihing sub-topics (maikling title, 3-5 pangungusap na content sa magaan na Taglish). Gumawa ng eksaktong 3 quiz questions base LAMANG sa notes, 4 options bawat isa, tama lang ang isang sagot, may maikling explanation. Huwag lumihis sa laman ng ibinigay na notes.`,
    buildUserMessage: (payload) => `Narito ang notes:\n\n${payload.rawText || ""}`,
    maxTokens: 1200,
    validate: (json) =>
      Array.isArray(json.subtopics) && json.subtopics.length > 0 &&
      Array.isArray(json.quiz) && json.quiz.length > 0,
  },

  chat: {
    system: (payload) => `Ikaw si Bilog, isang cute pero medyo sarkastiko/mapang-asar na Yo-kai/gadget-monster na study buddy. Sumasagot ka LAMANG sa Taglish, conversational, may kaunting asar pero hindi bastos. Ang aralin na pinag-uusapan ninyo: ${payload.contentSummary || "(wala pang laman)"}.
Sumagot ka LAMANG ng STRICT JSON: {"reply":"maikling sagot (2-4 pangungusap)","emotion":"happy"|"smug"|"angry"|"neutral"}
Piliin ang emotion base sa tono ng sagot mo: "happy" kung natutuwa, "smug" kung normal/nangaasar (default), "angry" kung na-iritate, "neutral" kung plain. Manatili sa paksa ng aralin.`,
    buildUserMessage: (payload) => payload.message || "",
    maxTokens: 500,
    validate: (json) => typeof json.reply === "string" && json.reply.length > 0,
  },

  generateFlashcards: {
    system: `Gumawa ng flashcards mula sa study notes. Sumagot LAMANG ng STRICT JSON:
{"flashcards":[{"front":"...","back":"..."}, ...]}
Gumawa ng 5-8 flashcards, maikli at malinaw, sa Taglish.`,
    buildUserMessage: (payload) => payload.rawText || payload.contentSummary || "",
    maxTokens: 900,
    validate: (json) => Array.isArray(json.flashcards) && json.flashcards.length > 0,
  },

  generateMnemonic: {
    system: `Gumawa ng isang cute at madaling matandaan na mnemonic (sa Taglish) para sa ibinigay na konsepto. Sumagot LAMANG ng STRICT JSON: {"mnemonic":"...","explanation":"..."}`,
    buildUserMessage: (payload) => payload.concept || payload.contentSummary || "",
    maxTokens: 300,
    validate: (json) => typeof json.mnemonic === "string",
  },

  generateAnalogy: {
    system: `Gumawa ng isang simple at nakakatawang analogy (sa Taglish) para maintindihan ang ibinigay na konsepto ng isang estudyante. Sumagot LAMANG ng STRICT JSON: {"analogy":"..."}`,
    buildUserMessage: (payload) => payload.concept || payload.contentSummary || "",
    maxTokens: 300,
    validate: (json) => typeof json.analogy === "string",
  },

  simplifyExplanation: {
    system: `I-simplify ang ibinigay na paliwanag para sa isang high school student, sa magaan na Taglish, 3-4 pangungusap lang. Sumagot LAMANG ng STRICT JSON: {"simplified":"..."}`,
    buildUserMessage: (payload) => payload.text || "",
    maxTokens: 400,
    validate: (json) => typeof json.simplified === "string",
  },

  evaluateStudentAnswer: {
    system: `Suriin kung tama ang sagot ng estudyante base sa tanong at sa expected na sagot. Sumagot LAMANG ng STRICT JSON: {"correct": true/false, "feedback":"maikling feedback sa Taglish"}`,
    buildUserMessage: (payload) =>
      `Tanong: ${payload.question}\nExpected na sagot: ${payload.expectedAnswer}\nSagot ng estudyante: ${payload.studentAnswer}`,
    maxTokens: 300,
    validate: (json) => typeof json.correct === "boolean",
  },

  generateStudyRecommendation: {
    system: `Base sa mga quiz results ng estudyante, magbigay ng maikling study recommendation sa Taglish. Sumagot LAMANG ng STRICT JSON: {"recommendation":"..."}`,
    buildUserMessage: (payload) => JSON.stringify(payload.results || {}),
    maxTokens: 300,
    validate: (json) => typeof json.recommendation === "string",
  },
};

function extractJson(text) {
  let t = (text || "").trim();
  t = t.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI response was not valid JSON");
  return JSON.parse(t.slice(start, end + 1));
}

async function callAnthropic({ system, userMessage, maxTokens }) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    const err = new Error("AI_API_KEY is not configured");
    err.code = "NO_API_KEY";
    throw err;
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          max_tokens: maxTokens || 1000,
          system,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
      }

      const data = await res.json();
      const text = (data.content || []).map((b) => b.text || "").join("\n");
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) continue;
    }
  }
  throw lastErr;
}

// runOperation(operationName, payload) -> { ok: true, data } | { ok: false, error }
// NEVER returns fabricated data. If the AI call fails or the response
// doesn't match the expected shape, ok is false and the caller must show
// a friendly "can't reach Bilog's brain right now" message — never fake content.
async function runOperation(operationName, payload) {
  const op = OPERATIONS[operationName];
  if (!op) {
    return { ok: false, error: `Unknown operation: ${operationName}` };
  }

  try {
    const system = typeof op.system === "function" ? op.system(payload) : op.system;
    const userMessage = op.buildUserMessage(payload);
    const rawText = await callAnthropic({ system, userMessage, maxTokens: op.maxTokens });
    const json = extractJson(rawText);

    if (!op.validate(json)) {
      return { ok: false, error: "AI response did not match the expected structure" };
    }
    return { ok: true, data: json };
  } catch (err) {
    if (err.code === "NO_API_KEY") {
      return { ok: false, error: "NO_API_KEY", friendly: "Bilog needs an AI connection to analyze your lesson. Please configure the AI provider first." };
    }
    return { ok: false, error: err.message || "Unknown AI error" };
  }
}

module.exports = { runOperation, OPERATIONS };
