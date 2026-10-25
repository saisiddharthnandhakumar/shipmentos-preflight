import { POST as sessionPost } from "@/app/api/session/route";
import { capture, newJar, req, type Jar } from "./http";

export async function newSession(): Promise<Jar> {
  const jar = newJar();
  const res = await sessionPost(req("/api/session", { method: "POST" }));
  if (res.status !== 200) throw new Error(`session create failed ${res.status}`);
  capture(jar, res);
  return jar;
}
