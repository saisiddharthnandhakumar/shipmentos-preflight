import { redirect } from "next/navigation";

/** Old name of the Dashboard; kept so bookmarks keep working. */
export default function TodayRedirect() {
  redirect("/dashboard");
}
