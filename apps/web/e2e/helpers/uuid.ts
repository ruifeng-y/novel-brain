import { randomBytes } from "node:crypto";

export function uuidV7(): string {
  const hex = `${Date.now().toString(16).padStart(12, "0")}${randomBytes(10).toString("hex")}`;
  const characters = [...hex];
  characters[12] = "7";
  characters[16] = ((Number.parseInt(characters[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = characters.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
