import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { needsSetup } from "@/server/auth/setup";

export default async function Home() {
  if (await needsSetup()) redirect("/setup");
  redirect((await getSessionUser()) ? "/projects" : "/login");
}
