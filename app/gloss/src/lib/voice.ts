/**
 * Read aloud: Cartesia on Together. Sonic 3 is the newest Cartesia model
 * served serverless (Sonic 3.5 is listed, but only on dedicated endpoints;
 * checked 2026-10-09). Swap the id here when that changes.
 */
export const TTS_URL = "https://api.together.xyz/v1/audio/speech";
export const TTS_MODEL = "cartesia/sonic-3";
/** "Marian - Poised Narrator": even and unhurried, made for long reading. */
export const TTS_VOICE = "26403c37-80c1-4a1a-8692-540551ca2ae5";
/** One request's worth of text. Paragraphs past this are split at sentence ends. */
export const TTS_MAX_CHARS = 1200;
