import { isAllowedEmail, getAllowedDomain } from '@/lib/auth'
import {
  createCodeChallenge,
  createMagicLoginToken,
  generateLoginCode
} from '@/lib/auth-challenge'
import { buildMagicLoginUrl, sendLoginEmail } from '@/lib/email'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const nextPath =
    typeof req.body?.next === 'string' && req.body.next.startsWith('/') ? req.body.next : '/'

  if (!isAllowedEmail(email)) {
    return res.status(400).json({
      error: `Povolené jsou pouze e-maily s doménou ${getAllowedDomain()}.`
    })
  }

  try {
    const code = generateLoginCode()
    const challengeId = createCodeChallenge(email, code)
    const magicToken = createMagicLoginToken(email, nextPath)
    const magicUrl = buildMagicLoginUrl(magicToken, nextPath)
    const delivery = await sendLoginEmail({ email, code, magicUrl })

    const response = {
      ok: true,
      message: 'Na e-mail jsme odeslali přihlašovací kód a odkaz.',
      challengeId
    }

    if (delivery.devMode && process.env.NODE_ENV !== 'production') {
      response.devCode = code
      response.devMagicUrl = magicUrl
    }

    return res.status(200).json(response)
  } catch (error) {
    console.error('request-code error:', error.message)
    return res.status(500).json({
      error: 'Nepodařilo se odeslat přihlašovací e-mail. Zkuste to znovu nebo kontaktujte správce.'
    })
  }
}
