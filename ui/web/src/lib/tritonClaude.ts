// TritonAI (UCSD) Claude proxy — OpenAI-compatible.
// Used for the "Ask Mahant" RAG / Q&A tool. Independent of the OpenAI client
// in ./ai.ts so the existing skills keep working unchanged.

import OpenAI from 'openai';

const TRITON_BASE_URL = 'https://tritonai-api.ucsd.edu/v1';
const TRITON_MODEL = process.env.TRITON_MODEL ?? 'claude-sonnet-4-6';

let _client: OpenAI | null = null;

export const TRITON_AVAILABLE = (): boolean => Boolean(process.env.TRITONAI_API_KEY);

function client(): OpenAI {
  if (!_client) {
    if (!process.env.TRITONAI_API_KEY) {
      throw new Error(
        'TRITONAI_API_KEY is not set. Add it to ui/web/.env to enable the Ask AI tool.',
      );
    }
    _client = new OpenAI({
      apiKey: process.env.TRITONAI_API_KEY,
      baseURL: TRITON_BASE_URL,
    });
  }
  return _client;
}

/**
 * Ask Claude (via TritonAI) a question with a system prompt + RAG context.
 * Returns the plain-text answer plus token usage when reported.
 */
export async function askClaude(args: {
  system: string;
  cachedContext: string;
  userMessage: string;
}): Promise<{ answer: string; usage: { input: number; output: number } }> {
  const c = client();
  const completion = await c.chat.completions.create({
    model: TRITON_MODEL,
    messages: [
      // Big stable RAG context goes first — automatic prompt caching kicks in
      // for repeat calls with the same prefix in OpenAI-compatible clients.
      { role: 'system', content: `${args.system}\n\n${args.cachedContext}` },
      { role: 'user', content: args.userMessage },
    ],
    // Higher temp for the Ask AI tool so explanations are richer / less
    // dictionary-style — the system prompt still pins facts to the snapshot.
    temperature: 0.5,
  });
  return {
    answer: completion.choices[0]?.message?.content ?? '',
    usage: {
      input: completion.usage?.prompt_tokens ?? 0,
      output: completion.usage?.completion_tokens ?? 0,
    },
  };
}
