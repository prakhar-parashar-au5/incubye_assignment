// Test-only HTTP proxy in front of the real Express backend, for two dashboard journeys:
//
// - Partial failure: GET /api/v1/dashboard/breakdowns answers 503 SERVICE_UNAVAILABLE, in the
//   backend's public error shape. Every other request, including the other three dashboard
//   endpoints, goes to the real backend unchanged, so the healthy sections show real data.
// - No analytics call for an invalid link: the proxy counts dashboard requests, and
//   GET /__test/dashboard-requests returns the count.
//
// Started by playwright.config.ts on 127.0.0.1:3907 with E2E_API_BASE_URL as the target, and
// used only by the Next.js server on port 3908. It never logs request or response bodies.
import { createServer, request as httpRequest } from "node:http";

const target = new URL(process.env.E2E_API_BASE_URL ?? "");
let dashboardRequests = 0;

createServer((req, res) => {
  const path = req.url ?? "/";
  if (req.method === "GET" && path === "/__test/dashboard-requests") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ count: dashboardRequests }));
    return;
  }
  if (path.startsWith("/api/v1/dashboard/")) dashboardRequests += 1;
  if (req.method === "GET" && path.startsWith("/api/v1/dashboard/breakdowns")) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "The service is temporarily unavailable. Try again shortly." } }));
    return;
  }
  const upstream = httpRequest(
    { hostname: target.hostname, port: target.port, method: req.method, path, headers: { ...req.headers, host: target.host } },
    (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "Upstream unavailable." } }));
  });
  req.pipe(upstream);
}).listen(3907, "127.0.0.1");
