import type { Metadata } from "next";
import { UploadResults } from "@/components/upload/upload-workspace";

export const metadata: Metadata = { title: "Upload results" };

export default async function UploadResultsPage({ params }: PageProps<"/upload/[batchId]">) {
  const { batchId } = await params;
  return <UploadResults batchId={batchId} />;
}
