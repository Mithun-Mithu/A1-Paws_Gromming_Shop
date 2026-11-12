import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { phoneNumberSchema } from "../utils/phone.js";

describe("phoneNumberSchema", () => {
  it("accepts a formatted international phone number", () => {
    assert.equal(phoneNumberSchema.safeParse("+91 (98765) 43210").success, true);
  });

  it("accepts phone numbers at the 7- and 15-digit boundaries", () => {
    assert.equal(phoneNumberSchema.safeParse("1234567").success, true);
    assert.equal(phoneNumberSchema.safeParse("123456789012345").success, true);
  });

  it("rejects values with no digits", () => {
    assert.equal(phoneNumberSchema.safeParse("-------").success, false);
  });

  it("rejects plus signs outside the leading country-code position", () => {
    assert.equal(phoneNumberSchema.safeParse("123++4567").success, false);
  });

  it("rejects fewer than 7 or more than 15 digits", () => {
    assert.equal(phoneNumberSchema.safeParse("123456").success, false);
    assert.equal(phoneNumberSchema.safeParse("1234567890123456").success, false);
  });
});
