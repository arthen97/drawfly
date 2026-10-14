/**
 * Sound: the merouter-generated soundtrack (title / race / victory) streamed through Web Audio,
 * plus synthesized kart sounds — engine, drift screech, boost whoosh, backfire pops, countdown beeps.
 * Browsers only allow audio after a user gesture, so nothing plays until unlock() is called.
 */
const TRACKS = {
  title: { url: "./assets/audio/music-title.mp3", loop: true, gain: 0.55 },
  race: { url: "./assets/audio/music-race.mp3", loop: true, gain: 0.42 },
  victory: { url: "./assets/audio/music-victory.mp3", loop: false, gain: 0.6 },
};

export function createAudio() {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const musicBus = ctx.createGain();
  const sfxBus = ctx.createGain();
  musicBus.connect(master);
  sfxBus.connect(master);
  sfxBus.gain.value = 0.7;

  const buffers = {};
  const loading = Object.fromEntries(Object.entries(TRACKS).map(([name, t]) => [
    name,
    fetch(t.url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).then((buf) => (buffers[name] = buf)),
  ]));

  let current = null;
  let wanted = null;
  async function music(name) {
    wanted = name;
    if (current?.name === name) return;
    const now = ctx.currentTime;
    if (current) {
      current.gain.gain.cancelScheduledValues(now);
      current.gain.gain.setTargetAtTime(0, now, 0.25);
      current.src.stop(now + 1.5);
      current = null;
    }
    if (!name) return;
    const buf = buffers[name] ?? (await loading[name]);
    if (wanted !== name) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = TRACKS[name].loop;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(TRACKS[name].gain, ctx.currentTime, 0.15);
    src.connect(gain).connect(musicBus);
    src.start();
    current = { name, src, gain };
  }

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noiseSource = () => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    return s;
  };

  // Engine: two detuned saws through a lowpass, pitch follows speed.
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = "lowpass";
  engineFilter.Q.value = 4;
  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  oscA.type = "sawtooth";
  oscB.type = "square";
  const bGain = ctx.createGain();
  bGain.gain.value = 0.35;
  oscA.connect(engineFilter);
  oscB.connect(bGain).connect(engineFilter);
  engineFilter.connect(engineGain).connect(sfxBus);
  oscA.start();
  oscB.start();

  // Drift: band-passed noise, gain while sliding.
  const screech = noiseSource();
  const screechFilter = ctx.createBiquadFilter();
  screechFilter.type = "bandpass";
  screechFilter.frequency.value = 2400;
  screechFilter.Q.value = 6;
  const screechGain = ctx.createGain();
  screechGain.gain.value = 0;
  screech.connect(screechFilter).connect(screechGain).connect(sfxBus);
  screech.start();

  function oneShot(build, duration) {
    const g = ctx.createGain();
    g.connect(sfxBus);
    build(g, ctx.currentTime);
    setTimeout(() => g.disconnect(), duration * 1000 + 200);
  }

  return {
    ctx,
    music,
    unlock() {
      if (ctx.state !== "running") ctx.resume();
    },
    set muted(m) {
      master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.05);
      this._muted = m;
    },
    get muted() {
      return !!this._muted;
    },
    engine({ speed = 0, throttle = 0, boost = false, drifting = false, stage = 0, active = true }) {
      const t = ctx.currentTime;
      const rpm = 70 + speed * 4.2 + throttle * 25 + (boost ? 40 : 0);
      oscA.frequency.setTargetAtTime(rpm, t, 0.05);
      oscB.frequency.setTargetAtTime(rpm * 0.501, t, 0.05);
      engineFilter.frequency.setTargetAtTime(500 + speed * 40 + throttle * 600, t, 0.05);
      engineGain.gain.setTargetAtTime(active ? 0.05 + throttle * 0.05 + (boost ? 0.04 : 0) : 0, t, 0.08);
      screechGain.gain.setTargetAtTime(active && drifting ? 0.07 + stage * 0.03 : 0, t, 0.05);
      screechFilter.frequency.setTargetAtTime(2200 + stage * 700, t, 0.1);
    },
    whoosh() {
      oneShot((g, t) => {
        const n = noiseSource();
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.Q.value = 1.2;
        f.frequency.setValueAtTime(400, t);
        f.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        n.connect(f).connect(g);
        n.start(t);
        n.stop(t + 1);
      }, 1);
    },
    pop() {
      oneShot((g, t) => {
        const n = noiseSource();
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 900 + Math.random() * 500;
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        n.connect(f).connect(g);
        n.start(t);
        n.stop(t + 0.12);
      }, 0.15);
    },
    chime(stage) {
      oneShot((g, t) => {
        const o = ctx.createOscillator();
        o.type = "triangle";
        const base = stage === 2 ? 880 : 660;
        o.frequency.setValueAtTime(base, t);
        o.frequency.setValueAtTime(base * 1.5, t + 0.07);
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.32);
      }, 0.35);
    },
    beep(high = false) {
      oneShot((g, t) => {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = high ? 1320 : 660;
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + (high ? 0.6 : 0.25));
        o.connect(g);
        o.start(t);
        o.stop(t + 0.7);
      }, 0.7);
    },
    click() {
      oneShot((g, t) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(900, t);
        o.frequency.exponentialRampToValueAtTime(1500, t + 0.05);
        g.gain.setValueAtTime(0.1, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.12);
      }, 0.15);
    },
  };
}
