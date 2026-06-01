import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me');

export type CustomerJwt = { sub: string; kind: 'customer' };
export type AdminJwt = { sub: string; kind: 'admin'; role: string };
export type AnyJwt = CustomerJwt | AdminJwt;

export async function sign(payload: AnyJwt, expiresIn = '30d'): Promise<string> {
  return new SignJWT(payload as Record<string, any>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(SECRET);
}

export async function verify(token: string): Promise<AnyJwt> {
  const { payload } = await jwtVerify(token, SECRET);
  return payload as unknown as AnyJwt;
}
