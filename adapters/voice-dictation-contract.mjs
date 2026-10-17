// A declaration only. The browser must never request microphone permission,
// capture audio, upload audio, or choose a transcription service by itself.
export const VOICE_DICTATION_ADAPTER_CONTRACT = Object.freeze({
  version: 'voice-dictation-v1',
  status: 'configuration-required',
  input: 'provider-owned dictation reference',
  output: 'reviewable text draft',
  browserCapture: false,
  audioUpload: false,
  autonomousSend: false,
  requiresHumanReview: true
});
