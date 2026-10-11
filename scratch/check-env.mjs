import { SettingsManager } from "../apps/server/dist/platform/settings-manager.js";
import { getActiveProvider } from "../apps/server/dist/providers/reasoning/registry.js";
import { getBridgeStatus, listBridges } from "../apps/server/dist/platform/antigravity-agent.js";

async function main() {
  const settings = SettingsManager.loadSettings();
  console.log("Persisted Settings:", JSON.stringify(settings, null, 2));
  console.log("Data Dir:", SettingsManager.getDataDir());

  const provider = getActiveProvider();
  console.log("Active Provider ID:", provider.id);
  console.log("Active Provider Model:", provider.getModel());
  
  try {
    const health = await provider.healthCheck();
    console.log("Provider Health Check:", JSON.stringify(health, null, 2));
  } catch (err) {
    console.log("Provider Health Check Error:", err.message);
  }

  const bridges = listBridges();
  console.log("Bridge Instances:", JSON.stringify(bridges, null, 2));

  const bridgeStatus = await getBridgeStatus();
  console.log("Bridge Status:", JSON.stringify(bridgeStatus, null, 2));
}

main().catch(console.error);
