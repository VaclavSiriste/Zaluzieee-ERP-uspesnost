/**
 * Diagnostika: které env proměnné jsou na serveru nastavené (bez hodnot).
 * Otevřete: /api/auth/env-status
 */
export default function handler(req, res) {
  const smtpReady = Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS
  )

  res.status(200).json({
    ok: smtpReady && Boolean(process.env.APP_URL?.trim() || process.env.VERCEL_URL),
    checks: {
      ERP_DB_CONNECTION_STRING: Boolean(process.env.ERP_DB_CONNECTION_STRING),
      ERP_DB_CA_CERT: Boolean(process.env.ERP_DB_CA_CERT),
      DAKTELA_DB_CONNECTION_STRING: Boolean(process.env.DAKTELA_DB_CONNECTION_STRING),
      DAKTELA_DB_SSL: process.env.DAKTELA_DB_SSL !== 'false',
      APP_AUTH_SECRET: Boolean(process.env.APP_AUTH_SECRET?.trim()),
      APP_URL: Boolean(process.env.APP_URL?.trim()),
      VERCEL_URL: Boolean(process.env.VERCEL_URL),
      SMTP_HOST: Boolean(process.env.SMTP_HOST?.trim()),
      SMTP_PORT: Boolean(process.env.SMTP_PORT),
      SMTP_USER: Boolean(process.env.SMTP_USER?.trim()),
      SMTP_PASS: Boolean(process.env.SMTP_PASS),
      SMTP_FROM: Boolean(process.env.SMTP_FROM?.trim())
    },
    smtp_ready: smtpReady,
    hint: smtpReady
      ? 'SMTP proměnné jsou nastavené – pokud mail nejde, je špatné heslo/host (viz Logs).'
      : 'Chybí SMTP_HOST, SMTP_USER nebo SMTP_PASS na Vercelu + Redeploy.'
  })
}
