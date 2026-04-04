function createBaseFrame(seed) {
  const size = 1024;
  const buffer = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    buffer[index] = 128 + Math.round(Math.sin(seed + index * 0.1) * 48);
  }
  return buffer;
}

export function createDemoAudioFrame(frame) {
  const main = createBaseFrame(frame * 0.11);
  const left = createBaseFrame(frame * 0.13 + 0.7);
  const right = createBaseFrame(frame * 0.17 + 1.3);

  return {
    frame,
    timeByteArray: main,
    timeByteArrayL: left,
    timeByteArrayR: right,
  };
}

export class DemoAudioSource {
  constructor() {
    this.frame = 0;
  }

  getFrame() {
    this.frame += 1;
    return createDemoAudioFrame(this.frame);
  }
}

export class MicrophoneAudioSource {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.analyserL = null;
    this.analyserR = null;
    this.frame = 0;
    this.timeByteArray = new Uint8Array(1024);
    this.timeByteArrayL = new Uint8Array(1024);
    this.timeByteArrayR = new Uint8Array(1024);
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(stream);
    const splitter = this.audioContext.createChannelSplitter(2);
    source.connect(splitter);

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);

    this.analyserL = this.audioContext.createAnalyser();
    this.analyserL.fftSize = 1024;
    this.analyserR = this.audioContext.createAnalyser();
    this.analyserR.fftSize = 1024;
    splitter.connect(this.analyserL, 0);
    splitter.connect(this.analyserR, 1);
  }

  getFrame() {
    if (!this.analyser) {
      return createDemoAudioFrame(this.frame);
    }

    this.frame += 1;
    this.analyser.getByteTimeDomainData(this.timeByteArray);
    this.analyserL.getByteTimeDomainData(this.timeByteArrayL);
    this.analyserR.getByteTimeDomainData(this.timeByteArrayR);
    return {
      frame: this.frame,
      timeByteArray: new Uint8Array(this.timeByteArray),
      timeByteArrayL: new Uint8Array(this.timeByteArrayL),
      timeByteArrayR: new Uint8Array(this.timeByteArrayR),
    };
  }
}

