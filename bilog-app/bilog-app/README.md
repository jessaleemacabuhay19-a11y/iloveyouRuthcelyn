# Bilog — Yo-kai Study Buddy

An interactive study dashboard fronted by an original Yo-kai/monster
character named Bilog. Paste your notes, get 3 sub-topics + a 3-question
quiz, and chat with Bilog about the lesson — all powered by one small,
central backend AI layer.

## Architecture

```
Frontend (public/index.html)
        |
        v
   POST /api/ai   <-- the ONLY endpoint, handles every AI feature
        |
        v
  lib/aiService.js  (reads AI_API_KEY from the server environment)
        |
        v
   Anthropic API
```

The frontend never sees the API key. Every feature (lesson analysis, chat,
and — if you wire them up later — flashcards, mnemonics, analogies, etc.)
goes through the same `/api/ai` route and the same `aiService.js` module.
Adding a new AI feature means adding one entry to the `OPERATIONS` object in
`lib/aiService.js` — not a new route, not a new key.

If the AI connection isn't configured, Bilog says so directly
("Bilog needs an AI connection...") instead of faking a response. There is
no hard-coded fallback content anywhere in this project.

## Setup (Vercel — recommended, free tier works)

1. Push this folder to a GitHub repo.
2. Go to [vercel.com](https://vercel.com), "Add New Project", import the repo.
   Vercel auto-detects `/api/*.js` as serverless functions and `/public` as
   static files — no config file needed.
3. In the project's **Settings → Environment Variables**, add:
   - `AI_API_KEY` = your key from [console.anthropic.com](https://console.anthropic.com/settings/keys)
   - `AI_MODEL` = `claude-sonnet-5` (optional, this is already the default)
4. Deploy. That's it — open the deployed URL and Bilog is live.

## Setup (local development)

```bash
npm install -g vercel   # one-time, if you don't have it
cp .env.example .env.local
# edit .env.local and paste your real AI_API_KEY
vercel dev
```

Then open the local URL it prints (usually `http://localhost:3000`).

## Project structure

```
/api/ai.js          <- the single API route (POST /api/ai)
/lib/aiService.js    <- central AI service (all operations + Anthropic calls live here)
/public/index.html   <- the Bilog frontend (calls /api/ai, holds no secrets)
.env.example         <- required env vars
package.json
```

## Extending Bilog

`lib/aiService.js` already includes ready-to-wire operations beyond the two
the UI currently uses (`analyzeLesson`, `chat`): `generateFlashcards`,
`generateMnemonic`, `generateAnalogy`, `simplifyExplanation`,
`evaluateStudentAnswer`, `generateStudyRecommendation`. To add a button for
any of these in the frontend, just call:

```js
const data = await callAI("generateFlashcards", { rawText: someText });
```

No backend changes needed unless you're adding a brand-new operation type.

## Notes

- Do not commit `.env.local` or any real API key to git.
- The frontend deliberately never imports the Anthropic SDK or holds a key —
  all AI calls are server-side in `lib/aiService.js`.
