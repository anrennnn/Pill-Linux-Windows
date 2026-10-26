// Sonidos generados con WebAudio: aviso al terminar y ambientes para concentrarse.
// No se distribuye ningún archivo de audio.

let ctx = null;
const audio = () => (ctx = ctx || new AudioContext());

export function chime() {
  try {
    const ac = audio();
    const now = ac.currentTime;
    [660, 880, 1320].forEach((freq, i) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.14);
      g.gain.linearRampToValueAtTime(0.18, now + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.6);
      o.connect(g).connect(ac.destination);
      o.start(now + i * 0.14);
      o.stop(now + i * 0.14 + 0.65);
    });
  } catch (_) {
    /* sin audio disponible */
  }
}

export const AMBIENTS = { rain: "Lluvia", brown: "Ruido marrón", pink: "Ruido rosa", waves: "Olas" };

function noiseBuffer(ac, kind) {
  const len = ac.sampleRate * 4;
  const buf = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let last = 0;
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === "brown" || kind === "waves") {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        // Filtro de Paul Kellet para ruido rosa.
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }
    }
  }
  return buf;
}

let current = null;

export function playAmbient(kind, volume = 0.35) {
  stopAmbient();
  if (!AMBIENTS[kind]) return;
  try {
    const ac = audio();
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, kind === "rain" ? "pink" : kind);
    src.loop = true;
    const gain = ac.createGain();
    gain.gain.value = 0;
    let node = src;
    const extras = [];
    if (kind === "rain") {
      const hp = ac.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      node.connect(hp);
      node = hp;
    }
    if (kind === "waves") {
      // Un oscilador lento modula el volumen como el vaivén del mar.
      const lfo = ac.createOscillator();
      const depth = ac.createGain();
      lfo.frequency.value = 0.12;
      depth.gain.value = 0.45;
      const swell = ac.createGain();
      swell.gain.value = 0.55;
      lfo.connect(depth).connect(swell.gain);
      lfo.start();
      node.connect(swell);
      node = swell;
      extras.push(lfo);
    }
    node.connect(gain).connect(ac.destination);
    src.start();
    gain.gain.linearRampToValueAtTime(volume, ac.currentTime + 1.2);
    current = { src, gain, extras, kind };
  } catch (_) {
    current = null;
  }
}

export function setAmbientVolume(volume) {
  if (current) current.gain.gain.setTargetAtTime(volume, audio().currentTime, 0.1);
}

export function stopAmbient() {
  if (!current) return;
  const { src, gain, extras } = current;
  const ac = audio();
  gain.gain.setTargetAtTime(0, ac.currentTime, 0.25);
  setTimeout(() => {
    try {
      src.stop();
      extras.forEach((e) => e.stop());
    } catch (_) {}
  }, 900);
  current = null;
}

export const ambientPlaying = () => current?.kind || null;
