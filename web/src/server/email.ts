//
// email.ts — outbound email via the Resend HTTP API (plain fetch, no SDK).
// When RESEND_API_KEY is not configured, email features are OFF and every
// caller degrades gracefully (self-hosters don't need an email provider).
//

import { config } from './config'
import { log } from './core/logger'

export function emailEnabled(): boolean {
  return !!config.email.resendKey
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!emailEnabled()) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.email.resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: config.email.from, to: [to], subject, html })
    })
    if (!res.ok) {
      log.app.warn(`email send failed: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`)
      return false
    }
    return true
  } catch (err) {
    log.app.warn(`email send failed: ${String(err)}`)
    return false
  }
}

export function verificationEmail(link: string): { subject: string; html: string } {
  return {
    subject: 'Verify your ReCreateHistory account',
    html: `<p>Welcome to ReCreateHistory.</p>
<p><a href="${link}">Click here to verify your email address</a> and activate your account.</p>
<p>If you did not sign up, ignore this email.</p>`
  }
}

export function resetEmail(link: string): { subject: string; html: string } {
  return {
    subject: 'Reset your ReCreateHistory password',
    html: `<p>A password reset was requested for your ReCreateHistory account.</p>
<p><a href="${link}">Click here to set a new password</a>. This link expires in 1 hour.</p>
<p>If you did not request this, ignore this email — your password is unchanged.</p>`
  }
}
