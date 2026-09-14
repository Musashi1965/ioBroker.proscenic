export function validateAccountEmailForTest(value: string): void {
  validateAccountEmail(value);
}

export function validateAccountEmail(value: string): void {
  if (value.includes("<") || value.includes(">") || value === "user@example.invalid" || value.includes("deine-")) {
    throw new Error("PROSCENIC_EMAIL still looks like a placeholder; set the real Proscenic account e-mail locally");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
    throw new Error("PROSCENIC_EMAIL must be the real Proscenic account e-mail address");
  }
}
