async function testOllamaJson() {
  const t0 = Date.now();
  const res = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3:30b",
      messages: [
        { role: "system", content: "You are an assistant. Reply with one JSON object: {\"status\": \"ok\", \"brief\": \"markdown brief\"}" },
        { role: "user", content: "Provide a 2-line engineering brief for a health check endpoint." }
      ],
      format: "json",
      stream: false,
      options: {
        num_predict: 1000,
        temperature: 0.2
      }
    }),
  });
  const data = await res.json();
  console.log(`Completed in ${((Date.now() - t0)/1000).toFixed(2)}s`);
  console.log("Done reason:", data.done_reason);
  console.log("Thinking length:", data.message?.thinking?.length || 0);
  console.log("Content:\n", data.message?.content);
  try {
    const parsed = JSON.parse(data.message?.content);
    console.log("Successfully parsed JSON:", parsed);
  } catch (err) {
    console.log("JSON parse error:", err.message);
  }
}

testOllamaJson().catch(console.error);
