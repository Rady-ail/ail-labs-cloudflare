import { test, expect } from "vitest";
import { normalizePhoneId, isEmail, isUuid, clampInt, pickAllowed } from "../src/lib/validate";

test("telepon valid -> 6281234567890", () => {
  for (const x of ["081234567890", "81234567890", "+6281234567890", "6281234567890", "0812 3456 7890", "(0812) 345-67890", "0062 812-3456-7890"])
    expect(normalizePhoneId(x)).toBe("6281234567890");
});
test("telepon tidak valid -> null", () => {
  for (const x of ["0812", "628123", "12345678901234", "", "021-5551234"]) expect(normalizePhoneId(x)).toBeNull();
});
test("email, uuid, clampInt", () => {
  expect(isEmail("a@b.co")).toBe(true); expect(isEmail("a b@c.co")).toBe(false);
  expect(isUuid("3f2b8c1e-9d4a-4b6e-8a1c-2d5e7f9a0b3c")).toBe(true); expect(isUuid("x")).toBe(false);
  expect(clampInt("500", 1, 100, 20)).toBe(100); expect(clampInt("abc", 1, 100, 20)).toBe(20);
});
test("pickAllowed menolak field asing", () => {
  expect(() => pickAllowed({ a: 1, z: 2 }, ["a"])).toThrow("Field tidak dikenal");
});
