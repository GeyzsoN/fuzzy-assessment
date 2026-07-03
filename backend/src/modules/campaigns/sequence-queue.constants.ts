export const SEQUENCE_EMAIL_QUEUE = 'sequence-email';
export const SEQUENCE_EMAIL_JOB = 'send-sequence-email';
export const DISPATCH_DUE_SEQUENCE_EMAILS_JOB = 'dispatch-due-sequence-emails';
export const DISPATCH_DUE_SEQUENCE_EMAILS_JOB_ID = 'dispatch-due-sequence-emails';
export const CAMPAIGN_GENERATION_QUEUE = 'campaign-generation';
export const CAMPAIGN_GENERATION_JOB = 'generate-campaign-draft';
export const CAMPAIGN_GENERATION_RECOVERY_JOB =
  'recover-stale-campaign-generations';
export const CAMPAIGN_GENERATION_RECOVERY_JOB_ID =
  'recover-stale-campaign-generations';

export const CAMPAIGN_GENERATION_ATTEMPTS = 2;
export const SEQUENCE_EMAIL_ATTEMPTS = 3;
export const QUEUE_BACKOFF_DELAY_MS = 1000;
export const QUEUE_REMOVE_ON_COMPLETE = 1000;
export const OUTBOX_DISPATCH_INTERVAL_MS = 60_000;
export const OUTBOX_DISPATCH_BATCH_SIZE = 100;
export const CAMPAIGN_GENERATION_LEASE_MS = 10 * 60 * 1000;
export const CAMPAIGN_GENERATION_MAX_ATTEMPTS = 3;
export const CAMPAIGN_GENERATION_RECOVERY_INTERVAL_MS = 60_000;
export const CAMPAIGN_GENERATION_RECOVERY_BATCH_SIZE = 100;
