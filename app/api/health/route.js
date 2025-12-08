const USERS = [
  {
    id: 1,
    username: 'marandi',
    password: '1234',
    name: 'مرندی',
    role: 'admin',
  },
];

export async function POST(request) {
  try {
    const body = await request.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '').trim();

    const user = USERS.find(
      (u) => u.username === username && u.password === password
    );

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'invalid_credentials' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // پسورد رو نفرستیم به فرانت
    const { password: _pw, ...safeUser } = user;

    return new Response(
      JSON.stringify({
        ok: true,
        user: safeUser,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (e) {
    console.error('login_error', e);
    return new Response(
      JSON.stringify({ error: 'bad_request' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export async function GET() {
  // فقط برای تست سریع با مرورگر
  return Response.json({ ok: true, message: 'login endpoint is alive' });
}
