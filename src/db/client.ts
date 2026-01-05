import { PrismaClient } from "@prisma/client";

// Shared Prisma client for all db access
export const prisma = new PrismaClient();
