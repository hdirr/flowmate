// Logs de diagnóstico (por mensagem do webhook, tempos de cada fase do sync): só com
// DEBUG_LOGS=on na Vercel. Erros e o essencial seguem sempre (console.error/warn direto).
export const debugOn = () => process.env.DEBUG_LOGS === 'on';
export function debug(...args) { if (debugOn()) console.log(...args); }
