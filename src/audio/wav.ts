/**
 * 最小限の WAV(PCM)リーダ/ライタ。依存を増やさないため自前実装。
 * 対応: PCM(fmt=1) のみ。fmt チャンクから rate/bits/channels を読む。
 */

export interface WavData {
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
  /** インターリーブされた生サンプル(Int16Array, 16bit前提) */
  samples: Int16Array;
}

export function parseWav(buf: Buffer): WavData {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }
  let offset = 12;
  let fmt: { rate: number; bits: number; channels: number; format: number } | null = null;
  let dataOffset = -1;
  let dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      dataOffset = body;
      dataLen = size;
    }
    offset = body + size + (size % 2); // チャンクは偶数境界
  }
  if (!fmt) throw new Error("Missing fmt chunk");
  if (dataOffset < 0) throw new Error("Missing data chunk");
  if (fmt.format !== 1) throw new Error(`Unsupported WAV format ${fmt.format} (PCM only)`);
  if (fmt.bits !== 16) throw new Error(`Unsupported bit depth ${fmt.bits} (16-bit only)`);

  const sampleCount = Math.floor(dataLen / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2);
  }
  return {
    sampleRate: fmt.rate,
    bitsPerSample: fmt.bits,
    channels: fmt.channels,
    samples,
  };
}

/** Int16 サンプルから WAV(PCM 16bit) Buffer を作る */
export function writeWav(
  samples: Int16Array,
  sampleRate: number,
  channels = 1,
): Buffer {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  buf.writeUInt16LE(channels * 2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i]!, 44 + i * 2);
  return buf;
}

/** raw PCM バイト列(little-endian 16bit)を取り出す。'p' フレーム送信用。 */
export function pcmBytes(wav: WavData): Buffer {
  // mono 前提。多チャンネルなら先頭チャンネルへダウンミックス。
  if (wav.channels === 1) {
    return Buffer.from(wav.samples.buffer, wav.samples.byteOffset, wav.samples.byteLength);
  }
  const frames = Math.floor(wav.samples.length / wav.channels);
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = wav.samples[i * wav.channels]!;
  return Buffer.from(mono.buffer, mono.byteOffset, mono.byteLength);
}
