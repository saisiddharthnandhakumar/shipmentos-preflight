import type { NextRequest } from "next/server";
import { IMPORT_LIMITS } from "@/lib/import/parse-xlsx";
import { ApiError } from "./http";

/** Validate a multipart .xlsx upload (size, extension, zip magic bytes) and return its bytes. Nothing is stored. */
export async function readWorkbookUpload(req: NextRequest): Promise<{ form: FormData; bytes: Buffer; name: string }> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > IMPORT_LIMITS.maxBytes + 64 * 1024) throw new ApiError(413, "TOO_LARGE", "The file is larger than 4 MB.");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "INVALID_UPLOAD", "Expected a multipart upload with a 'file' field.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "INVALID_UPLOAD", "Choose an .xlsx file to upload.");
  if (!/\.xlsx$/i.test(file.name)) throw new ApiError(400, "INVALID_TYPE", "Only .xlsx workbooks are supported (Excel 2007+).");
  if (file.size > IMPORT_LIMITS.maxBytes) throw new ApiError(413, "TOO_LARGE", "The file is larger than 4 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ApiError(400, "INVALID_TYPE", "That file isn't a valid .xlsx workbook.");
  return { form, bytes, name: file.name };
}
