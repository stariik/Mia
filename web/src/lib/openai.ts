import OpenAI from "openai";

// 30s per-request timeout (the SDK default is 10 minutes) so a hung upstream
// can't pin a server request open. maxRetries stays at the SDK default (2);
// retries only fire on connection errors before a stream starts.
const openai = new OpenAI({
  // The SDK constructor throws on a missing key, and this module is evaluated
  // at import time — which `next build` does for every route while collecting
  // page data. The Docker build deliberately ships no secrets, so a real key is
  // absent there and the build would die. The placeholder keeps construction
  // total; a request from a genuinely misconfigured server then fails with
  // OpenAI's 401, which quotes this string back and names the missing var.
  apiKey: process.env.OPENAI_API_KEY ?? "OPENAI_API_KEY-is-not-set",
  timeout: 30_000,
});

export default openai;
