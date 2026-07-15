// Prisma client singleton. Used only as a typed SQL executor ($queryRaw):
// the GTFS schema lives in scripts/init.sql, not in Prisma models.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
