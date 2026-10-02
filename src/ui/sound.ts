import { Store } from '../store';

// Все звуки синтезируются через Web Audio — звуковых файлов в проекте нет.

export type SoundName = 'card' | 'take' | 'deal' | 'turn' | 'win' | 'safe' | 'lose' | 'matchLost';

const STORAGE_KEY = 'yui.sound';
const MASTER_VOLUME = 0.7;

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const soundSetting = new Store<{ enabled: boolean }>({ enabled: loadEnabled() });

export function setSoundEnabled(enabled: boolean): void {
  soundSetting.set({ enabled });
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // настройка просто не запомнится
  }
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let silenced = false;

/** Глушит звук, пока игра не на виду или площадка поставила её на паузу. */
export function setSoundSilenced(value: boolean): void {
  silenced = value;
  if (!context) return;
  if (value) void context.suspend();
  else void context.resume();
}

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!context) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(context.destination);
    noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  // браузер держит звук выключенным до первого действия пользователя
  if (context.state === 'suspended') void context.resume();
  return context;
}

interface BurstOptions {
  duration: number;
  volume: number;
  attack: number;
  filter: BiquadFilterType;
  frequency: number;
}

/** Короткий шум через фильтр — шелест и шлепок карты. */
function burst(ctx: AudioContext, at: number, o: BurstOptions): void {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = o.filter;
  filter.frequency.value = o.frequency;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(o.volume, at + o.attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + o.duration);
  source.connect(filter).connect(gain).connect(master!);
  // начинаем с разных мест буфера, чтобы одинаковые звуки не звучали как копии
  source.start(at, Math.random() * 0.5, o.duration + 0.05);
}

interface ToneOptions {
  frequency: number;
  /** частота, к которой тон съезжает к концу; по умолчанию не меняется */
  slideTo?: number;
  duration: number;
  volume: number;
  type: OscillatorType;
}

function tone(ctx: AudioContext, at: number, o: ToneOptions): void {
  const oscillator = ctx.createOscillator();
  oscillator.type = o.type;
  oscillator.frequency.setValueAtTime(o.frequency, at);
  if (o.slideTo) oscillator.frequency.exponentialRampToValueAtTime(o.slideTo, at + o.duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(o.volume, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + o.duration);
  oscillator.connect(gain).connect(master!);
  oscillator.start(at);
  oscillator.stop(at + o.duration + 0.05);
}

function flick(ctx: AudioContext, at: number, volume: number): void {
  burst(ctx, at, { duration: 0.07, volume: volume * 0.5, attack: 0.002, filter: 'bandpass', frequency: 1600 });
  tone(ctx, at, { frequency: 150, slideTo: 70, duration: 0.06, volume: volume * 0.3, type: 'sine' });
}

function melody(ctx: AudioContext, at: number, notes: number[], step: number, type: OscillatorType): void {
  notes.forEach((frequency, i) => {
    const last = i === notes.length - 1;
    tone(ctx, at + i * step, { frequency, duration: last ? step * 3 : step * 1.6, volume: 0.18, type });
  });
}

export interface SoundOptions {
  /** сколько карт положили или взяли */
  count?: number;
  /** задержка в секундах */
  delay?: number;
}

export function playSound(name: SoundName, options: SoundOptions = {}): void {
  if (silenced || !soundSetting.get().enabled) return;
  try {
    const ctx = audio();
    if (!ctx) return;
    const at = ctx.currentTime + 0.01 + (options.delay ?? 0);
    const count = options.count ?? 1;
    switch (name) {
      case 'card':
        for (let i = 0; i < count; i++) flick(ctx, at + i * 0.08, 1);
        break;
      case 'take':
        for (let i = 0; i < count; i++) {
          burst(ctx, at + i * 0.09, { duration: 0.15, volume: 0.25, attack: 0.03, filter: 'highpass', frequency: 1800 });
        }
        break;
      case 'deal':
        for (let i = 0; i < 6; i++) flick(ctx, at + i * 0.06, 0.6);
        break;
      case 'turn':
        melody(ctx, at, [784, 1046.5], 0.1, 'sine');
        break;
      case 'win':
        melody(ctx, at, [523.25, 659.25, 783.99, 1046.5], 0.11, 'triangle');
        break;
      case 'safe':
        melody(ctx, at, [523.25, 659.25], 0.14, 'triangle');
        break;
      case 'lose':
        melody(ctx, at, [392, 311.13, 261.63], 0.2, 'sine');
        break;
      case 'matchLost':
        melody(ctx, at, [392, 349.23, 311.13, 261.63, 196], 0.2, 'sine');
        break;
    }
  } catch {
    // звук — украшение: если аудио недоступно, игра продолжается молча
  }
}
