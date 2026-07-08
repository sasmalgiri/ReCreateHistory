import { tryOcr } from './src/main/ingestion/ocr'
import { tryTranscribe } from './src/main/ingestion/asr'
const ocr = await tryOcr('C:/Users/USER/AppData/Local/Temp/claude/d--Shirshendu-sasmal-ReCreateHistory/bfd9f621-b8bd-453e-b567-8112ef4dd594/scratchpad/scan.png', 'png')
console.log('TESSERACT OCR:', ocr ? ocr.replace(/\s+/g, ' ').slice(0, 120) : 'NULL')
console.log('OCR CHECK:', ocr?.includes('INV-2001') && /Acme/i.test(ocr || '') ? 'PASS' : 'FAIL')
const t = await tryTranscribe('C:/Users/USER/AppData/Local/Temp/claude/d--Shirshendu-sasmal-ReCreateHistory/bfd9f621-b8bd-453e-b567-8112ef4dd594/scratchpad/speech.wav', 'wav')
console.log('WHISPER:', t ? t.slice(0, 140) : 'NULL')
console.log('ASR CHECK:', /acme/i.test(t || '') && /march/i.test(t || '') ? 'PASS' : 'FAIL')
