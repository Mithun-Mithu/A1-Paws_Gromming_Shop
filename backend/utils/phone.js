import { z } from "zod";

export const phoneNumberSchema = z.string().trim()
  .regex(/^\+?[0-9()\-\s]{6,19}$/, "Enter a valid phone number")
  .refine(value => {
    const digitCount = value.replace(/\D/g, "").length;
    return digitCount >= 7 && digitCount <= 15;
  }, "Enter a valid phone number");
