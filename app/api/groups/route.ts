import { authErrorResponse, requireAuthContext } from "../../../lib/auth";

export async function GET(request: Request) {
  try {
    const context = await requireAuthContext(request);
    return Response.json({ memberships: context.memberships, activeMembership: context.activeMembership });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireAuthContext(request);
    return Response.json({ error: "内部版不开放自助创建小组，请联系运维初始化" }, { status: 403 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
