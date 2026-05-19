import nodemailer from 'nodemailer'

function getSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim()
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM?.trim() || user

  if (!host || !user || !pass) return null

  return {
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    from
  }
}

function getAppUrl() {
  const value = process.env.APP_URL?.trim() || process.env.VERCEL_URL
  if (!value) return 'http://localhost:3200'
  if (value.startsWith('http')) return value.replace(/\/$/, '')
  return `https://${value.replace(/\/$/, '')}`
}

export function isEmailConfigured() {
  return Boolean(getSmtpConfig())
}

export async function sendLoginEmail({ email, code, magicUrl }) {
  const smtp = getSmtpConfig()
  if (!smtp) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP není nakonfigurované (SMTP_HOST, SMTP_USER, SMTP_PASS).')
    }
    console.log('[auth] SMTP chybí – přihlašovací kód pro', email, ':', code)
    console.log('[auth] Magic link:', magicUrl)
    return { delivered: false, devMode: true }
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.auth
  })

  const subject = `Přihlášení do dashboardu – kód ${code}`
  const text = [
    'Dobrý den,',
    '',
    `váš přihlašovací kód je: ${code}`,
    'Platnost kódu je 15 minut.',
    '',
    'Nebo se přihlaste jedním kliknutím:',
    magicUrl,
    '',
    'Pokud jste o přihlášení nežádali, tento e-mail ignorujte.'
  ].join('\n')

  const html = [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">',
    '<p>Dobrý den,</p>',
    '<p>váš přihlašovací kód pro dashboard:</p>',
    `<p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>`,
    '<p>Platnost kódu je <strong>15 minut</strong>.</p>',
    '<p>',
    `<a href="${magicUrl}" style="display:inline-block;padding:12px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">`,
    'Přihlásit se jedním kliknutím',
    '</a>',
    '</p>',
    `<p style="font-size:12px;color:#64748b">Pokud tlačítko nefunguje, zkopírujte odkaz:<br>${magicUrl}</p>`,
    '</div>'
  ].join('')

  await transporter.sendMail({
    from: smtp.from,
    to: email,
    subject,
    text,
    html
  })

  return { delivered: true, devMode: false }
}

export function buildMagicLoginUrl(token, nextPath = '/') {
  const base = getAppUrl()
  const params = new URLSearchParams({ token })
  if (nextPath && nextPath !== '/') {
    params.set('next', nextPath)
  }
  return `${base}/api/auth/verify?${params.toString()}`
}
