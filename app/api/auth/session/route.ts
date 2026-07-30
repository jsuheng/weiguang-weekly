import { authErrorResponse, getAuthContext } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getAuthContext(request);
    if (!context) return Response.json({ authenticated: false }, { status: 401 });
    return Response.json({ authenticated: true, ...context });
  } catch (error) {
    return authErrorResponse(error);
  }
}
