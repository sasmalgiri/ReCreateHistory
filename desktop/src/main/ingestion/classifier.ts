//
// classifier.ts — lightweight document classification (ported from
// Ingestion/Classification/DocumentClassifier.swift). Heuristic labels that
// help experts + routing; not a hard branch on file type (formats already
// died at ingestion).
//

export type DocClass =
  | 'invoice' | 'contract' | 'email' | 'report' | 'spreadsheet'
  | 'presentation' | 'note' | 'receipt' | 'resume' | 'article' | 'unknown'

export function classify(content: string, hintSourceType?: string): DocClass {
  const t = content.toLowerCase().slice(0, 4000)
  if (hintSourceType && ['eml', 'mbox', 'msg', 'appleMail'].includes(hintSourceType)) return 'email'
  if (/\binvoice\b|\bamount due\b|\bbill to\b|\binvoice (no|number)\b/.test(t)) return 'invoice'
  if (/\breceipt\b|\bsubtotal\b|\bpaid\b.*\btotal\b/.test(t)) return 'receipt'
  if (/\bagreement\b|\bthis contract\b|\bparties\b|\bhereinafter\b|\bwhereas\b|\bterms and conditions\b/.test(t)) return 'contract'
  if (/\bcurriculum vitae\b|\bwork experience\b|\beducation\b.*\bskills\b/.test(t)) return 'resume'
  if (/\bexecutive summary\b|\bfindings\b|\bmethodology\b|\bconclusion\b/.test(t)) return 'report'
  if (/\babstract\b|\breferences\b|\bcitation\b/.test(t)) return 'article'
  return 'unknown'
}
