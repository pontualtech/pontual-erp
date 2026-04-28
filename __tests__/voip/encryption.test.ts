// =============================================================================
// __tests__/voip/encryption.test.ts
// =============================================================================
// Testa encrypt/decrypt round-trip + tampering detection (GCM auth tag).
// =============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  generateSipSecret,
  maskSecret,
} from "@/lib/voip/encryption";

beforeAll(() => {
  // Garante que ENCRYPTION_SALT está setado no ambiente de teste
  if (!process.env.ENCRYPTION_SALT) {
    process.env.ENCRYPTION_SALT = "test-salt-32-bytes-long-aaaaaaaa";
  }
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = "test-key-32-bytes-long-bbbbbbbbbb";
  }
});

describe("voip/encryption", () => {
  describe("encryptSecret + decryptSecret round-trip", () => {
    it("decripta string igual à original", () => {
      const plain = "minha-senha-sip-secreta";
      const cipher = encryptSecret(plain);
      expect(cipher).not.toBe(plain);
      expect(decryptSecret(cipher)).toBe(plain);
    });

    it("gera ciphertext diferente para o mesmo input (IV random)", () => {
      const plain = "mesma-senha";
      const c1 = encryptSecret(plain);
      const c2 = encryptSecret(plain);
      expect(c1).not.toBe(c2);
      // mas ambos decriptam pra mesma coisa
      expect(decryptSecret(c1)).toBe(plain);
      expect(decryptSecret(c2)).toBe(plain);
    });

    it("rejeita ciphertext truncado (tampering)", () => {
      const plain = "abc12345";
      const cipher = encryptSecret(plain);
      const tampered = cipher.slice(0, cipher.length - 5);
      expect(() => decryptSecret(tampered)).toThrow(/falha/i);
    });

    it("rejeita ciphertext com byte alterado (auth tag GCM)", () => {
      const plain = "abc12345";
      const cipher = encryptSecret(plain);
      const tampered = cipher.replace(/.$/, (last) => (last === "A" ? "B" : "A"));
      expect(() => decryptSecret(tampered)).toThrow(/falha/i);
    });

    it("rejeita string vazia em encrypt", () => {
      expect(() => encryptSecret("")).toThrow(/não-vazia/);
    });

    it("rejeita plaintext muito longo (> 200 chars)", () => {
      const longStr = "x".repeat(201);
      expect(() => encryptSecret(longStr)).toThrow(/200 chars/);
    });
  });

  describe("generateSipSecret", () => {
    it("gera 32 chars hex", () => {
      const s = generateSipSecret();
      expect(s).toMatch(/^[0-9a-f]{32}$/);
    });

    it("gera valores diferentes em chamadas consecutivas", () => {
      const s1 = generateSipSecret();
      const s2 = generateSipSecret();
      expect(s1).not.toBe(s2);
    });

    it("encripta e decripta secret gerado", () => {
      const plain = generateSipSecret();
      const cipher = encryptSecret(plain);
      expect(decryptSecret(cipher)).toBe(plain);
    });
  });

  describe("maskSecret", () => {
    it("retorna hasSecret=true para string não-vazia", () => {
      expect(maskSecret("abc123")).toEqual({ hasSecret: true });
    });

    it("retorna hasSecret=false para null/undefined/vazio", () => {
      expect(maskSecret(null)).toEqual({ hasSecret: false });
      expect(maskSecret(undefined)).toEqual({ hasSecret: false });
      expect(maskSecret("")).toEqual({ hasSecret: false });
    });
  });
});