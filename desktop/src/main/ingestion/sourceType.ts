//
// sourceType.ts — best-effort SourceType detection from a file path.
// Ported from SourceType.detect(from:) in the Swift Core/Models.
//

import { extname, basename } from 'node:path'
import type { SourceType } from '../../shared/models'

export function detectSourceType(path: string): SourceType {
  const ext = extname(path).toLowerCase().replace('.', '')
  const name = basename(path).toLowerCase()
  if (name === 'chat.db' || path.toLowerCase().includes('/messages/')) return 'imessage'
  switch (ext) {
    case 'pdf': return 'pdf'
    case 'docx': return 'docx'
    case 'doc': return 'doc'
    case 'txt': case 'log': return 'txt'
    case 'md': case 'markdown': return 'markdown'
    case 'rtf': return 'rtf'
    case 'odt': return 'odt'
    case 'epub': return 'epub'
    case 'xlsx': return 'xlsx'
    case 'xls': return 'xls'
    case 'csv': case 'tsv': return 'csv'
    case 'ods': return 'ods'
    case 'pptx': return 'pptx'
    case 'ppt': return 'ppt'
    case 'key': return 'keynote'
    case 'mbox': return 'mbox'
    case 'pst': return 'pst'
    case 'eml': return 'eml'
    case 'emlx': return 'appleMail'
    case 'msg': return 'msg'
    case 'nsf': return 'nsf'
    case 'png': return 'png'
    case 'jpg': case 'jpeg': return 'jpg'
    case 'heic': return 'heic'
    case 'tiff': case 'tif': return 'tiff'
    case 'webp': return 'webp'
    case 'mp3': return 'mp3'
    case 'wav': return 'wav'
    case 'm4a': return 'm4a'
    case 'aac': return 'aac'
    case 'mp4': return 'mp4'
    case 'mov': return 'mov'
    case 'zip': return 'zip'
    case 'rar': return 'rar'
    case '7z': return 'sevenZip'
    case 'html': case 'htm': return 'html'
    case 'json': return 'json'
    default: return 'unknown'
  }
}
