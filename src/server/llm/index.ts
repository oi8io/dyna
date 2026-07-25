import { DeepSeekGameProvider } from "@/server/llm/deepseek-provider";
import { FakeGameProvider } from "@/server/llm/fake-provider";
import type { GameGenerationProvider } from "@/server/llm/types";
import { getServerEnv, isLiveGenerationReady } from "@/server/env";

// Annotated with the interface rather than inferred as a union of the two
// classes, so optional capabilities stay callable through the common type.
export function getGameGenerationProvider(): GameGenerationProvider {
  const env = getServerEnv();
  if (isLiveGenerationReady() && env.AI_PROVIDER_MODE === "live") {
    return new DeepSeekGameProvider();
  }
  return new FakeGameProvider();
}
