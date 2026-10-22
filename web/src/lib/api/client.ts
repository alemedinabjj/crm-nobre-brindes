import type {
  ApiErrorBody,
  AssistantReply,
  AssistantStatus,
  AutomationRun,
  FollowUpTask,
  Meta,
  Opportunity,
  OpportunityDetail,
  OpportunityFilters,
  RuleViolation,
  Stage,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? `Erro ${status} ao falar com a API.`);
    this.name = "ApiError";
  }

  get violations(): RuleViolation[] {
    return this.body?.violations ?? [];
  }

  get isBusinessRule(): boolean {
    return this.status === 422;
  }
}

/** Sem conexão com a API (servidor fora do ar, rede, CORS). */
export class NetworkError extends Error {
  constructor() {
    super("Não foi possível conectar à API. Verifique se o servidor está no ar.");
    this.name = "NetworkError";
  }
}

const parseBody = async (response: Response): Promise<ApiErrorBody | null> => {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  return requestRaw(path, init).then(async (response) =>
    response.status === 204 ? (undefined as T) : ((await response.json()) as T),
  );
};

const requestRaw = async (path: string, init: RequestInit = {}): Promise<Response> => {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new NetworkError();
  }

  if (!response.ok) throw new ApiError(response.status, await parseBody(response));
  return response;
};

const toQuery = (filters: OpportunityFilters): string => {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.seller) params.set("seller", filters.seller);
  if (filters.attention) params.set("attention", filters.attention);
  const query = params.toString();
  return query ? `?${query}` : "";
};

export const api = {
  meta: () => request<Meta>("/meta"),
  listOpportunities: (filters: OpportunityFilters) =>
    request<Opportunity[]>(`/opportunities${toQuery(filters)}`),
  getOpportunity: (id: string) => request<OpportunityDetail>(`/opportunities/${id}`),
  changeStage: (id: string, body: { to: Stage; reason?: string; changedBy?: string }) =>
    request<OpportunityDetail>(`/opportunities/${id}/stage-transitions`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listFollowUps: (seller?: string) =>
    request<FollowUpTask[]>(`/follow-up-tasks${seller ? `?seller=${encodeURIComponent(seller)}` : ""}`),
  resolveFollowUp: (id: string, status: "DONE" | "CANCELED") =>
    request<void>(`/follow-up-tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  runFollowUps: () => request<AutomationRun>("/automations/follow-ups/run", { method: "POST" }),
  listAutomationRuns: () => request<AutomationRun[]>("/automations/follow-ups/runs?limit=1"),
  assistantStatus: () => request<AssistantStatus>("/assistant/status"),
  askAssistant: (body: {
    message: string;
    history: { role: "user" | "assistant"; content: string }[];
    seller?: string;
  }) => request<AssistantReply>("/assistant/chat", { method: "POST", body: JSON.stringify(body) }),
  registerContact: (id: string) =>
    request<OpportunityDetail>(`/opportunities/${id}/contacts`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
};
