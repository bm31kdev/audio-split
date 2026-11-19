import { t } from './i18n.js?v=1.5.0.25';

// Keep UI errors concise while preserving actionable server validation messages.
export function userFacingError(error, fallbackKey) {
  const message = String(error?.message || '').trim();
  if (error instanceof TypeError || !message || message.length > 240 || /failed to fetch|networkerror|load failed/i.test(message)) return t(fallbackKey);
  return message;
}
