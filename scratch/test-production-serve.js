import http from "node:http";
import { buildApp } from "../apps/server/dist/app.js";

async function testProductionServing() {
  console.log("Testing standalone production server serving both API and static frontend...");
  const app = await buildApp(":memory:");
  await app.listen({ port: 4329, host: "127.0.0.1" });

  try {
    // 1. Test API health
    const healthRes = await fetch("http://127.0.0.1:4329/api/v1/health");
    console.log(`[Prod Test] /api/v1/health -> HTTP ${healthRes.status}`);
    const healthJson = await healthRes.json();
    console.log("[Prod Test] Health response:", healthJson);

    // 2. Test SPA index.html serving
    const rootRes = await fetch("http://127.0.0.1:4329/");
    console.log(`[Prod Test] / (root SPA) -> HTTP ${rootRes.status}`);
    const rootText = await rootRes.text();
    console.log(`[Prod Test] Root HTML length: ${rootText.length} bytes, has DOCTYPE: ${rootText.includes("<!doctype html") || rootText.includes("<!DOCTYPE html")}`);

    if (healthRes.ok && rootRes.ok && rootText.includes("Autonomous Development Orchestrator")) {
      console.log("SUCCESS: Standalone production server cleanly serves frontend bundle & backend API on single port without dev proxies!");
    } else {
      throw new Error("Production serving verification failed!");
    }
  } finally {
    await app.close();
  }
}

testProductionServing().catch((err) => {
  console.error(err);
  process.exit(1);
});
