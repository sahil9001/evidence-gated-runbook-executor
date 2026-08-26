import { createMemoryStore } from "./memory";
import { runStoreConformance } from "./conformance";

runStoreConformance("memory", () => createMemoryStore());
