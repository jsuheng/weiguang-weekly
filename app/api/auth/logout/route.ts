import { clearSessionCookie, deleteSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  await deleteSession(request);
  return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie() } });
}
