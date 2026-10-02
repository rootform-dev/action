import { type MainDependencies, main } from "./main.ts";

export async function setup(dependencies?: MainDependencies): Promise<void> {
  await main("setup", dependencies);
}
