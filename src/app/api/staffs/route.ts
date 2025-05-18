// src/app/api/staff/route.ts
import { NextRequest, NextResponse } from "next/server";
import { withRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { staffCreateSchema, staffFilterSchema } from "@/schemas/staff.schema";
import { User } from "@prisma/client";
import bcrypt from "bcryptjs";

type FormattedStaff = {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
};

// Helper function to format staff response with proper typing
const formatStaff = (staff: User): FormattedStaff => ({
  id: staff.id,
  name: staff.name,
  username: staff.username,
  email: staff.email,
  role: staff.role,
  createdAt: staff.createdAt,
  updatedAt: staff.updatedAt,
});

// GET - List staff with pagination and filters
export const GET = withRole(
  ["ADMIN"],
  async (request: NextRequest, session) => {
    // Parse query parameters
    const url = new URL(request.url);
    const params = Object.fromEntries(url.searchParams.entries());

    // Validate and parse filter parameters
    const result = staffFilterSchema.safeParse(params);
    if (!result.success) {
      return NextResponse.json(
        { error: "フィルターパラメータが無効です" }, // "Invalid filter parameters"
        { status: 400 }
      );
    }

    const { page, limit, name } = result.data;

    // Build filter conditions
    const where: any = {
      role: "STAFF",
    };

    if (name) {
      where.OR = [
        { name: { contains: name, mode: "insensitive" } },
        { username: { contains: name, mode: "insensitive" } },
        { email: { contains: name, mode: "insensitive" } },
      ];
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Fetch total count
    const total = await prisma.user.count({ where });

    // Fetch staff
    const staffList = await prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { name: "asc" },
    });

    // Prepare response data
    const formattedStaff = staffList.map(formatStaff);

    return NextResponse.json({
      data: formattedStaff,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    });
  }
);

// POST - Create a new staff
export const POST = withRole(
  ["ADMIN"],
  async (request: NextRequest, session) => {
    try {
      const body = await request.json();

      // Validate request body
      const result = staffCreateSchema.safeParse(body);
      if (!result.success) {
        return NextResponse.json(
          { error: "入力データが無効です" }, // "Invalid input data"
          { status: 400 }
        );
      }

      const { username, password, email, name } = result.data;

      // Check if username or email already exists
      const existingUser = await prisma.user.findFirst({
        where: { OR: [{ username }, { email }] },
      });

      if (existingUser) {
        return NextResponse.json(
          {
            error:
              email && existingUser.email === email
                ? "メールアドレスは既に使用されています" // "Email already in use"
                : "ユーザー名は既に使用されています", // "Username already taken"
          },
          { status: 409 }
        );
      }

      // Hash the password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create staff user
      const newStaff = await prisma.user.create({
        data: {
          username,
          passwordHash,
          email,
          name,
          role: "STAFF",
        },
      });

      // Format the response
      const formattedStaff = formatStaff(newStaff);

      return NextResponse.json(
        {
          data: [formattedStaff],
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
      console.error("Error creating staff:", error);
      return NextResponse.json(
        { error: "スタッフの作成に失敗しました" }, // "Failed to create staff"
        { status: 500 }
      );
    }
  }
);
