/**
 * Every RAG knob, read from the environment at call time.
 *
 * Model ids are never literals in feature code (PLAN §11): providers retire
 * models without notice — `gemini-2.5-flash` already returns 404 for new keys —
 * so a deployment can move to a new model by editing `.env` alone.
 */

const int = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const float = (value, fallback) => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
};

export function ragConfig() {
  const embeddingBaseUrl = (process.env.RAG_EMBEDDING_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  return {
    embedding: {
      baseUrl: embeddingBaseUrl,
      apiKey: process.env.RAG_EMBEDDING_API_KEY || process.env.OPENROUTER_API_KEY || '',
      model: process.env.RAG_EMBEDDING_MODEL || 'nvidia/nemotron-3.5-embed-1b:free',
      dimensions: int(process.env.RAG_EMBEDDING_DIMENSIONS, 1024),
      batch: int(process.env.RAG_EMBEDDING_BATCH, 32),
      concurrency: int(process.env.RAG_EMBEDDING_CONCURRENCY, 2),
    },
    llm: {
      provider: process.env.RAG_LLM_PROVIDER || 'gemini',
      model: process.env.RAG_LLM_MODEL || 'gemini-3.6-flash',
      fallbackModels: (process.env.RAG_LLM_FALLBACK_MODELS || '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      apiKey: process.env.GEMINI_API_KEY || '',
      baseUrl: (process.env.RAG_LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
      maxOutputTokens: int(process.env.RAG_LLM_MAX_OUTPUT_TOKENS, 1024),
      thinkingBudget: int(process.env.RAG_LLM_THINKING_BUDGET, 0),
      temperature: float(process.env.RAG_LLM_TEMPERATURE, 0.2),
      topP: float(process.env.RAG_LLM_TOP_P, 0.95),
      timeoutMs: int(process.env.RAG_LLM_TIMEOUT_MS, 60_000),
    },
    rerank: {
      enabled: bool(process.env.RAG_RERANK_ENABLED, true),
      baseUrl: (process.env.RAG_RERANK_BASE_URL || embeddingBaseUrl).replace(/\/+$/, ''),
      apiKey: process.env.RAG_RERANK_API_KEY || process.env.OPENROUTER_API_KEY || '',
      model: process.env.RAG_RERANK_MODEL || 'nvidia/nemotron-3.5-rerank-8b:free',
      topN: int(process.env.RAG_RERANK_TOP_N, 8),
      timeoutMs: int(process.env.RAG_RERANK_TIMEOUT_MS, 3000),
    },
    retrieval: {
      topKDense: int(process.env.RAG_TOP_K_DENSE, 30),
      topKLexical: int(process.env.RAG_TOP_K_LEXICAL, 30),
      rrfK: int(process.env.RAG_RRF_K, 60),
      contextTopN: int(process.env.RAG_CONTEXT_TOP_N, 8),
      promptBudgetTokens: int(process.env.RAG_PROMPT_BUDGET_TOKENS, 6000),
      historyTurns: int(process.env.RAG_HISTORY_TURNS, 6),
    },
    chunking: {
      targetTokens: int(process.env.RAG_CHUNK_TARGET_TOKENS, 500),
      maxTokens: int(process.env.RAG_CHUNK_MAX_TOKENS, 800),
      overlap: float(process.env.RAG_CHUNK_OVERLAP, 0.15),
      maxChunksPerDocument: int(process.env.RAG_MAX_CHUNKS_PER_DOC, 2000),
    },
    limits: {
      chatPerMinute: int(process.env.RAG_CHAT_RATE_LIMIT, 20),
      dailyTokenBudget: int(process.env.RAG_DAILY_TOKEN_BUDGET, 50_000),
    },
  };
}

/** True when the embedding provider has everything it needs to answer. */
export function embeddingConfigured(config = ragConfig()) {
  return Boolean(config.embedding.apiKey && config.embedding.model && config.embedding.baseUrl);
}

/** True when the answer model has everything it needs to answer. */
export function llmConfigured(config = ragConfig()) {
  return Boolean(config.llm.apiKey && config.llm.model);
}
