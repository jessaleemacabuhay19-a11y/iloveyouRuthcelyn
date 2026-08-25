// api/ai.js
//
// THE ONLY AI ENDPOINT IN THIS PROJECT.
// Deployed as a Vercel Serverless Function at: POST /api/ai
//
// Request body:  { "operation": "analyzeLesson" | "chat" | ..., "payload": {...} }
// Response body: { "ok": true, "data": {...} }  or  { "ok": false, "error": "...", "friendly": "..." }
//
// The secret AI_API_KEY lives only in this server-side file's environment
// (set in Vercel dashboard or .env.local) — it is never sent to the browser.

const { runOperation } = require("../lib/aiService");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed. Use POST." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ ok: false, error: "Invalid JSON body" });
      return;
    }
  }

  const { operation, payload } = body || {};
  if (!operation || typeof operation !== "string") {
    res.status(400).json({ ok: false, error: "Missing required field: operation" });
    return;
  }

  const result = await runOperation(operation, payload || {});

  if (!result.ok) {
    // 200 on purpose: this is a well-formed "AI unavailable" response, not a
    // server crash. The frontend checks result.ok and shows the friendly
    // message — it never fabricates content when this happens.
    res.status(200).json(result);
    return;
  }

  res.status(200).json(result);
};
