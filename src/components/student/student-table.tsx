"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { useStudents } from "@/hooks/useStudentQuery";
import { useStudentDelete } from "@/hooks/useStudentMutation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Student } from "@/schemas/student.schema";
import { StudentFormDialog } from "@/components/student/student-form-dialog";
import { StudentWithGrade } from "@/schemas/student.schema";

export function StudentTable() {
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const {
    data: students,
    isLoading,
    isFetching,
  } = useStudents({
    page,
    limit: pageSize,
    name: searchTerm || undefined,
  });
  console.log(students);
  const totalCount = students?.pagination.total || 0;
  const deleteStudentMutation = useStudentDelete();

  const [studentToEdit, setStudentToEdit] = useState<Student | null>(null);
  const [studentToDelete, setStudentToDelete] = useState<Student | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Helper to normalize nulls to undefined for Student fields
  function normalizeStudentNulls(student: StudentWithGrade): Student {
    return {
      ...student,
      kanaName: student.kanaName ?? undefined,
      gradeId: student.gradeId ?? undefined,
      schoolName: student.schoolName ?? undefined,
      schoolType: student.schoolType ?? undefined,
      examSchoolType: student.examSchoolType ?? undefined,
      examSchoolCategoryType: student.examSchoolCategoryType ?? undefined,
      firstChoiceSchool: student.firstChoiceSchool ?? undefined,
      secondChoiceSchool: student.secondChoiceSchool ?? undefined,
      enrollmentDate: student.enrollmentDate ? (typeof student.enrollmentDate === "string" ? student.enrollmentDate : student.enrollmentDate.toISOString().slice(0, 10)) : undefined,
      birthDate: student.birthDate,
      homePhone: student.homePhone ?? undefined,
      parentMobile: student.parentMobile ?? undefined,
      studentMobile: student.studentMobile ?? undefined,
      parentEmail: student.parentEmail ?? undefined,
      notes: student.notes ?? undefined,
    };
  }

  const columns: ColumnDef<StudentWithGrade>[] = [
    {
      accessorKey: "name",
      header: "名前",
    },
    {
      accessorKey: "grade.name",
      header: "学年",
      cell: ({ row }) => row.original.grade?.name || "-",
    },
    {
      accessorKey: "kanaName",
      header: "カナ名",
      cell: ({ row }) => row.original.kanaName || "-",
    },
    {
      accessorKey: "schoolName",
      header: "学校名",
    },
    {
      accessorKey: "schoolType",
      header: "学校タイプ",
      cell: ({ row }) => {
        const value = row.original.schoolType as string | null;
        if (value === "PRIVATE") return "私立";
        if (value === "PUBLIC") return "公立";
        return "-";
      },
    },
    {
      accessorKey: "examSchoolType",
      header: "受験校タイプ",
      cell: ({ row }) => {
        const value = row.original.examSchoolType as string | null;
        if (value === "PRIVATE") return "私立";
        if (value === "PUBLIC") return "公立";
        return "-";
      },
    },
    {
      accessorKey: "examSchoolCategoryType",
      header: "受験校カテゴリータイプ",
      cell: ({ row }) => {
        const value = row.original.examSchoolCategoryType;
        if (value === "ELEMENTARY") return "小学校";
        if (value === "MIDDLE") return "中学校";
        if (value === "HIGH") return "高校";
        if (value === "UNIVERSITY") return "大学";
        if (value === "OTHER") return "その他";
        return "-";
      },
    },
    {
      accessorKey: "firstChoiceSchool",
      header: "第一志望校",
      cell: ({ row }) => row.original.firstChoiceSchool || "-",
    },
    {
      accessorKey: "secondChoiceSchool",
      header: "第二志望校",
      cell: ({ row }) => row.original.secondChoiceSchool || "-",
    },
    {
      accessorKey: "birthDate",
      header: "生年月日",
      cell: ({ row }) =>
        row.original.birthDate
          ? new Date(row.original.birthDate).toLocaleDateString()
          : "-",
    },
    {
      accessorKey: "homePhone",
      header: "自宅電話",
      cell: ({ row }) => row.original.homePhone || "-",
    },
    {
      accessorKey: "parentMobile",
      header: "保護者携帯電話",
      cell: ({ row }) => row.original.parentMobile || "-",
    },
    {
      accessorKey: "studentMobile",
      header: "学生携帯電話",
      cell: ({ row }) => row.original.studentMobile || "-",
    },
    {
      accessorKey: "parentEmail",
      header: "保護者メール",
      cell: ({ row }) => row.original.parentEmail || "-",
    },
    {
      accessorKey: "notes",
      header: "メモ",
      cell: ({ row }) => row.original.notes || "-",
    },
    {
      id: "actions",
      header: "操作",
      cell: ({ row }) => {
        return (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setStudentToEdit(normalizeStudentNulls(row.original))}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setStudentToDelete(normalizeStudentNulls(row.original))}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        );
      },
    },
  ];

  const handleDeleteStudent = async () => {
    if (studentToDelete) {
      try {
        await deleteStudentMutation.mutateAsync(studentToDelete.studentId);
        setStudentToDelete(null);
      } catch (error) {
        console.error("Failed to delete student:", error);
      }
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage + 1);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <>
      <DataTable
        columns={columns}
        data={students?.data || []}
        isLoading={isLoading || isFetching}
        searchPlaceholder="学生を検索..."
        onSearch={setSearchTerm}
        searchValue={searchTerm}
        onCreateNew={() => setIsCreateDialogOpen(true)}
        createNewLabel="新しい学生"
        pageIndex={page - 1}
        pageCount={totalPages || 1}
        onPageChange={handlePageChange}
        pageSize={pageSize}
        totalItems={totalCount}
      />

      {/* 編集ダイアログ */}
      {studentToEdit && (
        <StudentFormDialog
          open={!!studentToEdit}
          onOpenChange={(open) => !open && setStudentToEdit(null)}
          student={studentToEdit}
        />
      )}

      {/* 学生作成ダイアログ */}
      <StudentFormDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        student={null}
      />

      {/* 削除確認ダイアログ */}
      <AlertDialog
        open={!!studentToDelete}
        onOpenChange={(open) => !open && setStudentToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>学生の削除</AlertDialogTitle>
            <AlertDialogDescription>
              本当にこの学生を削除しますか？ この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setStudentToDelete(null)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStudent}>
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
