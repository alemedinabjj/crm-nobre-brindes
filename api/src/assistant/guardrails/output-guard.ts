import type { GuardrailFlag } from './input-guard.js';

/**
 * Guardrails de saída: conferem a resposta do modelo contra o que o próprio
 * sistema sabe antes de mostrar ao vendedor.
 *
 * - Citação [n] precisa apontar para uma fonte realmente recuperada.
 * - Código OPP-XXXX citado precisa ter vindo dos dados do CRM (ou da pergunta).
 * - Segredos e o marcador "canary" do prompt de sistema nunca saem.
 */

export const SYSTEM_PROMPT_CANARY = 'NB-CANARY-4F7A9C';

export type OutputContext = {
  /** Números de fonte disponíveis para citação, ex.: {1, 2, 3}. */
  citableSources: Set<number>;
  /** Códigos de oportunidade vistos em resultados de ferramenta ou na pergunta. */
  knownOpportunityCodes: Set<string>;
};

export type OutputInspection = {
  text: string;
  flags: GuardrailFlag[];
  /** Fontes efetivamente citadas na resposta final. */
  citedSources: number[];
};

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g, // chave de API do Google (formato clássico)
  /\bAQ\.[0-9A-Za-z_-]{30,}/g, // chave de API do Google (formato novo)
  /postgres(?:ql)?:\/\/[^\s)]+/gi,
  /\bnpg_[0-9A-Za-z]{8,}\b/g, // senha gerada pelo Neon
  /\bsk-[0-9A-Za-z]{20,}\b/g,
];

const LEAK_REFUSAL =
  'Não posso compartilhar detalhes de como fui configurado. Posso ajudar com o funil, os retornos ou dúvidas sobre produtos, prazos e políticas.';

export const inspectOutput = (
  raw: string,
  context: OutputContext,
): OutputInspection => {
  if (raw.includes(SYSTEM_PROMPT_CANARY)) {
    return { text: LEAK_REFUSAL, flags: ['PROMPT_LEAK'], citedSources: [] };
  }

  const flags = new Set<GuardrailFlag>();
  let text = raw;

  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      flags.add('SECRET_REDACTED');
      return '[removido]';
    });
  }

  const cited = new Set<number>();
  text = text.replace(/\s?\[(\d{1,2})\]/g, (match, value: string) => {
    const source = Number(value);
    if (context.citableSources.has(source)) {
      cited.add(source);
      return match;
    }
    flags.add('INVALID_CITATION');
    return '';
  });

  const unknownCodes = [
    ...new Set(text.match(/\bOPP-\d{3,6}\b/g) ?? []),
  ].filter((code) => !context.knownOpportunityCodes.has(code));
  if (unknownCodes.length > 0) {
    flags.add('UNKNOWN_OPPORTUNITY_CODE');
    text += `\n\n_Atenção: não encontrei ${unknownCodes.join(', ')} nos dados do CRM; confira o código antes de agir._`;
  }

  return {
    text: text.trim(),
    flags: [...flags],
    citedSources: [...cited].sort((a, b) => a - b),
  };
};
