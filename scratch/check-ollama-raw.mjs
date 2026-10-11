async function checkOllamaRaw() {
  const res = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "qwen3:30b",
      messages: [
        { role: "user", content: "Say hello in one word." }
      ],
      stream: false,
    }),
  });
  const data = await res.json();
  console.log("Raw Ollama response for simple prompt:");
  console.log(JSON.stringify(data, null, 2));
}

checkOllamaRaw().catch(console.error);
