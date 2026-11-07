/**
 * Default environment variable names for each IBYOK key type.
 *
 * These match what each provider's official SDK reads by default, so an app
 * that already uses `process.env.OPENAI_API_KEY` works under `ibyok run`
 * with no code changes.
 */

const PROVIDER_ENV_NAMES: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  cohere: 'CO_API_KEY',
  xai: 'XAI_API_KEY',
  ai21: 'AI21_API_KEY',
  groq: 'GROQ_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  replicate: 'REPLICATE_API_TOKEN',
  huggingface: 'HF_TOKEN',
  nvidia: 'NVIDIA_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  assemblyai: 'ASSEMBLYAI_API_KEY',
  stability: 'STABILITY_API_KEY',
  voyage: 'VOYAGE_API_KEY',
  jina: 'JINA_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvName(name: string): boolean {
  return ENV_NAME_PATTERN.test(name);
}

/** Turn arbitrary text into an UPPER_SNAKE identifier. */
function toEnvIdentifier(text: string): string {
  const snake = text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!snake) return 'IBYOK_KEY';
  return /^[0-9]/.test(snake) ? `_${snake}` : snake;
}

/**
 * Suggest an env var name for a key.
 *
 * Known providers get their SDK's conventional name. Everything else
 * (including `custom`) is derived from the key's name, e.g. a custom key
 * named "github" becomes GITHUB_API_KEY.
 */
export function suggestEnvName(llmType: string, keyName: string): string {
  const known = PROVIDER_ENV_NAMES[llmType];
  if (known) return known;

  const base = toEnvIdentifier(llmType === 'custom' ? keyName : llmType);
  return /(_KEY|_TOKEN|_SECRET)$/.test(base) ? base : `${base}_API_KEY`;
}

/** Return `name`, or `name_2`, `name_3`, ... if it is already taken. */
export function uniqueEnvName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name}_${i}`)) i++;
  return `${name}_${i}`;
}
