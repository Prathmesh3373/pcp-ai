import { PCPMemoryStore } from "./stores/pcp-memory-store.js";

async function main(): Promise<void> {
  const memoryStore = new PCPMemoryStore();

  console.log("Checking PCP local memory service...");

  await memoryStore.checkConnection();

  console.log("Searching approved personal context...\n");

  const results = await memoryStore.searchContext({
    query:
      "What AI projects, technical experience, and interests does the user have?",
    limit: 8,
  });

  if (results.length === 0) {
    console.log("No relevant memories were found.");
    return;
  }

  console.log(`Found ${results.length} relevant memories:\n`);

  results.forEach((result, index) => {
    console.log("----------------------------------------");
    console.log(`Result ${index + 1}`);
    console.log("----------------------------------------");
    console.log(result.content);

    if (result.category) {
      console.log(`Category: ${result.category}`);
    }

    if (result.evidence) {
      console.log(`Evidence: ${result.evidence}`);
    }

    console.log(
      `Score: ${Math.round(result.score * 100)}%`,
    );

    console.log();
  });
}

main().catch((error: unknown) => {
  console.error("\nPCP search test failed:");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }

  process.exit(1);
});