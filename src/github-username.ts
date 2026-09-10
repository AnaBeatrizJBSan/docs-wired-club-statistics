// Codes from the supplied screenshot: 0=space, 1..26=a..z, 27=hyphen; digits 0..9 extend the map at 28..37.
export const GITHUB_CHARACTER_MAP = " abcdefghijklmnopqrstuvwxyz-0123456789";
export type PackedNumber = bigint | number | string;

function asBigInt(value: PackedNumber): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("Packed numbers above Number.MAX_SAFE_INTEGER must be bigint or decimal strings.");
  }
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    throw new Error("Packed values must be unsigned decimal integers.");
  }
  const number = BigInt(value);
  if (number < 0n || number > 0x7fffffffffffffffn) {
    throw new Error("Packed values must fit in a nonnegative signed 64-bit integer.");
  }
  return number;
}

function validateMap(charMap: string) {
  if (charMap.length < 2 || charMap.length > 64 || new Set(charMap).size !== charMap.length) {
    throw new Error("The character map must contain 2–64 unique characters.");
  }
}

/** Decode most-significant character first, in the order of the packed parts. */
export function unpack6Bit(numbers: readonly PackedNumber[], charMap = GITHUB_CHARACTER_MAP): string {
  validateMap(charMap);
  let result = "";
  for (const value of numbers) {
    let number = asBigInt(value);
    let part = "";
    while (number > 0n) {
      const code = Number(number & 63n);
      const character = charMap[code];
      if (character === undefined) throw new Error(`Unknown packed character code ${code}.`);
      part = character + part;
      number >>= 6n;
    }
    result += part;
  }
  return result;
}

/** Reference encoder: ten six-bit characters per part (60 bits), four parts. */
export function packGitHubUsername(username: string, charMap = GITHUB_CHARACTER_MAP): bigint[] {
  validateMap(charMap);
  validateUsername(username);
  const parts = [0n, 0n, 0n, 0n];
  for (let i = 0; i < username.length; i++) {
    const code = charMap.indexOf(username[i]!.toLowerCase());
    if (code <= 0) throw new Error(`Character ${username[i]} is not supported by the packing map.`);
    const index = Math.floor(i / 10);
    parts[index] = (parts[index]! << 6n) | BigInt(code);
  }
  return parts;
}

function validateUsername(username: string) {
  if (username.length > 39 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(username)) {
    throw new Error("Decoded GitHub username must have 1–39 letters/digits, with single internal hyphens only.");
  }
}

export function decodeGitHubUsername(parts: readonly PackedNumber[], charMap = GITHUB_CHARACTER_MAP): string {
  if (parts.length !== 4) throw new Error("Expected gh_user_part1 through gh_user_part4, in order.");
  // Zero-coded trailing spaces may be used to pad the final packed part.
  const username = unpack6Bit(parts, charMap).trimEnd();
  validateUsername(username);
  return username;
}
