import type { Metadata } from "next";
import { UploadStart } from "@/components/upload/upload-workspace";

export const metadata: Metadata = { title: "Master Data" };

export default function UploadPage() {
  return <UploadStart />;
}
