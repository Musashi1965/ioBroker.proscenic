export interface DecodedMapPayload {
  compressed: Buffer;
  restoredBase64Chars: number;
}

export function decodeMapPayload(encodedMap: string): DecodedMapPayload {
  const restored = encodedMap.replace(/\s/gu, "+");
  return {
    compressed: Buffer.from(restored, "base64"),
    restoredBase64Chars: restored === encodedMap ? 0 : encodedMap.length - encodedMap.replace(/\s/gu, "").length,
  };
}

export function decompressLz4Block(input: Buffer, maxOutputBytes: number): Buffer {
  const output = Buffer.alloc(maxOutputBytes);
  let inputOffset = 0;
  let outputOffset = 0;

  while (inputOffset < input.length) {
    const token = input[inputOffset++];
    let literalLength = token >> 4;
    if (literalLength === 15) {
      let next: number;
      do {
        if (inputOffset >= input.length) {
          throw new Error("literal length overflow");
        }
        next = input[inputOffset++];
        literalLength += next;
      } while (next === 255);
    }

    if (inputOffset + literalLength > input.length || outputOffset + literalLength > output.length) {
      throw new Error("literal overrun");
    }
    input.copy(output, outputOffset, inputOffset, inputOffset + literalLength);
    inputOffset += literalLength;
    outputOffset += literalLength;

    if (inputOffset >= input.length) {
      break;
    }
    if (inputOffset + 2 > input.length) {
      throw new Error("offset overrun");
    }
    const matchOffset = input[inputOffset] | (input[inputOffset + 1] << 8);
    inputOffset += 2;
    if (matchOffset === 0 || matchOffset > outputOffset) {
      throw new Error("bad match offset");
    }

    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      let next: number;
      do {
        if (inputOffset >= input.length) {
          throw new Error("match length overflow");
        }
        next = input[inputOffset++];
        matchLength += next;
      } while (next === 255);
    }
    matchLength += 4;
    if (outputOffset + matchLength > output.length) {
      throw new Error("match overrun");
    }
    for (let index = 0; index < matchLength; index++) {
      output[outputOffset + index] = output[outputOffset - matchOffset + index];
    }
    outputOffset += matchLength;
  }

  return output.subarray(0, outputOffset);
}
