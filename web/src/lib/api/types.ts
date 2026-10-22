/**
 * Contrato da API (espelha os presenters em api/src/opportunities). Mantido
 * à mão por ser pequeno; com o projeto crescendo, o próximo passo seria gerar
 * a partir de um OpenAPI exportado pela API.
 */
export type Stage =
  | "PRIMEIRO_CONTATO"
  | "APRESENTACAO_ORCAMENTO"
  | "FOLLOW_UP"
  | "FORECAST"
  | "FECHAMENTO"
  | "PERDIDA";

export type Severity = "critical" | "warning";
export type AttentionLevel = Severity | "ok";

export type AttentionSignal = {
  code: string;
  severity: Severity;
  message: string;
};

export type Attention = {
  level: AttentionLevel;
  score: number;
  signals: AttentionSignal[];
};

export type OpportunityItem = { id: string; productName: string; quantity: number };

export type Opportunity = {
  id: string;
  code: string;
  companyName: string;
  sellerName: string;
  estimatedValue: number | null;
  lastContactAt: string | null;
  proposalValidUntil: string | null;
  clientEventDate: string | null;
  stage: Stage;
  lossReason: string | null;
  stageChangedAt: string;
  items: OpportunityItem[];
  attention: Attention;
  allowedTransitions: Stage[];
};

export type StageChange = {
  id: string;
  fromStage: Stage | null;
  toStage: Stage;
  reason: string | null;
  changedBy: string | null;
  changedAt: string;
};

export type OpportunityDetail = Opportunity & { history: StageChange[] };

export type StageMeta = {
  id: Stage;
  label: string;
  isFinal: boolean;
  allowedTransitions: Stage[];
};

export type Meta = {
  today: string;
  stages: StageMeta[];
  sellers: string[];
};

export type RuleViolation = { code: string; message: string };

export type ApiErrorBody = {
  error: string;
  message: string;
  violations?: RuleViolation[];
  fields?: { path: string; message: string }[];
};

export type AttentionFilter = "any" | "critical" | "warning";

export type OpportunityFilters = {
  search?: string;
  seller?: string;
  attention?: AttentionFilter;
};
