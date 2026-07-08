//
// asr.ts (desktop) — no transcription engine is bundled with the local app
// (local Whisper is the follow-on; Ollama has no ASR). Audio files are
// recorded honestly as unsupported. The hosted web app transcribes via its
// configured cloud AI.
//

export async function tryTranscribe(_path: string, _format: string): Promise<string | null> {
  return null
}
