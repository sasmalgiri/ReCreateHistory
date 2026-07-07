//
// legal.ts — Terms of Service + Privacy Policy pages, served at /terms and
// /privacy. Plain-language defaults suitable for an early-access deployment;
// the operator should review them (this is a template, not legal advice).
//

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ReCreateHistory</title>
<style>
  body{background:#0f1219;color:#d5d9e2;font-family:Segoe UI,system-ui,sans-serif;
       max-width:760px;margin:0 auto;padding:48px 24px;line-height:1.6}
  h1{color:#fff;font-size:1.6rem} h2{color:#e0b980;font-size:1.1rem;margin-top:2em}
  a{color:#e0b980} .muted{color:#8591aa;font-size:.85rem}
</style></head><body>
<p class="muted"><a href="/">← ReCreateHistory</a></p>
${body}
<p class="muted">Last updated: 2026-07-08</p>
</body></html>`
}

export const termsHtml = page('Terms of Service', `
<h1>Terms of Service</h1>
<p>These terms govern your use of this ReCreateHistory instance (the "Service"),
operated by the owner of this deployment (the "Operator").</p>

<h2>1. The Service</h2>
<p>ReCreateHistory lets you upload documents and reconstructs an evidence-backed
view of events from them: timelines, entities, claims, contradictions, and
cited answers. Reconstructions are labeled by how they are known (observed,
asserted, derived, inferred, contradicted) and are <strong>not</strong> statements of
absolute truth. You are responsible for verifying conclusions before relying on
them in legal, financial, journalistic, or other consequential contexts. The
Service does not provide legal advice.</p>

<h2>2. Your account</h2>
<p>You must provide accurate signup information and keep your password secure.
You are responsible for activity under your account. The Operator may suspend
accounts that abuse the Service (excessive load, unlawful content, attempts to
access other users' data).</p>

<h2>3. Your content</h2>
<p>You retain all rights to the documents you upload. You grant the Service
permission to store and process them solely to provide the features to you.
You must have the right to upload what you upload; do not upload content that
is unlawful for you to possess or process.</p>

<h2>4. Acceptable use</h2>
<p>No attempts to breach account isolation, probe or overload the Service,
or use it to violate others' rights or applicable law. Resource quotas
(storage, daily questions) apply and may change.</p>

<h2>5. Availability and warranty</h2>
<p>The Service is provided "as is", without warranty of any kind, during early
access. The Operator may modify or discontinue features. To the maximum extent
permitted by law, the Operator is not liable for indirect or consequential
damages arising from use of the Service.</p>

<h2>6. Termination</h2>
<p>You may stop using the Service at any time and request deletion of your
data. The Operator may terminate accounts for breach of these terms.</p>

<h2>7. Changes</h2>
<p>These terms may be updated; continued use after an update constitutes
acceptance. Material changes will be noted on this page.</p>
`)

export const privacyHtml = page('Privacy Policy', `
<h1>Privacy Policy</h1>
<p>This policy describes how this ReCreateHistory instance handles your data.</p>

<h2>What is collected</h2>
<ul>
<li><strong>Account data:</strong> email address, display name (optional), and a
salted bcrypt hash of your password — never the password itself.</li>
<li><strong>Your documents:</strong> files you upload and the structured data
derived from them (text blocks, entities, events, claims, timelines). These are
stored in a per-account ledger isolated from every other account.</li>
<li><strong>Operational records:</strong> ingestion logs, answer audit records
(your questions and the evidence used to answer them), and resource-usage
counters (storage, daily questions) used to enforce quotas.</li>
</ul>

<h2>How it is used</h2>
<p>Solely to provide the Service to you: parsing, indexing, reconstruction, and
answering your questions. Your data is never sold, shared with other users, or
used to train models.</p>

<h2>AI processing</h2>
<p>Question answering may send <em>excerpts of your documents</em> to a
configured AI model — either a local model on the Operator's server (Ollama) or
a third-party API (such as Anthropic or OpenAI) acting as a processor. Facts in
history reconstructions come from your documents, not from the model. If this
deployment uses a third-party AI API, that provider's data-usage terms apply to
those excerpts.</p>

<h2>Storage and security</h2>
<p>Data is stored in per-account databases on the Operator's server. Sessions
use httpOnly cookies; passwords are bcrypt-hashed; original files are kept with
SHA-256 integrity hashes. Transport encryption (HTTPS) is provided by the
hosting platform.</p>

<h2>Retention and deletion</h2>
<p>Your data is retained while your account is active. You can delete individual
files in-app; to delete your account and all associated data, contact the
Operator. Deletion removes your ledger, uploads, and account record.</p>

<h2>Contact</h2>
<p>For privacy requests, contact the Operator of this deployment.</p>
`)
