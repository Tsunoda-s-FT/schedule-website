// src/app/api/branches/route.ts
import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  branchCreateSchema,
  branchFilterSchema,
} from "@/schemas/branch.schema";
import { Branch, UserBranch } from "@prisma/client";

type BranchWithUsers = Branch & {
  userBranches: (UserBranch & {
    user: {
      id: string;
      name: string | null;
      username: string | null;
      email: string | null;
      role: string;
    };
  })[];
};

type FormattedBranch = {
  branchId: string;
  name: string;
  notes: string | null;
  users: {
    id: string;
    name: string | null;
    username: string | null;
    email: string | null;
    role: string;
  }[];
  createdAt: Date;
  updatedAt: Date;
};

// Helper function to format branch response
const formatBranch = (branch: BranchWithUsers): FormattedBranch => ({
  branchId: branch.branchId,
  name: branch.name,
  notes: branch.notes,
  users: branch.userBranches.map((ub) => ub.user),
  createdAt: branch.createdAt,
  updatedAt: branch.updatedAt,
});

// GET - List branches with pagination and filters
export const GET = withRole(
  ["ADMIN"],
  async (request: NextRequest, session) => {
    // Parse query parameters
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());

    // Validate and parse filter parameters
    const result = branchFilterSchema.safeParse(params);
    if (!result.success) {
      return NextResponse.json(
        { error: "フィルターパラメータが無効です" }, // "Invalid filter parameters"
        { status: 400 }
      );
    }

    const { page, limit, name } = result.data;

    // Build filter conditions
    const where: any = {};

    if (name) {
      where.name = {
        contains: name,
        mode: "insensitive",
      };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Fetch total count
    const total = await prisma.branch.count({ where });

    // Fetch branches with users
    const branches = await prisma.branch.findMany({
      where,
      include: {
        userBranches: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                email: true,
                role: true,
              },
            },
          },
        },
      },
      skip,
      take: limit,
      orderBy: { name: "asc" },
    });

    // Format branches
    const formattedBranches = branches.map(formatBranch);

    return NextResponse.json({
      data: formattedBranches,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  }
);

// POST - Create a new branch
export const POST = withRole(
  ["ADMIN"],
  async (request: NextRequest, session) => {
    try {
      const body = await request.json();

      // Validate request body
      const result = branchCreateSchema.safeParse(body);
      if (!result.success) {
        return NextResponse.json(
          { error: "入力データが無効です" }, // "Invalid input data"
          { status: 400 }
        );
      }

      const { name, notes, userIds = [] } = result.data;

      // Check if branch name already exists
      const existingBranch = await prisma.branch.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
      });

      if (existingBranch) {
        return NextResponse.json(
          { error: "支店名は既に使用されています" }, // "Branch name already in use"
          { status: 409 }
        );
      }

      // Verify that all userIds exist
      if (userIds.length > 0) {
        const userCount = await prisma.user.count({
          where: { id: { in: userIds } },
        });

        if (userCount !== userIds.length) {
          return NextResponse.json(
            { error: "一部のユーザーIDが存在しません" }, // "Some user IDs do not exist"
            { status: 400 }
          );
        }
      }

      // Create branch and user associations in a transaction
      const newBranch = await prisma.$transaction(async (tx) => {
        // Create branch
        const branch = await tx.branch.create({
          data: {
            name,
            notes,
          },
        });

        // Create user-branch associations
        if (userIds.length > 0) {
          await tx.userBranch.createMany({
            data: userIds.map((userId) => ({
              branchId: branch.branchId,
              userId,
            })),
          });
        }

        // Return branch with user associations
        return tx.branch.findUnique({
          where: { branchId: branch.branchId },
          include: {
            userBranches: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    username: true,
                    email: true,
                    role: true,
                  },
                },
              },
            },
          },
        });
      });

      if (!newBranch) {
        throw new Error("Failed to create branch");
      }

      // Format response
      const formattedBranch = formatBranch(newBranch);

      return NextResponse.json(
        {
          data: [formattedBranch],
          pagination: {
            total: 1,
            page: 1,
            limit: 1,
            pages: 1,
          },
        },
        { status: 201 }
      );
    } catch (error) {
      console.error("Error creating branch:", error);
      return NextResponse.json(
        { error: "支店の作成に失敗しました" }, // "Failed to create branch"
        { status: 500 }
      );
    }
  }
);
