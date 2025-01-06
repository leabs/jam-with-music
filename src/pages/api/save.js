// Example: src/pages/api/save.js
// In Astro, you might do something like: `export async function post(context) {...}` 
// or use an integration. This is a simplified example.

let store = {}; // in-memory { shortId: dataObj }

function generateShortId(length = 6) {
  // a quick-n-dirty short ID generator
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function post({ request }) {
  try {
    const body = await request.json();
    // e.g. { bpm: 120, patterns: { kick: "101010...", snare: "01010..." } }

    // generate a short ID (make sure we don't collide, or do a while-loop if needed)
    let shortId = generateShortId(6);
    while (store[shortId]) {
      shortId = generateShortId(6);
    }

    // Store the data
    store[shortId] = body;

    return new Response(JSON.stringify({ shortId }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Bad request" }), { status: 400 });
  }
}

export async function get({ request }) {
  // e.g. GET /api/save?id=AbCd12
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return new Response(JSON.stringify({ error: "No id provided" }), { status: 400 });
  }
  if (!store[id]) {
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  }

  return new Response(JSON.stringify(store[id]), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}