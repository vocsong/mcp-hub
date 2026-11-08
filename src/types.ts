import type { Tenant } from "./tenant";
export interface Env {
  TENANTS: DurableObjectNamespace<Tenant>;
  AUDIO: R2Bucket;
  APP_MODE: string;
  PUBLIC_ORIGIN: string;
  LIVE_PROVIDER: string;
  KEY_ENCRYPTION_KEY?: string;
  AUTH_ISSUER?: string;
  AUTH_AUDIENCE?: string;
  AUTH_JWKS_URL?: string;
  INVITED_SUBJECTS?: string;
  PRICE_VERIFIED_UNTIL?: string;
}
export type Identity = { tenant: string; scopes: string[]; dashboard: boolean };
export type Speech = {
  text: string;
  voice: "en_paul_neutral";
  requestId: string;
};
export type Job = {
  id: string;
  digest: string;
  status: "pending" | "approved" | "running" | "complete" | "uncertain";
  created: number;
  expires: number;
  reserve: number;
  artifact?: string;
  audioExpires?: number;
};
export type Policy = {
  dailyMicros: number;
  approvalRequired: boolean;
  retentionHours: number;
};
export const defaults: Policy = {
  dailyMicros: 1_000_000,
  approvalRequired: true,
  retentionHours: 24,
};
export const MODEL = "mistralai/voxtral-mini-tts-2603";
export const RESERVATION = 100_000;
export class Fault extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
