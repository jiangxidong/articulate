// Attaches the capture worklet to a source node. The real mic and the test fake mic both come through here.
/** Set by scripts/build.mjs: the worklet's URL with its content hash. */
declare const __AUDIO_WORKLET_URL__: string;

const loaded = new WeakMap<BaseAudioContext, Promise<void>>();
/** Loads the call's audio worklet (capture and player) once per AudioContext: a second load would register twice. */
export function loadAudioWorklet(ctx: BaseAudioContext) {
  let p = loaded.get(ctx);
  if (!p) loaded.set(ctx, (p = ctx.audioWorklet.addModule(__AUDIO_WORKLET_URL__)));
  return p;
}

/** The call's mic settings; the mic check uses the same, so it measures what the call will hear. */
export const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

/** Lets the mic and the speaker run together on iPhone (Safari's Audio Session API). Returns the session type, for the log. */
export function setPlayAndRecord() {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  if (nav.audioSession) nav.audioSession.type = "play-and-record";
  return nav.audioSession?.type ?? "n/a";
}

export interface MicFrame {
  /** 40 ms of 16 kHz mono Int16 PCM. */
  pcm: ArrayBuffer;
  rms: number;
}

export async function startCapture(ctx: AudioContext, source: AudioNode, onFrame: (f: MicFrame) => void) {
  await loadAudioWorklet(ctx);
  const node = new AudioWorkletNode(ctx, "capture");
  node.port.onmessage = (e: MessageEvent<MicFrame>) => onFrame(e.data);
  source.connect(node);
  // Keep the worklet pulled without sending the mic to the speaker.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);
  return () => {
    source.disconnect();
    node.disconnect();
    mute.disconnect();
  };
}
