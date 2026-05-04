export default async () =>
  new Response(JSON.stringify({ ok: true, service: "claroia-netlify", mode: "byok" }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
