const SPEECH_LOCALE_BY_LANGUAGE: Record<string, string> = {
  en: 'en-US',
  'en-US': 'en-US',
  'en-GB': 'en-GB',
  es: 'es-ES',
  'es-ES': 'es-ES',
  tr: 'tr-TR',
  'pt-BR': 'pt-BR',
  'pt-br': 'pt-BR',
  fr: 'fr-FR',
  nl: 'nl-NL',
  de: 'de-DE',
  it: 'it-IT',
  ar: 'ar-SA',
  ru: 'ru-RU',
};

const speechQueue: string[] = [];
let isSpeaking = false;
let voicesReady = false;

/** Browser TTS caps volume at 1; repeating cuts through a noisy kitchen better. */
const SPEECH_REPEAT = 2;

const getSpeechLocale = (language: string) =>
  SPEECH_LOCALE_BY_LANGUAGE[language]
  ?? SPEECH_LOCALE_BY_LANGUAGE[language.split('-')[0] ?? '']
  ?? 'en-US';

const ensureVoices = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return;
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    voicesReady = true;
  }
};

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  ensureVoices();
  window.speechSynthesis.addEventListener('voiceschanged', ensureVoices);
}

/** Prefer local OS voices: usually fuller and more reliable on POS tablets than remote ones. */
const pickBest = (candidates: SpeechSynthesisVoice[]) => {
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates.find((v) => v.localService && v.default)
    ?? candidates.find((v) => v.localService)
    ?? candidates.find((v) => v.default)
    ?? candidates[0];
};

const pickVoice = (language: string): SpeechSynthesisVoice | undefined => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return undefined;
  }

  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) {
    return undefined;
  }

  const locale = getSpeechLocale(language);
  const exact = voices.filter((v) => v.lang === locale);
  if (exact.length > 0) {
    return pickBest(exact);
  }

  const prefix = locale.split('-')[0].toLowerCase();
  return pickBest(voices.filter((v) => v.lang.toLowerCase().startsWith(prefix)));
};

const processSpeechQueue = (language: string) => {
  if (isSpeaking || speechQueue.length === 0 || typeof window === 'undefined') {
    return;
  }

  if (!('speechSynthesis' in window)) {
    speechQueue.length = 0;
    return;
  }

  // Chrome often leaves synthesis paused, which blocks speak().
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }

  const text = speechQueue.shift();
  if (!text) {
    return;
  }

  isSpeaking = true;
  const utterance = new SpeechSynthesisUtterance(text);
  const locale = getSpeechLocale(language);
  utterance.lang = locale;
  // Slightly slower + a touch lower pitch reads louder in a noisy room.
  utterance.rate = 0.88;
  utterance.pitch = 0.85;
  utterance.volume = 1;

  const voice = pickVoice(language);
  if (voice) {
    utterance.voice = voice;
  }

  utterance.onend = () => {
    isSpeaking = false;
    processSpeechQueue(language);
  };
  utterance.onerror = () => {
    isSpeaking = false;
    processSpeechQueue(language);
  };

  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    isSpeaking = false;
    processSpeechQueue(language);
    return;
  }

  // Chrome bug: speak() sometimes no-ops until a tick / cancel-retry.
  window.setTimeout(() => {
    if (!isSpeaking) {
      return;
    }
    if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } catch {
        isSpeaking = false;
        processSpeechQueue(language);
      }
    }
  }, 250);
};

export const speakOrderReady = (text: string, language: string) => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return;
  }

  const trimmed = text?.trim();
  if (!trimmed) {
    return;
  }

  ensureVoices();
  for (let i = 0; i < SPEECH_REPEAT; i++) {
    speechQueue.push(trimmed);
  }

  // Defer if voices are not ready yet (first load).
  if (!voicesReady && window.speechSynthesis.getVoices().length === 0) {
    const onVoices = () => {
      voicesReady = true;
      window.speechSynthesis.removeEventListener('voiceschanged', onVoices);
      processSpeechQueue(language);
    };
    window.speechSynthesis.addEventListener('voiceschanged', onVoices);
    // Fallback in case voiceschanged never fires.
    window.setTimeout(() => processSpeechQueue(language), 300);
    return;
  }

  processSpeechQueue(language);
};

/** Call once after a user gesture so browsers unlock speech. */
export const unlockSpeech = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return;
  }

  ensureVoices();
  try {
    // No-op utterance primes Chrome's autoplay policy after a click.
    const unlock = new SpeechSynthesisUtterance(' ');
    unlock.volume = 0;
    unlock.rate = 10;
    window.speechSynthesis.speak(unlock);
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
};

export const cancelOrderReadySpeech = () => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return;
  }

  speechQueue.length = 0;
  isSpeaking = false;
  window.speechSynthesis.cancel();
};

let chimeContext: AudioContext | null = null;

const getChimeContext = (): AudioContext | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  if (!chimeContext) {
    chimeContext = new Ctor();
  }
  return chimeContext;
};

/** Call after a user gesture so the browser lets the chime play later. */
export const unlockReadyChime = () => {
  const context = getChimeContext();
  if (context?.state === 'suspended') {
    void context.resume().catch(() => undefined);
  }
};

const READY_VIBRATION_MS = [400, 150, 400, 150, 600];

/**
 * Three buzzes for a tablet in a pocket or a noisy room. Android only: iOS
 * Safari and desktops have no Vibration API, and it needs an earlier tap.
 */
export const vibrateOrderReady = (): 'unsupported' | 'blocked' | 'sent' => {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return 'unsupported';
  }
  try {
    // 'sent' only means the browser accepted it: a device without a motor stays still.
    return navigator.vibrate(READY_VIBRATION_MS) ? 'sent' : 'blocked';
  } catch {
    return 'blocked';
  }
};

/**
 * Loud attention tones before speech. Square + saw layers push harder than a
 * single triangle; gain sits at the Web Audio ceiling.
 */
export const playReadyChime = () => {
  const context = getChimeContext();
  if (!context) {
    return;
  }
  if (context.state === 'suspended') {
    void context.resume().catch(() => undefined);
  }

  const start = context.currentTime;
  const tones: Array<{ frequency: number; at: number; type: OscillatorType; peak: number }> = [
    { frequency: 880, at: 0, type: 'square', peak: 1 },
    { frequency: 1760, at: 0, type: 'sawtooth', peak: 0.55 },
    { frequency: 1175, at: 0.26, type: 'square', peak: 1 },
    { frequency: 2350, at: 0.26, type: 'sawtooth', peak: 0.55 },
    { frequency: 1320, at: 0.52, type: 'square', peak: 1 },
    { frequency: 2640, at: 0.52, type: 'sawtooth', peak: 0.6 },
  ];

  tones.forEach(({ frequency, at: offset, type, peak }) => {
    const at = start + offset;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.38);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.4);
  });
};
