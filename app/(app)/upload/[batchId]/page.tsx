import type { Metadata } from "next";
import { Suspense } from "react";
import { UploadResults } from "@/components/upload/upload-workspace";

export const metadata: Metadata = { title: "Upload results" };

export default async function UploadResultsPage({ params }: PageProps<"/upload/[batchId]">) {
  const { batchId } = await params;
  return (
    <Suspense>
      <UploadResults batchId={batchId} />
    </Suspense>
  );
}
