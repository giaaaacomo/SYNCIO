export interface DecodedWatchedField {
  values: boolean[];
  videoIds: string[];
}

export async function decodeWatchedField(
  serialized: string | null | undefined,
  videoIds: string[]
): Promise<DecodedWatchedField> {
  if (!serialized) return { values: new Array(videoIds.length).fill(false), videoIds };
  const components = serialized.split(":");
  if (components.length < 3) throw new Error("Invalid watched field components length.");
  const serializedBuffer = components.pop();
  const oldLengthRaw = components.pop();
  const anchorVideoId = components.join(":");
  if (!serializedBuffer || !oldLengthRaw) throw new Error("Invalid watched field components.");
  const oldLength = Number.parseInt(oldLengthRaw, 10);
  if (!Number.isFinite(oldLength)) throw new Error("Invalid watched field length.");

  const anchorIndex = videoIds.indexOf(anchorVideoId);
  const offset = (oldLength - 1) - anchorIndex;
  const blank = { values: new Array(videoIds.length).fill(false), videoIds };
  if (anchorIndex === -1 || offset < 0) return blank;
  const oldValues = await inflateValues(serializedBuffer, offset > 0 ? oldLength : videoIds.length);
  if (offset === 0) return { values: oldValues, videoIds };

  const values = new Array(videoIds.length).fill(false);
  for (let oldIndex = offset; oldIndex < oldValues.length; oldIndex += 1) {
    values[oldIndex - offset] = oldValues[oldIndex] ?? false;
  }
  return { values, videoIds };
}

export async function setEpisodeWatched(
  serialized: string | null | undefined,
  videoIds: string[],
  videoId: string,
  watched: boolean
): Promise<string> {
  const decoded = await decodeWatchedField(serialized, videoIds);
  const index = videoIds.indexOf(videoId);
  if (index === -1) throw new Error(`Video id not found in Cinemeta video list: ${videoId}`);
  decoded.values[index] = watched;
  return encodeWatchedField(decoded.values, videoIds);
}

export async function encodeWatchedField(values: boolean[], videoIds: string[]): Promise<string> {
  if (videoIds.length === 0) throw new Error("Cannot serialize watched field with no videos.");
  const anchorIndex = lastTrueIndex(values);
  const packed = packWithAnchor(values, videoIds.length, anchorIndex);
  const compressed = await transform(packed, new CompressionStream("deflate"));
  const anchorVideoId = videoIds[anchorIndex];
  if (!anchorVideoId) throw new Error("Cannot serialize watched field without an anchor video.");
  return `${anchorVideoId}:${videoIds.length}:${base64Encode(compressed)}`;
}

async function inflateValues(serialized: string, length: number): Promise<boolean[]> {
  const inflated = await transform(base64Decode(serialized), new DecompressionStream("deflate"));
  const values = new Array(length).fill(false);
  for (let index = 0; index < length; index += 1) {
    const byteIndex = Math.floor(index / 8);
    const bit = index % 8;
    values[index] = ((inflated[byteIndex] ?? 0) & (1 << bit)) !== 0;
  }
  return values;
}

async function transform(
  input: Uint8Array,
  stream: ReadableWritablePair<Uint8Array, BufferSource>
): Promise<Uint8Array> {
  const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
  const readable = new Blob([buffer])
    .stream()
    .pipeThrough(stream);
  return new Uint8Array(await new Response(readable).arrayBuffer());
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

function base64Encode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}
