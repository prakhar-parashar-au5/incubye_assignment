import { redirect } from "next/navigation";

// The application starts at the employee directory. Signed-out visitors are sent on to sign-in
// by src/proxy.ts.
export default function Home() {
  redirect("/employees");
}
