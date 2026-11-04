import { FakeAiProvider } from "./index";

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("Fake AI smoke must not access the network");
  }) as typeof fetch;

  try {
    const provider = new FakeAiProvider();
    const first = await provider.generateText({ prompt: "fake-ai-smoke", model: "fake-model" });
    const second = await provider.generateText({ prompt: "fake-ai-smoke", model: "fake-model" });
    if (JSON.stringify(first) !== JSON.stringify(second)) {
      throw new Error("Fake AI output was not deterministic");
    }

    console.log(
      JSON.stringify({
        event: "ai.fake.smoke.completed",
        deterministic: true,
        networkCalls: 0,
        outputLength: first.text.length,
      }),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown fake AI smoke error";
  console.error(JSON.stringify({ event: "ai.fake.smoke.failed", message }));
  process.exitCode = 1;
});
