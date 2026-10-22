import { mergeSettings, type AppSettings } from "@rave-run/core";
import type { PrismaClient } from "@rave-run/db";

export async function loadSettings(prisma: PrismaClient): Promise<AppSettings> {
  return mergeSettings(await prisma.setting.findMany());
}
