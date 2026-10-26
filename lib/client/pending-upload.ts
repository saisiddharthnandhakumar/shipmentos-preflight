"use client";

/**
 * A spreadsheet chosen on the New booking page, handed to the chat page across a client-side navigation.
 * Held in memory only: a hard refresh drops it and the chat simply opens empty.
 */
let stashed: File | null = null;

export const stashUpload = (file: File) => {
  stashed = file;
};
export const hasStashedUpload = () => stashed !== null;
export function takeStashedUpload(): File | null {
  const f = stashed;
  stashed = null;
  return f;
}

export const MAX_XLSX_BYTES = 4 * 1024 * 1024;

/** Quick client-side check so a wrong file is rejected before leaving the page. */
export function xlsxProblem(file: File): string | null {
  if (!/\.xlsx$/i.test(file.name)) return "That isn't an .xlsx file. Save your spreadsheet as an Excel Workbook (.xlsx) and try again.";
  if (file.size > MAX_XLSX_BYTES) return "That file is larger than 4 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}
