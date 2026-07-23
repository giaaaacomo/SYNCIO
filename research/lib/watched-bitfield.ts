import { deflateSync, inflateSync } from "node:zlib";

export interface DecodedWatchedField {
  values: boolean[];
  videoIds: string[];
}

export function constructFromSerialized(
  serialized: string | null | undefined,
  videoIds: string[]
): DecodedWatchedField {
  if (!serialized) {
    return { values: new Array(videoIds.length).fill(false), videoIds };
  }

  const components = serialized.split(":");
  if (components.length < 3) throw new Error("invalid watched field components length");

  const serializedBuffer = components.pop();
  const lastLengthRaw = components.pop();
  const lastVideoId = components.join(":");
  if (!serializedBuffer || !lastLengthRaw) throw new Error("invalid watched field components");

  const lastLength = Number.parseInt(lastLengthRaw, 10);
  if (!Number.isFinite(lastLength)) throw new Error("invalid watched field length");

  const lastVideoIdx = videoIds.indexOf(lastVideoId);
  const offset = (lastLength - 1) - lastVideoIdx;
  const blank = { values: new Array(videoIds.length).fill(false), videoIds };

  if (lastVideoIdx === -1 || offset < 0) return blank;

  if (offset > 0) {
    const oldValues = inflateValues(serializedBuffer, lastLength);
    const values = new Array(videoIds.length).fill(false);
    for (let oldIndex = offset; oldIndex < oldValues.length; oldIndex += 1) {
      values[oldIndex - offset] = oldValues[oldIndex] ?? false;
    }
    return { values, videoIds };
  }

  return { values: inflateValues(serializedBuffer, videoIds.length), videoIds };
}

export function setVideoWatched(
  serialized: string | null | undefined,
  videoIds: string[],
  videoId: string,
  watched: boolean
): string {
  const decoded = constructFromSerialized(serialized, videoIds);
  const index = videoIds.indexOf(videoId);
  if (index === -1) throw new Error(`video id not found in Cinemeta video list: ${videoId}`);
  decoded.values[index] = watched;
  return serialize(decoded.values, videoIds);
}

export function serialize(values: boolean[], videoIds: string[]): string {
  if (videoIds.length === 0) throw new Error("cannot serialize watched field with no videos");
  const anchorIndex = lastTrueIndex(values);
  const packed = packWithAnchor(values, videoIds.length, anchorIndex);
  const compressed = deflateSync(packed);
  const anchorVideoId = videoIds[anchorIndex];
  if (!anchorVideoId) throw new Error("cannot serialize watched field without an anchor video");
  return `${anchorVideoId}:${videoIds.length}:${compressed.toString("base64")}`;
}

function inflateValues(serializedBuffer: string, length: number): boolean[] {
  const compressed = Buffer.from(serializedBuffer, "base64");
  const inflated = inflateSync(compressed);
  const values = new Array(length).fill(false);
  for (let index = 0; index < length; index += 1) {
    const byteIndex = Math.floor(index / 8);
    const bit = index % 8;
    values[index] = ((inflated[byteIndex] ?? 0) & (1 << bit)) !== 0;
  }
  return values;
}

function packWithAnchor(values: boolean[], length: number, anchorIndex: number): Uint8Array {
  const packed = new Uint8Array(Math.ceil(length / 8));
  const offset = (length - 1) - anchorIndex;
  for (let index = 0; index <= anchorIndex; index += 1) {
    if (!values[index]) continue;
    const packedIndex = offset + index;
    const byteIndex = Math.floor(packedIndex / 8);
    const bit = packedIndex % 8;
    packed[byteIndex] = (packed[byteIndex] ?? 0) | (1 << bit);
  }
  return packed;
}

function lastTrueIndex(values: boolean[]): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (values[index]) return index;
  }
  return values.length - 1;
}
