import OpenAI from "openai";

// 30s per-request timeout (the SDK default is 10 minutes) so a hung upstream
// can't pin a server request open. maxRetries stays at the SDK default (2);
// retries only fire on connection errors before a stream starts.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30_000,
});

export default openai;
