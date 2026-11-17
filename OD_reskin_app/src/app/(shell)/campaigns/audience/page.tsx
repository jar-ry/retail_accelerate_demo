import { redirect } from "next/navigation";

// The old Audience Builder's address; bookmarks land on the new builder.
export default function OldAudienceBuilder() {
  redirect("/campaigns/audiences");
}
