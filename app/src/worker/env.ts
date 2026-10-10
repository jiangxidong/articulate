import type { Gate } from "./gate";
import type { CallLogs } from "./call-logs";

export interface Env {
  ASSETS: Fetcher;
  GATE: DurableObjectNamespace<Gate>;
  LOGS: DurableObjectNamespace<CallLogs>;
  // Secrets (wrangler secret put): never in code, logs or the browser.
  GEMINI_API_KEY: string;
  PASSCODE: string;
  SESSION_SECRET: string;
}
