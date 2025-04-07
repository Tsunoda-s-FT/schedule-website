"use client"

import { useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/data-table"
import { useStudents } from "@/hooks/useStudentQuery"
import { useStudentDelete } from "@/hooks/useStudentMutation"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Student } from "@prisma/client"
import { StudentFormDialog } from "@/components/student/student-form-dialog"

export function StudentTable() {
    const [searchTerm, setSearchTerm] = useState("")
    const { data: students = [], isLoading } = useStudents()
    const deleteStudentMutation = useStudentDelete()

    const [studentToEdit, setStudentToEdit] = useState<Student | null>(null)
    const [studentToDelete, setStudentToDelete] = useState<Student | null>(null)
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

    const filteredStudents = searchTerm
        ? students.filter(
            (student) =>
                student.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (student.notes && student.notes.toLowerCase().includes(searchTerm.toLowerCase())),
        )
        : students

    const columns: ColumnDef<Student>[] = [
        {
            accessorKey: "name",
            header: "名前",
        },
        {
            accessorKey: "kanaName",
            header: "カナ名",
            cell: ({ row }) => row.original.kanaName || "N/A", // Показываем N/A, если kanaName пустое
        },
        {
            accessorKey: "gradeId",
            header: "学年ID",
            cell: ({ row }) => row.original.gradeId || "N/A",
        },
        {
            accessorKey: "schoolName",
            header: "学校名",
        },
        {
            accessorKey: "schoolType",
            header: "学校タイプ",
            cell: ({ row }) => row.original.schoolType || "N/A",
        },
        {
            accessorKey: "examSchoolType",
            header: "受験校タイプ",
            cell: ({ row }) => row.original.examSchoolType || "N/A",
        },
        {
            accessorKey: "examSchoolCategoryType",
            header: "受験校カテゴリータイプ",
            cell: ({ row }) => row.original.examSchoolCategoryType || "N/A",
        },
        {
            accessorKey: "firstChoiceSchool",
            header: "第一志望校",
            cell: ({ row }) => row.original.firstChoiceSchool || "N/A",
        },
        {
            accessorKey: "secondChoiceSchool",
            header: "第二志望校",
            cell: ({ row }) => row.original.secondChoiceSchool || "N/A",
        },
        {
            accessorKey: "enrollmentDate",
            header: "入学日",
            cell: ({ row }) => row.original.enrollmentDate ? row.original.enrollmentDate.toLocaleDateString() : "N/A",
        },
        {
            accessorKey: "birthDate",
            header: "生年月日",
            cell: ({ row }) => row.original.birthDate ? row.original.birthDate.toLocaleDateString() : "N/A",
        },
        {
            accessorKey: "homePhone",
            header: "自宅電話",
            cell: ({ row }) => row.original.homePhone || "N/A",
        },
        {
            accessorKey: "parentMobile",
            header: "保護者携帯電話",
            cell: ({ row }) => row.original.parentMobile || "N/A",
        },
        {
            accessorKey: "studentMobile",
            header: "学生携帯電話",
            cell: ({ row }) => row.original.studentMobile || "N/A",
        },
        {
            accessorKey: "parentEmail",
            header: "保護者メール",
            cell: ({ row }) => row.original.parentEmail || "N/A",
        },
        {
            accessorKey: "notes",
            header: "メモ",
            cell: ({ row }) => row.original.notes || "N/A",
        },
        {
            id: "actions",
            header: "操作",
            cell: ({ row }) => {
                return (
                    <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => setStudentToEdit(row.original)}>
                            <Pencil className="h-4 w-4"/>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setStudentToDelete(row.original)}>
                            <Trash2 className="h-4 w-4 text-destructive"/>
                        </Button>
                    </div>
                );
            },
        },
    ];

    const handleDeleteStudent = async () => {
        if (studentToDelete) {
            try {
                await deleteStudentMutation.mutateAsync(studentToDelete.studentId)
                setStudentToDelete(null)
            } catch (error) {
                console.error("学生の削除に失敗しました:", error)
            }
        }
    }

    return (
        <>
            <DataTable
                columns={columns}
                data={filteredStudents}
                isLoading={isLoading}
                searchPlaceholder="学生を検索..."
                onSearch={setSearchTerm}
                searchValue={searchTerm}
                onCreateNew={() => setIsCreateDialogOpen(true)}
                createNewLabel="新しい学生"
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
            <StudentFormDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} student={null}/>

            {/* 削除確認ダイアログ */}
            <AlertDialog open={!!studentToDelete} onOpenChange={(open) => !open && setStudentToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>学生の削除</AlertDialogTitle>
                        <AlertDialogDescription>
                            本当にこの学生を削除しますか？ この操作は元に戻せません。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => setStudentToDelete(null)}>キャンセル</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteStudent}>削除</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
