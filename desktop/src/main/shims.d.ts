// Ambient module shims for untyped CJS deps loaded lazily by the ingest loaders.
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
    numpages: number
    info?: unknown
    metadata?: unknown
  }
  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>
  export default pdfParse
}
