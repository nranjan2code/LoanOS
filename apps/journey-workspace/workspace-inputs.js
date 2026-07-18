export function inputControlType(schemaType) {
  if (schemaType === "boolean") return "checkbox";
  if (schemaType === "date") return "date";
  if (schemaType === "tel") return "tel";
  return "text";
}

export function inputPattern(schemaType) {
  if (schemaType === "integer" || schemaType === "money_string") return "[0-9]+";
  if (schemaType === "decimal_string") return "[0-9]+(?:\\.[0-9]+)?";
  return undefined;
}

export function readWorkspaceInputValue(input) {
  if (input.dataset.type === "boolean") return Boolean(input.checked);
  if (!input.value) return undefined;
  if (input.dataset.type === "money_string" && !/^[0-9]+$/.test(input.value)) return undefined;
  if (input.dataset.type === "decimal_string" && !/^[0-9]+(?:\.[0-9]+)?$/.test(input.value)) return undefined;
  if (input.dataset.type === "integer") {
    if (!/^[0-9]+$/.test(input.value)) return undefined;
    const value = Number(input.value);
    return Number.isSafeInteger(value) ? value : undefined;
  }
  return input.value;
}

export function restoreWorkspaceInputValue(input, prior) {
  if (prior == null || String(prior).includes("•")) return;
  if (input.dataset.type === "boolean") input.checked = prior === true;
  else input.value = String(prior);
}
