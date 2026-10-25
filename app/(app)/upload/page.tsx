import type { Metadata } from "next";
import { UploadStart } from "@/components/upload/upload-workspace";

export const metadata: Metadata = { title: "Upload Excel" };

export default function UploadPage() {
  return <UploadStart />;
}
