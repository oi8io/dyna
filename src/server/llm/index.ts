import { DeepSeekGameProvider } from "@/server/llm/deepseek-provider";
import { FakeGameProvider } from "@/server/llm/fake-provider";
import { getServerEnv, isLiveGenerationReady } from "@/server/env";

export function getGameGenerationProvider() {
  const env = getServerEnv();
  if (isLiveGenerationReady() && env.AI_PROVIDER_MODE === "live") {
    return new DeepSeekGameProvider();
  }
  return new FakeGameProvider();
}
