/**
 * Guardrails de entrada: rodam antes de qualquer chamada ao modelo.
 *
 * Bloqueiam o que nunca deveria chegar ao LLM (tentativa de sobrescrever as
 * instruções, pedido de segredos, texto gigante) e mascaram dados pessoais
 * sensíveis, que não precisam sair da empresa para responder sobre vendas.
 * São heurísticas determinísticas: baratas, auditáveis e testáveis; a segunda
 * linha de defesa é o próprio prompt de sistema e os guardrails de saída.
 */

export type GuardrailFlag =
  | 'PII_MASKED'
  | 'PROMPT_INJECTION'
  | 'SECRET_REQUEST'
  | 'INPUT_TOO_LONG'
  | 'EMPTY_INPUT'
  | 'INVALID_CITATION'
  | 'UNKNOWN_OPPORTUNITY_CODE'
  | 'SECRET_REDACTED'
  | 'PROMPT_LEAK'
  | 'TOOL_LIMIT_REACHED'
  | 'TOOL_ARGS_INVALID'
  | 'RETRIEVED_CONTENT_SUSPICIOUS';

export type InputInspection =
  | { allowed: true; text: string; flags: GuardrailFlag[] }
  | {
      allowed: false;
      flag: GuardrailFlag;
      message: string;
      flags: GuardrailFlag[];
    };

export const MAX_INPUT_CHARS = 1500;

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|ignora|desconsidere|esque[cç]a)\b.{0,40}\b(instru[cç][õo]es|regras|prompt|orienta[cç][õo]es|instructions|rules)\b/i,
  /\b(prompt|instru[cç][õo]es)\s+(do\s+)?sistema\b/i,
  /\bsystem\s*prompt\b/i,
  /\b(revele|mostre|repita|imprima|reveal|print|repeat)\b.{0,40}\b(instru[cç][õo]es|prompt|regras|instructions)\b/i,
  // Sem \b no fim: em JS, "é" não é caractere de palavra e a fronteira falharia.
  /\b(voc[êe]\s+agora\s+[ée]|a\s+partir\s+de\s+agora\s+voc[êe]\s+[ée]|you\s+are\s+now|act\s+as)(?=\s|$)/i,
  /\b(jailbreak|modo\s+desenvolvedor|developer\s+mode|DAN\b)/i,
  /<\/?(system|instructions?)>/i,
];

const SECRET_PATTERNS: RegExp[] = [
  /\b(api[\s_-]?key|chave\s+(da\s+)?api|token\s+de\s+acesso|access\s+token)\b/i,
  /\b(senha|password|credenciais?|credentials?)\b.{0,30}\b(banco|database|servidor|admin|sistema)\b/i,
  /\b(DATABASE_URL|GEMINI_API_KEY|AUTOMATION_SECRET|vari[aá]veis\s+de\s+ambiente|env\s+vars?)\b/i,
];

const onlyDigits = (value: string) => value.replace(/\D/g, '');

/** Valida os dígitos verificadores do CPF: evita mascarar qualquer número de 11 dígitos. */
export const isValidCpf = (value: string): boolean => {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    const sum = digits
      .slice(0, length)
      .split('')
      .reduce(
        (total, digit, index) => total + Number(digit) * (length + 1 - index),
        0,
      );
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
};

/** Algoritmo de Luhn: só mascara sequências que são de fato números de cartão. */
export const isLuhnValid = (value: string): boolean => {
  const digits = onlyDigits(value);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
};

const CPF_CANDIDATE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

export const maskSensitiveData = (
  text: string,
): { text: string; masked: boolean } => {
  let masked = false;
  const withoutCards = text.replace(CARD_CANDIDATE, (match) => {
    if (!isLuhnValid(match)) return match;
    masked = true;
    return '[cartão removido]';
  });
  const withoutCpf = withoutCards.replace(CPF_CANDIDATE, (match) => {
    if (!isValidCpf(match)) return match;
    masked = true;
    return '[CPF removido]';
  });
  return { text: withoutCpf, masked };
};

export const inspectInput = (raw: string): InputInspection => {
  const text = raw.trim();
  if (!text) {
    return {
      allowed: false,
      flag: 'EMPTY_INPUT',
      message: 'Escreva sua pergunta.',
      flags: ['EMPTY_INPUT'],
    };
  }
  if (text.length > MAX_INPUT_CHARS) {
    return {
      allowed: false,
      flag: 'INPUT_TOO_LONG',
      message: `A pergunta passou de ${MAX_INPUT_CHARS} caracteres. Resuma o que precisa e tente de novo.`,
      flags: ['INPUT_TOO_LONG'],
    };
  }
  if (INJECTION_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      allowed: false,
      flag: 'PROMPT_INJECTION',
      message:
        'Não posso mudar minhas instruções nem revelar como fui configurado. Posso ajudar com o funil, os retornos ou dúvidas sobre produtos, prazos e políticas.',
      flags: ['PROMPT_INJECTION'],
    };
  }
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      allowed: false,
      flag: 'SECRET_REQUEST',
      message:
        'Não tenho acesso a credenciais, chaves ou configurações do sistema, e não as compartilharia.',
      flags: ['SECRET_REQUEST'],
    };
  }

  const { text: masked, masked: hadPii } = maskSensitiveData(text);
  return { allowed: true, text: masked, flags: hadPii ? ['PII_MASKED'] : [] };
};

/**
 * Conteúdo recuperado da base também é dado não confiável: um documento
 * adulterado poderia carregar instruções. Trechos suspeitos são marcados e
 * descartados do contexto.
 */
export const looksLikeInjection = (text: string): boolean =>
  INJECTION_PATTERNS.some((pattern) => pattern.test(text));
