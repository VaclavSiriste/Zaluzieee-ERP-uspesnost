/**
 * Lokální test SMTP (Seznam / jakýkoli server z .env).
 * Spuštění: yarn test:smtp
 * Volitelně: yarn test:smtp --send vaclav.siriste@zaluzieee.cz
 */
import dotenv from 'dotenv'
import nodemailer from 'nodemailer'

dotenv.config()

function getConfig() {
  const host = process.env.SMTP_HOST?.trim()
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS?.trim()
  const from = process.env.SMTP_FROM?.trim() || user

  return { host, port, user, pass, from, secure: port === 465 }
}

function printMissing(cfg) {
  const missing = []
  if (!cfg.host) missing.push('SMTP_HOST')
  if (!cfg.user) missing.push('SMTP_USER')
  if (!cfg.pass) missing.push('SMTP_PASS')
  return missing
}

const cfg = getConfig()
const missing = printMissing(cfg)

if (missing.length) {
  console.error('Chybí proměnné v .env:', missing.join(', '))
  console.error('')
  console.error('Zkopírujte z Vercelu (Settings → Environment Variables) do Prvni/.env:')
  console.error('  SMTP_HOST=smtp.seznam.cz')
  console.error('  SMTP_PORT=465')
  console.error('  SMTP_USER=vase-adresa@zaluzieee.cz')
  console.error('  SMTP_PASS=heslo-nebo-heslo-pro-aplikace')
  console.error('  SMTP_FROM=Dashboard <vase-adresa@zaluzieee.cz>')
  process.exit(1)
}

const sendTo = process.argv.includes('--send')
  ? process.argv[process.argv.indexOf('--send') + 1]
  : null

console.log('SMTP test')
console.log('  host:', cfg.host)
console.log('  port:', cfg.port, cfg.secure ? '(SSL)' : '(STARTTLS)')
console.log('  user:', cfg.user)
console.log('  pass:', cfg.pass ? `*** (${cfg.pass.length} znaků)` : '(prázdné)')
console.log('')

const transporter = nodemailer.createTransport({
  host: cfg.host,
  port: cfg.port,
  secure: cfg.secure,
  auth: { user: cfg.user, pass: cfg.pass },
  ...(cfg.port === 587 ? { requireTLS: true } : {})
})

try {
  console.log('1/2 Přihlášení k SMTP (verify)...')
  await transporter.verify()
  console.log('    OK – credentials accepted')
} catch (error) {
  console.error('    CHYBA:', error.message)
  if (String(error.message).includes('535')) {
    console.error('')
    console.error('535 = špatné heslo nebo login.')
    console.error('  • Ověřte přihlášení na https://email.seznam.cz')
    console.error('  • Při 2FA použijte Heslo pro aplikace na https://ucet.seznam.cz')
    console.error('  • SMTP_USER musí být celá e-mailová adresa')
  }
  process.exit(1)
}

if (!sendTo) {
  console.log('')
  console.log('Přihlášení funguje. Pro odeslání testovacího mailu:')
  console.log(`  yarn test:smtp --send ${cfg.user}`)
  process.exit(0)
}

try {
  console.log(`2/2 Odesílám testovací mail na ${sendTo}...`)
  await transporter.sendMail({
    from: cfg.from,
    to: sendTo,
    subject: 'SMTP test – dashboard',
    text: 'Pokud vidíte tento e-mail, SMTP funguje správně.'
  })
  console.log('    OK – mail odeslán (zkontrolujte Doručené i Spam)')
} catch (error) {
  console.error('    CHYBA při odesílání:', error.message)
  process.exit(1)
}
