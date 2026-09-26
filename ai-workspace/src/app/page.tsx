import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";

export default async function Home() {
  redirect((await getSessionUser()) ? "/projects" : "/login");
}
