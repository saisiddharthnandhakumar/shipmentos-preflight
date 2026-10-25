import { readFileSync } from "node:fs";
import { POST as importPost } from "@/app/api/import/route";
import { req, type Jar } from "./http";

export function uploadReq(jar: Jar, fixture: string, name = fixture) {
  const form = new FormData();
  form.append("file", new File([readFileSync(`tests/fixtures/${fixture}`)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  return req("/api/import", { method: "POST", jar, rawBody: form });
}

export async function upload(jar: Jar, fixture: string) {
  const res = await importPost(uploadReq(jar, fixture));
  return { status: res.status, body: await res.json() };
}
