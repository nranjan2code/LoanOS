export function checkedValues(root, name) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  return [...root.querySelectorAll(`[name="${name}"]:checked`)].map((input) => input.value);
}

export function rupeesToPaise(value) {
  const normalized = String(value ?? "").trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("Enter a non-negative rupee amount with no more than two decimal places.");
  const [rupees, fraction = ""] = normalized.split(".");
  return (BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}
