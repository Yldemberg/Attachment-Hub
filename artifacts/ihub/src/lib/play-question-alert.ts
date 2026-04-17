/** Alerta sonoro curto para nova pergunta do ML. Em alguns mobile browsers o áudio só toca após interação do usuário. */

let audioCtx: AudioContext | undefined;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

export function primeQuestionAlertAudio(): void {
  const ctx = getAudioContext();
  if (ctx?.state === "suspended") void ctx.resume().catch(() => {});
}

export function playNewQuestionAlertSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const play = (): void => {
    const t0 = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.11, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);

    const mk = (start: number, freq: number) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0 + start);
      osc.connect(gain);
      osc.start(t0 + start);
      osc.stop(t0 + start + 0.16);
    };
    mk(0, 880);
    mk(0.14, 660);
  };

  if (ctx.state === "suspended") {
    void ctx.resume().then(play).catch(() => {});
  } else {
    play();
  }
}
