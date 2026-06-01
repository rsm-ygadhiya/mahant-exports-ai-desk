import OpenAI from 'openai';

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set. Add it to your .env file.');
    }
    _client = new OpenAI();
  }
  return _client;
}

export const AI_AVAILABLE = (): boolean => Boolean(process.env.OPENAI_API_KEY);

// gpt-4o is the strongest general model. Switch to 'gpt-4o-mini' for ~25× cheaper at modest quality cost.
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o';

/**
 * Run a single structured-output call against OpenAI.
 *
 * - `system` + `cachedContext` are concatenated into the system message.
 * - OpenAI does **automatic prompt caching** for prompts > 1024 tokens with no
 *   client-side markers (since late 2024) — repeat calls with the same prefix
 *   within ~5 minutes get a 50% discount on cached tokens.
 * - `schema` is a JSON Schema describing the expected response shape; we use
 *   strict mode (`strict: true`) so the model is constrained to emit valid JSON
 *   matching the schema. Schemas must have `additionalProperties: false` on every
 *   object and list every property in `required`.
 */
export async function askJson<T>(args: {
  system: string;
  cachedContext: string;
  userMessage: string;
  schema: Record<string, any>;
}): Promise<{ data: T; usage: { input: number; output: number; cacheRead: number; cacheCreation: number } }> {
  const c = client();

  const completion = await c.chat.completions.create({
    model: MODEL,
    messages: [
      // Stable text first — this is what gets cached automatically by OpenAI.
      { role: 'system', content: `${args.system}\n\n${args.cachedContext}` },
      { role: 'user', content: args.userMessage },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'response',
        strict: true,
        schema: args.schema,
      },
    },
  });

  const text = completion.choices[0]?.message.content ?? '';
  if (!text) throw new Error('OpenAI returned no content');

  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(`OpenAI returned non-JSON output: ${text.slice(0, 200)}`);
  }

  return {
    data,
    usage: {
      input: completion.usage?.prompt_tokens ?? 0,
      output: completion.usage?.completion_tokens ?? 0,
      cacheRead: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheCreation: 0, // OpenAI doesn't expose a separate cache-write count.
    },
  };
}
