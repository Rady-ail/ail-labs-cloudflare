export interface Env {
  DATABASE_URL: string;
  RESEND_API_KEY: string;
  RESEND_WEBHOOK_SECRET: string;
  API_TOKEN: string;
  EMAIL_SEND_MODE: "dry-run" | "live";
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  AI_PLAYBOOK?: string;
  AI_RATE_LIMITER: RateLimit;
}
